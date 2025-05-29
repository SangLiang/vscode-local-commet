import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface LocalComment {
    id: string;
    line: number;
    content: string;
    timestamp: number;
    originalLine: number; // 原始行号，用于跟踪位置变化
    lineContent: string; // 该行的内容，用于智能定位
}

export interface FileComments {
    [filePath: string]: LocalComment[];
}

export class CommentManager {
    private comments: FileComments = {};
    private storageFile: string;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.storageFile = path.join(context.globalStorageUri?.fsPath || context.extensionPath, 'local-comments.json');
        this.loadComments();
    }

    private async loadComments(): Promise<void> {
        try {
            // 确保存储目录存在
            const storageDir = path.dirname(this.storageFile);
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }

            if (fs.existsSync(this.storageFile)) {
                const data = fs.readFileSync(this.storageFile, 'utf8');
                this.comments = JSON.parse(data);
            }
        } catch (error) {
            console.error('加载注释失败:', error);
            this.comments = {};
        }
    }

    private async saveComments(): Promise<void> {
        try {
            const storageDir = path.dirname(this.storageFile);
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }
            
            fs.writeFileSync(this.storageFile, JSON.stringify(this.comments, null, 2));
        } catch (error) {
            console.error('保存注释失败:', error);
        }
    }

    public async addComment(uri: vscode.Uri, line: number, content: string): Promise<void> {
        const filePath = uri.fsPath;
        
        if (!this.comments[filePath]) {
            this.comments[filePath] = [];
        }

        // 获取当前行的内容用于智能定位
        const document = await vscode.workspace.openTextDocument(uri);
        const lineContent = document.lineAt(line).text;

        const comment: LocalComment = {
            id: this.generateId(),
            line: line,
            content: content,
            timestamp: Date.now(),
            originalLine: line,
            lineContent: lineContent.trim()
        };

        // 检查是否已存在该行的注释，如果存在则替换
        const existingIndex = this.comments[filePath].findIndex(c => c.line === line);
        if (existingIndex >= 0) {
            this.comments[filePath][existingIndex] = comment;
        } else {
            this.comments[filePath].push(comment);
        }

        await this.saveComments();
        vscode.window.showInformationMessage(`已添加本地注释到第 ${line + 1} 行`);
    }

    public async editComment(uri: vscode.Uri, commentId: string, newContent: string): Promise<void> {
        const filePath = uri.fsPath;
        
        if (!this.comments[filePath]) {
            vscode.window.showWarningMessage('该文件没有本地注释');
            return;
        }

        const commentIndex = this.comments[filePath].findIndex(c => c.id === commentId);
        if (commentIndex === -1) {
            vscode.window.showWarningMessage('找不到指定的注释');
            return;
        }

        this.comments[filePath][commentIndex].content = newContent;
        this.comments[filePath][commentIndex].timestamp = Date.now(); // 更新时间戳

        await this.saveComments();
        vscode.window.showInformationMessage('注释已更新');
    }

    public getCommentById(uri: vscode.Uri, commentId: string): LocalComment | undefined {
        const filePath = uri.fsPath;
        const fileComments = this.comments[filePath];
        
        if (!fileComments) {
            return undefined;
        }

        return fileComments.find(c => c.id === commentId);
    }

    public async removeComment(uri: vscode.Uri, line: number): Promise<void> {
        const filePath = uri.fsPath;
        
        if (!this.comments[filePath]) {
            vscode.window.showWarningMessage('该文件没有本地注释');
            return;
        }

        const initialLength = this.comments[filePath].length;
        this.comments[filePath] = this.comments[filePath].filter(c => c.line !== line);

        if (this.comments[filePath].length === initialLength) {
            vscode.window.showWarningMessage(`第 ${line + 1} 行没有本地注释`);
            return;
        }

        // 如果该文件没有注释了，删除该文件的记录
        if (this.comments[filePath].length === 0) {
            delete this.comments[filePath];
        }

        await this.saveComments();
        vscode.window.showInformationMessage(`已删除第 ${line + 1} 行的本地注释`);
    }

    public async removeCommentById(uri: vscode.Uri, commentId: string): Promise<void> {
        const filePath = uri.fsPath;
        
        if (!this.comments[filePath]) {
            vscode.window.showWarningMessage('该文件没有本地注释');
            return;
        }

        const initialLength = this.comments[filePath].length;
        const commentToRemove = this.comments[filePath].find(c => c.id === commentId);
        
        if (!commentToRemove) {
            vscode.window.showWarningMessage('找不到指定的注释');
            return;
        }

        this.comments[filePath] = this.comments[filePath].filter(c => c.id !== commentId);

        // 如果该文件没有注释了，删除该文件的记录
        if (this.comments[filePath].length === 0) {
            delete this.comments[filePath];
        }

        await this.saveComments();
        vscode.window.showInformationMessage(`已删除第 ${commentToRemove.line + 1} 行的本地注释`);
    }

    public getComments(uri: vscode.Uri): LocalComment[] {
        const filePath = uri.fsPath;
        return this.comments[filePath] || [];
    }

    public async handleDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
        const filePath = event.document.uri.fsPath;
        const fileComments = this.comments[filePath];
        
        if (!fileComments || fileComments.length === 0) {
            return;
        }

        let needsSave = false;

        for (const change of event.contentChanges) {
            const startLine = change.range.start.line;
            const endLine = change.range.end.line;
            const linesAdded = change.text.split('\n').length - 1;
            const linesRemoved = endLine - startLine;
            const netLineChange = linesAdded - linesRemoved;

            // 更新受影响的注释位置
            for (const comment of fileComments) {
                if (comment.line >= startLine) {
                    if (comment.line <= endLine) {
                        // 注释在被修改的范围内，尝试智能重新定位
                        const newLine = this.findNewLinePosition(event.document, comment);
                        if (newLine !== -1) {
                            comment.line = newLine;
                            needsSave = true;
                        }
                    } else {
                        // 注释在被修改范围之后，调整行号
                        comment.line += netLineChange;
                        needsSave = true;
                    }
                }
            }
        }

        if (needsSave) {
            await this.saveComments();
        }
    }

    private findNewLinePosition(document: vscode.TextDocument, comment: LocalComment): number {
        // 尝试通过行内容匹配找到新位置
        const searchRange = 10; // 在原位置前后10行内搜索
        const startSearch = Math.max(0, comment.originalLine - searchRange);
        const endSearch = Math.min(document.lineCount - 1, comment.originalLine + searchRange);

        for (let i = startSearch; i <= endSearch; i++) {
            try {
                const lineText = document.lineAt(i).text.trim();
                if (lineText === comment.lineContent) {
                    return i;
                }
            } catch (error) {
                // 行号可能超出范围，继续搜索
                continue;
            }
        }

        // 如果找不到匹配的行，返回调整后的原始位置（如果在有效范围内）
        const adjustedLine = Math.min(comment.line, document.lineCount - 1);
        return adjustedLine >= 0 ? adjustedLine : -1;
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    public getAllComments(): FileComments {
        return this.comments;
    }

    public getStorageFilePath(): string {
        return this.storageFile;
    }
} 