import * as vscode from 'vscode';
import { CommentManager, SharedComment } from '../managers/commentManager';
import { createDataUri } from '../utils/utils';
import { logger } from '../utils/logger';
import { COMMANDS } from '../constants';
import { TimerManager } from '../utils/timerUtils';

export class SharedCommentProvider implements vscode.Disposable, vscode.HoverProvider {
    private decorationType: vscode.TextEditorDecorationType;
    private commentManager: CommentManager;
    private isVisible: boolean = true;
    private disposables: vscode.Disposable[] = [];
    private timerManager: TimerManager = new TimerManager(); // 定时器管理器
    private updateTimer: NodeJS.Timeout | null = null; // 防抖定时器

    // 预加载的图标URIs
    private markdownIconUri: string | null = null;

    constructor(commentManager: CommentManager) {
        this.commentManager = commentManager;

        // 行尾用 before，与本地注释一致，并尽量排在 GitLens after 左侧
        this.decorationType = vscode.window.createTextEditorDecorationType({
            before: {
                color: '#6B7283', // 灰蓝色，与本地注释区分
                fontStyle: 'italic',
                margin: '0 0 0 2em'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });

        // 监听编辑器变化
        // this.disposables.push(
        //     vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
        //     vscode.window.onDidChangeTextEditorSelection(() => this.debouncedUpdateDecorations())
        // );

        // 异步加载图标，加载完成后重新创建装饰类型
        this.loadIcons().then(() => {
            this.recreateDecorationType();
            this.updateDecorations();
        });

        this.updateDecorations();
    }

    // 异步加载图标
    private async loadIcons(): Promise<void> {
        try {
            const context = this.commentManager.getContext();
            const markdown = await createDataUri(context, 'src/resources/markdown.svg');
            this.markdownIconUri = markdown;
        } catch (error) {
            logger.error('加载图标失败:', error);
        }
    }

    // 重新创建装饰类型（加载图标后）
    private recreateDecorationType(): void {
        // 先释放旧的装饰类型
        this.decorationType.dispose();

        this.decorationType = vscode.window.createTextEditorDecorationType({
            before: {
                color: '#6B7283', // 灰蓝色，与本地注释区分
                fontStyle: 'italic',
                margin: '0 0 0 2em'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
    }

    public refresh(): void {
        this.updateDecorations();
    }

    public toggleVisibility(): void {
        this.isVisible = !this.isVisible;
        if (this.isVisible) {
            this.updateDecorations();
            vscode.window.showInformationMessage('共享注释已显示');
        } else {
            this.clearDecorations();
            vscode.window.showInformationMessage('共享注释已隐藏');
        }
    }

    private updateDecorations(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.isVisible) {
            this.clearDecorations();
            return;
        }

        const document = editor.document;
        const uri = document.uri;
        
        // 获取当前光标位置
        const currentPosition = editor.selection.active;
        const currentLine = currentPosition.line;
        
        // 获取所有共享注释
        const allSharedComments = this.commentManager.getAllSharedComments();
        const filePath = document.uri.fsPath;
        const sharedComments = allSharedComments[filePath] || [];

        if (sharedComments.length === 0) {
            this.clearDecorations();
            return;
        }

        // 获取本地注释，用于判断哪些行已经有本地注释
        const localComments = this.commentManager.getComments(uri);
        const localCommentsByLine = new Set<number>();
        localComments.forEach(comment => {
            if (!('userId' in comment)) { // 只统计本地注释
                localCommentsByLine.add(comment.line);
            }
        });

        const sharedDecorations: vscode.DecorationOptions[] = [];

        // 只显示当前光标所在行的共享注释装饰器
        const lineComments = sharedComments.filter(comment => comment.line === currentLine);
        
        if (lineComments.length > 0) {
            // 如果这一行已经有本地注释，跳过共享注释装饰器（优先级：本地注释 > 共享注释）
            if (!localCommentsByLine.has(currentLine)) {
                // 只显示匹配的共享注释装饰器
                const matchedComments = lineComments.filter(comment => comment.isMatched !== false);
                
                if (matchedComments.length > 0) {
                    // 创建匹配的共享注释装饰器
                    const decoration = this.createSharedCommentDecoration(currentLine, matchedComments, document);
                    if (decoration) {
                        sharedDecorations.push(decoration);
                    }
                }
            }
        }

        // 应用装饰器
        editor.setDecorations(this.decorationType, sharedDecorations);
    }

    // 创建共享注释的装饰器
    private createSharedCommentDecoration(lineNumber: number, comments: SharedComment[], document: vscode.TextDocument): vscode.DecorationOptions | null {
        if (comments.length === 0) {
            return null;
        }

        const line = document.lineAt(lineNumber);
        const lineLength = line.text.length;

        // 构建显示文本 - 显示第一条匹配的共享注释
        const firstComment = comments[0];
        let contentText = '';
        
        // 添加云朵图标标识和注释内容
        if (firstComment.username) {
            contentText = `  [${firstComment.username}] ${firstComment.content}`;
        } else {
            contentText = ` [用户${firstComment.userId}] ${firstComment.content}`;
        }

        // 如果内容太长，截断显示
        const maxLength = 80;
        if (contentText.length > maxLength) {
            contentText = contentText.substring(0, maxLength) + '...';
        }

        return {
            range: new vscode.Range(lineNumber, lineLength, lineNumber, lineLength),
            renderOptions: {
                before: {
                    contentText: contentText,
                    color: '#6B7283', // 灰蓝色，与本地注释区分
                    fontStyle: 'italic',
                    margin: '0 0 0 2em'
                }
            }
        };
    }

    private clearDecorations(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(this.decorationType, []);
        }
    }

    public dispose(): void {
        this.timerManager.dispose(); // 清理所有定时器
        this.decorationType.dispose();
        this.disposables.forEach(d => d.dispose());
    }

    // 防抖更新方法，避免频繁更新装饰
    private debouncedUpdateDecorations(): void {
        if (this.updateTimer) {
            this.timerManager.clearTimeout(this.updateTimer);
        }

        this.updateTimer = this.timerManager.setTimeout(() => {
            this.updateDecorations();
            this.updateTimer = null;
        }, 100); // 100ms防抖延迟
    }

    // 添加hover提供器功能
    public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        if (!this.isVisible) {
            return undefined;
        }

        const line = position.line;
        
        // 检查是否有本地注释（优先级：本地注释 > 共享注释）
        const localComments = this.commentManager.getComments(document.uri);
        const lineLocalComments = localComments.filter(c => c.line === line && !('userId' in c));
        
        // 如果这一行有本地注释，不显示共享注释的hover
        if (lineLocalComments.length > 0) {
            return undefined;
        }

        // 获取共享注释
        const allSharedComments = this.commentManager.getAllSharedComments();
        const filePath = document.uri.fsPath;
        const sharedComments = allSharedComments[filePath] || [];
        const lineSharedComments = sharedComments.filter(c => c.line === line && c.isMatched !== false);

        if (lineSharedComments.length === 0) {
            return undefined;
        }

        const markdownContent = new vscode.MarkdownString();
        markdownContent.isTrusted = true;
        markdownContent.supportHtml = true;

        // 显示共享注释的hover信息
        const markdownIconUri = this.markdownIconUri || '';
        const markdown = `<img src="${markdownIconUri}" width="12" height="12" alt="查看详情" style="vertical-align: middle; margin-left: 4px;" />`;
        
        markdownContent.appendMarkdown(`**共享注释** \n\n`);

        for (let i = 0; i < lineSharedComments.length; i++) {
            const comment = lineSharedComments[i];

            if (i > 0) {
                markdownContent.appendMarkdown(`---\n\n`);
            }

            // 显示用户信息
            if (comment.username) {
                markdownContent.appendMarkdown(`**用户**: ${comment.username}[${markdown}](command:${COMMANDS.SHOW_SHARE_COMMENT}?${encodeURIComponent(JSON.stringify({
                    commentId: comment.id,
                    filePath: filePath,
                    line: comment.line
        }))} "查看共享注释详情")：\n\n`);
            } else {
                markdownContent.appendMarkdown(`**用户ID**: ${comment.userId}\n\n`);
            }

            // 显示注释内容
            markdownContent.appendMarkdown(`**内容**:\n${comment.content}\n\n`);

            // 显示代码上下文（如果有的话）
            if (comment.lineContent) {
                markdownContent.appendMarkdown(`**上下文内容**: \`${comment.lineContent}\`\n\n`);
            }

            // 显示时间戳
            if (comment.timestamp) {
                markdownContent.appendMarkdown(`**时间**: ${new Date(comment.timestamp).toLocaleString()}\n\n`);
            }

            // 添加查看详情的链接
            markdownContent.appendMarkdown(`[查看详情](command:${COMMANDS.SHOW_SHARE_COMMENT}?${encodeURIComponent(JSON.stringify({
                commentId: comment.id,
                filePath: filePath,
                line: comment.line
            }))} "查看共享注释详情")`);
        }

        return new vscode.Hover(markdownContent);
    }
}