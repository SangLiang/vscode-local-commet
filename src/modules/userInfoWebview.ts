import * as vscode from 'vscode';
import * as path from 'path';
import { AuthManager } from '../managers/authManager';
import { CommentManager } from '../managers/commentManager';
import { BookmarkManager } from '../managers/bookmarkManager';
import { TagManager } from '../managers/tagManager';
import { ProjectManager } from '../managers/projectManager';
import { WebviewUtils } from '../utils/webviewUtils';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/utils';
import { DELAY_TIMES, VIEW_TYPES, COMMANDS, IPC_MESSAGES } from '../constants';
import { TimerManager } from '../utils/timerUtils';

export class UserInfoWebview {
    public static currentPanel: UserInfoWebview | undefined;

    public static readonly viewType = VIEW_TYPES.USER_INFO;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _timerManager: TimerManager = new TimerManager(); // 定时器管理器
    private _authManager: AuthManager;
    private _commentManager?: CommentManager;
    private _bookmarkManager?: BookmarkManager;
    private _tagManager?: TagManager;
    private _projectManager: ProjectManager;

    public static createOrShow(
        extensionUri: vscode.Uri, 
        authManager: AuthManager,
        projectManager: ProjectManager,
        commentManager?: CommentManager,
        bookmarkManager?: BookmarkManager,
        tagManager?: TagManager
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.One
            : undefined;

        // 如果已经存在面板，则显示它
        if (UserInfoWebview.currentPanel) {
            UserInfoWebview.currentPanel._panel.reveal(column);
            UserInfoWebview.currentPanel.refreshUserInfo();
            return;
        }

        // 否则创建新面板
        const panel = vscode.window.createWebviewPanel(
            UserInfoWebview.viewType,
            '用户信息',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'src', 'templates')
                ],
                retainContextWhenHidden: true,
                // 允许模态对话框
                enableCommandUris: false,
                enableFindWidget: false,
                // 添加 allow-modals 以支持 confirm 对话框
                portMapping: []
            }
        );

        UserInfoWebview.currentPanel = new UserInfoWebview(
            panel, 
            extensionUri, 
            authManager,
            projectManager,
            commentManager,
            bookmarkManager,
            tagManager
        );
    }

    public static revive(
        panel: vscode.WebviewPanel, 
        extensionUri: vscode.Uri, 
        authManager: AuthManager,
        projectManager: ProjectManager,
        commentManager?: CommentManager,
        bookmarkManager?: BookmarkManager,
        tagManager?: TagManager
    ) {
        UserInfoWebview.currentPanel = new UserInfoWebview(
            panel, 
            extensionUri, 
            authManager,
            projectManager,
            commentManager,
            bookmarkManager,
            tagManager
        );
    }

    private constructor(
        panel: vscode.WebviewPanel, 
        extensionUri: vscode.Uri, 
        authManager: AuthManager,
        projectManager: ProjectManager,
        commentManager?: CommentManager,
        bookmarkManager?: BookmarkManager,
        tagManager?: TagManager
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._authManager = authManager;
        this._projectManager = projectManager;
        this._commentManager = commentManager;
        this._bookmarkManager = bookmarkManager;
        this._tagManager = tagManager;

        // 设置初始HTML内容
        this._update();

        // 监听面板被关闭的事件
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理来自webview的消息
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case IPC_MESSAGES.GET_USER_INFO:
                        this.handleGetUserInfo();
                        return;
                    case IPC_MESSAGES.GET_PROJECTS:
                        this.handleGetProjects();
                        return;
                    case IPC_MESSAGES.LOGOUT:
                        this.handleLogout();
                        return;
                    case IPC_MESSAGES.ASSOCIATE_PROJECT:
                        this.handleAssociateProject(message.projectId);
                        return;
                    case IPC_MESSAGES.DISASSOCIATE_PROJECT:
                        this.handleDisassociateProject(message.projectId);
                        return;
                    case IPC_MESSAGES.FETCH_SHARED_COMMENTS:
                        this.handleFetchSharedComments();
                        return;
                    case IPC_MESSAGES.UPLOAD_AVATAR:
                        this.handleUploadAvatar(message.data);
                        return;
                    case IPC_MESSAGES.CLOSE:
                        this.dispose();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        UserInfoWebview.currentPanel = undefined;

        // 清理资源
        this._timerManager.dispose(); // 清理所有定时器
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async handleGetUserInfo() {
        try {
            // 检查用户是否已登录
            if (!this._authManager.isLoggedIn()) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.USER_INFO_RESULT,
                    success: false,
                    message: '用户未登录'
                });
                return;
            }

            // 获取用户信息
            const user = this._authManager.getCurrentUser();
            
            // 获取使用统计
            const stats = this.getUsageStats();
            
            // 获取API基础URL
            const config = vscode.workspace.getConfiguration('local-comment');
            const apiBaseUrl = config.get<string>('server.apiUrl');
            
            // 发送用户信息和统计信息到webview
            this._panel.webview.postMessage({
                command: 'userInfoResult',
                success: true,
                data: {
                    user,
                    stats,
                    apiBaseUrl
                }
            });
        } catch (error) {
            logger.error('获取用户信息失败:', error);
            this._panel.webview.postMessage({
                command: 'userInfoResult',
                success: false,
                message: '获取用户信息失败: ' + getErrorMessage(error)
            });
        }
    }

    /**
     * 处理获取项目共享注释命令
     */
    private async handleFetchSharedComments() {
        try {
            // 检查用户是否已登录
            if (!this._authManager.isLoggedIn()) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.FETCH_SHARED_COMMENTS_RESULT,
                    success: false,
                    message: '用户未登录'
                });
                return;
            }

            // 检查是否有关联的项目
            const associatedProjectId = this._projectManager.getAssociatedProject();
            if (!associatedProjectId) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.FETCH_SHARED_COMMENTS_RESULT,
                    success: false,
                    message: '请先关联项目'
                });
                return;
            }

            // 获取项目共享注释
            const projectId = parseInt(associatedProjectId, 10);
            if (isNaN(projectId)) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.FETCH_SHARED_COMMENTS_RESULT,
                    success: false,
                    message: '项目ID无效'
                });
                return;
            }

            // 调用CommentManager获取共享注释
            if (this._commentManager) {
                const sharedComments = await this._commentManager.getProjectSharedComments(projectId);
                
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.FETCH_SHARED_COMMENTS_RESULT,
                    success: true,
                    message: `成功获取 ${sharedComments?.length || 0} 条共享注释`,
                    data: sharedComments // 返回获取到的共享注释数据
                });
                
                // 可以在这里添加进一步处理共享注释的逻辑
                // 比如显示通知或更新UI
            } else {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.FETCH_SHARED_COMMENTS_RESULT,
                    success: false,
                    message: '注释管理器未初始化'
                });
            }
        } catch (error) {
            logger.error('获取项目共享注释失败:', error);
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.FETCH_SHARED_COMMENTS_RESULT,
                success: false,
                message: '获取项目共享注释失败: ' + getErrorMessage(error)
            });
        }
    }

    private async handleGetProjects() {
        try {
            // 检查用户是否已登录
            if (!this._authManager.isLoggedIn()) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.PROJECTS_RESULT,
                    success: false,
                    message: '用户未登录'
                });
                return;
            }

            // 从服务端获取用户所属的项目列表
            const projects = await this.getUserProjects();

            // 获取当前工作区关联的项目ID，添加错误处理
            let associatedProjectId: string | undefined;
            try {
                if (this._projectManager && typeof this._projectManager.getAssociatedProject === 'function') {
                    associatedProjectId = this._projectManager.getAssociatedProject();
                } else {
                    logger.warn('ProjectManager not properly initialized');
                    associatedProjectId = undefined;
                }
            } catch (error) {
                logger.error('Error getting associated project:', error);
                associatedProjectId = undefined;
            }

            // 发送项目列表到webview，包含关联状态信息
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.PROJECTS_RESULT,
                success: true,
                data: projects,
                associatedProjectId: associatedProjectId
            });
        } catch (error) {
            logger.error('获取项目列表失败:', error);
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.PROJECTS_RESULT,
                success: false,
                message: '获取项目列表时发生错误: ' + getErrorMessage(error)
            });
        }
    }

    private async handleLogout() {
        try {
            await this._authManager.logout();
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.LOGOUT_RESULT,
                success: true
            });
            
            // 显示退出登录成功消息
            vscode.window.showInformationMessage('已成功退出登录');
            
            // 执行用户退出登录后的清理工作
            vscode.commands.executeCommand(COMMANDS.ON_USER_LOGOUT);
        } catch (error) {
            logger.error('退出登录失败:', error);
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.LOGOUT_RESULT,
                success: false,
                message: '退出登录失败: ' + getErrorMessage(error)
            });
        }
    }

    private async handleAssociateProject(projectId: string) {
        try {
            await this._projectManager.associateProject(projectId);

            // 通知webview关联成功
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.ASSOCIATE_PROJECT_RESULT,
                success: true,
                projectId: projectId
            });

            // 延迟重新获取项目列表，让前端先完成状态更新动画
            this._timerManager.setTimeout(() => {
                this.handleGetProjects();
            }, DELAY_TIMES.PROJECT_REFRESH_AFTER_ANIMATION);
        } catch (error) {
            logger.error('关联项目失败:', error);
            vscode.window.showErrorMessage('关联项目失败: ' + getErrorMessage(error));
            
            // 通知webview关联失败
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.ASSOCIATE_PROJECT_RESULT,
                success: false,
                projectId: projectId,
                message: '关联项目失败: ' + getErrorMessage(error)
            });
        }
    }

    private async handleDisassociateProject(projectId: string) {
        try {
            await this._projectManager.disassociateProject();

            // 通知webview取消关联成功
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.DISASSOCIATE_PROJECT_RESULT,
                success: true,
                projectId: projectId
            });

            // 延迟重新获取项目列表，让前端先完成状态更新动画
            this._timerManager.setTimeout(() => {
                this.handleGetProjects();
            }, DELAY_TIMES.PROJECT_REFRESH_AFTER_ANIMATION);
        } catch (error) {
            logger.error('取消关联项目失败:', error);
            vscode.window.showErrorMessage('取消关联项目失败: ' + getErrorMessage(error));
            
            // 通知webview取消关联失败
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.DISASSOCIATE_PROJECT_RESULT,
                success: false,
                projectId: projectId,
                message: '取消关联项目失败: ' + getErrorMessage(error)
            });
        }
    }

    private async getUserProjects() {
        try {
            // 使用AuthManager的公共方法获取项目列表
            return await this._authManager.getUserProjects();
        } catch (error) {
            logger.error('获取用户项目失败:', error);
            // 如果API调用失败，返回空数组
            return [];
        }
    }

    private getProjectInfo() {
        // 优先使用commentManager获取项目信息
        if (this._commentManager) {
            return this._commentManager.getProjectInfo();
        } else if (this._bookmarkManager) {
            return this._bookmarkManager.getProjectInfo();
        } else {
            // 如果没有管理器，手动获取项目信息
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspacePath = workspaceFolders[0].uri.fsPath;
                return {
                    name: path.basename(workspacePath),
                    path: workspacePath,
                    storageFile: ''
                };
            }
            
            return {
                name: '未知项目',
                path: '无工作区',
                storageFile: ''
            };
        }
    }

    private getUsageStats() {
        const stats = {
            comments: 0,
            bookmarks: 0,
            tags: 0
        };

        try {
            // 获取注释数量（只统计本地注释，不包括共享注释）
            if (this._commentManager) {
                const allComments = this._commentManager.getAllComments();
                stats.comments = Object.values(allComments).reduce((total, comments) => {
                    const localComments = comments.filter(comment => !('userId' in comment));
                    return total + localComments.length;
                }, 0);
            }

            // 获取书签数量
            if (this._bookmarkManager) {
                const allBookmarks = this._bookmarkManager.getAllBookmarks();
                stats.bookmarks = Object.values(allBookmarks).reduce((total, bookmarks) => total + bookmarks.length, 0);
            }

            // 获取标签数量
            if (this._tagManager) {
                const tagDeclarations = this._tagManager.getTagDeclarations();
                stats.tags = tagDeclarations.size;
            }
        } catch (error) {
            logger.error('获取统计信息失败:', error);
        }

        return stats;
    }

    private async handleUploadAvatar(data: {
        fileName: string;
        fileType: string;
        fileSize: number;
        base64Data: string;
    }) {
        try {
            // 检查用户是否已登录
            if (!this._authManager.isLoggedIn()) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.UPLOAD_AVATAR_RESULT,
                    success: false,
                    message: '用户未登录'
                });
                return;
            }

            // 验证文件大小（2MB）
            if (data.fileSize > 2 * 1024 * 1024) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.UPLOAD_AVATAR_RESULT,
                    success: false,
                    message: '文件大小不能超过2MB'
                });
                return;
            }

            // 验证文件类型
            if (!data.fileType.startsWith('image/')) {
                this._panel.webview.postMessage({
                    command: IPC_MESSAGES.UPLOAD_AVATAR_RESULT,
                    success: false,
                    message: '只支持图片文件'
                });
                return;
            }

            // TODO: 这里应该调用实际的API上传头像
            // 目前先模拟上传成功
            logger.debug('头像上传数据:', {
                fileName: data.fileName,
                fileType: data.fileType,
                fileSize: data.fileSize,
                // base64Data 太长，不打印
            });

            // 模拟上传延迟
            await new Promise<void>(resolve => this._timerManager.setTimeout(() => resolve(), 1000));

            // 发送上传成功消息
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.UPLOAD_AVATAR_RESULT,
                success: true,
                message: '头像上传成功'
            });

            // 显示成功通知
            vscode.window.showInformationMessage('头像上传成功！');

        } catch (error) {
            logger.error('头像上传失败:', error);
            this._panel.webview.postMessage({
                command: IPC_MESSAGES.UPLOAD_AVATAR_RESULT,
                success: false,
                message: '头像上传失败: ' + getErrorMessage(error)
            });
        }
    }

    public refreshUserInfo() {
        // 刷新用户信息
        this.handleGetUserInfo();
    }

    private _update() {
        const webview = this._panel.webview;

        this._panel.title = '用户信息';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // 构建资源 URI
        const resourceUris = WebviewUtils.buildResourceUris(webview, this._extensionUri, {
            css: 'userInfo/userInfo.css',
            js: 'userInfo/userInfo.js'
        });

        // 生成 nonce
        const nonce = WebviewUtils.getNonce();

        // 加载模板
        const template = WebviewUtils.loadTemplate(this._authManager.context, 'userInfo/userInfo.html');

        // 替换模板变量
        const html = WebviewUtils.replaceTemplateVariables(template, {
            cspSource: webview.cspSource,
            cssUri: resourceUris.cssUri || '',
            jsUri: resourceUris.jsUri || '',
            nonce: nonce
        });

        return html;
    }
} 