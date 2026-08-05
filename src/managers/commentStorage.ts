import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LocalComment, SharedComment, FileComments } from './commentTypes';
import { StoragePathUtils, StoragePaths, StorageConfig } from '../utils/storagePathUtils';
import { getFirstWorkspaceFolder, getFirstWorkspacePathOrWarn, remapFileCommentsToWorkspace } from '../utils/utils';
import { generateId } from '../utils/idUtils';
import { logger } from '../utils/logger';
import { DELAY_TIMES } from '../constants';
import { TimerManager } from '../utils/timerUtils';

/**
 * 注释存储管理类
 *
 * 职责：
 * - 注释数据的加载/保存
 * - 存储路径管理
 * - 配置文件切换/创建/列表
 * - 数据迁移
 *
 * 注意：本类不触发事件，事件由 CommentManager 协调器统一处理
 */
export class CommentStorage {
  private _comments: FileComments = {};
  private _shareComments: FileComments = {};
  private _storageFile: string;
  private _context: vscode.ExtensionContext;
  private _saveTimer: NodeJS.Timeout | null = null;
  private _timerManager: TimerManager = new TimerManager();

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._storageFile = this._getProjectStorageFile(context);
  }

  // ============== 数据引用访问（供其他模块使用）==============

  getCommentsRef(): FileComments {
    return this._comments;
  }

  getShareCommentsRef(): FileComments {
    return this._shareComments;
  }

  /**
   * 替换整个注释数据对象（用于迁移场景）
   */
  replaceComments(newComments: FileComments): void {
    // 清空现有对象
    for (const key of Object.keys(this._comments)) {
      delete this._comments[key];
    }
    // 复制新数据
    Object.assign(this._comments, newComments);
  }

  replaceShareComments(newShareComments: FileComments): void {
    for (const key of Object.keys(this._shareComments)) {
      delete this._shareComments[key];
    }
    Object.assign(this._shareComments, newShareComments);
  }

  /**
   * 清空所有注释数据
   */
  clearAllComments(): void {
    for (const key of Object.keys(this._comments)) {
      delete this._comments[key];
    }
    for (const key of Object.keys(this._shareComments)) {
      delete this._shareComments[key];
    }
  }

  /**
   * 更新 storageFile 路径
   */
  updateStorageFile(filePath: string): void {
    this._storageFile = filePath;
  }

  // ============== 存储路径管理 ==============

  private _getProjectStorageFile(context: vscode.ExtensionContext): string {
    const globalStorageDir = context.globalStorageUri?.fsPath || path.join(require('os').homedir(), '.vscode-local-comment');
    if (!fs.existsSync(globalStorageDir)) {
      fs.mkdirSync(globalStorageDir, { recursive: true });
    }
    return path.join(globalStorageDir, 'local-comments.json');
  }

  getStorageFilePath(): string {
    return this._storageFile;
  }

  getProjectInfo(): { name: string; path: string; storageFile: string } {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspacePath = workspaceFolders[0].uri.fsPath;
      const projectName = path.basename(workspacePath);
      return {
        name: projectName,
        path: workspacePath,
        storageFile: this._storageFile
      };
    } else {
      return {
        name: '未知项目',
        path: '无工作区',
        storageFile: this._storageFile
      };
    }
  }

  getContext(): vscode.ExtensionContext {
    return this._context;
  }

  // ============== 数据加载 ==============

  async loadComments(): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        await this._loadCommentsFromPath(this._storageFile);
        return;
      }

      const workspacePath = workspaceFolders[0].uri.fsPath;
      const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);

      const currentCommentsFile = StoragePathUtils.getCurrentCommentsFile(paths, workspacePath);
      const hasOldComments = StoragePathUtils.fileExists(paths.oldCommentsFile);
      const hasOldBookmarks = StoragePathUtils.fileExists(paths.oldBookmarksFile);

      if (currentCommentsFile) {
        try {
          StoragePathUtils.ensureNewPathExists(paths);
        } catch (err) {
          if (StoragePathUtils.isWritePermissionError(err)) {
            logger.warn('无法创建新路径目录（只读或权限不足），使用旧路径', err);
          } else {
            throw err;
          }
        }
        try {
          await this._loadCommentsFromPath(currentCommentsFile);
          await this._checkAndPromptMigration(paths);
        } catch (error) {
          return;
        }
      } else if (hasOldComments) {
        // 旧路径有注释数据、新路径无配置文件：仅加载，不创建本地目录；迁移由统一弹窗确认后再执行
        await this._loadCommentsFromPath(paths.oldCommentsFile);
      } else if (hasOldBookmarks) {
        // 仅有旧书签无旧注释：不创建本地目录，注释为空，等用户迁移书签后再统一
        this._comments = {};
        this._shareComments = {};
      } else {
        // 完全没有旧数据的新项目：静默创建项目下的默认配置文件
        try {
          StoragePathUtils.ensureNewPathExists(paths);
          const defaultFile = path.join(paths.commentsDir, 'comments.json');
          const defaultData = { comments: {}, shareComments: {} };
          fs.writeFileSync(defaultFile, JSON.stringify(defaultData, null, 2));
          const config = StoragePathUtils.loadConfig(workspacePath);
          config.comments = 'comments.json';
          await StoragePathUtils.saveConfig(config);
        } catch (err) {
          if (StoragePathUtils.isWritePermissionError(err)) {
            logger.warn('无法创建默认配置（只读或权限不足）', err);
          } else {
            throw err;
          }
        }
        this._comments = {};
        this._shareComments = {};
      }
    } catch (error) {
      logger.error('加载注释失败:', error);
      this._comments = {};
      this._shareComments = {};
    }
  }

  private async _loadCommentsFromPath(filePath: string): Promise<void> {
    const storageDir = path.dirname(filePath);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf8');
        const parsedData = JSON.parse(data);

        if (typeof parsedData !== 'object' || parsedData === null) {
          throw new Error('配置文件格式错误：根对象必须是对象类型');
        }

        if (parsedData.comments && parsedData.shareComments) {
          this._comments = parsedData.comments;
          this._shareComments = parsedData.shareComments;
        } else if (parsedData.comments || Object.keys(parsedData).length > 0) {
          this._comments = parsedData.comments || parsedData;
          this._shareComments = parsedData.shareComments || {};
        } else {
          this._comments = {};
          this._shareComments = {};
        }
        // 将存储中的路径重映射到当前工作区，解决拷贝 .vscode 到另一台电脑后无法跳转的问题
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          const workspacePath = workspaceFolder.uri.fsPath;
          this._comments = remapFileCommentsToWorkspace(this._comments, workspacePath);
          this._shareComments = remapFileCommentsToWorkspace(this._shareComments, workspacePath);
        }
      } catch (parseError) {
        logger.error('配置文件格式错误:', parseError);
        const errorMessage = `配置文件格式错误: ${filePath}\n请检查文件是否为有效的 JSON 格式。`;
        vscode.window.showErrorMessage(errorMessage, '打开文件').then(choice => {
          if (choice === '打开文件') {
            vscode.workspace.openTextDocument(filePath).then(doc => {
              vscode.window.showTextDocument(doc);
            });
          }
        });
        this._comments = {};
        this._shareComments = {};
        throw parseError;
      }
    } else {
      this._comments = {};
      this._shareComments = {};
    }
  }

  // ============== 数据保存 ==============

  /**
   * 立即保存注释数据到磁盘（用于配置切换等需要立即落盘的场景）
   */
  async saveComments(): Promise<void> {
    await this._writeToDisk();
  }

  /**
   * 防抖保存：合并高频调用，100ms 后写盘（用于 CRUD 操作等高频路径）
   */
  scheduleSave(): void {
    if (this._saveTimer) {
      this._timerManager.clearTimeout(this._saveTimer);
    }
    this._saveTimer = this._timerManager.setTimeout(() => {
      this._saveTimer = null;
      void this._writeToDisk();
    }, DELAY_TIMES.ASYNC_SAVE);
  }

  /**
   * 立即刷盘：取消防抖 timer，立即执行写入（用于 dispose 时确保数据不丢失）
   */
  flush(): void {
    if (this._saveTimer) {
      this._timerManager.clearTimeout(this._saveTimer);
      this._saveTimer = null;
      void this._writeToDisk();
    }
  }

  /**
   * 实际写盘逻辑（异步，不阻塞 UI 线程）
   */
  private async _writeToDisk(): Promise<void> {
    try {
      const dataToSave = {
        comments: this._comments,
        shareComments: this._shareComments
      };

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);

        try {
          StoragePathUtils.ensureNewPathExists(paths);
        } catch (err) {
          if (StoragePathUtils.isWritePermissionError(err)) {
            if (StoragePathUtils.fileExists(paths.oldCommentsFile)) {
              await fs.promises.writeFile(paths.oldCommentsFile, JSON.stringify(dataToSave, null, 2));
            } else {
              vscode.window.showErrorMessage('无法写入项目目录（只读或权限不足），请检查 .vscode 目录权限');
            }
            return;
          }
          throw err;
        }

        const currentCommentsFile = StoragePathUtils.getCurrentCommentsFile(paths, workspacePath);

        if (currentCommentsFile) {
          try {
            await fs.promises.writeFile(currentCommentsFile, JSON.stringify(dataToSave, null, 2));
          } catch (err) {
            if (StoragePathUtils.isWritePermissionError(err) && StoragePathUtils.fileExists(paths.oldCommentsFile)) {
              await fs.promises.writeFile(paths.oldCommentsFile, JSON.stringify(dataToSave, null, 2));
            } else {
              throw err;
            }
          }
        } else if (StoragePathUtils.fileExists(paths.oldCommentsFile)) {
          await fs.promises.writeFile(paths.oldCommentsFile, JSON.stringify(dataToSave, null, 2));
        } else {
          const defaultFile = path.join(paths.commentsDir, 'comments.json');
          await fs.promises.writeFile(defaultFile, JSON.stringify(dataToSave, null, 2));
          const config = StoragePathUtils.loadConfig(workspacePath);
          config.comments = 'comments.json';
          await StoragePathUtils.saveConfig(config);
        }
      } else {
        const storageDir = path.dirname(this._storageFile);
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
        }
        await fs.promises.writeFile(this._storageFile, JSON.stringify(dataToSave, null, 2));
      }

      this._storageFile = this._getProjectStorageFile(this._context);
    } catch (error) {
      logger.error('保存注释失败:', error);
    }
  }

  // ============== 数据查询 ==============

  getAllComments(): FileComments {
    // 合并本地注释和共享注释
    const allComments: FileComments = {};

    // 获取所有文件路径（本地注释和共享注释的并集）
    const allFilePaths = new Set([
      ...Object.keys(this._comments),
      ...Object.keys(this._shareComments)
    ]);

    for (const filePath of allFilePaths) {
      const localComments = this._comments[filePath] || [];

      // 从shareComments中过滤出只有SharedComment类型的数据
      const allSharedComments = this._shareComments[filePath] || [];
      const sharedComments = allSharedComments.filter((comment): comment is SharedComment =>
        'userId' in comment
      );

      allComments[filePath] = [...localComments, ...sharedComments];
    }

    return allComments;
  }

  getAllSharedComments(): { [filePath: string]: SharedComment[] } {
    // 确保只返回SharedComment类型的数据
    const result: { [filePath: string]: SharedComment[] } = {};

    for (const [filePath, comments] of Object.entries(this._shareComments)) {
      // 过滤出只有SharedComment类型的数据
      const sharedComments = comments.filter((comment): comment is SharedComment =>
        'userId' in comment
      );

      if (sharedComments.length > 0) {
        result[filePath] = sharedComments;
      }
    }

    return result;
  }

  // ============== 配置管理 ==============

  async switchCommentsConfig(configFileName: string): Promise<void> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return;

    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const configFile = path.join(paths.commentsDir, configFileName);

    if (!StoragePathUtils.fileExists(configFile)) {
      const choice = await vscode.window.showWarningMessage(
        `配置文件不存在: ${configFileName}\n是否创建新的配置文件？`,
        '创建',
        '取消'
      );
      if (choice === '创建') {
        StoragePathUtils.ensureNewPathExists(paths);
        const defaultData = { comments: {}, shareComments: {} };
        fs.writeFileSync(configFile, JSON.stringify(defaultData, null, 2));
      } else {
        return;
      }
    }

    await this.saveComments();
    const config = StoragePathUtils.loadConfig(workspacePath);
    config.comments = configFileName;
    await StoragePathUtils.saveConfig(config);
    await this.loadComments();
    vscode.window.showInformationMessage(`已切换到注释配置: ${configFileName}`);
  }

  listAvailableCommentsConfigs(): string[] {
    const folder = getFirstWorkspaceFolder();
    if (!folder) return [];
    const workspacePath = folder.uri.fsPath;
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    StoragePathUtils.ensureDirectoryExists(paths.commentsDir);
    return StoragePathUtils.listConfigFiles(paths.commentsDir);
  }

  async createCommentsConfig(configFileName: string): Promise<void> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return;
    if (!configFileName.endsWith('.json')) {
      configFileName += '.json';
    }
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const configFile = path.join(paths.commentsDir, configFileName);
    if (fs.existsSync(configFile)) {
      vscode.window.showWarningMessage(`配置文件已存在: ${configFileName}`);
      return;
    }
    StoragePathUtils.ensureNewPathExists(paths);
    const defaultData = { comments: {}, shareComments: {} };
    fs.writeFileSync(configFile, JSON.stringify(defaultData, null, 2));
    vscode.window.showInformationMessage(`已创建注释配置文件: ${configFileName}`);
  }

  getCurrentCommentsConfig(): string {
    const folder = getFirstWorkspaceFolder();
    if (!folder) return 'default';
    const workspacePath = folder.uri.fsPath;
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const config = StoragePathUtils.loadConfig(workspacePath);
    return config.comments || 'comments.json';
  }

  readCommentsFromConfigFile(configFileName: string, workspacePath: string): FileComments {
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const configFile = path.join(paths.commentsDir, configFileName);
    if (!StoragePathUtils.fileExists(configFile)) {
      return {};
    }
    try {
      const raw = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { comments?: FileComments };
      let comments = raw.comments ?? {};
      comments = remapFileCommentsToWorkspace(comments, workspacePath);
      return comments;
    } catch {
      return {};
    }
  }

  countLocalCommentsInConfigFile(configFileName: string, workspacePath: string): number {
    const comments = this.readCommentsFromConfigFile(configFileName, workspacePath);
    return Object.values(comments)
      .flat()
      .filter((c) => !('userId' in c))
      .length;
  }

  async moveCommentsBetweenConfigs(
    sourceConfigFileName: string,
    targetConfigFileName: string,
    commentIds: string[]
  ): Promise<{ moved: number; skipped: number }> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null || commentIds.length === 0) {
      return { moved: 0, skipped: commentIds.length };
    }
    if (sourceConfigFileName === targetConfigFileName) {
      return { moved: 0, skipped: commentIds.length };
    }

    const activeConfig = this.getCurrentCommentsConfig();
    const sourceIsActive = sourceConfigFileName === activeConfig;
    const targetIsActive = targetConfigFileName === activeConfig;
    const idSet = new Set(commentIds);
    let moved = 0;
    let skipped = 0;

    let sourceComments: FileComments;
    let sourceShareComments: FileComments;
    if (sourceIsActive) {
      sourceComments = this._comments;
      sourceShareComments = this._shareComments;
    } else {
      const sourcePayload = this._readFullConfigPayload(sourceConfigFileName, workspacePath);
      sourceComments = sourcePayload.comments;
      sourceShareComments = sourcePayload.shareComments;
    }

    let targetComments: FileComments;
    let targetShareComments: FileComments;
    if (targetIsActive) {
      targetComments = this._comments;
      targetShareComments = this._shareComments;
    } else {
      const targetPayload = this._readFullConfigPayload(targetConfigFileName, workspacePath);
      targetComments = targetPayload.comments;
      targetShareComments = targetPayload.shareComments;
    }

    for (const filePath of Object.keys(sourceComments)) {
      const fileCommentList = sourceComments[filePath];
      if (!fileCommentList) {
        continue;
      }
      for (let i = fileCommentList.length - 1; i >= 0; i--) {
        const comment = fileCommentList[i];
        if (!idSet.has(comment.id)) {
          continue;
        }
        if ('userId' in comment) {
          skipped++;
          continue;
        }

        if (!targetComments[filePath]) {
          targetComments[filePath] = [];
        }
        const movedComment: LocalComment = {
          ...(comment as LocalComment),
          id: generateId(),
          timestamp: Date.now(),
          isShared: false,
        };
        targetComments[filePath].push(movedComment);
        fileCommentList.splice(i, 1);
        moved++;
      }
      if (fileCommentList.length === 0) {
        delete sourceComments[filePath];
      }
    }

    if (sourceIsActive) {
      await this.saveComments();
    } else {
      this._writeFullConfigPayload(sourceConfigFileName, workspacePath, {
        comments: sourceComments,
        shareComments: sourceShareComments,
      });
    }

    if (targetIsActive) {
      if (!sourceIsActive) {
        await this.saveComments();
      }
    } else {
      this._writeFullConfigPayload(targetConfigFileName, workspacePath, {
        comments: targetComments,
        shareComments: targetShareComments,
      });
    }

    return { moved, skipped };
  }

  async removeCommentsByIdsFromConfig(
    configFileName: string,
    commentIds: string[]
  ): Promise<number> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null || commentIds.length === 0) {
      return 0;
    }

    const activeConfig = this.getCurrentCommentsConfig();
    const sourceIsActive = configFileName === activeConfig;
    const idSet = new Set(commentIds);
    let removed = 0;

    let sourceComments: FileComments;
    let sourceShareComments: FileComments;
    if (sourceIsActive) {
      sourceComments = this._comments;
      sourceShareComments = this._shareComments;
    } else {
      const sourcePayload = this._readFullConfigPayload(configFileName, workspacePath);
      sourceComments = sourcePayload.comments;
      sourceShareComments = sourcePayload.shareComments;
    }

    for (const filePath of Object.keys(sourceComments)) {
      const fileCommentList = sourceComments[filePath];
      if (!fileCommentList) {
        continue;
      }
      for (let i = fileCommentList.length - 1; i >= 0; i--) {
        const comment = fileCommentList[i];
        if (!idSet.has(comment.id) || 'userId' in comment) {
          continue;
        }
        fileCommentList.splice(i, 1);
        removed++;
      }
      if (fileCommentList.length === 0) {
        delete sourceComments[filePath];
      }
    }

    if (removed === 0) {
      return 0;
    }

    if (sourceIsActive) {
      await this.saveComments();
    } else {
      this._writeFullConfigPayload(configFileName, workspacePath, {
        comments: sourceComments,
        shareComments: sourceShareComments,
      });
    }

    return removed;
  }

  private _readFullConfigPayload(
    configFileName: string,
    workspacePath: string
  ): { comments: FileComments; shareComments: FileComments } {
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const configFile = path.join(paths.commentsDir, configFileName);
    const empty = { comments: {} as FileComments, shareComments: {} as FileComments };
    if (!StoragePathUtils.fileExists(configFile)) {
      return empty;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(configFile, 'utf8')) as {
        comments?: FileComments;
        shareComments?: FileComments;
      };
      return {
        comments: remapFileCommentsToWorkspace(raw.comments ?? {}, workspacePath),
        shareComments: remapFileCommentsToWorkspace(raw.shareComments ?? {}, workspacePath),
      };
    } catch (error) {
      logger.error('读取注释配置文件失败:', error);
      return empty;
    }
  }

  private _writeFullConfigPayload(
    configFileName: string,
    workspacePath: string,
    payload: { comments: FileComments; shareComments: FileComments }
  ): void {
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    StoragePathUtils.ensureDirectoryExists(paths.commentsDir);
    const configFile = path.join(paths.commentsDir, configFileName);
    fs.writeFileSync(configFile, JSON.stringify(payload, null, 2));
  }

  async renameCommentsConfig(oldFileName: string, newFileName: string): Promise<boolean> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return false;
    if (!newFileName.endsWith('.json')) {
      newFileName += '.json';
    }
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(newFileName)) {
      vscode.window.showWarningMessage('配置文件名只能包含字母、数字、下划线和连字符');
      return false;
    }
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const oldPath = path.join(paths.commentsDir, oldFileName);
    const newPath = path.join(paths.commentsDir, newFileName);
    if (!StoragePathUtils.fileExists(oldPath)) {
      vscode.window.showWarningMessage(`配置文件不存在: ${oldFileName}`);
      return false;
    }
    if (StoragePathUtils.fileExists(newPath)) {
      vscode.window.showWarningMessage(`配置文件已存在: ${newFileName}`);
      return false;
    }
    try {
      fs.renameSync(oldPath, newPath);
    } catch (error) {
      vscode.window.showWarningMessage(`重命名失败: ${oldFileName}`);
      logger.error('重命名注释配置失败:', error);
      return false;
    }
    const config = StoragePathUtils.loadConfig(workspacePath);
    if (config.comments === oldFileName) {
      config.comments = newFileName;
      await StoragePathUtils.saveConfig(config);
      await this.loadComments();
    }
    vscode.window.showInformationMessage(`已重命名: ${oldFileName} → ${newFileName}`);
    return true;
  }

  async deleteCommentsConfig(configFileName: string): Promise<boolean> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return false;
    const config = StoragePathUtils.loadConfig(workspacePath);
    if (config.comments === configFileName) {
      vscode.window.showWarningMessage('不能删除当前正在使用的分组');
      return false;
    }
    const count = this.countLocalCommentsInConfigFile(configFileName, workspacePath);
    if (count > 0) {
      vscode.window.showWarningMessage(`分组内还有 ${count} 条注释，请先清空后再删除`);
      return false;
    }
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const target = path.join(paths.commentsDir, configFileName);
    if (!StoragePathUtils.fileExists(target)) {
      return false;
    }
    try {
      fs.unlinkSync(target);
    } catch (error) {
      vscode.window.showWarningMessage(`删除失败: ${configFileName}`);
      logger.error('删除注释配置失败:', error);
      return false;
    }
    vscode.window.showInformationMessage(`已删除分组: ${configFileName}`);
    return true;
  }

  // ============== 数据迁移 ==============

  private async _migrateToNewPath(paths: StoragePaths, workspacePath: string): Promise<void> {
    try {
      StoragePathUtils.ensureNewPathExists(paths);
      if (!StoragePathUtils.fileExists(paths.oldCommentsFile)) {
        return;
      }
      const oldData = fs.readFileSync(paths.oldCommentsFile, 'utf8');
      const defaultCommentsFile = path.join(paths.commentsDir, 'comments.json');
      fs.writeFileSync(defaultCommentsFile, oldData);
      const currentConfig = StoragePathUtils.loadConfig(workspacePath);
      const config: StorageConfig = {
        comments: 'comments.json',
        bookmarks: currentConfig.bookmarks || 'bookmarks.json'
      };
      try {
        await StoragePathUtils.saveConfig(config);
      } catch (configErr) {
        // 若配置未在 package.json 注册（如旧版扩展）会抛 CodeExpectedError，数据已写入新路径，仅打日志不误报迁移失败
        logger.warn('保存工作区配置失败（数据已写入 .vscode/local-comment/）:', configErr);
      }
      // 写入文件并保存配置成功即视为迁移成功；加载若失败只打日志，不误报迁移失败
      this._comments = {};
      this._shareComments = {};
      try {
        await this._loadCommentsFromPath(defaultCommentsFile);
      } catch (loadErr) {
        logger.warn('迁移后加载注释数据时出错（数据已写入新路径）:', loadErr);
      }
      this._storageFile = defaultCommentsFile;
      logger.info('注释数据已迁移到默认配置文件: comments.json');
      vscode.window.showInformationMessage('注释数据已迁移到项目本地存储 (.vscode/local-comment/)');
    } catch (error) {
      if (StoragePathUtils.isWritePermissionError(error)) {
        vscode.window.showErrorMessage('迁移失败：无法写入 .vscode/local-comment（只读或权限不足）');
      } else {
        logger.error('迁移注释数据失败:', error);
        vscode.window.showErrorMessage('迁移注释数据失败，请手动迁移');
      }
    }
  }

  private async _checkAndPromptMigration(paths: StoragePaths): Promise<void> {
    if (StoragePathUtils.fileExists(paths.oldCommentsFile)) {
      const migrationKey = `migration_checked_${paths.oldCommentsFile}`;
      const alreadyChecked = this._context.globalState.get<boolean>(migrationKey, false);
      if (!alreadyChecked) {
        logger.info('检测到旧路径仍有数据，新路径数据已优先使用');
        this._context.globalState.update(migrationKey, true);
      }
    }
  }

  /**
   * 公开的迁移方法，供命令调用
   */
  async migrateOldData(): Promise<void> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return;
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    await this._migrateToNewPath(paths, workspacePath);
  }

  // ============== 工作区变化处理 ==============

  async handleWorkspaceChange(): Promise<void> {
    this._storageFile = this._getProjectStorageFile(this._context);
    await this.loadComments();
  }
}
