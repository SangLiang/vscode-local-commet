import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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
        this.storageFile = this.getProjectStorageFile(context);
        this.loadComments();
        
        // 监听工作区变化，重新加载注释数据
        const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.handleWorkspaceChange();
        });
        
        context.subscriptions.push(workspaceWatcher);
    }

    /**
     * 处理工作区变化
     */
    private async handleWorkspaceChange(): Promise<void> {
        // 保存当前注释数据
        await this.saveComments();
        
        // 更新存储文件路径
        this.storageFile = this.getProjectStorageFile(this.context);
        
        // 重新加载新工作区的注释数据
        await this.loadComments();
        
        console.log('工作区已切换，注释数据已重新加载');
    }

    /**
     * 根据当前工作区生成项目特定的存储文件路径
     */
    private getProjectStorageFile(context: vscode.ExtensionContext): string {
        const globalStorageDir = context.globalStorageUri?.fsPath || context.extensionPath;
        
        // 获取当前工作区的根路径
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            // 使用第一个工作区文件夹路径
            const workspacePath = workspaceFolders[0].uri.fsPath;
            
            // 创建工作区路径的哈希值作为文件名
            const pathHash = crypto.createHash('md5').update(workspacePath).digest('hex');
            const projectName = path.basename(workspacePath);
            
            // 确保项目存储目录存在
            const projectStorageDir = path.join(globalStorageDir, 'projects');
            if (!fs.existsSync(projectStorageDir)) {
                fs.mkdirSync(projectStorageDir, { recursive: true });
            }
            
            return path.join(projectStorageDir, `${projectName}-${pathHash}.json`);
        } else {
            // 如果没有工作区，使用默认的全局存储（向后兼容）
            return path.join(globalStorageDir, 'local-comments.json');
        }
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
            } else {
                // 如果项目特定的文件不存在，尝试迁移旧数据
                this.comments = {};
                await this.tryMigrateOldData();
            }
        } catch (error) {
            console.error('加载注释失败:', error);
            this.comments = {};
        }
    }

    /**
     * 尝试从旧的全局存储迁移数据到项目特定存储
     */
    private async tryMigrateOldData(): Promise<void> {
        try {
            const globalStorageDir = this.context.globalStorageUri?.fsPath || this.context.extensionPath;
            const oldStorageFile = path.join(globalStorageDir, 'local-comments.json');
            
            if (!fs.existsSync(oldStorageFile)) {
                return; // 没有旧数据需要迁移
            }

            const oldData = fs.readFileSync(oldStorageFile, 'utf8');
            const allComments: FileComments = JSON.parse(oldData);
            
            // 获取当前工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return; // 没有工作区，无法迁移
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const projectComments: FileComments = {};
            
            // 筛选出属于当前项目的注释
            for (const [filePath, comments] of Object.entries(allComments)) {
                if (filePath.startsWith(workspacePath)) {
                    projectComments[filePath] = comments;
                }
            }
            
            // 如果有属于当前项目的注释，保存到项目特定文件
            if (Object.keys(projectComments).length > 0) {
                this.comments = projectComments;
                await this.saveComments();
                console.log(`已迁移 ${Object.keys(projectComments).length} 个文件的注释到项目存储`);
            }
            
        } catch (error) {
            console.error('迁移旧数据失败:', error);
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

        // 检查是否有直接编辑注释所在行的情况
        let hasDirectLineEdit = false;
        let directUpdates = 0;

        for (const change of event.contentChanges) {
            const startLine = change.range.start.line;
            const endLine = change.range.end.line;
            
            // 检查变化范围内是否有注释
            for (const comment of fileComments) {
                if (comment.line >= startLine && comment.line <= endLine) {
                    // 用户直接编辑了注释所在的行，立即更新代码快照
                    try {
                        const currentLineContent = event.document.lineAt(comment.line).text.trim();
                        if (currentLineContent !== (comment.lineContent || '').trim()) {
                            comment.lineContent = currentLineContent;
                            directUpdates++;
                            hasDirectLineEdit = true;
                            console.log(`⚡ 检测到直接编辑注释行 ${comment.line + 1}，立即更新代码快照`);
                        }
                    } catch (error) {
                        console.warn(`⚠️ 无法立即更新注释 ${comment.id}:`, error);
                    }
                }
            }
        }

        // 如果有直接编辑，立即保存并刷新
        if (hasDirectLineEdit) {
            await this.saveComments();
            console.log(`⚡ 立即更新完成，共更新 ${directUpdates} 个注释`);
            
            // 立即刷新注释显示
            setTimeout(() => {
                vscode.commands.executeCommand('localComment.refreshComments');
            }, 10);
            
            // 如果只是直接编辑，不需要执行智能匹配
            const needsSmartUpdate = fileComments.some(comment => {
                // 检查是否有注释可能需要智能匹配（不在编辑范围内的注释）
                return !event.contentChanges.some(change => 
                    comment.line >= change.range.start.line && 
                    comment.line <= change.range.end.line
                );
            });
            
            if (!needsSmartUpdate) {
                console.log(`✅ 所有注释都通过直接编辑更新，跳过智能匹配`);
                return;
            }
        }

        // 将这个文件标记为需要智能更新（处理可能需要重新匹配的注释）
        this.pendingUpdates.add(filePath);

        // 使用防抖机制：清除之前的定时器，设置新的定时器
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }

        // 延迟300ms后执行智能更新（减少延迟，但仍然防抖）
        this.updateTimer = setTimeout(async () => {
            console.log('🧠 开始智能更新注释代码快照...');
            await this.performSmartUpdates();
            this.updateTimer = null;
            
            // 智能更新完成后再触发注释重新渲染
            setTimeout(() => {
                vscode.commands.executeCommand('localComment.refreshComments');
            }, 10);
        }, 300);
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
                } else {
                    // 如果找不到匹配位置，检查是否是在原位置直接修改
                    try {
                        if (comment.line >= 0 && comment.line < document.lineCount) {
                            const currentLineContent = document.lineAt(comment.line).text.trim();
                            
                            // 如果原位置有新内容（不是空行），且与存储的内容有明显差异
                            // 可能是用户直接修改了注释所在的行，应该更新代码快照
                            if (currentLineContent.length > 0 && 
                                currentLineContent !== (comment.lineContent || '').trim()) {
                                
                                // 使用相似度检查，如果修改不是太大，认为是同一行的修改
                                const similarity = this.calculateSimilarity(currentLineContent, comment.lineContent || '');
                                if (similarity > 0.4) { // 相似度超过40%认为是同一行的修改
                                    comment.lineContent = currentLineContent;
                                    fileUpdates++;
                                    totalUpdates++;
                                    console.log(`🔄 检测到原位置代码修改，更新注释 ${comment.id} 的代码快照`);
                                }
                            }
                        }
                    } catch (error) {
                        console.warn(`⚠️ 无法检查原位置修改 ${comment.id}:`, error);
                    }
                }
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

    /**
     * 计算两个字符串的相似度
     */
    private calculateSimilarity(str1: string, str2: string): number {
        if (!str1 || !str2) return 0;
        
        // 简单的编辑距离算法
        const len1 = str1.length;
        const len2 = str2.length;
        
        if (len1 === 0) return len2 === 0 ? 1 : 0;
        if (len2 === 0) return 0;
        
        const matrix: number[][] = [];
        
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // 替换
                        matrix[i][j - 1] + 1,     // 插入
                        matrix[i - 1][j] + 1      // 删除
                    );
                }
            }
        }
        
        const distance = matrix[len1][len2];
        const maxLen = Math.max(len1, len2);
        return (maxLen - distance) / maxLen;
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
     * 获取当前项目信息
     */
    public getProjectInfo(): { name: string; path: string; storageFile: string } {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const projectName = path.basename(workspacePath);
            return {
                name: projectName,
                path: workspacePath,
                storageFile: this.storageFile
            };
        } else {
            return {
                name: '未知项目',
                path: '无工作区',
                storageFile: this.storageFile
            };
        }
    }

    /**
     * 获取扩展上下文
     */
    public getContext(): vscode.ExtensionContext {
        return this.context;
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