import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { TimerManager } from '../utils/timerUtils';

export interface FileHeatInfo {
    filePath: string;
    accessCount: number; // 访问次数
    lastAccessTime: number; // 最后访问时间戳
    totalActiveTime: number; // 总活跃时间（毫秒）
}

export interface FileHeatData {
    [filePath: string]: FileHeatInfo;
}

export class FileHeatManager implements vscode.Disposable {
    private heatData: FileHeatData = {};
    private context: vscode.ExtensionContext;
    private activeFileStartTime: number = 0;
    private currentActiveFile: string | undefined;
    private timerManager: TimerManager = new TimerManager(); // 定时器管理器
    private saveTimer: NodeJS.Timeout | null = null;
    private disposables: vscode.Disposable[] = [];
    
    // 延迟更新相关变量
    private pendingUpdates: Map<string, {accessCount: number}> = new Map();
    private onHeatUpdated: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidUpdateHeat: vscode.Event<void> = this.onHeatUpdated.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadHeatData();
        this.cleanupOldData();
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // 监听活动编辑器变化
        const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
            this.handleEditorChange(editor);
        });

        // 监听文档打开 - 仅记录到pending，不立即更新热度
        const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
            this.recordFileAccess(document.uri.fsPath);
        });

        // 监听文档保存 - 在保存时应用pending的更新，但不触发排序更新
        const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument((document) => {
            this.applyPendingUpdates(document.uri.fsPath, false); // 不触发排序更新
        });

        // 监听文档关闭 - 在关闭时应用pending的更新，并触发排序更新
        const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document) => {
            this.applyPendingUpdates(document.uri.fsPath, true); // 触发排序更新
        });

        this.disposables.push(
            onDidChangeActiveTextEditor,
            onDidOpenTextDocument,
            onDidSaveTextDocument,
            onDidCloseTextDocument
        );

        // 初始化当前活动文件
        if (vscode.window.activeTextEditor) {
            this.handleEditorChange(vscode.window.activeTextEditor);
        }
    }

    private handleEditorChange(editor: vscode.TextEditor | undefined): void {
        // 记录前一个文件的活跃时间
        if (this.currentActiveFile && this.activeFileStartTime > 0) {
            const activeTime = Date.now() - this.activeFileStartTime;
            this.updateActiveTime(this.currentActiveFile, activeTime);
        }

        // 开始跟踪新的活动文件
        if (editor) {
            const filePath = editor.document.uri.fsPath;
            this.handleFileAccess(filePath);
            this.currentActiveFile = filePath;
            this.activeFileStartTime = Date.now();
        } else {
            this.currentActiveFile = undefined;
            this.activeFileStartTime = 0;
        }
    }

    private handleFileAccess(filePath: string): void {
        const now = Date.now();
        
        if (!this.heatData[filePath]) {
            this.heatData[filePath] = {
                filePath,
                accessCount: 0,
                lastAccessTime: now,
                totalActiveTime: 0
            };
        }

        const heatInfo = this.heatData[filePath];
        heatInfo.accessCount++;
        heatInfo.lastAccessTime = now;

        this.scheduleHeatDataSave();
    }

    // 记录文件访问到pending（不立即更新热度）
    private recordFileAccess(filePath: string): void {
        const existing = this.pendingUpdates.get(filePath) || { accessCount: 0 };
        existing.accessCount++;
        this.pendingUpdates.set(filePath, existing);
    }

    // 应用pending的更新到实际热度数据
    private applyPendingUpdates(filePath: string, triggerSortUpdate: boolean = false): void {
        const pending = this.pendingUpdates.get(filePath);
        if (!pending) {
            return;
        }

        const now = Date.now();
        
        // 确保文件信息存在
        if (!this.heatData[filePath]) {
            this.heatData[filePath] = {
                filePath,
                accessCount: 0,
                lastAccessTime: now,
                totalActiveTime: 0
            };
        }

        const heatInfo = this.heatData[filePath];
        
        // 应用访问次数更新
        if (pending.accessCount > 0) {
            heatInfo.accessCount += pending.accessCount;
            heatInfo.lastAccessTime = now;
        }

        // 清除pending更新
        this.pendingUpdates.delete(filePath);
        
        // 保存数据
        this.scheduleHeatDataSave();
        
        // 只有在明确需要触发排序更新时才触发热度更新事件
        if (triggerSortUpdate) {
            logger.debug(`🔥 文件 ${filePath} 关闭，触发热度排序更新`);
            this.onHeatUpdated.fire();
        }
    }

    private updateActiveTime(filePath: string, activeTime: number): void {
        if (this.heatData[filePath]) {
            this.heatData[filePath].totalActiveTime += activeTime;
            this.scheduleHeatDataSave();
        }
    }

    private scheduleHeatDataSave(): void {
        // 使用防抖机制，避免频繁保存
        if (this.saveTimer) {
            this.timerManager.clearTimeout(this.saveTimer);
        }

        this.saveTimer = this.timerManager.setTimeout(() => {
            this.saveHeatData();
            this.saveTimer = null;
        }, 2000); // 2秒后保存
    }

    private getStorageKey(): string {
        // 使用项目特定的存储键
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            return `fileHeat_${Buffer.from(workspacePath).toString('base64')}`;
        }
        return 'fileHeat_default';
    }

    private loadHeatData(): void {
        try {
            const storageKey = this.getStorageKey();
            const data = this.context.globalState.get<FileHeatData>(storageKey, {});
            this.heatData = data;
        } catch (error) {
            logger.error('加载文件热度数据失败:', error);
            this.heatData = {};
        }
    }

    private saveHeatData(): void {
        try {
            const storageKey = this.getStorageKey();
            this.context.globalState.update(storageKey, this.heatData);
        } catch (error) {
            logger.error('保存文件热度数据失败:', error);
        }
    }

    /**
     * 计算文件热度分数
     * 热度分数综合考虑：访问次数、最近访问时间、总活跃时间
     */
    public calculateHeatScore(filePath: string): number {
        const heatInfo = this.heatData[filePath];
        if (!heatInfo) {
            return 0;
        }

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        
        // 时间权重：最近访问的文件权重更高
        const timeSinceLastAccess = now - heatInfo.lastAccessTime;
        const timeWeight = Math.max(0, 1 - (timeSinceLastAccess / (7 * dayMs))); // 7天内的访问有权重
        
        // 活跃时间权重（转换为分钟）
        const activeTimeWeight = Math.min(heatInfo.totalActiveTime / (60 * 1000), 120) / 120; // 最大120分钟
        
        // 简化的热度分数计算
        const score = 
            heatInfo.accessCount * 2 +           // 访问次数基础分（提高权重）
            timeWeight * 15 +                    // 最近访问权重
            activeTimeWeight * 8;                // 活跃时间权重
            
        return score;
    }

    /**
     * 获取文件热度信息
     */
    public getFileHeatInfo(filePath: string): FileHeatInfo | undefined {
        return this.heatData[filePath];
    }

    /**
     * 获取按热度排序的文件路径列表
     */
    public getFilesByHeat(filePaths: string[]): string[] {
        return filePaths.sort((a, b) => {
            const scoreA = this.calculateHeatScore(a);
            const scoreB = this.calculateHeatScore(b);
            return scoreB - scoreA; // 降序排列，热度高的在前
        });
    }

    /**
     * 清理过期数据（可选的维护方法）
     */
    public cleanupOldData(daysBefore: number = 30): void {
        const cutoffTime = Date.now() - (daysBefore * 24 * 60 * 60 * 1000);
        let removed = false;

        for (const [filePath, heatInfo] of Object.entries(this.heatData)) {
            if (heatInfo.lastAccessTime < cutoffTime) {
                delete this.heatData[filePath];
                removed = true;
            }
        }

        if (removed) {
            this.saveHeatData();
        }
    }

    /**
     * 销毁时保存数据
     */
    public dispose(): void {
        // 记录当前活动文件的活跃时间
        if (this.currentActiveFile && this.activeFileStartTime > 0) {
            const activeTime = Date.now() - this.activeFileStartTime;
            this.updateActiveTime(this.currentActiveFile, activeTime);
        }
        
        // 应用所有pending的更新
        for (const filePath of this.pendingUpdates.keys()) {
            this.applyPendingUpdates(filePath);
        }
        
        // 立即保存数据
        if (this.saveTimer) {
            this.timerManager.clearTimeout(this.saveTimer);
        }
        this.saveHeatData();
        
        // 清理所有定时器
        this.timerManager.dispose();
        
        // 清理事件监听器
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        
        // 清理事件发射器
        this.onHeatUpdated.dispose();
    }
} 