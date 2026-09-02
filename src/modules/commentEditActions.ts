import * as vscode from 'vscode';
import { CommentManager, LocalComment } from '../managers/commentManager';
import { ProjectManager } from '../managers/projectManager';
import { AuthManager } from '../managers/authManager';
import { getCodeContext, showMarkdownWebviewInput } from './markdownWebview';
import { getFileNameFromUri } from '../utils/pathUtils';
import { getErrorMessage } from '../utils/utils';
import { logger } from '../utils/logger';
import { MarkdownContextInfo, MarkdownSaveCallback } from './command/comment';

export async function openCommentEditor(options: {
    context: vscode.ExtensionContext;
    commentManager: CommentManager;
    projectManager: ProjectManager;
    authManager: AuthManager;
    uri: vscode.Uri;
    comment: Pick<LocalComment, 'id' | 'line' | 'content' | 'lineContent' | 'isShared' | 'color'>;
    onSaveAndContinue: MarkdownSaveCallback;
}): Promise<void> {
    const { context, commentManager, projectManager, authManager, uri, comment, onSaveAndContinue } = options;

    try {
        const fileName = getFileNameFromUri(uri);

        let contextInfo: MarkdownContextInfo = {
            fileName,
            filePath: uri.fsPath,
            lineNumber: comment.line,
            originalLineContent: comment.lineContent
        };

        let fileExists = false;
        let document: vscode.TextDocument | null = null;

        try {
            document = await vscode.workspace.openTextDocument(uri);
            fileExists = true;
        } catch (error) {
            logger.debug(`文件不存在: ${uri.fsPath}，但仍允许编辑注释`);
            fileExists = false;
        }

        if (fileExists && document) {
            const matchedComments = commentManager.getComments(uri);
            const isMatched = matchedComments.some(c => c.id === comment.id);

            if (isMatched) {
                const lineContent = document.lineAt(comment.line).text;
                const codeContext = await getCodeContext(uri, comment.line);

                contextInfo.lineContent = lineContent;
                contextInfo.contextLines = codeContext.contextLines;
                contextInfo.contextStartLine = codeContext.contextStartLine;
            }
        } else {
            contextInfo.fileNotFound = true;
        }

        await showMarkdownWebviewInput(
            context,
            fileExists ? '修改注释内容' : '修改注释内容 (原文件已删除)',
            projectManager,
            commentManager,
            fileExists ?
                '支持 Markdown 语法和多行输入，使用 ${标签名} 声明标签，使用 @标签名 引用标签' :
                '原文件已删除，但您仍可以编辑注释内容。支持 Markdown 语法和多行输入，使用 ${标签名} 声明标签，使用 @标签名 引用标签',
            comment.content,
            contextInfo,
            '',
            onSaveAndContinue,
            authManager.isLoggedIn(),
            comment.isShared || false,
            comment.color
        );
    } catch (error) {
        logger.error('编辑注释失败:', error);
        vscode.window.showErrorMessage(`编辑注释失败: ${getErrorMessage(error)}`);
    }
}
