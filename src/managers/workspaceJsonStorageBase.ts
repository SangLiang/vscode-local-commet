import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StoragePathUtils, StoragePaths, StorageConfig } from '../utils/storagePathUtils';
import { getFirstWorkspaceFolder, getFirstWorkspacePathOrWarn } from '../utils/utils';
import { logger } from '../utils/logger';

/**
 * 工作区 JSON 存储基类
 *
 * 收敛 commentStorage 与 bookmarkManager 中逐字镜像的纯路径逻辑：
 * 配置列表 / 当前配置 / 创建配置 / 切换配置 / 迁移检查 / 迁移执行 / 项目信息。
 *
 * 不收敛：load / save（序列化结构与写盘策略差异大）、CRUD、各自独有概念。
 * 差异通过抽象成员与钩子方法由子类提供。
 */
export abstract class WorkspaceJsonStorageBase {
  protected _context: vscode.ExtensionContext;
  protected _storageFile: string;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._storageFile = this._resolveInitialStorageFile(context);
  }

  // ============== 子类提供的差异 ==============

  protected abstract readonly kind: 'comments' | 'bookmarks';
  protected abstract getConfigDir(paths: StoragePaths): string;
  protected abstract getOldFile(paths: StoragePaths): string;
  protected abstract getCurrentFile(paths: StoragePaths, workspacePath: string): string | null;
  protected abstract getDefaultConfigFileName(): string;
  protected abstract buildDefaultEmptyData(): unknown;
  protected abstract getMigrationKeyPrefix(): string;
  protected abstract getMigrationSuccessMessage(): string;
  protected abstract getMigrationFailureMessage(): string;
  protected abstract getSwitchSuccessMessage(configFileName: string): string;

  /** 切换配置前落盘当前数据（saveComments / saveBookmarks） */
  protected abstract persistBeforeSwitch(): Promise<void>;
  /** 切换配置后重新加载（loadComments / loadBookmarks） */
  protected abstract reloadAfterSwitch(): Promise<void>;
  /** 迁移写入默认文件后，清空内存数据并加载新文件（内部自行 try/catch 仅 warn） */
  protected abstract resetDataAndLoadAfterMigration(defaultFile: string): Promise<void>;

  // ============== 存储文件路径 ==============

  protected _resolveInitialStorageFile(context: vscode.ExtensionContext): string {
    const globalStorageDir = context.globalStorageUri?.fsPath
      || path.join(require('os').homedir(), '.vscode-local-comment');
    return path.join(globalStorageDir, this.kind === 'comments' ? 'local-comments.json' : 'local-bookmarks.json');
  }

  getStorageFilePath(): string {
    return this._storageFile;
  }

  protected _updateStorageFile(filePath: string): void {
    this._storageFile = filePath;
  }

  getProjectInfo(): { name: string; path: string; storageFile: string } {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspacePath = workspaceFolders[0].uri.fsPath;
      return {
        name: path.basename(workspacePath),
        path: workspacePath,
        storageFile: this._storageFile,
      };
    }
    return {
      name: '未知项目',
      path: this.kind === 'comments' ? '无工作区' : '',
      storageFile: this._storageFile,
    };
  }

  // ============== 配置列表 / 当前配置 ==============

  listAvailableConfigs(): string[] {
    const folder = getFirstWorkspaceFolder();
    if (!folder) return [];
    const workspacePath = folder.uri.fsPath;
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const dir = this.getConfigDir(paths);
    StoragePathUtils.ensureDirectoryExists(dir);
    return StoragePathUtils.listConfigFiles(dir);
  }

  getCurrentConfig(): string {
    const folder = getFirstWorkspaceFolder();
    if (!folder) return 'default';
    const workspacePath = folder.uri.fsPath;
    const config = StoragePathUtils.loadConfig(workspacePath);
    const fileName = this.kind === 'comments' ? config.comments : config.bookmarks;
    return fileName || this.getDefaultConfigFileName();
  }

  // ============== 创建配置 ==============

  async createConfig(configFileName: string): Promise<void> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return;
    if (!configFileName.endsWith('.json')) {
      configFileName += '.json';
    }
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const configFile = path.join(this.getConfigDir(paths), configFileName);
    if (fs.existsSync(configFile)) {
      vscode.window.showWarningMessage(`配置文件已存在: ${configFileName}`);
      return;
    }
    StoragePathUtils.ensureNewPathExists(paths);
    fs.writeFileSync(configFile, JSON.stringify(this.buildDefaultEmptyData(), null, 2));
    const label = this.kind === 'comments' ? '注释' : '书签';
    vscode.window.showInformationMessage(`已创建${label}配置文件: ${configFileName}`);
  }

  // ============== 切换配置 ==============

  async switchConfig(configFileName: string): Promise<void> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return;
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    const configFile = path.join(this.getConfigDir(paths), configFileName);

    if (!StoragePathUtils.fileExists(configFile)) {
      const choice = await vscode.window.showWarningMessage(
        `配置文件不存在: ${configFileName}\n是否创建新的配置文件？`,
        '创建',
        '取消'
      );
      if (choice === '创建') {
        StoragePathUtils.ensureNewPathExists(paths);
        fs.writeFileSync(configFile, JSON.stringify(this.buildDefaultEmptyData(), null, 2));
      } else {
        return;
      }
    }

    await this.persistBeforeSwitch();
    const config = StoragePathUtils.loadConfig(workspacePath);
    if (this.kind === 'comments') {
      config.comments = configFileName;
    } else {
      config.bookmarks = configFileName;
    }
    await StoragePathUtils.saveConfig(config);
    await this.reloadAfterSwitch();
    vscode.window.showInformationMessage(this.getSwitchSuccessMessage(configFileName));
  }

  // ============== 迁移检查 ==============

  protected async checkAndPromptMigration(paths: StoragePaths): Promise<void> {
    const oldFile = this.getOldFile(paths);
    if (StoragePathUtils.fileExists(oldFile)) {
      const migrationKey = `${this.getMigrationKeyPrefix()}${oldFile}`;
      const alreadyChecked = this._context.globalState.get<boolean>(migrationKey, false);
      if (!alreadyChecked) {
        const label = this.kind === 'comments' ? '注释' : '书签';
        logger.info(`检测到旧路径仍有${label}数据，新路径数据已优先使用`);
        this._context.globalState.update(migrationKey, true);
      }
    }
  }

  // ============== 迁移执行 ==============

  async migrateOldData(): Promise<void> {
    const workspacePath = getFirstWorkspacePathOrWarn();
    if (workspacePath === null) return;
    const paths = StoragePathUtils.getStoragePaths(this._context, workspacePath);
    await this.migrateToNewPath(paths, workspacePath);
  }

  protected async migrateToNewPath(paths: StoragePaths, workspacePath: string): Promise<void> {
    const label = this.kind === 'comments' ? '注释' : '书签';
    try {
      StoragePathUtils.ensureNewPathExists(paths);
      const oldFile = this.getOldFile(paths);
      if (!StoragePathUtils.fileExists(oldFile)) {
        return;
      }
      const oldData = fs.readFileSync(oldFile, 'utf8');
      const defaultFile = path.join(this.getConfigDir(paths), this.getDefaultConfigFileName());
      fs.writeFileSync(defaultFile, oldData);
      const currentConfig = StoragePathUtils.loadConfig(workspacePath);
      const config: StorageConfig = this.kind === 'comments'
        ? { comments: this.getDefaultConfigFileName(), bookmarks: currentConfig.bookmarks || 'bookmarks.json' }
        : { comments: currentConfig.comments || 'comments.json', bookmarks: this.getDefaultConfigFileName() };
      try {
        await StoragePathUtils.saveConfig(config);
      } catch (configErr) {
        logger.warn('保存工作区配置失败（数据已写入 .vscode/local-comment/）:', configErr);
      }
      await this.resetDataAndLoadAfterMigration(defaultFile);
      this._storageFile = defaultFile;
      logger.info(`${label}数据已迁移到默认配置文件: ${this.getDefaultConfigFileName()}`);
      vscode.window.showInformationMessage(this.getMigrationSuccessMessage());
    } catch (error) {
      if (StoragePathUtils.isWritePermissionError(error)) {
        vscode.window.showErrorMessage(this.getMigrationFailureMessage());
      } else {
        logger.error(`迁移${label}数据失败:`, error);
        vscode.window.showErrorMessage(`迁移${label}数据失败，请手动迁移`);
      }
    }
  }
}
