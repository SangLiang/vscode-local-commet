import * as vscode from 'vscode';
import { TagManager } from '../managers/tagManager';
import { CommentManager, LocalComment } from '../managers/commentManager';
import { ApiService, ApiRoutes } from '../apiService';
import { ProjectManager } from '../managers/projectManager';
import { normalizeFilePath, getErrorMessage } from '../utils/utils';
import { WebviewUtils, ResourceUris } from '../utils/webviewUtils';
import { logger } from '../utils/logger';
import { IPC_MESSAGES, COMMANDS, DELAY_TIMES } from '../constants';
import { UpdatedContextInfo, MarkdownContextInfo, MarkdownSaveOutcome } from './command/comment';
import { EditorUtils } from '../utils/editorUtils';

// 辅助函数：获取代码上下文（前后5行）
export async function getCodeContext(uri: vscode.Uri, lineNumber: number, contextLines: number = 5): Promise<{
    contextLines: string[];
    contextStartLine: number;
}> {
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const totalLines = document.lineCount;
        
        // 计算上下文的开始和结束行
        const startLine = Math.max(0, lineNumber - contextLines);
        const endLine = Math.min(totalLines - 1, lineNumber + contextLines);
        
        // 获取上下文行的内容
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
            try {
                const lineText = document.lineAt(i).text;
                lines.push(lineText);
            } catch (error) {
                // 如果某行无法读取，添加空行
                lines.push('');
            }
        }
        
        return {
            contextLines: lines,
            contextStartLine: startLine
        };
    } catch (error) {
        logger.error('获取代码上下文失败:', error);
        return {
            contextLines: [],
            contextStartLine: 0
        };
    }
}

export async function showMarkdownWebviewInput(
    context: vscode.ExtensionContext,
    prompt: string,
    projectManager: ProjectManager,
    placeholder: string = '',
    existingContent: string = '',
    contextInfo?: MarkdownContextInfo,
    markedJsUri: string = '',
    onSaveAndContinue?: (
        content: string,
        updatedContextInfo?: UpdatedContextInfo,
        callback?: () => void
    ) => void | Promise<MarkdownSaveOutcome>,
    isUserLoggedIn: boolean = false,
    isCommentShared: boolean = false
): Promise<{content: string, contextInfo?: MarkdownContextInfo} | undefined> {
    // 保存当前活动编辑器的引用，以便稍后恢复焦点
    const activeEditor = vscode.window.activeTextEditor;
    
    return new Promise((resolve) => {
        const sourceGroup = vscode.window.tabGroups.activeTabGroup;
        const sourceViewColumn = activeEditor?.viewColumn ?? sourceGroup.viewColumn;
        const viewColumn = EditorUtils.smartSelectViewColumn(activeEditor);
        const panelTabBaseTitle = '本地注释';
        const panelTabDirtyTitle = `${panelTabBaseTitle}-未保存*`;

        const panel = vscode.window.createWebviewPanel(
            'localCommentInput',
            panelTabBaseTitle,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,  // 用户切换tab时，保留状态
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', 'markdownInputs'),
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', 'common'),  // 添加 common 目录以支持 public.css
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'lib'),
                    vscode.Uri.joinPath(context.extensionUri, 'out', 'lib')  // 添加 out/lib 以支持打包后的库文件
                ],
                // 添加对SVG的支持
                enableCommandUris: false,
                enableFindWidget: false
            }
        );
        void EditorUtils.ensureWebviewBesideSource(sourceViewColumn, sourceGroup);

        // 读取代码高亮主题配置
        const config = vscode.workspace.getConfiguration('local-comment');
        const highlightTheme = config.get<string>('codeHighlight.theme', 'github-dark');
        
        // 构建资源 URI
        const resourceUris = WebviewUtils.buildResourceUris(panel.webview, context.extensionUri, {
            markedJs: true,
            css: 'markdownInputs/commentInput.css',
            js: 'markdownInputs/commentInput.js',
            mermaidJs: true,
            katexJs: true,
            katexCss: true,
            highlightJs: true,
            highlightCss: true,
            highlightTheme: highlightTheme,
            customResources: [
                { path: 'src/templates/common/public.js', name: 'publicJsUri' },
                { path: 'src/templates/common/mermaidChartInteract.js', name: 'mermaidChartInteractJsUri' },
                { path: 'src/templates/common/markdownRenderCore.js', name: 'markdownRenderCoreJsUri' }
            ]
        });

        // 优化：先显示面板，使用空的标签建议，后续异步加载
        const tagSuggestions = ''; // 先使用空字符串，后续异步更新

        // HTML内容
        panel.webview.html = getMarkdownWebviewContent(
            context, 
            prompt, 
            placeholder, 
            existingContent, 
            contextInfo, 
            resourceUris.markedJsUri || '', 
            resourceUris.cssUri || '', 
            resourceUris.jsUri || '', 
            resourceUris.mermaidJsUri || '', 
            resourceUris.katexJsUri || '',
            resourceUris.katexCssUri || '',
            resourceUris.highlightJsUri || '',
            resourceUris.highlightCssUri || '',
            tagSuggestions, 
            isUserLoggedIn,
            isCommentShared,
            panel.webview,
            resourceUris
        );

        // 异步加载标签建议和代码上下文，避免阻塞界面显示
        let asyncLoadTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
            asyncLoadTimer = undefined;
            void (async () => {
                try {
                    // 并行加载标签建议和代码上下文
                    const promises: Promise<void | boolean>[] = [];
                    
                    // 加载标签建议
                    promises.push(
                        Promise.resolve().then(() => {
                            const commentManager = new CommentManager(context);
                            const tagManager = new TagManager();
                            tagManager.updateTags(commentManager.getAllComments());
                            const availableTagNames = tagManager.getAvailableTagNames();
                            const asyncTagSuggestions = availableTagNames.map(tag => `@${tag}`).join(',');
                            
                            // 向webview发送标签建议数据
                            panel.webview.postMessage({
                                command: IPC_MESSAGES.UPDATE_TAG_SUGGESTIONS,
                                tagSuggestions: asyncTagSuggestions
                            });

                            // 同步发送可用标签白名单，供预览精确渲染 @tag 链接（与 .md 预览一致）
                            panel.webview.postMessage({
                                command: IPC_MESSAGES.SET_AVAILABLE_TAGS,
                                tagNames: availableTagNames
                            });
                        })
                    );

                    // 发送Mermaid主题配置
                    promises.push(
                        Promise.resolve().then(() => {
                            const config = vscode.workspace.getConfiguration('local-comment');
                            const mermaidTheme = config.get<string>('mermaid.theme', 'default');
                            panel.webview.postMessage({
                                command: IPC_MESSAGES.SET_MERMAID_THEME,
                                theme: mermaidTheme
                            });
                        })
                    );

                    // 发送预览字体大小配置
                    promises.push(
                        Promise.resolve().then(() => {
                            const config = vscode.workspace.getConfiguration('local-comment');
                            const previewFontSize = config.get<number>('markdownPreview.fontSize', 0);
                            
                            // 如果配置为 0，则使用编辑器字体大小
                            let fontSize: number;
                            if (previewFontSize === 0) {
                                const editorConfig = vscode.workspace.getConfiguration('editor');
                                fontSize = editorConfig.get<number>('fontSize', 14);
                            } else {
                                fontSize = previewFontSize;
                            }
                            
                            panel.webview.postMessage({
                                command: IPC_MESSAGES.SET_PREVIEW_FONT_SIZE,
                                fontSize: fontSize
                            });
                        })
                    );

                    // 如果需要代码上下文且当前没有提供，异步加载
                    if (contextInfo && contextInfo.lineNumber !== undefined && !contextInfo.contextLines) {
                        const activeEditorForContext = vscode.window.activeTextEditor;
                        if (activeEditorForContext) {
                            promises.push(
                                getCodeContext(activeEditorForContext.document.uri, contextInfo.lineNumber).then(codeContext => {
                                    // 向webview发送代码上下文数据
                                    panel.webview.postMessage({
                                        command: IPC_MESSAGES.UPDATE_CODE_CONTEXT,
                                        contextLines: codeContext.contextLines,
                                        contextStartLine: codeContext.contextStartLine,
                                        lineNumber: contextInfo.lineNumber
                                    });
                                })
                            );
                        }
                    }
                    
                    await Promise.all(promises);
                } catch (error) {
                    logger.error('异步加载数据失败:', error);
                }
            })();
        }, 0);

        // 处理WebView消息
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case IPC_MESSAGES.EDITOR_DIRTY_STATE:
                        if (typeof message.isDirty === 'boolean') {
                            panel.title = message.isDirty ? panelTabDirtyTitle : panelTabBaseTitle;
                        }
                        break;
                    case IPC_MESSAGES.SAVE:
                        // 返回内容和更新后的上下文信息（保存成功后才 dispose）
                        if (onSaveAndContinue) {
                            void (async () => {
                                try {
                                    await Promise.resolve(
                                        onSaveAndContinue(message.content, contextInfo, () => {
                                            panel.dispose();
                                            EditorUtils.restoreFocus(activeEditor);
                                        })
                                    );
                                } catch (err) {
                                    logger.error('保存并退出时发生错误:', err);
                                }
                            })();
                        }
                        break;
                    case IPC_MESSAGES.SAVE_AND_CONTINUE:
                        // 保存内容但不关闭编辑器；根据结果通知 Webview 更新 dirty 基线
                        if (onSaveAndContinue) {
                            void (async () => {
                                try {
                                    const outcome = await Promise.resolve(
                                        onSaveAndContinue(message.content, contextInfo, () => {
                                            vscode.window.showInformationMessage('保存成功');
                                        })
                                    );
                                    if (outcome === 'committed') {
                                        panel.title = panelTabBaseTitle;
                                        panel.webview.postMessage({
                                            command: IPC_MESSAGES.EDITOR_BASELINE_COMMITTED,
                                            text: message.content
                                        });
                                    } else if (outcome === 'skipped-noop') {
                                        panel.title = panelTabBaseTitle;
                                        panel.webview.postMessage({
                                            command: IPC_MESSAGES.EDITOR_SAVE_SKIPPED,
                                            reason: 'no-op',
                                            text: message.content
                                        });
                                    } else if (outcome === 'skipped-empty') {
                                        panel.webview.postMessage({
                                            command: IPC_MESSAGES.EDITOR_SAVE_SKIPPED,
                                            reason: 'empty'
                                        });
                                    }
                                } catch (err) {
                                    logger.error('保存并继续时发生错误:', err);
                                }
                            })();
                        }
                        break;
                    case IPC_MESSAGES.UPDATE_SELECTED_LINE:
                        // 处理用户点击代码行的消息
                        if (message.lineNumber !== undefined && contextInfo) {
                            // 更新当前选中的行号
                            contextInfo.lineNumber = message.lineNumber;
                            
                            // 如果有活动编辑器，尝试更新代码上下文
                            if (activeEditor) {
                                try {
                                    // 获取新选中行的代码上下文
                                    const codeContext = await getCodeContext(activeEditor.document.uri, message.lineNumber);
                                    
                                    // 更新contextInfo中的上下文信息
                                    contextInfo.contextLines = codeContext.contextLines;
                                    contextInfo.contextStartLine = codeContext.contextStartLine;
                                    
                                    // 更新当前行内容
                                    if (codeContext.contextLines && codeContext.contextLines.length > 0) {
                                        const relativeLineIndex = message.lineNumber - codeContext.contextStartLine;
                                        if (relativeLineIndex >= 0 && relativeLineIndex < codeContext.contextLines.length) {
                                            contextInfo.lineContent = codeContext.contextLines[relativeLineIndex];
                                        }
                                    }
                                    
                                    // 向webview发送更新后的代码上下文
                                    panel.webview.postMessage({
                                        command: IPC_MESSAGES.UPDATE_CODE_CONTEXT,
                                        contextLines: codeContext.contextLines,
                                        contextStartLine: codeContext.contextStartLine,
                                        lineNumber: message.lineNumber
                                    });
                                    
                                    // 同时发送当前行内容更新，让webview同步显示
                                    panel.webview.postMessage({
                                        command: IPC_MESSAGES.UPDATE_CURRENT_LINE_CONTENT,
                                        lineContent: contextInfo.lineContent || '',
                                        lineNumber: message.lineNumber
                                    });
                                    
                                    logger.debug('已更新选中行:', message.lineNumber + 1);
                                } catch (error) {
                                    logger.error('更新代码上下文失败:', error);
                                }
                            }
                        }
                        break;
                    case IPC_MESSAGES.SHARE:
                        // 处理分享功能
                        try {
                            // 获取当前活动的编辑器和文档信息
                            const activeEditor = vscode.window.activeTextEditor;
                            let filePath = '';

                            logger.debug('activeEditor:', activeEditor);
                            logger.debug('contextInfo:', contextInfo);
                            
                            // 直接使用contextInfo中的文件路径
                            if (contextInfo?.filePath) {
                                filePath = contextInfo.filePath;
                                logger.debug('从contextInfo获取文件路径:', filePath);
                            } else {
                                logger.warn('contextInfo中没有文件路径信息');
                                vscode.window.showWarningMessage('无法获取文件路径信息，分享功能可能无法正常工作');
                            }

                            const associatedProjectId = projectManager.getAssociatedProject();
                            const projectId = associatedProjectId ? parseInt(associatedProjectId, 10) : 0;
                            
                            // 如果没有关联项目，提示用户
                            if (!projectId) {
                                vscode.window.showWarningMessage('请先关联项目再分享注释');
                                panel.webview.postMessage({
                                    command: IPC_MESSAGES.SHARE_ERROR,
                                    error: '请先关联项目再分享注释'
                                });
                                return;
                            }
                            
                            // 构造完整的LocalComment对象
                            const commentData: LocalComment = {
                                id: typeof message.comment?.id === 'string' ? message.comment.id : 'temp_' + Date.now(),
                                content: String(message.content ?? ''),
                                timestamp: Date.now(),
                                line: contextInfo?.lineNumber ?? 0,
                                originalLine: contextInfo?.lineNumber ?? 0,
                                lineContent: contextInfo?.lineContent ?? ''
                            };
                            
                            // 构造要分享的数据
                            const shareData = {
                                content: commentData, // 完整的LocalComment对象
                                file_path: normalizeFilePath(filePath), // 使用相对路径，便于跨项目迁移
                                project_id: projectId,
                                is_public: true // 默认设为公开
                            };

                            logger.debug('[filePath]', filePath);
                            // 调用API服务分享注释
                            const apiService = ApiService.getInstance();
                            // 修复API路径拼写错误（sharedCommnets -> sharedComments）
                            const response = await apiService.post<{ id?: number | string; error?: string }>(ApiRoutes.comment.sharedComments, shareData);
                            
                            logger.debug('[shareData]', shareData);
                            logger.debug('[response]', response);
                            // 分享成功后更新注释状态
                            if (response && response.id) {
                                vscode.window.showInformationMessage('注释分享成功！');
                                // 更新界面显示分享状态
                                panel.webview.postMessage({
                                    command: IPC_MESSAGES.SHARE_SUCCESS,
                                    sharedId: response.id?.toString(), // 使用返回数据中的id
                                    message: '分享成功'
                                });
                            } else {
                                throw new Error(response?.error || '分享失败');
                            }
                        } catch (error) {
                            logger.error('分享注释失败:', error);
                            const errorMessage = getErrorMessage(error);
                            vscode.window.showErrorMessage(`注释分享失败: ${errorMessage}`);
                            panel.webview.postMessage({
                                command: IPC_MESSAGES.SHARE_ERROR,
                                error: errorMessage
                            });
                        }
                        break;
                    case IPC_MESSAGES.GO_TO_TAG_DECLARATION:
                        // 处理跳转到tag声明的消息
                        if (message.tagName) {
                            try {
                                // 使用TagManager查找tag声明
                                const commentManager = new CommentManager(context);
                                const tagManager = new TagManager();
                                tagManager.updateTags(commentManager.getAllComments());
                                
                                const declaration = tagManager.getTagDeclaration(message.tagName);
                                
                                if (declaration) {
                                    // 跳转到tag声明位置
                                    const targetUri = vscode.Uri.file(declaration.filePath);
                                    const targetPosition = new vscode.Position(declaration.line, 0);
                                    
                                    vscode.window.showTextDocument(targetUri, {
                                        selection: new vscode.Range(targetPosition, targetPosition),
                                        viewColumn: vscode.ViewColumn.One
                                    }).then(() => {
                                        // 跳转成功后显示提示
                                        vscode.window.showInformationMessage(`已跳转到标签 @${message.tagName} 的声明位置`);
                                    });
                                } else {
                                    vscode.window.showWarningMessage(`未找到标签 @${message.tagName} 的声明`);
                                }
                            } catch (error) {
                                logger.error('跳转到tag声明失败:', error);
                                vscode.window.showErrorMessage(`跳转失败: ${getErrorMessage(error)}`);
                            }
                        }
                        break;
                    case IPC_MESSAGES.CANCEL:
                        // 仅当 Webview 已确认放弃未保存更改时才关闭，避免误触丢失
                        if (message.abandonConfirmed === true) {
                            resolve(undefined);
                            panel.dispose();
                            EditorUtils.restoreFocus(activeEditor);
                        }
                        break;
                }
            }
        );

        // 面板关闭时返回undefined
        panel.onDidDispose(() => {
            if (asyncLoadTimer !== undefined) {
                clearTimeout(asyncLoadTimer);
                asyncLoadTimer = undefined;
            }
            resolve(undefined);
            // WebView关闭后恢复编辑器焦点
            EditorUtils.restoreFocus(activeEditor);
        });
    });
}

function getMarkdownWebviewContent(
    context: vscode.ExtensionContext,
    prompt: string,
    placeholder: string,
    existingContent: string,
    contextInfo?: {
        fileName?: string;
        lineNumber?: number;
        lineContent?: string; // 当前行的实际内容
        originalLineContent?: string; // 注释保存的代码快照
        selectedText?: string;
        contextLines?: string[]; // 前后5行的代码内容
        contextStartLine?: number; // 上下文开始的行号
        fileNotFound?: boolean; // 文件是否不存在
        filePath?: string; // 文件路径
    },
    markedJsUri: string = '',
    cssUri: string = '',
    jsUri: string = '',
    mermaidJsUri: string = '',
    katexJsUri: string = '',
    katexCssUri: string = '',
    highlightJsUri: string = '',
    highlightCssUri: string = '',
    tagSuggestions: string = '',
    isUserLoggedIn: boolean = false,
    isCommentShared: boolean = false,
    webview?: vscode.Webview, // 添加webview参数
    resourceUris?: ResourceUris
): string {
    // 生成nonce用于CSP
    const nonce = WebviewUtils.getNonce();

    // 构建上下文信息HTML（总是显示，即使没有contextInfo）
    let contextHtml = '';
    contextHtml = '<div class="context-info">';
    contextHtml += '<div class="context-title">代码上下文</div>';
    
    // 添加tab切换功能
    contextHtml += '<div class="context-tabs">';
    contextHtml += '<div class="tab-header">';
    contextHtml += '  <div class="tab-buttons">';
    contextHtml += '    <button class="tab-btn active" data-tab="preview-tab">Markdown预览</button>';
    contextHtml += '    <button class="tab-btn" data-tab="code-tab">代码快照</button>';
    contextHtml += '  </div>';
    contextHtml += '  <div class="preview-controls">';
    contextHtml += '    <button id="toggle-preview-size-btn" class="control-btn" title="编辑/预览">预览</button>';
    contextHtml += '  </div>';
    contextHtml += '</div>';
    
    // 代码快照tab内容
    contextHtml += '<div id="code-tab" class="tab-content">';
    
    if (contextInfo) {
        // 如果文件不存在，显示特殊提示
        if (contextInfo.fileNotFound) {
            contextHtml += `<div class="context-item file-not-found">
                <span class="context-label">文件状态:</span>
                <span class="context-value">原文件已删除或移动</span>
            </div>`;
            if (contextInfo.filePath) {
                contextHtml += `<div class="context-item">
                    <span class="context-label">原路径:</span>
                    <span class="context-value">${WebviewUtils.escapeHtml(contextInfo.filePath)}</span>
                </div>`;
            }
        }
        
        if (contextInfo.fileName) {
            contextHtml += `<div class="context-item">
                <span class="context-label">文件:</span>
                <span class="context-value">${WebviewUtils.escapeHtml(contextInfo.fileName)}</span>
            </div>`;
        }
        
        if (contextInfo.lineNumber !== undefined) {
            contextHtml += `<div class="context-item">
                <span class="context-label">行号:</span>
                <span class="context-value">第 ${contextInfo.lineNumber + 1} 行</span>
            </div>`;
        }
        
        if (contextInfo.selectedText) {
            contextHtml += `<div class="context-item">
                <span class="context-label">选中:</span>
                <div class="context-value">
                    <div class="code-preview">${WebviewUtils.escapeHtml(contextInfo.selectedText)}</div>
                </div>
            </div>`;
        } else if (contextInfo.contextLines && contextInfo.contextLines.length > 0) {
            // 显示扩展的上下文信息（前后5行） - 仅当注释能匹配到代码时
            contextHtml += `<div class="context-item">
                <span class="context-label">代码上下文:</span>
                <div class="context-value">
                    <div class="code-context-preview">`;
            
            contextInfo.contextLines.forEach((line, index) => {
                const currentLineNumber = (contextInfo.contextStartLine || 0) + index;
                const isTargetLine = currentLineNumber === contextInfo.lineNumber;
                const lineClass = isTargetLine ? 'target-line' : 'context-line';
                const lineNumberDisplay = currentLineNumber + 1;
                
                contextHtml += `<div class="code-line ${lineClass}">
                    <span class="line-number">${lineNumberDisplay}</span>
                    <span class="line-content">${WebviewUtils.escapeHtml(line)}</span>
                </div>`;
            });
            
            contextHtml += `    </div>
                </div>
            </div>`;
            
            // 如果当前代码与快照不同，额外显示当前代码
            if (contextInfo.lineContent && contextInfo.lineContent !== contextInfo.originalLineContent) {
                contextHtml += `<div class="context-item">
                    <span class="context-label">当前代码:</span>
                    <div class="context-value">
                        <div class="code-preview current-code">${WebviewUtils.escapeHtml(contextInfo.lineContent)}</div>
                    </div>
                </div>`;
            }
        } else if (contextInfo.lineContent && !contextInfo.originalLineContent) {
            // 如果没有快照但有当前内容，显示当前内容（新注释场景）
            contextHtml += `<div class="context-item">
                <span class="context-label">当前代码:</span>
                <div class="context-value">
                    <div class="code-preview current-code">${WebviewUtils.escapeHtml(contextInfo.lineContent)}</div>
                </div>
            </div>`;
        } else if (contextInfo.originalLineContent && !contextInfo.contextLines) {
            // 注释无法匹配到代码时，只显示注释保存的代码快照
            const snapshotLabel = contextInfo.fileNotFound ? '代码快照 (原文件已删除)' : '注释快照';
            contextHtml += `<div class="context-item">
                <span class="context-label">${snapshotLabel}:</span>
                <div class="context-value">
                    <div class="code-preview original-code">${WebviewUtils.escapeHtml(contextInfo.originalLineContent)}</div>
                </div>
            </div>`;
        }
        
    } else {
        // 没有上下文信息时显示提示
        contextHtml += '<div class="context-item">';
        contextHtml += '<span class="context-label">提示:</span>';
        contextHtml += '<span class="context-value">暂无代码上下文信息</span>';
        contextHtml += '</div>';
    }
    
    contextHtml += '</div>'; // 结束代码快照tab内容
    
    // Markdown预览tab内容
    contextHtml += '<div id="preview-tab" class="tab-content active">';
    contextHtml += '<div id="previewArea" class="preview-area"></div>';
    contextHtml += '</div>'; // 结束预览tab内容
    
    contextHtml += '</div>'; // 结束context-tabs
    contextHtml += '</div>'; // 结束context-info

    // 计算 publicJsScript / mermaidInteractJsScript / coreJsScript 的值
    const publicJsUri = resourceUris?.publicJsUri || '';
    const publicJsScript = publicJsUri 
        ? `<script src="${publicJsUri}" onerror="console.error('public.js 加载失败')"></script>`
        : '';
    const mermaidInteractJsUri = resourceUris?.mermaidChartInteractJsUri || '';
    const mermaidInteractJsScript = mermaidInteractJsUri
        ? `<script src="${mermaidInteractJsUri}" onerror="console.error('mermaidChartInteract.js 加载失败')"></script>`
        : '';
    const coreJsUri = resourceUris?.markdownRenderCoreJsUri || '';
    const coreJsScript = coreJsUri
        ? `<script src="${coreJsUri}" onerror="console.error('markdownRenderCore.js 加载失败')"></script>`
        : '';

    // 准备模板变量
    const templateVariables: Record<string, string> = {
        contextHtml,
        escapedPrompt: WebviewUtils.escapeHtml(prompt),
        escapedPlaceholder: WebviewUtils.escapeHtml(placeholder),
        escapedContent: WebviewUtils.escapeHtml(existingContent || ''),
        markedJsUri: markedJsUri || '',
        cssUri: cssUri || '',
        jsUri: jsUri || '',
        mermaidJsUri: mermaidJsUri || '',
        katexJsUri: katexJsUri || '',
        katexCssUri: katexCssUri || '',
        highlightJsUri: highlightJsUri || '',
        highlightCssUri: highlightCssUri || '',
        publicJsUri: publicJsUri,
        publicJsScript: publicJsScript,
        mermaidInteractJsScript: mermaidInteractJsScript,
        coreJsScript: coreJsScript,
        tagSuggestions: tagSuggestions,
        cspSource: webview ? webview.cspSource : "'self'", // 从webview获取CSP源
        shareButtonHtml: (isUserLoggedIn && !isCommentShared) ? 
            `<button class="share-btn" onclick="share()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                </svg>
                分享
            </button>` : ''
    };

    // 加载模板（使用缓存）
    const template = WebviewUtils.loadTemplate(context, 'markdownInputs/commentInput.html');

    // 替换模板变量
    const html = WebviewUtils.replaceTemplateVariables(template, templateVariables);

    return html;
} 