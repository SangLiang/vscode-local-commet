import * as vscode from 'vscode';
import { CommentManager, LocalComment, SharedComment } from '../managers/commentManager';
import { createDataUri } from '../utils/utils';
import { logger } from '../utils/logger';
import { COMMANDS } from '../constants';
import { TimerManager } from '../utils/timerUtils';
import { extractTagsFromMarkdown, replaceTagReferencesInMarkdown } from '../utils/tagParser';

export class CommentProvider implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType;
    private tagDecorationType: vscode.TextEditorDecorationType;
    private commentManager: CommentManager;
    private isVisible: boolean = true;
    private disposables: vscode.Disposable[] = [];
    private timerManager: TimerManager = new TimerManager(); // 定时器管理器
    private updateTimer: NodeJS.Timeout | null = null; // 防抖定时器
    private onRefreshCallback?: () => void; // 添加刷新回调

    // 预加载的图标URIs
    private commentIconUri: string | null = null;
    private editIconUri: string | null = null;
    private deleteIconUri: string | null = null;
    private markdownIconUri: string | null = null;

    constructor(commentManager: CommentManager) {
        this.commentManager = commentManager;

        // 行内注释装饰类型（位置/样式集中在 buildDecorationRenderOptions，改 before↔after 只需改那一处）
        this.decorationType = vscode.window.createTextEditorDecorationType(this.buildDecorationRenderOptions(false));

        // 标签装饰器（当前未使用，但保留以避免错误）
        this.tagDecorationType = vscode.window.createTextEditorDecorationType({});

        // 监听编辑器变化
        this.disposables.push(
            // vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
            // vscode.window.onDidChangeTextEditorSelection(() => this.debouncedUpdateDecorations())
        );

        // 监听配置变更，gutter 开关变化时重新创建装饰类型并刷新
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('local-comment.enableGutterProvider')) {
                    this.recreateDecorationType();
                    this.refresh();
                }
            })
        );

        // 异步加载图标，加载完成后重新创建装饰类型
        this.loadAllIcons().then(() => {
            this.recreateDecorationType();
            this.updateDecorations();
        });
        this.updateDecorations();
    }

            // 异步加载所有图标
        private async loadAllIcons(): Promise<void> {
            try {
                const context = this.commentManager.getContext();
                const [commentIcon, editIcon, deleteIcon, markdownIcon] = await Promise.all([
                    createDataUri(context, 'src/resources/pin.svg'), // 注释图标
                    createDataUri(context, 'src/resources/edit.svg'), // 编辑图标
                    createDataUri(context, 'src/resources/delete.svg'), // 删除图标
                    createDataUri(context, 'src/resources/markdown.svg') // Markdown图标
                ]);

                this.commentIconUri = commentIcon;
                this.editIconUri = editIcon;
                this.deleteIconUri = deleteIcon;
                this.markdownIconUri = markdownIcon;
            } catch (error) {
                logger.error('加载图标失败:', error);
            }
        }

    // 重新创建装饰类型（加载图标后）
    // 行内文字始终显示；gutter 图标根据配置决定是否显示
    private recreateDecorationType(): void {
        this.decorationType.dispose();
        const enableGutter = vscode.workspace.getConfiguration('local-comment').get<boolean>('enableGutterProvider', true);
        this.decorationType = vscode.window.createTextEditorDecorationType(this.buildDecorationRenderOptions(enableGutter));
    }

    // 构建行内注释装饰类型的渲染选项（位置/样式集中在此，改 before↔after 只需改这一处）
    private buildDecorationRenderOptions(enableGutter: boolean): vscode.DecorationRenderOptions {
        const options: vscode.DecorationRenderOptions = {
            // 行尾用 after：光标可正常到达行末（before 会在行尾占据虚拟位置，导致光标无法越过最后一个字符）
            after: {
                color: '#888888',
                fontStyle: 'italic',
                margin: '0 0 0 2em'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        };
        if (enableGutter && this.commentIconUri) {
            options.gutterIconPath = vscode.Uri.parse(this.commentIconUri);
            options.gutterIconSize = 'contain';
        }
        return options;
    }

    public refresh(): void {
        this.updateDecorations();
        // 调用刷新回调
        if (this.onRefreshCallback) {
            this.onRefreshCallback();
        }
    }

    // 设置刷新回调
    public setRefreshCallback(callback: () => void): void {
        this.onRefreshCallback = callback;
    }

    public toggleVisibility(): void {
        this.isVisible = !this.isVisible;
        if (this.isVisible) {
            this.updateDecorations();
            vscode.window.showInformationMessage('本地注释已显示');
        } else {
            this.clearDecorations();
            vscode.window.showInformationMessage('本地注释已隐藏');
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
        const comments = this.commentManager.getComments(uri);

        if (comments.length === 0) {
            this.clearDecorations();
            return;
        }

        const normalDecorations: vscode.DecorationOptions[] = [];

        // 按行号分组注释
        const commentsByLine = this.groupCommentsByLine(comments, document.lineCount);

        // 为每一行创建装饰器
        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            const line = document.lineAt(lineNumber);
            const lineComments = commentsByLine.get(lineNumber) || [];

            if (lineComments.length === 0) {
                continue;
            }

            // 分离本地注释和共享注释
            const localComments = lineComments.filter(comment => !('userId' in comment));

            // 优先显示本地注释的内容和行号标识
            if (localComments.length > 0) {
                const normalDecoration = this.createSingleDecoration(lineComments, line, editor);
                if (this.hasInlineContent(normalDecoration)) {
                    normalDecorations.push(normalDecoration);
                }
            }
            // 如果有本地注释，完全忽略共享注释，避免同一行有两个装饰器
        }

        editor.setDecorations(this.decorationType, normalDecorations);
        editor.setDecorations(this.tagDecorationType, []); // 标签装饰器（当前未使用）
    }

    // 创建注释的装饰器
    private createSingleDecoration(comments: (LocalComment | SharedComment)[], line: vscode.TextLine, editor: vscode.TextEditor): vscode.DecorationOptions {
        const lineLength = line.text.length;

        // 只显示本地注释，过滤掉共享注释
        const localComments = comments.filter(comment => !('userId' in comment));

        let contentText = '';
        if (localComments.length > 0) {
            contentText = ` ${localComments[0].content}`;
        }

        return {
            range: new vscode.Range(line.lineNumber, lineLength, line.lineNumber, lineLength),
            renderOptions: { after: this.buildInlineAttachment(contentText) }
        };
    }

    // 构建单个注释的行内附件渲染选项（实例级，覆盖类型级默认色）
    private buildInlineAttachment(contentText: string): vscode.ThemableDecorationAttachmentRenderOptions {
        return {
            contentText,
            color: '#6B7283',
            fontStyle: 'italic',
            margin: '0 0 0 2em'
        };
    }

    // 判断装饰是否带有行内注释内容
    private hasInlineContent(decoration: vscode.DecorationOptions): boolean {
        return !!decoration.renderOptions?.after?.contentText;
    }

    // 移除共享注释装饰器方法 - 不再需要

    /**
     * 按行号分组注释
     *
     * @param comments 注释数组
     * @param documentLineCount 文档总行数
     * @returns 按行号分组的注释Map
     *
     * @example
     * 假设有以下注释：
     * - 第5行：本地注释A
     * - 第5行：共享注释B
     * - 第10行：本地注释C
     * - 第15行：共享注释D
     *
     * 分组后的结果：
     * ```typescript
     * commentsByLine = {
     *   5: [本地注释A, 共享注释B],
     *   10: [本地注释C],
     *   15: [共享注释D]
     * }
     * ```
     */
    private groupCommentsByLine(comments: (LocalComment | SharedComment)[], documentLineCount: number): Map<number, (LocalComment | SharedComment)[]> {
        const commentsByLine = new Map<number, (LocalComment | SharedComment)[]>();

        for (const comment of comments) {
            if (comment.line >= 0 && comment.line < documentLineCount) {
                if (!commentsByLine.has(comment.line)) {
                    commentsByLine.set(comment.line, []);
                }
                commentsByLine.get(comment.line)!.push(comment);
            }
        }

        return commentsByLine;
    }

    private clearDecorations(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(this.decorationType, []);
            editor.setDecorations(this.tagDecorationType, []);
        }
    }

    public dispose(): void {
        this.timerManager.dispose(); // 清理所有定时器
        this.decorationType.dispose();
        this.tagDecorationType.dispose();
        this.disposables.forEach(d => d.dispose());
    }

    private processMarkdownContent(content: string): string {
        return content
            .replace(/\\n/g, '\n')      // \n -> 换行
            .replace(/\\t/g, '\t')      // \t -> 制表符
            .replace(/\\r/g, '\r')      // \r -> 回车
            .replace(/\\\\/g, '\\')     // \\ -> \
            .replace(/\\"/g, '"')       // \" -> "
            .replace(/\\'/g, "'");      // \' -> '
    }

    // 提供悬浮提示
    public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        if (!this.isVisible) {
            return;
        }

        const line = position.line;
        const comments = this.commentManager.getComments(document.uri);
        const lineComments = comments.filter(c => c.line === line);

        // 检查所有注释的存储状态
        const allComments = this.commentManager.getAllComments();
        const filePath = document.uri.fsPath;
        const storedComments = allComments[filePath] || [];

        // 检查是否有共享注释
        const allSharedComments = this.commentManager.getAllSharedComments();
        const sharedComments = allSharedComments[filePath] || [];
        const lineSharedComments = sharedComments.filter(c => c.line === line);

        if (lineComments.length > 0) {
            // 使用预加载的图标URIs，如果没有加载完成则跳过图标显示
            const editIconUri = this.editIconUri || '';
            const deleteIconUri = this.deleteIconUri || '';
            const markDownIconUri = this.markdownIconUri || '';

            const markdownContent = new vscode.MarkdownString();
            markdownContent.isTrusted = true;
            markdownContent.supportHtml = true;

            // 分离本地注释和共享注释
            const localComments = lineComments.filter(comment => !('userId' in comment));

            // 只显示本地注释的hover，不显示共享注释的hover
            if (localComments.length === 0) {
                return undefined; // 如果没有本地注释，不显示hover
            }

            // 显示本地注释
            for (let i = 0; i < localComments.length; i++) {
                const comment = localComments[i];

                if (i > 0) {
                    markdownContent.appendMarkdown(`---\n\n`);
                }

                // 创建编辑参数
                const editArgs = JSON.stringify({
                    uri: document.uri.toString(),
                    commentId: comment.id,
                    line: comment.line
                });

                const editIcon = `<img src="${editIconUri}" width="12" height="12" alt="编辑" style="vertical-align: middle; margin-left: 4px;" />`;
                
                markdownContent.appendMarkdown(`**本地注释** [${editIcon}](command:${COMMANDS.EDIT_COMMENT_FROM_HOVER}?${encodeURIComponent(editArgs)} "编辑注释")\n\n`);

                // 处理用户输入的转义字符
                const processedContent = this.processMarkdownContent(comment.content);

                // 按Markdown语义提取标签，并将代码以外的@标签转换为可点击链接
                const tags = extractTagsFromMarkdown(processedContent);
                const enhancedContent = replaceTagReferencesInMarkdown(processedContent, tags, tag =>
                    `[${tag.text}](command:${COMMANDS.GO_TO_TAG_DECLARATION}?${encodeURIComponent(JSON.stringify({tagName: tag.tagName}))})`
                );

                markdownContent.appendMarkdown(enhancedContent);
                markdownContent.appendMarkdown(`\n\n`);

                // 添加标签信息部分并进行去重
                if (tags.length > 0) {
                    // 使用Set进行去重
                    const declarationTags = new Set<string>();
                    const referenceTags = new Set<string>();

                    // 收集唯一标签
                    for (const tag of tags) {
                        if (tag.type === 'declaration') {
                            declarationTags.add(tag.text);
                        } else {
                            referenceTags.add(tag.text);
                        }
                    }

                    markdownContent.appendMarkdown(`**标签信息**\n\n`);

                    // 处理声明标签
                    for (const tagText of declarationTags) {
                        markdownContent.appendMarkdown(`️**声明**: \`${tagText}\`\n\n`);
                    }

                    // 处理引用标签
                    for (const tagText of referenceTags) {
                        const tagName = tagText.substring(1);
                        markdownContent.appendMarkdown(`**引用**: \`${tagText}\` - [跳转到声明](command:${COMMANDS.GO_TO_TAG_DECLARATION}?${encodeURIComponent(JSON.stringify({tagName}))})\n\n`);
                    }
                }

                markdownContent.appendMarkdown(`---\n`);
                markdownContent.appendMarkdown(`*${new Date(comment.timestamp).toLocaleString()}*\n\n`);

                // 本地注释显示完整的操作按钮
                const removeArgs = JSON.stringify({
                    uri: document.uri.toString(),
                    commentId: comment.id,
                    line: comment.line
                });

                const deleteIcon = `<img src="${deleteIconUri}" width="16" height="16" alt="删除" style="vertical-align: middle;" />`;
                const markDownIcon = `<img src="${markDownIconUri}" width="16" height="16" alt="Markdown编辑" style="vertical-align: middle;" />`;

                markdownContent.appendMarkdown(`[${markDownIcon} Markdown编辑](command:${COMMANDS.EDIT_COMMENT_FROM_HOVER}?${encodeURIComponent(editArgs)} "多行编辑注释") | `);
                markdownContent.appendMarkdown(`[${deleteIcon} 删除](command:${COMMANDS.REMOVE_COMMENT_FROM_HOVER}?${encodeURIComponent(removeArgs)} "删除注释")`);
            }

            // 如果同一行有共享注释，添加提示信息
            if (lineSharedComments.length > 0) {
                markdownContent.appendMarkdown(`\n\n---\n\n`);
                markdownContent.appendMarkdown(`**这里还有其他人的共享评论**\n\n`);
                
                // 显示共享注释的简要信息
                for (const sharedComment of lineSharedComments) {
                    const username = sharedComment.username || `用户${sharedComment.userId}`;
                    
                    // 创建查看详情的命令参数
                    const detailArgs = JSON.stringify({
                        commentId: sharedComment.id,
                        filePath: document.uri.fsPath,
                        line: sharedComment.line
                    });
                    
                    // 添加详情按钮
                    markdownContent.appendMarkdown(`**${username}**: ${sharedComment.content.substring(0, 150)}${sharedComment.content.length > 150 ? '...' : ''} [查看详情](command:${COMMANDS.SHOW_SHARE_COMMENT}?${encodeURIComponent(detailArgs)} "查看共享评论详情")\n\n`);
                }
            }

            return new vscode.Hover(markdownContent);
        }

        return undefined;
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

    /**
     * 获取API基础URL
     */
    private getApiBaseUrl(): string {
        const config = vscode.workspace.getConfiguration('local-comment');
        const apiUrl = config.get<string>('server.apiUrl');
        if (!apiUrl) {
            throw new Error('API服务器地址未配置，请在设置中配置 server.apiUrl');
        }
        return apiUrl;
    }

    /**
     * 获取图片并转换为base64格式
     */
    private async fetchImageAsBase64(imageUrl: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(imageUrl, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`图片请求失败，状态码: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const base64 = buffer.toString('base64');
            const contentType = response.headers.get('content-type') || 'image/png';
            const dataUri = `data:${contentType};base64,${base64}`;

            return dataUri;
        } catch (error) {
            logger.error('获取图片失败:', error);
            return null;
        }
    }
}