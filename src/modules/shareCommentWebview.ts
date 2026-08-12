import * as vscode from 'vscode';
import { CommentManager } from '../managers/commentManager';
import { TagManager } from '../managers/tagManager';
import { WebviewUtils, ResourceUris, buildMarkdownPanelResourceOptions, buildMarkdownLocalResourceRoots, postMarkdownPreviewConfig, buildMarkdownScriptTags, buildContextHtml } from '../utils/webviewUtils';
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
            localResourceRoots: buildMarkdownLocalResourceRoots(
                context.extensionUri,
                'shareComment'
            ),
            enableCommandUris: false,
            enableFindWidget: false
        }
    );
    void EditorUtils.ensureWebviewBesideSource(sourceViewColumn, sourceGroup);

    // 构建资源 URI
    const resourceUris = WebviewUtils.buildResourceUris(panel.webview, context.extensionUri, buildMarkdownPanelResourceOptions({
        css: 'shareComment/shareComment.css',
        js: 'shareComment/shareComment.js',
        includePreviewFind: false
    }));

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
            const tagManager = new TagManager();
            tagManager.updateTags(commentManager.getAllComments());
            postMarkdownPreviewConfig(panel.webview, {
                sendAvailableTags: true,
                availableTagNames: tagManager.getAvailableTagNames()
            });
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
        contextHtml += buildContextHtml(contextInfo);
        contextHtml += '</div>';
    }

    // 计算 publicJsScript / mermaidInteractJsScript / coreJsScript 的值
    const scriptTags = buildMarkdownScriptTags(resourceUris ?? {});
    const publicJsUri = resourceUris?.publicJsUri || '';

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
        publicJsScript: scriptTags.publicJsScript,
        mermaidInteractJsScript: scriptTags.mermaidInteractJsScript,
        coreJsScript: scriptTags.coreJsScript,
        cspSource: webview ? webview.cspSource : "'self'"
    };

    // 加载模板（使用缓存）
    const template = WebviewUtils.loadTemplate(context, 'shareComment/shareComment.html');

    // 替换模板变量
    const html = WebviewUtils.replaceTemplateVariables(template, templateVariables);

    return html;
}
