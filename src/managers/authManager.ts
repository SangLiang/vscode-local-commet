import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ApiRoutes, apiService } from '../apiService';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/utils';

export interface UserInfo {
    id: string;
    username: string;
    email: string;
    avatar?: string;
    createdAt: number;
    lastLoginAt: number;
}

export interface LoginCredentials {
    username: string;
    password: string;
}

export interface AuthSession {
    token: string;
    user?: UserInfo;
    expiresAt: number;
}

export interface UserProject {
    id: number;
    name: string;
    description?: string;
    [key: string]: unknown;
}

/** 默认会话过期时间：24 小时（毫秒） */
const DEFAULT_SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** 会话过期时间：7 天（毫秒） */
const SESSION_EXPIRY_7D_MS = 7 * 24 * 60 * 60 * 1000;

export class AuthManager {
    public context: vscode.ExtensionContext;
    private sessionFile: string;
    private currentSession: AuthSession | null = null;
    private isAuthenticated = false;
    private _isInitialized = false; // 添加初始化完成标志
    
    // 添加事件监听器
    private initializationListeners: Array<() => void> = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.sessionFile = path.join(context.globalStorageUri?.fsPath || context.extensionPath, 'auth-session.json');

        // 设置AuthManager到API服务
        apiService.setAuthManager(this);

        // 异步加载会话，但不等待完成
        this.loadSession().catch(error => {
            logger.error('加载会话时出错:', error);
        });

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('local-comment.server.apiUrl')) {
                const newApiUrl = vscode.workspace.getConfiguration('local-comment').get<string>('server.apiUrl');
                if (newApiUrl) {
                    apiService.updateBaseURL(newApiUrl);
                    logger.debug(`API URL updated to: ${newApiUrl}`);
                }
            }
        });
    }

    /**
     * 加载已保存的会话
     */
    private async loadSession(): Promise<void> {
        try {
            if (fs.existsSync(this.sessionFile)) {
                const data = fs.readFileSync(this.sessionFile, 'utf8');
                const session: AuthSession = JSON.parse(data);
                
                // 检查会话是否过期
                if (session.expiresAt > Date.now()) {
                    this.currentSession = session;
                    this.isAuthenticated = true;
                    
                    // 验证用户信息是否仍然有效
                    try {
                        const user = await apiService.get<UserInfo>(ApiRoutes.auth.me);
                        // 更新用户信息
                        this.currentSession.user = user;
                        await this.saveSession(this.currentSession);
                        logger.debug('已加载有效会话');
                    } catch (error) {
                        logger.error('验证用户信息失败:', error);
                        // 如果验证失败，可能是因为token过期，尝试刷新
                        try {
                            const refreshed = await this.refreshSession();
                            if (!refreshed) {
                                this.clearSession();
                            }
                        } catch (refreshError) {
                            logger.error('刷新token失败:', refreshError);
                            this.clearSession();
                        }
                    }
                } else {
                    // 会话过期，清除
                    this.clearSession();
                }
            }
        } catch (error) {
            logger.error('加载会话失败:', error);
            this.clearSession();
        } finally {
            // 标记初始化完成
            this._isInitialized = true;
            
            // 通知所有等待初始化的监听器
            this.notifyInitializationComplete();
        }
    }

    /**
     * 保存会话到本地
     */
    private async saveSession(session: AuthSession): Promise<void> {
        try {
            const storageDir = path.dirname(this.sessionFile);
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }
            fs.writeFileSync(this.sessionFile, JSON.stringify(session, null, 2));
        } catch (error) {
            logger.error('保存会话失败:', error);
        }
    }

    /**
     * 清除会话
     */
    private clearSession(): void {
        this.currentSession = null;
        this.isAuthenticated = false;
        if (fs.existsSync(this.sessionFile)) {
            fs.unlinkSync(this.sessionFile);
        }
    }

    /**
     * 用户登录
     */
    public async login(credentials: LoginCredentials): Promise<{ success: boolean; message: string; user?: UserInfo }> {
        try {
            // 调用实际的登录API
            const response = await apiService.post<{ access_token: string; token_type: string }>(
                ApiRoutes.auth.login, 
                credentials,
                {
                    skipAuth: true,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    }
                }
            );
            
            const { access_token, token_type } = response;
            
            // 先设置session，这样API服务就能获取到token
            const session: AuthSession = {
                token: access_token,
                expiresAt: Date.now() + SESSION_EXPIRY_7D_MS,
            };
            
            this.currentSession = session;
            this.isAuthenticated = true;
            
            // 获取用户信息
            const user = await apiService.get<UserInfo>(ApiRoutes.auth.me);
            
            // 更新session中的用户信息
            session.user = user;
            await this.saveSession(session);
            
            return { success: true, message: '登录成功', user };
        } catch (error) {
            return { success: false, message: '登录失败: ' + getErrorMessage(error) };
        }
    }



    /**
     * 用户登出
     */
    public async logout(): Promise<void> {
        // 仅本地清理会话数据（当前无后端登出接口）
        this.clearSession();
    }

    /**
     * 检查用户是否已登录
     */
    public isLoggedIn(): boolean {
        return this.isAuthenticated && this.currentSession !== null;
    }

    /**
     * 检查认证管理器是否已初始化完成
     */
    public isInitialized(): boolean {
        return this._isInitialized;
    }

    /**
     * 订阅初始化完成事件
     * @param callback 初始化完成时的回调函数
     */
    public onInitialized(callback: () => void): void {
        if (this._isInitialized) {
            // 如果已经初始化完成，立即执行回调
            callback();
        } else {
            // 否则添加到监听器列表
            this.initializationListeners.push(callback);
        }
    }

    /**
     * 通知所有等待初始化的监听器
     */
    private notifyInitializationComplete(): void {
        // 执行所有监听器
        this.initializationListeners.forEach(callback => {
            try {
                callback();
            } catch (error) {
                logger.error('执行初始化完成回调时出错:', error);
            }
        });
        
        // 清空监听器列表
        this.initializationListeners = [];
    }

    /**
     * 获取当前用户信息
     */
    public getCurrentUser(): UserInfo | null {
        return this.currentSession?.user || null;
    }

    /**
     * 获取认证token
     */
    public getAuthToken(): string | null {
        return this.currentSession?.token || null;
    }

    /**
     * 获取用户所属的项目列表
     */
    public async getUserProjects(): Promise<UserProject[]> {
        try {
            if (!this.isLoggedIn()) {
                throw new Error('用户未登录');
            }

            const projects = await apiService.get<UserProject[]>(ApiRoutes.project.getMyProject);
            return projects || [];
        } catch (error) {
            logger.error('获取用户项目失败:', error);
            throw error;
        }
    }

    /**
     * 刷新会话
     */
    public async refreshSession(): Promise<boolean> {
        if (!this.currentSession) {
            return false;
        }

        try {
            // 调用刷新token的API
            const response = await apiService.post<{ access_token: string; token_type: string }>(ApiRoutes.auth.refreshToken);
            const { access_token, token_type } = response;

            this.currentSession.token = access_token;
            this.currentSession.expiresAt = Date.now() + DEFAULT_SESSION_EXPIRY_MS;
            
            // 更新用户信息
            try {
                const user = await apiService.get<UserInfo>(ApiRoutes.auth.me);
                this.currentSession.user = user;
            } catch (error) {
                logger.error('获取用户信息失败:', error);
            }
            
            await this.saveSession(this.currentSession);
            return true;
        } catch (error) {
            logger.error('刷新会话失败:', error);
            await this.logout();
            return false;
        }
    }
} 