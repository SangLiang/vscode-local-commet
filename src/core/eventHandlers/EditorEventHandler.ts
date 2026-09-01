import * as vscode from 'vscode';
import { ExtensionContainer } from '../ExtensionContainer';

/**
 * 编辑器事件处理器 - 处理编辑器相关事件
 */
export class EditorEventHandler {
    constructor(
        private container: ExtensionContainer,
        private context: vscode.ExtensionContext
    ) {}

    /**
     * 注册所有编辑器相关事件监听器
     * @returns 所有事件监听器的 Disposable 数组
     */
    register(): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        // 监听编辑器切换事件
        const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                // 编辑器切换时只刷新注释装饰器
                this.container.commentProvider.refresh();
                // 注释树在编辑器切换时不需要刷新，因为内容没有变化
            }
        });
        disposables.push(onDidChangeActiveTextEditor);

        return disposables;
    }
}
