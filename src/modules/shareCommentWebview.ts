import * as vscode from 'vscode';
import { CommentManager } from '../managers/commentManager';
import { TagManager } from '../managers/tagManager';
import { WebviewUtils, ResourceUris } from '../utils/webviewUtils';
import { getErrorMessage } from '../utils/utils';
import { logger } from '../utils/logger';
import { VIEW_TYPES, COMMANDS, IPC_MESSAGES, DELAY_TIMES } from '../constants';
import { EditorUtils } from '../utils/editorUtils';
import { generateId } from '../utils/idUtils';


export async function showShareCommentWebview(
    context: vscode.ExtensionContext,
    commentManager: CommentManager,
    markdownContent: string,
    title: string = '注释预览',
    contextInfo?: {
        fileName?: string;
        lineNumber?: number;
        lineContent?: string;
        originalLineContent?: string;
        selectedText?: string;
        contextLines?: string[];
        contextStartLine?: number;
        filePath?: string;
        sharedCommentId?: string;
        userId?: string;
        username?: string;
        timestamp?: number;
        commentContent?: string;
    }
): Promise<void> {
    // 保存当前活动编辑器的引用，以便稍后恢复焦点
    const activeEditor = vscode.window.activeTextEditor;

    // 导出依赖 commentContent；调用方未传时回退到面板正文
    const resolvedContextInfo = contextInfo
        ? {
            ...contextInfo,
            commentContent: contextInfo.commentContent ?? markdownContent
        }
        : undefined;

    // 智能分屏：侧开，避免覆盖当前编辑器
    const sourceGroup = vscode.window.tabGroups.activeTabGroup;
    const sourceViewColumn = activeEditor?.viewColumn ?? sourceGroup.viewColumn;
    const viewColumn = EditorUtils.smartSelectViewColumn(activeEditor);
    
    // 创建WebView面板
    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPES.SHARE_COMMENT_PREVIEW,
        title,
        viewColumn,
        {
            enableScripts: true,
            retainContextWhenHidden: true,  // 用户切换tab时，保留状态
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', 'shareComment'),
                vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', 'common'),
                vscode.Uri.joinPath(context.extensionUri, 'src', 'lib'),
                vscode.Uri.joinPath(context.extensionUri, 'out', 'lib')  // 添加 out/lib 以支持打包后的库文件
            ],
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
        css: 'shareComment/shareComment.css',
        js: 'shareComment/shareComment.js',
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

    // HTML内容
    panel.webview.html = getShareCommentWebviewContent(
        context, 
        markdownContent, 
        resolvedContextInfo, 
        resourceUris.markedJsUri || '', 
        resourceUris.cssUri || '', 
        resourceUris.jsUri || '', 
        resourceUris.mermaidJsUri || '', 
        resourceUris.katexJsUri || '',
        resourceUris.katexCssUri || '',
        resourceUris.highlightJsUri || '',
        resourceUris.highlightCssUri || '',
        panel.webview,
        resourceUris
    );

    // 异步发送Mermaid主题配置和字体大小配置
    let configPostTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        configPostTimer = undefined;
        try {
            const config = vscode.workspace.getConfiguration('local-comment');
            const mermaidTheme = config.get<string>('mermaid.theme', 'default');
            panel.webview.postMessage({
                command: IPC_MESSAGES.SET_MERMAID_THEME,
                theme: mermaidTheme
            });
            
            // 发送预览字体大小配置
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

            // 发送可用标签白名单，供预览精确渲染 @tag 链接（与 .md 预览一致）
            {
                const tagManager = new TagManager();
                tagManager.updateTags(commentManager.getAllComments());
                panel.webview.postMessage({
                    command: IPC_MESSAGES.SET_AVAILABLE_TAGS,
                    tagNames: tagManager.getAvailableTagNames()
                });
            }
        } catch (error) {
            logger.error('发送配置失败:', error);
        }
    }, 0);

    // 处理WebView消息
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case IPC_MESSAGES.CLOSE:
                    panel.dispose();
                    // WebView关闭后恢复编辑器焦点
                    EditorUtils.restoreFocus(activeEditor);
                    break;
                case IPC_MESSAGES.EXPORT_TO_LOCAL_COMMENT:
                    // 处理导出为本地注释的请求
                    await handleExportToLocalComment(context, commentManager, resolvedContextInfo, markdownContent);
                    break;
            }
        }
    );

    // 面板关闭时恢复编辑器焦点
    panel.onDidDispose(() => {
        if (configPostTimer !== undefined) {
            clearTimeout(configPostTimer);
            configPostTimer = undefined;
        }
        // WebView关闭后恢复编辑器焦点
        EditorUtils.restoreFocus(activeEditor);
    });
}

// 处理导出为本地注释的请求
async function handleExportToLocalComment(
    context: vscode.ExtensionContext,
    commentManager: CommentManager,
    contextInfo?: {
        fileName?: string;
        lineNumber?: number;
        lineContent?: string;
        originalLineContent?: string;
        selectedText?: string;
        contextLines?: string[];
        contextStartLine?: number;
        filePath?: string;
        sharedCommentId?: string;
        userId?: string;
        username?: string;
        timestamp?: number;
        commentContent?: string;
    },
    markdownContentFallback?: string
): Promise<void> {
    try {
        if (!contextInfo?.filePath || contextInfo.lineNumber === undefined) {
            vscode.window.showErrorMessage('无法导出：缺少必要的文件信息');
            return;
        }

        const commentContent = contextInfo.commentContent || markdownContentFallback;
        if (!commentContent) {
            vscode.window.showErrorMessage('无法获取注释内容');
            return;
        }

        // 创建本地注释
        const localComment = {
            id: generateId(),
            line: contextInfo.lineNumber,
            content: commentContent,
            timestamp: Date.now(),
            originalLine: contextInfo.lineNumber,
            lineContent: contextInfo.lineContent || '',
            isMatched: true,
            isShared: false
        };

        // 检查该行是否已有本地注释
        const existingLocalComment = commentManager.getLocalCommentAtLine(contextInfo.filePath, contextInfo.lineNumber);

        if (existingLocalComment) {
            // 该行已有本地注释，询问是否覆盖
            const overwriteChoice = await vscode.window.showWarningMessage(
                `第 ${contextInfo.lineNumber + 1} 行已有本地注释：\n"${existingLocalComment.content}"\n\n是否要覆盖为新的注释？`,
                { modal: true },
                '覆盖',
                '取消'
            );

            if (overwriteChoice !== '覆盖') {
                return; // 用户选择取消
            }
        }

        // 使用专门的方法添加注释，保留共享注释的原始lineContent
        await commentManager.addCommentFromShared(
            contextInfo.filePath,
            localComment.line,
            localComment.content,
            localComment.lineContent,
            localComment.originalLine,
            localComment.isMatched,
            true // 强制覆盖，因为用户已经确认
        );

        vscode.window.showInformationMessage(
            `已成功将共享注释导出为本地注释！\n文件：${contextInfo.fileName || '未知文件'}\n行号：第${contextInfo.lineNumber + 1}行`
        );

        // 刷新注释显示
        vscode.commands.executeCommand(COMMANDS.REFRESH_COMMENTS);
    } catch (error) {
        logger.error('导出为本地注释失败:', error);
        vscode.window.showErrorMessage(`导出失败：${getErrorMessage(error)}`);
    }
}

function getShareCommentWebviewContent(
    context: vscode.ExtensionContext,
    markdownContent: string,
    contextInfo?: {
        fileName?: string;
        lineNumber?: number;
        lineContent?: string;
        originalLineContent?: string;
        selectedText?: string;
        contextLines?: string[];
        contextStartLine?: number;
        filePath?: string;
    },
    markedJsUri: string = '',
    cssUri: string = '',
    jsUri: string = '',
    mermaidJsUri: string = '',
    katexJsUri: string = '',
    katexCssUri: string = '',
    highlightJsUri: string = '',
    highlightCssUri: string = '',
    webview?: vscode.Webview,
    resourceUris?: ResourceUris
): string {
    // 生成nonce用于CSP
    const nonce = WebviewUtils.getNonce();

    // 构建上下文信息HTML
    let contextHtml = '';
    if (contextInfo) {
        contextHtml = '<div class="context-info">';
        contextHtml += '<div class="context-title">代码上下文</div>';
        
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
        }
        
        contextHtml += '</div>';
    }

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
        escapedContent: WebviewUtils.escapeHtml(markdownContent || ''),
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
        cspSource: webview ? webview.cspSource : "'self'"
    };

    // 加载模板（使用缓存）
    const template = WebviewUtils.loadTemplate(context, 'shareComment/shareComment.html');

    // 替换模板变量
    const html = WebviewUtils.replaceTemplateVariables(template, templateVariables);

    return html;
}
