import * as vscode from 'vscode';
import { CommentMatcher } from './commentMatcher';
import { AuthManager } from './authManager';
import { logger } from '../utils/logger';
import { TimerManager } from '../utils/timerUtils';
import { LocalComment, SharedComment, ProjectSharedComment, FileComments } from './commentTypes';
import { CommentStorage } from './commentStorage';
import { CommentCRUD } from './commentCrud';
import { CommentMatching } from './commentMatching';
import { CommentImportExport } from './commentImportExport';
import { CommentSharing } from './commentSharing';
import { findCommentIndex } from '../utils/idUtils';

// 类型 re-export，保持向后兼容
export type { LocalComment, SharedComment, ProjectSharedComment, FileComments } from './commentTypes';

/**
 * 注释管理器 - 协调器模式
 *
 * 职责：
 * - 统一对外 API
 * - 依赖注入和子模块协调
 * - 事件统一触发（写操作后 fire）
 * - 监听器注册
 *
 * 所有业务逻辑委托给子模块：
 * - CommentStorage: 存储/加载/迁移/配置
 * - CommentCRUD: 增删改查
 * - CommentMatching: 智能匹配/文档变更处理
 * - CommentImportExport: 导入导出
 * - CommentSharing: 共享注释管理
 */
export class CommentManager implements vscode.Disposable {
    // 子模块实例
    private storage: CommentStorage;
    private crud: CommentCRUD;
    private matching: CommentMatching;
    private importExport: CommentImportExport;
    private sharing: CommentSharing;

    // 共享实例（供外部使用）
    public readonly commentMatcher: CommentMatcher;
    private readonly _timerManager = new TimerManager();

    // 事件发射器，用于通知注释变化
    private _onDidChangeComments: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeComments: vscode.Event<void> = this._onDidChangeComments.event;

    // 事件发射器，用于通知共享注释变化
    private _onDidChangeSharedComments: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeSharedComments: vscode.Event<void> = this._onDidChangeSharedComments.event;

    constructor(context: vscode.ExtensionContext, authManager?: AuthManager) {
        // 初始化子模块（注意初始化顺序）
        this.storage = new CommentStorage(context);
        this.crud = new CommentCRUD(this.storage);
        this.importExport = new CommentImportExport(this.storage);
        this.sharing = new CommentSharing(this.storage, authManager);
        this.commentMatcher = new CommentMatcher();
        this.matching = new CommentMatching(
            this.storage,
            this.commentMatcher,
            this._timerManager,
            () => this._saveAndFire()
        );

        // 加载初始数据
        this.storage.loadComments();

        // 注册事件监听
        this._registerEventListeners(context);
    }

    /**
     * 注册 VS Code 事件监听器
     */
    private _registerEventListeners(context: vscode.ExtensionContext): void {
        // 监听配置变更
        const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('local-comment.storage.commentsConfig')) {
                this.storage.loadComments().catch(error => {
                    logger.error('配置变更后重新加载失败:', error);
                });
                logger.info('注释配置文件已切换');
            }
        });
        context.subscriptions.push(configWatcher);

        // 监听工作区变化
        const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.storage.handleWorkspaceChange();
        });
        context.subscriptions.push(workspaceWatcher);
    }

    /**
     * 扩展停用时由 ExtensionContainer 调用
     */
    dispose(): void {
        this.storage.flush();
        this._timerManager.dispose();
        this._onDidChangeComments.dispose();
        this._onDidChangeSharedComments.dispose();
    }

    // ============== 事件触发工具 ==============

    /**
     * 防抖保存并触发本地注释变化事件
     */
    private async _saveAndFire(): Promise<void> {
        this.storage.scheduleSave();
        this._onDidChangeComments.fire();
    }

    /**
     * 防抖保存并触发共享注释变化事件
     */
    private async _saveAndFireShared(): Promise<void> {
        this.storage.scheduleSave();
        this._onDidChangeSharedComments.fire();
    }

    /**
     * 防抖保存并触发所有事件（用于同时影响本地和共享注释的操作）
     */
    private async _saveAndFireAll(): Promise<void> {
        this.storage.scheduleSave();
        this._onDidChangeComments.fire();
        this._onDidChangeSharedComments.fire();
    }

    // ============== 存储管理委托方法 ==============

    public async migrateOldData(): Promise<void> {
        await this.storage.migrateOldData();
    }

    public getStorageFilePath(): string {
        return this.storage.getStorageFilePath();
    }

    public getProjectInfo(): { name: string; path: string; storageFile: string } {
        return this.storage.getProjectInfo();
    }

    public getContext(): vscode.ExtensionContext {
        return this.storage.getContext();
    }

    public getAllComments(): FileComments {
        return this.storage.getAllComments();
    }

    public getAllSharedComments(): { [filePath: string]: SharedComment[] } {
        return this.storage.getAllSharedComments();
    }

    public async switchCommentsConfig(configFileName: string): Promise<void> {
        await this.storage.switchCommentsConfig(configFileName);
        await this._saveAndFireAll();
    }

    public listAvailableCommentsConfigs(): string[] {
        return this.storage.listAvailableCommentsConfigs();
    }

    public async createCommentsConfig(configFileName: string): Promise<void> {
        await this.storage.createCommentsConfig(configFileName);
    }

    public getCurrentCommentsConfig(): string {
        return this.storage.getCurrentCommentsConfig();
    }

    /** 从磁盘重新加载当前分组的注释数据，并通知 UI 刷新 */
    public async reloadFromDisk(): Promise<void> {
        await this.storage.loadComments();
        this._onDidChangeComments.fire();
        this._onDidChangeSharedComments.fire();
    }

    public async moveCommentsToGroup(
        sourceConfigFileName: string,
        targetConfigFileName: string,
        commentIds: string[]
    ): Promise<{ moved: number; skipped: number }> {
        const result = await this.storage.moveCommentsBetweenConfigs(
            sourceConfigFileName,
            targetConfigFileName,
            commentIds
        );
        if (result.moved > 0) {
            this._onDidChangeComments.fire();
            this._onDidChangeSharedComments.fire();
        }
        return result;
    }

    public async removeCommentsFromConfig(
        configFileName: string,
        commentIds: string[]
    ): Promise<number> {
        const removed = await this.storage.removeCommentsByIdsFromConfig(configFileName, commentIds);
        if (removed > 0) {
            this._onDidChangeComments.fire();
            this._onDidChangeSharedComments.fire();
        }
        return removed;
    }

    public countLocalCommentsInConfigFile(configFileName: string): number {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return 0;
        return this.storage.countLocalCommentsInConfigFile(configFileName, folder.uri.fsPath);
    }

    public readCommentsFromConfigFile(configFileName: string): import('./commentTypes').FileComments {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return {};
        return this.storage.readCommentsFromConfigFile(configFileName, folder.uri.fsPath);
    }

    public async renameCommentsConfig(oldFileName: string, newFileName: string): Promise<boolean> {
        const ok = await this.storage.renameCommentsConfig(oldFileName, newFileName);
        if (ok) await this._saveAndFireAll();
        return ok;
    }

    public async deleteCommentsConfig(configFileName: string): Promise<boolean> {
        return this.storage.deleteCommentsConfig(configFileName);
    }

    // ============== CRUD 委托方法 ==============

    public findCommentIndex(comments: (LocalComment | SharedComment)[], commentId: string): number {
        return findCommentIndex(comments, commentId);
    }

    public getLocalCommentAtLine(filePath: string, line: number): LocalComment | undefined {
        return this.crud.getLocalCommentAtLine(filePath, line);
    }

    public getCommentById(uri: vscode.Uri, commentId: string): LocalComment | undefined {
        return this.crud.getCommentById(uri.fsPath, commentId);
    }

    public async addComment(uri: vscode.Uri, line: number, content: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const lineContent = document.lineAt(line).text;
        await this.crud.addComment(uri, line, content, lineContent.trim());
        await this._saveAndFire();
    }

    public async editComment(uri: vscode.Uri, commentId: string, newContent: string): Promise<void> {
        const success = this.crud.editComment(uri.fsPath, commentId, newContent);
        if (success) {
            await this._saveAndFire();
        }
    }

    public async updateCommentLine(uri: vscode.Uri, commentId: string, newLine: number, newLineContent: string): Promise<void> {
        const success = this.crud.updateCommentLine(uri.fsPath, commentId, newLine, newLineContent);
        if (success) {
            await this._saveAndFire();
        }
    }

    public async removeComment(uri: vscode.Uri, line: number): Promise<void> {
        const success = this.crud.removeComment(uri.fsPath, line);
        if (success) {
            await this._saveAndFire();
        }
    }

    public async removeCommentById(uri: vscode.Uri, commentId: string): Promise<void> {
        const success = this.crud.removeCommentById(uri.fsPath, commentId);
        if (success) {
            await this._saveAndFire();
        }
    }

    public async clearFileComments(uri: vscode.Uri): Promise<void> {
        const count = this.crud.clearFileComments(uri.fsPath);
        if (count > 0) {
            await this._saveAndFire();
        }
    }

    // ============== 智能匹配委托方法 ==============

    public getComments(uri: vscode.Uri): (LocalComment | SharedComment)[] {
        return this.matching.getComments(uri);
    }

    public async handleDocumentChange(
        event: vscode.TextDocumentChangeEvent,
        hasRecentKeyboardActivity: boolean = true
    ): Promise<void> {
        await this.matching.handleDocumentChange(event, hasRecentKeyboardActivity);
    }

    public async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
        await this.matching.handleDocumentSave(document, () => this._saveAndFire());
    }

    // ============== 导入导出委托方法 ==============

    public async exportComments(exportPath: string): Promise<boolean> {
        return this.importExport.exportComments(exportPath);
    }

    public async exportCommentsSubset(exportPath: string, commentIds: string[]): Promise<boolean> {
        return this.importExport.exportCommentsSubset(exportPath, commentIds);
    }

    public async importComments(
        importPath: string,
        mergeMode: 'replace' | 'merge' = 'merge',
        pathMapping?: { oldBasePath: string; newBasePath: string }
    ): Promise<{
        success: boolean;
        message: string;
        importedFiles?: number;
        importedComments?: number;
        skippedComments?: number;
        remappedFiles?: number;
    }> {
        const result = await this.importExport.importComments(importPath, mergeMode, pathMapping);
        if (result.success) {
            await this._saveAndFireAll();
        }
        return result;
    }

    public async analyzeImportPaths(importPath: string): Promise<{
        success: boolean;
        message: string;
        filePaths?: string[];
        commonBasePath?: string;
        projectName?: string;
    }> {
        return this.importExport.analyzeImportPaths(importPath);
    }

    public async validateImportFile(importPath: string): Promise<{
        valid: boolean;
        message: string;
        fileCount?: number;
        commentCount?: number;
        projectName?: string;
        exportTime?: string;
    }> {
        return this.importExport.validateImportFile(importPath);
    }

    // ============== 共享注释委托方法 ==============

    public async clearAllSharedComments(): Promise<number> {
        const count = await this.sharing.clearAllSharedComments();
        if (count > 0 && this.storage.hasPersistedStorage()) {
            await this._saveAndFireShared();
        }
        return count;
    }

    public async handleSharedCommentsByAuthStatus(isLoggedIn: boolean): Promise<void> {
        const count = await this.sharing.handleSharedCommentsByAuthStatus(isLoggedIn);
        if (!isLoggedIn && count > 0 && this.storage.hasPersistedStorage()) {
            await this._saveAndFireShared();
        }
    }

    public async clearFileSharedComments(uri: vscode.Uri): Promise<number> {
        const count = await this.sharing.clearFileSharedComments(uri.fsPath);
        if (count > 0 && this.storage.hasPersistedStorage()) {
            await this._saveAndFireShared();
        }
        return count;
    }

    public async addCommentFromShared(
        filePath: string,
        line: number,
        content: string,
        lineContent: string,
        originalLine: number,
        isMatched: boolean = true,
        _forceOverwrite: boolean = false
    ): Promise<void> {
        await this.sharing.addCommentFromShared(filePath, line, content, lineContent, originalLine, isMatched);
        await this._saveAndFire();
    }

    public async getProjectSharedComments(
        projectId: number,
        pathMapping?: { oldBasePath: string; newBasePath: string }
    ): Promise<ProjectSharedComment[] | null> {
        const result = await this.sharing.getProjectSharedComments(projectId, pathMapping);
        if (result && result.length > 0) {
            await this._saveAndFireShared();
        }
        return result;
    }

    // ============== 旧 API 兼容方法 ==============

    /**
     * @deprecated 使用 saveCommentsAsync 或直接通过 _saveAndFire 触发保存
     */
    public async saveComments(): Promise<void> {
        await this._saveAndFire();
    }

    /**
     * 将选中的文字转换为本地注释
     */
    public async convertSelectionToComment(
        uri: vscode.Uri,
        selection: vscode.Selection,
        selectedText: string
    ): Promise<void> {
        const filePath = uri.fsPath;
        const line = selection.start.line;

        // 获取当前行的内容（选中文字所在行）
        const document = await vscode.workspace.openTextDocument(uri);
        const lineContent = document.lineAt(line).text.trim();

        // 删除选中的文字
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.fsPath === filePath) {
            await editor.edit(editBuilder => {
                editBuilder.delete(selection);
            });

            // 检查删除文字后，当前行是否为空行
            const currentLineText = document.lineAt(line).text.trim();

            // 如果当前行变成了空行，向下查找第一个非空行
            let targetLine = line;
            if (currentLineText === '') {
                for (let i = line + 1; i < document.lineCount; i++) {
                    if (document.lineAt(i).text.trim() !== '') {
                        targetLine = i;
                        break;
                    }
                }
            }

            // 添加注释
            await this.crud.addComment(uri, targetLine, selectedText, lineContent);
            await this._saveAndFire();
        }
    }
}
