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

        // 创建装饰类型用于高亮标签
        this.tagDecorationType = vscode.window.createTextEditorDecorationType({
            // 移除所有可能导致额外视觉效果的样式
            // 现在我们通过renderOptions.after来控制样式
        });

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
        
        // 解析内容为段落
        const segments = this.parseCommentIntoSegments(comment.content);
        
        let currentPos = lineLength; // 从行尾开始
        let isFirstSegment = true;
        
        for (const segment of segments) {
            if (isFirstSegment) {
                // 第一个段落包含图标
                const iconAndContent = ` 💬 ${segment.text}`;
                
                if (segment.isTag) {
                    // 第一个就是标签
                    const decoration: vscode.DecorationOptions = {
                        range: new vscode.Range(comment.line, currentPos, comment.line, currentPos),
                        renderOptions: {
                            after: {
                                contentText: iconAndContent,
                                color: '#6BB6FF',
                                backgroundColor: 'rgba(107, 182, 255, 0.08)',
                                fontStyle: 'italic'
                            }
                        },
                        hoverMessage: this.createHoverMessage(comment, editor.document.uri)
                    };
                    tags.push(decoration);
                } else {
                    // 第一个是普通文本
                    const decoration: vscode.DecorationOptions = {
                        range: new vscode.Range(comment.line, currentPos, comment.line, currentPos),
                        renderOptions: {
                            after: {
                                contentText: iconAndContent,
                                color: '#888888',
                                fontStyle: 'italic'
                            }
                        },
                        hoverMessage: this.createHoverMessage(comment, editor.document.uri)
                    };
                    normal.push(decoration);
                }
                isFirstSegment = false;
            } else {
                // 后续段落不包含图标
                if (segment.isTag) {
                    const decoration: vscode.DecorationOptions = {
                        range: new vscode.Range(comment.line, currentPos, comment.line, currentPos),
                        renderOptions: {
                            after: {
                                contentText: segment.text,
                                color: '#6BB6FF',
                                backgroundColor: 'rgba(107, 182, 255, 0.08)',
                                fontStyle: 'italic'
                            }
                        }
                    };
                    tags.push(decoration);
                } else {
                    const decoration: vscode.DecorationOptions = {
                        range: new vscode.Range(comment.line, currentPos, comment.line, currentPos),
                        renderOptions: {
                            after: {
                                contentText: segment.text,
                                color: '#888888',
                                fontStyle: 'italic'
                            }
                        }
                    };
                    normal.push(decoration);
                }
            }
        }
        
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

    private createHoverMessage(comment: LocalComment, uri: vscode.Uri): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;
        
        markdown.appendMarkdown(`**本地注释**\n\n`);
        markdown.appendMarkdown(`${comment.content}\n\n`);
        
        // 检测标签并添加相关信息
        const tags = this.extractTagsFromContent(comment.content);
        
        // 准备命令参数，包含注释的完整信息
        const editArgs = JSON.stringify({
            uri: uri.toString(),
            commentId: comment.id,
            line: comment.line
        });
        
        const deleteArgs = JSON.stringify({
            uri: uri.toString(),
            commentId: comment.id,
            line: comment.line
        });
        
        // 使用包含参数的命令链接
        markdown.appendMarkdown(`[✏️ 编辑注释](command:localComment.editCommentFromHover?${encodeURIComponent(editArgs)}) | [🗑️ 删除注释](command:localComment.removeCommentFromHover?${encodeURIComponent(deleteArgs)})`);
        markdown.appendMarkdown(`\n\n---\n\n`);
        markdown.appendMarkdown(`*添加时间: ${new Date(comment.timestamp).toLocaleString()}*\n\n`);

        if (tags.length > 0) {
            markdown.appendMarkdown(`**标签信息**\n\n`);
            for (const tag of tags) {
                if (tag.type === 'declaration') {
                    markdown.appendMarkdown(`🏷️ **声明**: \`${tag.text}\`\n\n`);
                } else {
                    const tagName = tag.text.substring(1); // 移除@符号
                    markdown.appendMarkdown(`🔗 **引用**: \`${tag.text}\` - [跳转到声明](command:localComment.goToTagDeclaration?${encodeURIComponent(JSON.stringify({tagName}))})\n\n`);
                }
            }
        }

        return markdown;
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
} 