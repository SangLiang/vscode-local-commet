import * as vscode from 'vscode';
import { ExtensionContainer } from './ExtensionContainer';
import { StatusBarManager } from './StatusBarManager';
import { EditorEventHandler } from './eventHandlers/EditorEventHandler';
import { DocumentEventHandler } from './eventHandlers/DocumentEventHandler';
import { AuthEventHandler } from './eventHandlers/AuthEventHandler';
import { ProviderRegistry } from './ProviderRegistry';
import { registerCommands } from '../modules/command/commands';
import { UserInfoWebview } from '../modules/userInfoWebview';
import { AuthWebview } from '../modules/authWebview';
import { logger } from '../utils/logger';
import { COMMANDS } from '../constants';
import { checkUnifiedMigration } from '../utils/migrationPrompt';
import { MarkdownPreviewWebview } from '../modules/markdownPreviewWebview';

/**
 * 扩展生命周期管理器 - 管理扩展的激活和停用流程
 */
export class ExtensionLifecycle {
    private container: ExtensionContainer;
    private statusBarManager?: StatusBarManager;
    private editorEventHandler?: EditorEventHandler;
    private documentEventHandler?: DocumentEventHandler;
    private authEventHandler?: AuthEventHandler;
    private providerRegistry?: ProviderRegistry;
    private disposables: vscode.Disposable[] = [];

    constructor(
        container: ExtensionContainer,
        private context: vscode.ExtensionContext
    ) {
        this.container = container;
    }

    /**
     * 激活扩展 - 协调所有组件的初始化顺序
     */
    async activate(): Promise<void> {
        logger.info('本地注释插件已激活');

        try {
            // 步骤1：创建状态栏管理器
            this.statusBarManager = new StatusBarManager(this.container, this.context);
            this.statusBarManager.initialize();

            // 步骤2：创建事件处理器
            this.editorEventHandler = new EditorEventHandler(this.container, this.context);
            this.documentEventHandler = new DocumentEventHandler(
                this.container, 
                this.context
            );
            this.authEventHandler = new AuthEventHandler(
                this.container, 
                this.context, 
                this.statusBarManager
            );

            // 步骤3：注册事件处理器
            const eventDisposables = [
                ...this.editorEventHandler.register(),
                ...this.documentEventHandler.register(),
                ...this.authEventHandler.register()
            ];
            this.disposables.push(...eventDisposables);

            // 步骤4：创建并注册提供器注册表
            this.providerRegistry = new ProviderRegistry(this.container, this.context);
            const providerDisposables = this.providerRegistry.register();
            this.disposables.push(...providerDisposables);
            this.providerRegistry.initialize();
            this.providerRegistry.registerUserInfoWebviewSerializer();
            this.providerRegistry.registerCommentManageWebviewSerializer();

            // 步骤5：注册命令
            const commandDisposables = registerCommands(
                this.context,
                this.container.commentManager,
                this.container.tagManager,
                this.container.commentProvider,
                this.container.commentTreeProvider,
                this.container.authManager,
                this.container.projectManager,
                this.container.bookmarkManager
            );
            this.disposables.push(...commandDisposables);

            // 统一迁移提示：确认后同时迁移注释和书签
            const runUnifiedMigrationCheck = () => {
                checkUnifiedMigration(
                    this.context,
                    this.container.commentManager,
                    this.container.bookmarkManager
                ).catch(err => logger.error('统一迁移检查失败', err));
            };
            runUnifiedMigrationCheck();
            const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
                runUnifiedMigrationCheck();
            });
            this.disposables.push(workspaceWatcher);

            // 步骤6：注册用户信息命令
            const showUserInfoCommand = vscode.commands.registerCommand(
                COMMANDS.SHOW_USER_INFO,
                () => {
                    if (!this.container.authManager) {
                        vscode.window.showErrorMessage('认证管理器未初始化');
                        return;
                    }
                    
                    // 如果未登录，显示登录界面
                    if (!this.container.authManager.isLoggedIn()) {
                        AuthWebview.createOrShow(
                            this.context.extensionUri,
                            this.container.authManager
                        );
                        return;
                    }
                    
                    // 如果已登录，显示用户信息面板
                    UserInfoWebview.createOrShow(
                        this.context.extensionUri,
                        this.container.authManager,
                        this.container.projectManager,
                        this.container.commentManager,
                        this.container.bookmarkManager,
                        this.container.tagManager
                    );
                }
            );
            this.disposables.push(showUserInfoCommand);

            // 步骤7：将生命周期级别的 disposables 添加到上下文订阅中
            // 注意：容器内资源由 ExtensionContainer 统一释放，避免重复 dispose
            this.disposables.forEach(disposable => {
                this.context.subscriptions.push(disposable);
            });

            logger.info('✅ 本地注释插件激活完成');
        } catch (error) {
            logger.error('扩展激活失败:', error);
            throw error;
        }
    }

    /**
     * 停用扩展 - 清理所有资源
     */
    deactivate(): void {
        logger.info('本地注释插件正在停用');

        try {
            // 清理文档事件处理器的防抖定时器
            if (this.documentEventHandler) {
                this.documentEventHandler.dispose();
            }

            if (this.authEventHandler) {
                this.authEventHandler.dispose();
            }

            // 清理状态栏管理器
            if (this.statusBarManager) {
                this.statusBarManager.dispose();
            }

            // 清理容器
            if (this.container) {
                this.container.dispose();
            }

            // 清理所有 disposables
            this.disposables.forEach(disposable => {
                try {
                    disposable.dispose();
                } catch (error) {
                    logger.error('清理资源失败:', error);
                }
            });
            this.disposables = [];

            MarkdownPreviewWebview.disposeAll();

            logger.info('✅ 本地注释插件停用完成');
        } catch (error) {
            logger.error('扩展停用失败:', error);
        }
    }
}

