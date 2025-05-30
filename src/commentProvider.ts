import * as vscode from 'vscode';
import { CommentManager, LocalComment } from './commentManager';

export class CommentProvider implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType;
    private tagDecorationType: vscode.TextEditorDecorationType;
    private commentManager: CommentManager;
    private isVisible: boolean = true;
    private disposables: vscode.Disposable[] = [];

    constructor(commentManager: CommentManager) {
        this.commentManager = commentManager;
        
        // 创建装饰类型用于显示注释
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                color: '#888888',
                fontStyle: 'italic',
                margin: '0 0 0 1em'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });

        // 标签装饰器现在不再使用，但保留以避免错误
        this.tagDecorationType = vscode.window.createTextEditorDecorationType({});

        // 监听编辑器变化
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
            vscode.window.onDidChangeTextEditorSelection(() => this.updateDecorations())
        );

        this.updateDecorations();
    }

    public refresh(): void {
        this.updateDecorations();
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
        if (!this.isVisible) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const comments = this.commentManager.getComments(editor.document.uri);
        
        const normalDecorations: vscode.DecorationOptions[] = [];
        const tagDecorations: vscode.DecorationOptions[] = [];

        for (const comment of comments) {
            // 确保行号在有效范围内
            if (comment.line >= 0 && comment.line < editor.document.lineCount) {
                const line = editor.document.lineAt(comment.line);
                
                // 创建分段装饰
                const decorations = this.createSegmentedDecorations(comment, line, editor);
                normalDecorations.push(...decorations.normal);
                tagDecorations.push(...decorations.tags);
            }
        }

        editor.setDecorations(this.decorationType, normalDecorations);
        editor.setDecorations(this.tagDecorationType, tagDecorations);
    }

    private createSegmentedDecorations(comment: LocalComment, line: vscode.TextLine, editor: vscode.TextEditor): {normal: vscode.DecorationOptions[], tags: vscode.DecorationOptions[]} {
        const normal: vscode.DecorationOptions[] = [];
        const tags: vscode.DecorationOptions[] = [];
        const lineLength = line.text.length;
        
        // 🎯 精确模式：所有注释都使用普通样式，不进行特殊高亮
        const decoration: vscode.DecorationOptions = {
            range: new vscode.Range(comment.line, lineLength, comment.line, lineLength),
            renderOptions: {
                after: {
                    contentText: ` 💬 ${comment.content}`,
                    color: '#888888',
                    fontStyle: 'italic',
                    margin: '0 0 0 1em'
                }
            }
        };
        
        // 所有注释都放到normal数组中，保持一致的显示效果
        normal.push(decoration);
        
        return { normal, tags };
    }

    private parseCommentIntoSegments(content: string): Array<{text: string, isTag: boolean}> {
        const segments: Array<{text: string, isTag: boolean}> = [];
        let lastIndex = 0;
        
        // 匹配所有标签（声明和引用）
        const tagRegex = /(\$[a-zA-Z_][a-zA-Z0-9_]*)|(@[a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        
        while ((match = tagRegex.exec(content)) !== null) {
            // 添加标签前的普通文本
            if (match.index > lastIndex) {
                segments.push({
                    text: content.substring(lastIndex, match.index),
                    isTag: false
                });
            }
            
            // 添加标签
            segments.push({
                text: match[0],
                isTag: true
            });
            
            lastIndex = match.index + match[0].length;
        }
        
        // 添加剩余的普通文本
        if (lastIndex < content.length) {
            segments.push({
                text: content.substring(lastIndex),
                isTag: false
            });
        }
        
        // 如果没有找到任何标签，返回整个内容作为普通文本
        if (segments.length === 0) {
            segments.push({
                text: content,
                isTag: false
            });
        }
        
        return segments;
    }

    private extractTagsFromContent(content: string): Array<{text: string, type: 'declaration' | 'reference'}> {
        const tags: Array<{text: string, type: 'declaration' | 'reference'}> = [];
        
        // 匹配所有标签（声明和引用）
        const tagRegex = /(\$[a-zA-Z_][a-zA-Z0-9_]*)|(@[a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        
        while ((match = tagRegex.exec(content)) !== null) {
            tags.push({
                text: match[0],
                type: match[0].startsWith('$') ? 'declaration' : 'reference'
            });
        }
        
        return tags;
    }

    private clearDecorations(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(this.decorationType, []);
            editor.setDecorations(this.tagDecorationType, []);
        }
    }

    public dispose(): void {
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

    public provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        if (!this.isVisible) {
            return;
        }

        const line = position.line;
        const comments = this.commentManager.getComments(document.uri);
        const comment = comments.find(c => c.line === line);

        if (comment) {
            const markdownContent = new vscode.MarkdownString();
            markdownContent.isTrusted = true;
            markdownContent.supportHtml = true;
            
            // 🔥 处理用户输入的转义字符
            const processedContent = this.processMarkdownContent(comment.content);
            
            // 构建Markdown内容
            markdownContent.appendMarkdown(`**💬 本地注释**\n\n`);
            markdownContent.appendMarkdown(processedContent);
            markdownContent.appendMarkdown(`\n\n`);
            
            // 恢复完整的标签处理逻辑
            const tags = this.extractTagsFromContent(comment.content);
            if (tags.length > 0) {
                markdownContent.appendMarkdown(`**🏷️ 标签信息**\n\n`);
                for (const tag of tags) {
                    if (tag.type === 'declaration') {
                        markdownContent.appendMarkdown(`🏷️ **声明**: \`${tag.text}\`\n\n`);
                    } else {
                        const tagName = tag.text.substring(1);
                        markdownContent.appendMarkdown(`🔗 **引用**: \`${tag.text}\` - [跳转到声明](command:localComment.goToTagDeclaration?${encodeURIComponent(JSON.stringify({tagName}))})\n\n`);
                    }
                }
            }
            
            markdownContent.appendMarkdown(`---\n`);
            markdownContent.appendMarkdown(`📅 *${new Date(comment.timestamp).toLocaleString()}*\n\n`);
            
            // 添加操作按钮
            const editArgs = JSON.stringify({
                uri: document.uri.toString(),
                commentId: comment.id,
                line: comment.line
            });
            
            const removeArgs = JSON.stringify({
                uri: document.uri.toString(),
                commentId: comment.id,
                line: comment.line
            });

            markdownContent.appendMarkdown(`[✏️ 编辑](command:localComment.quickEditCommentFromHover?${encodeURIComponent(editArgs)} "快速编辑注释") | `);
            markdownContent.appendMarkdown(`[📝 Markdown编辑](command:localComment.editCommentFromHover?${encodeURIComponent(editArgs)} "多行编辑注释") | `);
            markdownContent.appendMarkdown(`[🗑️ 删除](command:localComment.removeCommentFromHover?${encodeURIComponent(removeArgs)} "删除注释")`);
            
            return new vscode.Hover(markdownContent);
        }

        return undefined;
    }
}