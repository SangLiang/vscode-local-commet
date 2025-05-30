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
    private updateTimer: NodeJS.Timeout | null = null; // 防抖定时器
    private pendingUpdates: Set<string> = new Set(); // 待更新的文件路径

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
        const fileComments = this.comments[filePath] || [];
        
        if (fileComments.length === 0) {
            return [];
        }

        // 获取当前文档内容进行智能匹配
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
        if (!document) {
            // 如果文档未打开，返回空数组（暂时隐藏注释）
            return [];
        }

        const matchedComments: LocalComment[] = [];
        let needsSave = false;

        for (const comment of fileComments) {
            const matchedLine = this.findMatchingLine(document, comment);
            if (matchedLine !== -1) {
                // 创建一个新的注释对象，更新行号但保持原有信息
                const matchedComment: LocalComment = {
                    ...comment,
                    line: matchedLine
                };
                matchedComments.push(matchedComment);
                
                // 如果位置发生了变化，更新存储的注释
                if (comment.line !== matchedLine) {
                    comment.line = matchedLine;
                    needsSave = true;
                }
            }
            // 如果找不到匹配的行，暂时不显示该注释
        }

        // 如果有位置更新，保存到文件
        if (needsSave) {
            this.saveCommentsAsync();
        }

        return matchedComments;
    }

    /**
     * 智能匹配注释对应的行号
     * 优先通过代码内容匹配，行号作为辅助
     */
    private findMatchingLine(document: vscode.TextDocument, comment: LocalComment): number {
        const lineContent = comment.lineContent?.trim();
        
        // 如果没有保存的行内容（旧版本数据），严格隐藏注释
        // 不再提供兼容性支持，避免注释显示在错误的位置
        if (!lineContent || lineContent.length === 0) {
            console.warn(`⚠️ 注释 ${comment.id} 缺少代码内容快照，将被隐藏`);
            return -1; // 严格隐藏，不提供兼容性
        }

        // 1. 优先在原始行号位置查找匹配
        if (comment.line >= 0 && comment.line < document.lineCount) {
            const currentLineContent = document.lineAt(comment.line).text.trim();
            if (currentLineContent === lineContent) {
                return comment.line;
            }
        }

        // 2. 在原始行号附近的小范围内查找（±5行）
        const searchRange = 5;
        const startLine = Math.max(0, comment.line - searchRange);
        const endLine = Math.min(document.lineCount - 1, comment.line + searchRange);

        for (let i = startLine; i <= endLine; i++) {
            if (i !== comment.line) { // 跳过已经检查过的原始行号
                const currentLineContent = document.lineAt(i).text.trim();
                if (currentLineContent === lineContent) {
                    return i;
                }
            }
        }

        // 3. 在整个文档中查找精确匹配
        for (let i = 0; i < document.lineCount; i++) {
            if (i >= startLine && i <= endLine) {
                continue; // 跳过已经搜索过的范围
            }
            const currentLineContent = document.lineAt(i).text.trim();
            if (currentLineContent === lineContent) {
                return i;
            }
        }

        // 4. 使用模糊匹配（去除空格和标点符号的影响）
        const normalizedTarget = this.normalizeLineContent(lineContent);
        if (normalizedTarget && normalizedTarget.length > 0) {
            for (let i = 0; i < document.lineCount; i++) {
                const currentLineContent = document.lineAt(i).text.trim();
                const normalizedCurrent = this.normalizeLineContent(currentLineContent);
                if (normalizedCurrent && normalizedCurrent === normalizedTarget && normalizedCurrent.length > 0) {
                    return i;
                }
            }
        }

        // 5. 找不到匹配的内容，严格隐藏注释
        // 只在调试时显示详细信息
        return -1;
    }

    /**
     * 标准化行内容，用于模糊匹配
     * 移除空格、制表符和一些常见的标点符号
     */
    private normalizeLineContent(content: string): string {
        const normalized = content
            .replace(/\s+/g, '') // 移除所有空白字符
            .replace(/[;,{}()]/g, '') // 移除常见标点符号
            .toLowerCase(); // 转为小写
        
        // 避免过于短的内容造成误匹配
        // 标准化后的内容至少要有3个字符才考虑模糊匹配
        return normalized.length >= 3 ? normalized : '';
    }

    public async handleDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
        const filePath = event.document.uri.fsPath;
        const fileComments = this.comments[filePath];
        
        if (!fileComments || fileComments.length === 0) {
            return;
        }

        // 将这个文件标记为需要智能更新
        this.pendingUpdates.add(filePath);

        // 使用防抖机制：清除之前的定时器，设置新的定时器
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        // 延迟1秒后执行智能更新（用户停止编辑1秒后）
        this.updateTimer = setTimeout(async () => {
            console.log('🧠 开始智能更新注释代码快照...');
            await this.performSmartUpdates();
            this.updateTimer = null;
        }, 1000);

        // 立即触发注释重新渲染
        setTimeout(() => {
            vscode.commands.executeCommand('localComment.refreshComments');
        }, 50);
    }

    /**
     * 执行智能更新：只有当注释确实匹配到正确位置时，才更新代码快照
     */
    private async performSmartUpdates(): Promise<void> {
        let totalUpdates = 0;
        
        for (const filePath of this.pendingUpdates) {
            const fileComments = this.comments[filePath];
            if (!fileComments) continue;

            // 获取当前文档
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
            if (!document) continue;

            let fileUpdates = 0;
            
            for (const comment of fileComments) {
                // 首先进行智能匹配，看注释是否找到了正确的位置
                const matchedLine = this.findMatchingLine(document, comment);
                
                if (matchedLine !== -1) {
                    // 注释找到了匹配位置，检查是否需要更新代码快照
                    try {
                        const currentLineContent = document.lineAt(matchedLine).text.trim();
                        const storedLineContent = (comment.lineContent || '').trim();
                        
                        // 情况1：注释匹配到了原位置，但代码内容发生了变化（用户编辑）
                        // 情况2：注释匹配到了新位置，需要更新行号和代码快照
                        if (currentLineContent !== storedLineContent && currentLineContent.length > 0) {
                            comment.lineContent = currentLineContent;
                            comment.line = matchedLine; // 同时更新行号
                            fileUpdates++;
                            totalUpdates++;
                        } else if (comment.line !== matchedLine) {
                            // 只是位置变化，代码内容没变
                            comment.line = matchedLine;
                            fileUpdates++;
                            totalUpdates++;
                        }
                    } catch (error) {
                        console.warn(`⚠️ 无法智能更新注释 ${comment.id}:`, error);
                    }
                }
                // 注释没有找到匹配位置时，静默处理，不输出日志
        }

            if (fileUpdates > 0) {
                console.log(`✅ 文件 ${path.basename(filePath)} 更新了 ${fileUpdates} 个注释`);
            }
        }

        // 清空待更新列表
        this.pendingUpdates.clear();

        // 如果有更新，保存到文件
        if (totalUpdates > 0) {
            await this.saveComments();
            console.log(`✅ 智能更新完成，共更新 ${totalUpdates} 个注释`);
        }
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

    /**
     * 将选中的文字转换为本地注释
     * @param uri 文件URI
     * @param selection 选中的文字范围
     * @param selectedText 选中的文字内容
     */
    public async convertSelectionToComment(uri: vscode.Uri, selection: vscode.Selection, selectedText: string): Promise<void> {
        const filePath = uri.fsPath;
        
        if (!this.comments[filePath]) {
            this.comments[filePath] = [];
        }

        // 获取选中文字所在的行号（使用起始行）
        const line = selection.start.line;
        
        // 获取当前行的内容用于智能定位
        const document = await vscode.workspace.openTextDocument(uri);
        const lineContent = document.lineAt(line).text;

        // 创建本地注释
        const comment: LocalComment = {
            id: this.generateId(),
            line: line,
            content: selectedText.trim(), // 使用选中的文字作为注释内容
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

        // 保存注释
        await this.saveComments();

        // 删除选中的文字
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.fsPath === filePath) {
            await editor.edit(editBuilder => {
                editBuilder.delete(selection);
            });
        }

        vscode.window.showInformationMessage(`已将选中文字转换为第 ${line + 1} 行的本地注释`);
    }

    /**
     * 异步保存注释，避免阻塞UI
     */
    private async saveCommentsAsync(): Promise<void> {
        try {
            setTimeout(async () => {
                await this.saveComments();
            }, 100);
        } catch (error) {
            console.error('异步保存注释失败:', error);
        }
    }
} 