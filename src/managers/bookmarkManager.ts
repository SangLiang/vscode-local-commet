import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { TimerManager } from '../utils/timerUtils';
import { StoragePathUtils, StoragePaths, StorageConfig } from '../utils/storagePathUtils';
import { getFirstWorkspaceFolder, getFirstWorkspacePathOrWarn } from '../utils/utils';
import { generateId } from '../utils/idUtils';

export interface Bookmark {
    id: string;
    line: number; // 书签所在行号
    timestamp: number; // 创建时间戳
    filePath: string; // 文件路径
    label?: string; // 可选的书签标签
    lineContent?: string; // 该行的代码内容
}

export interface FileBookmarks {
    [filePath: string]: Bookmark[];
}

export class BookmarkManager {
    private bookmarks: FileBookmarks = {};
    private storageFile: string;
    private context: vscode.ExtensionContext;
    private _onDidChangeBookmarks: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeBookmarks: vscode.Event<void> = this._onDidChangeBookmarks.event;
    
    // 性能优化：缓存排序后的书签列表
    private _sortedBookmarksCache: Bookmark[] | null = null;
    private _cacheInvalidated = true;
    
    // 定时器管理器
    private _timerManager: TimerManager = new TimerManager();
    // 防抖保存


    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.storageFile = this.getProjectStorageFile(context);
        this.loadBookmarks();

        // 监听配置变更
        const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('local-comment.storage.bookmarksConfig')) {
                this.loadBookmarks().catch(error => {
                    logger.error('配置变更后重新加载书签失败:', error);
                });
                logger.info('书签配置文件已切换');
            }
        });
        context.subscriptions.push(configWatcher);

        // 监听工作区变化，重新加载书签数据
        const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.handleWorkspaceChange();
        });

        context.subscriptions.push(workspaceWatcher);
    }

    /**
     * 处理工作区变化
     */
    private async handleWorkspaceChange(): Promise<void> {
        // 保存当前书签数据
        await this.saveBookmarks();
        
        // 更新存储文件路径
        this.storageFile = this.getProjectStorageFile(this.context);
        
        // 重新加载新工作区的书签数据
        await this.loadBookmarks();
        
        this._onDidChangeBookmarks.fire();
        logger.info('工作区已切换，书签数据已重新加载');
    }

    /**
     * 根据当前工作区生成项目特定的存储文件路径（当前选择的书签配置文件）
     */
    private getProjectStorageFile(context: vscode.ExtensionContext): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const paths = StoragePathUtils.getStoragePaths(context, workspacePath);
            const currentFile = StoragePathUtils.getCurrentBookmarksFile(paths, workspacePath);
            return currentFile || (context.globalStorageUri?.fsPath || context.extensionPath) + path.sep + 'local-bookmarks.json';
        }
        const globalStorageDir = context.globalStorageUri?.fsPath || context.extensionPath;
        return path.join(globalStorageDir, 'local-bookmarks.json');
    }

    private async loadBookmarks(): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                await this.loadBookmarksFromPath(this.storageFile);
                if (Object.keys(this.bookmarks).length > 0) {
                    await this.migrateBookmarksWithLineContent();
                }
                return;
            }

            const workspacePath = workspaceFolders[0].uri.fsPath;
            const paths = StoragePathUtils.getStoragePaths(this.context, workspacePath);

            const currentBookmarksFile = StoragePathUtils.getCurrentBookmarksFile(paths, workspacePath);
            const hasOldComments = StoragePathUtils.fileExists(paths.oldCommentsFile);
            const hasOldBookmarks = StoragePathUtils.fileExists(paths.oldBookmarksFile);

            if (currentBookmarksFile) {
                try {
                    StoragePathUtils.ensureNewPathExists(paths);
                } catch (err) {
                    if (StoragePathUtils.isWritePermissionError(err)) {
                        logger.warn('无法创建新路径目录（只读或权限不足），使用旧路径', err);
                    } else {
                        throw err;
                    }
                }
                await this.loadBookmarksFromPath(currentBookmarksFile);
                await this.checkAndPromptMigration(paths);
                await this.migrateBookmarksWithLineContent();
            } else if (hasOldBookmarks) {
                // 旧路径有书签数据、新路径无配置文件：仅加载，不创建本地目录；迁移由统一弹窗确认后再执行
                await this.loadBookmarksFromPath(paths.oldBookmarksFile);
                await this.migrateBookmarksWithLineContent();
            } else if (hasOldComments) {
                // 仅有旧注释无旧书签：不创建本地目录，书签为空，等用户迁移注释后再统一
                this.bookmarks = {};
            } else {
                // 完全没有旧数据的新项目：静默创建项目下的默认配置文件
                try {
                    StoragePathUtils.ensureNewPathExists(paths);
                    const defaultFile = path.join(paths.bookmarksDir, 'bookmarks.json');
                    fs.writeFileSync(defaultFile, JSON.stringify({}, null, 2));
                    const config = StoragePathUtils.loadConfig(workspacePath);
                    config.bookmarks = 'bookmarks.json';
                    await StoragePathUtils.saveConfig(config);
                } catch (err) {
                    if (StoragePathUtils.isWritePermissionError(err)) {
                        logger.warn('无法创建默认书签配置（只读或权限不足）', err);
                    } else {
                        throw err;
                    }
                }
                this.bookmarks = {};
            }
        } catch (error) {
            logger.error('加载书签失败:', error);
            this.bookmarks = {};
        }
    }

    private async loadBookmarksFromPath(filePath: string): Promise<void> {
        const storageDir = path.dirname(filePath);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            try {
                this.bookmarks = JSON.parse(data);
            } catch (error) {
                logger.error(`解析书签文件失败: ${filePath}`, error);
                this.bookmarks = {};
            }
        } else {
            this.bookmarks = {};
        }
    }

    private async migrateToNewPath(paths: StoragePaths, workspacePath: string): Promise<void> {
        try {
            StoragePathUtils.ensureNewPathExists(paths);
            if (!StoragePathUtils.fileExists(paths.oldBookmarksFile)) {
                return;
            }
            const oldData = fs.readFileSync(paths.oldBookmarksFile, 'utf8');
            const defaultBookmarksFile = path.join(paths.bookmarksDir, 'bookmarks.json');
            fs.writeFileSync(defaultBookmarksFile, oldData);
            const currentConfig = StoragePathUtils.loadConfig(workspacePath);
            const config: StorageConfig = {
                comments: currentConfig.comments || 'comments.json',
                bookmarks: 'bookmarks.json'
            };
            try {
                await StoragePathUtils.saveConfig(config);
            } catch (configErr) {
                // 若配置未在 package.json 注册（如旧版扩展）会抛 CodeExpectedError，数据已写入新路径，仅打日志不误报迁移失败
                logger.warn('保存工作区配置失败（数据已写入 .vscode/local-comment/）:', configErr);
            }
            // 写入文件并保存配置成功即视为迁移成功；加载若失败只打日志，不误报迁移失败
            this.bookmarks = {};
            try {
                await this.loadBookmarksFromPath(defaultBookmarksFile);
            } catch (loadErr) {
                logger.warn('迁移后加载书签数据时出错（数据已写入新路径）:', loadErr);
            }
            this.storageFile = defaultBookmarksFile;
            logger.info('书签数据已迁移到默认配置文件: bookmarks.json');
            vscode.window.showInformationMessage('书签数据已迁移到项目本地存储 (.vscode/local-comment/)');
        } catch (error) {
            if (StoragePathUtils.isWritePermissionError(error)) {
                vscode.window.showErrorMessage('迁移书签失败：无法写入 .vscode/local-comment（只读或权限不足）');
            } else {
                logger.error('迁移书签数据失败:', error);
                vscode.window.showErrorMessage('迁移书签数据失败，请手动迁移');
            }
        }
    }

    private async checkAndPromptMigration(paths: StoragePaths): Promise<void> {
        if (StoragePathUtils.fileExists(paths.oldBookmarksFile)) {
            const migrationKey = `migration_checked_bookmarks_${paths.oldBookmarksFile}`;
            const alreadyChecked = this.context.globalState.get<boolean>(migrationKey, false);
            if (!alreadyChecked) {
                logger.info('检测到旧路径仍有书签数据，新路径数据已优先使用');
                this.context.globalState.update(migrationKey, true);
            }
        }
    }

    /**
     * 公开的迁移方法，供命令调用
     */
    public async migrateOldData(): Promise<void> {
        const workspacePath = getFirstWorkspacePathOrWarn();
        if (workspacePath === null) return;
        const paths = StoragePathUtils.getStoragePaths(this.context, workspacePath);
        await this.migrateToNewPath(paths, workspacePath);
    }

    /**
     * 为现有书签添加行内容（迁移逻辑）
     */
    private async migrateBookmarksWithLineContent(): Promise<void> {
        let hasChanges = false;
        
        for (const [filePath, bookmarks] of Object.entries(this.bookmarks)) {
            for (const bookmark of bookmarks) {
                // 如果书签没有行内容，尝试获取
                if (!bookmark.lineContent) {
                    try {
                        const uri = vscode.Uri.file(filePath);
                        const document = await vscode.workspace.openTextDocument(uri);
                        if (bookmark.line >= 0 && bookmark.line < document.lineCount) {
                            bookmark.lineContent = document.lineAt(bookmark.line).text.trim();
                            hasChanges = true;
                        }
                    } catch (error) {
                        // 文件可能不存在或无法访问，跳过
                        logger.warn(`无法获取书签行内容: ${filePath}:${bookmark.line + 1}`);
                    }
                }
            }
        }
        
        // 如果有变化，保存
        if (hasChanges) {
            await this.saveBookmarks();
        }
    }

    private async saveBookmarks(): Promise<void> {
        try {
            const dataToSave = this.bookmarks;

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspacePath = workspaceFolders[0].uri.fsPath;
                const paths = StoragePathUtils.getStoragePaths(this.context, workspacePath);

                try {
                    StoragePathUtils.ensureNewPathExists(paths);
                } catch (err) {
                    if (StoragePathUtils.isWritePermissionError(err)) {
                        if (StoragePathUtils.fileExists(paths.oldBookmarksFile)) {
                            fs.writeFileSync(paths.oldBookmarksFile, JSON.stringify(dataToSave, null, 2));
                        } else {
                            vscode.window.showErrorMessage('无法写入项目目录（只读或权限不足），请检查 .vscode 目录权限');
                        }
                        this._onDidChangeBookmarks.fire();
                        return;
                    }
                    throw err;
                }

                const currentBookmarksFile = StoragePathUtils.getCurrentBookmarksFile(paths, workspacePath);

                if (currentBookmarksFile) {
                    try {
                        fs.writeFileSync(currentBookmarksFile, JSON.stringify(dataToSave, null, 2));
                    } catch (err) {
                        if (StoragePathUtils.isWritePermissionError(err) && StoragePathUtils.fileExists(paths.oldBookmarksFile)) {
                            fs.writeFileSync(paths.oldBookmarksFile, JSON.stringify(dataToSave, null, 2));
                        } else {
                            throw err;
                        }
                    }
                } else if (StoragePathUtils.fileExists(paths.oldBookmarksFile)) {
                    fs.writeFileSync(paths.oldBookmarksFile, JSON.stringify(dataToSave, null, 2));
                } else {
                    const defaultFile = path.join(paths.bookmarksDir, 'bookmarks.json');
                    fs.writeFileSync(defaultFile, JSON.stringify(dataToSave, null, 2));
                    const config = StoragePathUtils.loadConfig(workspacePath);
                    config.bookmarks = 'bookmarks.json';
                    await StoragePathUtils.saveConfig(config);
                }
            } else {
                const storageDir = path.dirname(this.storageFile);
                if (!fs.existsSync(storageDir)) {
                    fs.mkdirSync(storageDir, { recursive: true });
                }
                fs.writeFileSync(this.storageFile, JSON.stringify(dataToSave, null, 2));
            }

            this.storageFile = this.getProjectStorageFile(this.context);
            this._onDidChangeBookmarks.fire();
        } catch (error) {
            logger.error('保存书签失败:', error);
        }
    }

    /**
     * 添加书签
     */
    public async addBookmark(uri: vscode.Uri, line: number, label?: string): Promise<void> {
        const filePath = uri.fsPath;
        
        if (!this.bookmarks[filePath]) {
            this.bookmarks[filePath] = [];
        }

        // 检查是否已存在该行的书签，如果存在则不重复添加
        const existingBookmark = this.bookmarks[filePath].find(b => b.line === line);
        if (existingBookmark) {
            return;
        }

        // 获取该行的代码内容
        let lineContent = '';
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            if (line >= 0 && line < document.lineCount) {
                lineContent = document.lineAt(line).text.trim();
            }
        } catch (error) {
            logger.error('获取行内容失败:', error);
        }

        const bookmark: Bookmark = {
            id: generateId(),
            line: line,
            timestamp: Date.now(),
            filePath: filePath,
            label: label,
            lineContent: lineContent // 添加行内容
        };

        this.bookmarks[filePath].push(bookmark);
        this._invalidateCache();
        await this.saveBookmarks();
        this._onDidChangeBookmarks.fire();
    }

    /**
     * 删除书签
     */
    public async removeBookmark(uri: vscode.Uri, line: number): Promise<void> {
        const filePath = uri.fsPath;
        
        if (!this.bookmarks[filePath]) {
            return;
        }

        const initialLength = this.bookmarks[filePath].length;
        this.bookmarks[filePath] = this.bookmarks[filePath].filter(b => b.line !== line);

        if (this.bookmarks[filePath].length === 0) {
            delete this.bookmarks[filePath];
        }

        if (this.bookmarks[filePath]?.length !== initialLength || !this.bookmarks[filePath]) {
            this._invalidateCache();
            await this.saveBookmarks();
            this._onDidChangeBookmarks.fire();
        } else {
        }
    }

    /**
     * 根据ID删除书签
     */
    public async removeBookmarkById(bookmarkId: string): Promise<void> {
        for (const [filePath, bookmarks] of Object.entries(this.bookmarks)) {
            const initialLength = bookmarks.length;
            this.bookmarks[filePath] = bookmarks.filter(b => b.id !== bookmarkId);

            if (this.bookmarks[filePath].length === 0) {
                delete this.bookmarks[filePath];
            }

            if (this.bookmarks[filePath]?.length !== initialLength || !this.bookmarks[filePath]) {
                this._invalidateCache();
                await this.saveBookmarks();
                this._onDidChangeBookmarks.fire();
                return;
            }
        }
    }

    /**
     * 切换书签（如果存在则删除，不存在则添加）
     */
    public async toggleBookmark(uri: vscode.Uri, line: number): Promise<void> {
        const filePath = uri.fsPath;
        
        if (this.bookmarks[filePath]) {
            const existingBookmark = this.bookmarks[filePath].find(b => b.line === line);
            if (existingBookmark) {
                await this.removeBookmark(uri, line);
                return;
            }
        }
        
        await this.addBookmark(uri, line);
    }

    /**
     * 获取文件的所有书签
     */
    public getBookmarks(uri: vscode.Uri): Bookmark[] {
        const filePath = uri.fsPath;
        return this.bookmarks[filePath] || [];
    }

    /**
     * 获取所有书签
     */
    public getAllBookmarks(): FileBookmarks {
        return { ...this.bookmarks };
    }

    /**
     * 清除文件的所有书签
     */
    public async clearFileBookmarks(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;
        
        if (this.bookmarks[filePath] && this.bookmarks[filePath].length > 0) {
            const count = this.bookmarks[filePath].length;
            delete this.bookmarks[filePath];
            this._invalidateCache();
            await this.saveBookmarks();
            this._onDidChangeBookmarks.fire();
            vscode.window.showInformationMessage(`已清除 ${count} 个书签`);
        } else {
            vscode.window.showInformationMessage('该文件没有书签');
        }
    }

    /**
     * 清除项目的所有书签
     */
    public async clearAllBookmarks(): Promise<void> {
        // 计算当前总书签数
        const totalCount = Object.values(this.bookmarks).reduce((sum, bookmarks) => sum + bookmarks.length, 0);
        
        if (totalCount === 0) {
            vscode.window.showInformationMessage('项目中没有书签');
            return;
        }

        // 清空所有书签
        this.bookmarks = {};
        this._invalidateCache();
        await this.saveBookmarks();
        this._onDidChangeBookmarks.fire();
        vscode.window.showInformationMessage(`已清除项目中的所有书签，共删除 ${totalCount} 个书签`);
    }

    /**
     * 跳转到书签
     */
    public async goToBookmark(filePath: string, line: number): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, { preview: false });
            
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        } catch (error) {
            logger.error('跳转到书签失败:', error);
        }
    }

    /**
     * 获取项目信息
     */
    public getProjectInfo(): { name: string; path: string; storageFile: string } {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            return {
                name: path.basename(workspacePath),
                path: workspacePath,
                storageFile: this.storageFile
            };
        }
        
        return {
            name: '未知项目',
            path: '',
            storageFile: this.storageFile
        };
    }

    /**
     * 获取存储文件路径
     */
    public getStorageFilePath(): string {
        return this.storageFile;
    }

    /**
     * 切换到指定的书签配置文件
     */
    public async switchBookmarksConfig(configFileName: string): Promise<void> {
        const workspacePath = getFirstWorkspacePathOrWarn();
        if (workspacePath === null) return;
        const paths = StoragePathUtils.getStoragePaths(this.context, workspacePath);
        const configFile = path.join(paths.bookmarksDir, configFileName);
        if (!StoragePathUtils.fileExists(configFile)) {
            const choice = await vscode.window.showWarningMessage(
                `配置文件不存在: ${configFileName}\n是否创建新的配置文件？`,
                '创建',
                '取消'
            );
            if (choice === '创建') {
                StoragePathUtils.ensureNewPathExists(paths);
                fs.writeFileSync(configFile, JSON.stringify({}, null, 2));
            } else {
                return;
            }
        }
        await this.saveBookmarks();
        const config = StoragePathUtils.loadConfig(workspacePath);
        config.bookmarks = configFileName;
        await StoragePathUtils.saveConfig(config);
        await this.loadBookmarks();
        vscode.window.showInformationMessage(`已切换到书签配置: ${configFileName}`);
    }

    /**
     * 列出所有可用的书签配置文件
     */
    public listAvailableBookmarksConfigs(): string[] {
        const folder = getFirstWorkspaceFolder();
        if (!folder) return [];
        const workspacePath = folder.uri.fsPath;
        const paths = StoragePathUtils.getStoragePaths(this.context, workspacePath);
        StoragePathUtils.ensureDirectoryExists(paths.bookmarksDir);
        return StoragePathUtils.listConfigFiles(paths.bookmarksDir);
    }

    /**
     * 创建新的书签配置文件
     */
    public async createBookmarksConfig(configFileName: string): Promise<void> {
        const workspacePath = getFirstWorkspacePathOrWarn();
        if (workspacePath === null) return;
        if (!configFileName.endsWith('.json')) {
            configFileName += '.json';
        }
        const paths = StoragePathUtils.getStoragePaths(this.context, workspacePath);
        const configFile = path.join(paths.bookmarksDir, configFileName);
        if (fs.existsSync(configFile)) {
            vscode.window.showWarningMessage(`配置文件已存在: ${configFileName}`);
            return;
        }
        StoragePathUtils.ensureNewPathExists(paths);
        fs.writeFileSync(configFile, JSON.stringify({}, null, 2));
        vscode.window.showInformationMessage(`已创建书签配置文件: ${configFileName}`);
    }

    /**
     * 获取当前使用的书签配置文件名
     */
    public getCurrentBookmarksConfig(): string {
        const folder = getFirstWorkspaceFolder();
        if (!folder) return 'default';
        const workspacePath = folder.uri.fsPath;
        const paths = StoragePathUtils.getStoragePaths(this.context, workspacePath);
        const config = StoragePathUtils.loadConfig(workspacePath);
        return config.bookmarks || 'bookmarks.json';
    }

    /**
     * 处理文档变化 - 书签保持静态，不做任何更新
     */
    public handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        // 书签不需要任何更新操作，保持静态即可
    }

    /**
     * 跳转到下一个书签（支持跨文件）- 优化版本
     */
    public async goToNextBookmark(): Promise<void> {
        const allBookmarks = this.getAllBookmarksForNavigation();
        
        if (allBookmarks.length === 0) {
            return;
        }

        const currentEditor = vscode.window.activeTextEditor;
        let targetBookmark: Bookmark;

        if (currentEditor) {
            const currentFilePath = currentEditor.document.uri.fsPath;
            const currentLine = currentEditor.selection.active.line;
            
            // 查找当前位置之后的下一个书签
            const nextBookmark = this.findNextBookmarkAfterPosition(allBookmarks, currentFilePath, currentLine);
            targetBookmark = nextBookmark || allBookmarks[0]; // 循环到第一个
        } else {
            targetBookmark = allBookmarks[0];
        }

        // 跳转到目标书签
        await this.goToBookmark(targetBookmark.filePath, targetBookmark.line);
    }

    /**
     * 跳转到上一个书签（支持跨文件）- 优化版本
     */
    public async goToPreviousBookmark(): Promise<void> {
        const allBookmarks = this.getAllBookmarksForNavigation();
        
        if (allBookmarks.length === 0) {
            return;
        }

        const currentEditor = vscode.window.activeTextEditor;
        let targetBookmark: Bookmark;

        if (currentEditor) {
            const currentFilePath = currentEditor.document.uri.fsPath;
            const currentLine = currentEditor.selection.active.line;
            
            // 查找当前位置之前的上一个书签
            const prevBookmark = this.findPreviousBookmarkBeforePosition(allBookmarks, currentFilePath, currentLine);
            targetBookmark = prevBookmark || allBookmarks[allBookmarks.length - 1]; // 循环到最后一个
        } else {
            targetBookmark = allBookmarks[allBookmarks.length - 1];
        }

        // 跳转到目标书签
        await this.goToBookmark(targetBookmark.filePath, targetBookmark.line);
    }

    /**
     * 让缓存失效
     */
    private _invalidateCache(): void {
        this._cacheInvalidated = true;
        this._sortedBookmarksCache = null;
    }

    /**
     * 比较两个书签位置
     * 返回值: < 0 表示 a 在 b 之前, > 0 表示 a 在 b 之后, 0 表示相同位置
     */
    private compareBookmarkPositions(a: { filePath: string; line: number }, b: { filePath: string; line: number }): number {
        // 首先比较文件路径
        const fileCompare = a.filePath.localeCompare(b.filePath);
        if (fileCompare !== 0) {
            return fileCompare;
        }
        // 然后比较行号
        return a.line - b.line;
    }

    /**
     * 获取所有书签并按位置排序（用于导航）- 带缓存优化
     */
    private getAllBookmarksForNavigation(): Bookmark[] {
        // 如果缓存有效，直接返回缓存结果
        if (!this._cacheInvalidated && this._sortedBookmarksCache) {
            return this._sortedBookmarksCache;
        }

        const allBookmarks: Bookmark[] = [];
        
        for (const [filePath, bookmarks] of Object.entries(this.bookmarks)) {
            allBookmarks.push(...bookmarks);
        }
        
        // 按文件路径和行号排序
        const sortedBookmarks = allBookmarks.sort((a, b) => {
            // 首先按文件路径排序
            const fileCompare = a.filePath.localeCompare(b.filePath);
            if (fileCompare !== 0) {
                return fileCompare;
            }
            // 然后按行号排序
            return a.line - b.line;
        });

        // 缓存结果
        this._sortedBookmarksCache = sortedBookmarks;
        this._cacheInvalidated = false;
        
        return sortedBookmarks;
    }

    /**
     * 查找当前位置之后的下一个书签 - 优化版本
     */
    private findNextBookmarkAfterPosition(allBookmarks: Bookmark[], currentFilePath: string, currentLine: number): Bookmark | null {
        // 使用二分查找优化性能
        const currentPosition = { filePath: currentFilePath, line: currentLine };
        
        for (let i = 0; i < allBookmarks.length; i++) {
            const bookmark = allBookmarks[i];
            
            // 比较当前位置和书签位置
            if (this.compareBookmarkPositions(currentPosition, bookmark) < 0) {
                return bookmark;
            }
        }
        return null;
    }

    /**
     * 查找当前位置之前的上一个书签 - 优化版本
     */
    private findPreviousBookmarkBeforePosition(allBookmarks: Bookmark[], currentFilePath: string, currentLine: number): Bookmark | null {
        const currentPosition = { filePath: currentFilePath, line: currentLine };
        
        // 从后往前查找，找到第一个位置小于当前位置的书签
        for (let i = allBookmarks.length - 1; i >= 0; i--) {
            const bookmark = allBookmarks[i];
            
            if (this.compareBookmarkPositions(bookmark, currentPosition) < 0) {
                return bookmark;
            }
        }
        return null;
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this._timerManager.dispose(); // 清理所有定时器
        this._onDidChangeBookmarks.dispose();
    }
} 