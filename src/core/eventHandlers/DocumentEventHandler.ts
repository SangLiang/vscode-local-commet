import * as vscode from 'vscode';
import { ExtensionContainer } from '../ExtensionContainer';
import { logger } from '../../utils/logger';
import { TimerManager } from '../../utils/timerUtils';

/**
 * 文档事件处理器 - 处理文档相关事件（变化、保存、打开）
 */
export class DocumentEventHandler {
    // 定时器管理器
    private timerManager: TimerManager = new TimerManager();
    // 添加防抖定时器用于优化刷新频率
    private refreshTimer: NodeJS.Timeout | null = null;
    private readonly REFRESH_DEBOUNCE_DELAY = 150; // 150ms防抖延迟

    constructor(
        private container: ExtensionContainer,
        private context: vscode.ExtensionContext
    ) {}

    /**
     * 注册所有文档相关事件监听器
     * @returns 所有事件监听器的 Disposable 数组
     */
    register(): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        // 监听文档打开
        const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument(() => {
            // 文档打开时只刷新注释装饰器
            this.container.commentProvider.refresh();
            // 注释树在文档打开时不需要刷新，因为内容没有变化
        });
        disposables.push(onDidOpenTextDocument);

        // 监听文档保存事件，执行智能匹配
        const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument((document) => {
            this.container.commentManager.handleDocumentSave(document);
        });
        disposables.push(onDidSaveTextDocument);

        // 监听文档变化
        const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {

            // 由于onDidChangeTextDocument会监听所有文档内容变化，包括：
            // 用户输入（键盘输入、粘贴、删除等）
            // 程序修改（通过 TextEditor.edit() 等方法）
            // 格式化操作
            // 所以需要过滤掉非文件内容的变更
            if (event.document.uri.scheme !== 'file') {
                return;
            }

            // 检查是否是真正的文档内容变化（而不是装饰器更新导致的）
            // 如果 contentChanges 为空，可能是装饰器更新触发的假事件
            if (event.contentChanges.length === 0) {
                logger.debug('[DocumentEventHandler] 文档变化事件没有实际内容变化，跳过处理');
                return;
            }

            // 通过检查后，才调用处理函数
            this.handleDocumentChange(event);
        });
        disposables.push(onDidChangeTextDocument);

        return disposables;
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        // 用户编辑和编辑器命令会使文档进入 dirty 状态；外部文件更新通常保持 clean。
        // Undo/Redo 可能使文档重新变为 clean，因此需要通过 reason 排除。
        const isExternalChange = !event.document.isDirty && event.reason === undefined;

        // 外部文件更新（包括Git分支切换）需要立即执行全文智能匹配
        this.container.commentManager.handleDocumentChange(event, isExternalChange);
        
        // 处理书签的文档变化
        this.container.bookmarkManager.handleDocumentChange(event);
        
        // 更新标签
        this.container.tagManager.updateTags(this.container.commentManager.getAllComments());
        
        // 使用防抖机制减少频繁刷新
        if (this.refreshTimer) {
            this.timerManager.clearTimeout(this.refreshTimer);
        }
        
        this.refreshTimer = this.timerManager.setTimeout(() => {
            // 只刷新注释装饰器，不刷新注释树
            // 注释树会在注释管理器的智能更新完成后自动刷新
            this.container.commentProvider.refresh();
            this.refreshTimer = null;
        }, this.REFRESH_DEBOUNCE_DELAY);
    }

    /**
     * 清理资源
     */
    dispose(): void {
        if (this.refreshTimer) {
            this.timerManager.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.timerManager.dispose(); // 清理所有定时器
    }
}

