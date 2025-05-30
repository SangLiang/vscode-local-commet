import * as vscode from 'vscode';
import * as path from 'path';
import { CommentManager, LocalComment, FileComments } from './commentManager';

export class CommentTreeProvider implements vscode.TreeDataProvider<CommentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CommentTreeItem | undefined | null | void> = new vscode.EventEmitter<CommentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CommentTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private commentManager: CommentManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CommentTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CommentTreeItem): Thenable<CommentTreeItem[]> {
        if (!element) {
            // 根节点，返回所有有注释的文件
            return Promise.resolve(this.getFileNodes());
        } else if (element.contextValue === 'file') {
            // 文件节点，返回该文件的所有注释
            return Promise.resolve(this.getCommentNodes(element.filePath!));
        }
        return Promise.resolve([]);
    }

    private getFileNodes(): CommentTreeItem[] {
        const allComments = this.commentManager.getAllComments();
        const fileNodes: CommentTreeItem[] = [];

        for (const [filePath, comments] of Object.entries(allComments)) {
            if (comments.length > 0) {
                const fileName = path.basename(filePath);
                const fileNode = new CommentTreeItem(
                    `${fileName} (${comments.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'file'
                );
                fileNode.filePath = filePath;
                fileNode.tooltip = filePath;
                fileNode.iconPath = new vscode.ThemeIcon('file-code');
                fileNodes.push(fileNode);
            }
        }

        if (fileNodes.length === 0) {
            const emptyNode = new CommentTreeItem(
                '暂无本地注释',
                vscode.TreeItemCollapsibleState.None,
                'empty'
            );
            emptyNode.iconPath = new vscode.ThemeIcon('info');
            return [emptyNode];
        }

        return fileNodes;
    }

    private getCommentNodes(filePath: string): CommentTreeItem[] {
        const comments = this.commentManager.getAllComments()[filePath] || [];
        const commentNodes: CommentTreeItem[] = [];

        // 按行号排序
        comments.sort((a, b) => a.line - b.line);

        for (const comment of comments) {
            const label = `第${comment.line + 1}行: ${comment.content}`;
            const commentNode = new CommentTreeItem(
                label,
                vscode.TreeItemCollapsibleState.None,
                'comment'
            );
            
            commentNode.filePath = filePath;
            commentNode.comment = comment;
            commentNode.tooltip = `${comment.content}\n添加时间: ${new Date(comment.timestamp).toLocaleString()}`;
            commentNode.iconPath = new vscode.ThemeIcon('comment');
            
            // 添加命令，点击时跳转到对应位置
            commentNode.command = {
                command: 'localComment.goToComment',
                title: '跳转到注释',
                arguments: [filePath, comment.line]
            };

            // 创建Markdown格式的tooltip
            const markdownTooltip = new vscode.MarkdownString();
            markdownTooltip.appendMarkdown(comment.content);
            commentNode.tooltip = markdownTooltip;

            commentNodes.push(commentNode);
        }

        return commentNodes;
    }
}

export class CommentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
    }

    filePath?: string;
    comment?: LocalComment;
} 