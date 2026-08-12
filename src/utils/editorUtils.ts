import * as vscode from 'vscode';
import { DELAY_TIMES } from '../constants';
import { TimerManager } from './timerUtils';

/**
 * 编辑器工具类
 * 提供编辑器相关的工具方法
 */
export class EditorUtils {
    private static readonly _restoreTimers = new TimerManager();

    /**
     * 扩展停用时取消尚未执行的「恢复编辑器焦点」定时器，避免卸载后仍访问 VS Code API。
     */
    static disposeRestoreTimers(): void {
        EditorUtils._restoreTimers.dispose();
    }

    /**
     * 智能选择 WebView 面板的列
     * 最多两列：仅一列时 Beside 侧开；已有两列则打开到「另一侧」组，避免覆盖当前文件。
     * @param activeEditor 可选的编辑器实例
     * @returns 应该在哪个列打开面板
     */
    static smartSelectViewColumn(activeEditor: vscode.TextEditor | undefined): vscode.ViewColumn {
        if (!activeEditor) {
            return vscode.ViewColumn.One;
        }
        const groups = vscode.window.tabGroups.all;
        if (groups.length <= 1) {
            return vscode.ViewColumn.Beside;
        }
        const activeGroup = vscode.window.tabGroups.activeTabGroup;
        const otherGroup = groups.find((group) => group !== activeGroup);
        if (otherGroup?.viewColumn !== undefined) {
            return otherGroup.viewColumn;
        }
        const sourceColumn = activeEditor.viewColumn ?? activeGroup.viewColumn;
        return sourceColumn === vscode.ViewColumn.Two
            ? vscode.ViewColumn.One
            : vscode.ViewColumn.Two;
    }

    /**
     * Cursor 等环境可能忽略目标 ViewColumn。
     * 基于 panel 实际所在列判断是否需要移动，避免依赖活动组切换时序：
     * - 仅唯一组时新建右侧组；
     * - 已有多列且面板已落到非源列时直接返回，不触发 moveEditor*（防止标准 VS Code 下误开第三栏）；
     * - 已有多列但面板仍落在源列（Cursor 忽略 viewColumn）时，手动移到另一侧已有组。
     */
    static async ensureWebviewBesideSource(
        panel: vscode.WebviewPanel,
        sourceViewColumn: vscode.ViewColumn | undefined,
        sourceGroup: vscode.TabGroup = vscode.window.tabGroups.activeTabGroup
    ): Promise<void> {
        const groups = vscode.window.tabGroups.all;

        if (groups.length === 1) {
            await vscode.commands.executeCommand('workbench.action.moveEditorToNewGroupRight');
            return;
        }

        // 仅当面板明确仍落在源列（Cursor 等忽略 viewColumn）时才手动移动；
        // 面板已到非源列、或位置无法确认时一律不移动，避免误开第三栏。
        if (panel.viewColumn !== sourceViewColumn) {
            return;
        }

        const sourceIndex = groups.indexOf(sourceGroup);
        const index = sourceIndex >= 0 ? sourceIndex : 0;
        await vscode.commands.executeCommand(
            index <= 0
                ? 'workbench.action.moveEditorToNextGroup'
                : 'workbench.action.moveEditorToPreviousGroup'
        );
    }

    /**
     * 在当前编辑器所在列以新 Tab 打开 Markdown 预览。
     * 避免占用侧栏列（通常为 Column Two），防止侧栏已有预览因布局重排而闪动。
     */
    static selectViewColumnForPreviewTab(activeEditor: vscode.TextEditor | undefined): vscode.ViewColumn {
        return activeEditor?.viewColumn ?? vscode.ViewColumn.One;
    }

    /**
     * 恢复编辑器焦点
     * @param editor 可选的编辑器实例，如果不提供则使用当前活动编辑器
     * @param delay 延迟时间（毫秒），默认为 DELAY_TIMES.RESTORE_EDITOR_FOCUS
     */
    static restoreFocus(editor?: vscode.TextEditor, delay: number = DELAY_TIMES.RESTORE_EDITOR_FOCUS): void {
        const targetEditor = editor || vscode.window.activeTextEditor;
        if (targetEditor) {
            EditorUtils._restoreTimers.setTimeout(() => {
                vscode.window.showTextDocument(targetEditor.document, {
                    viewColumn: targetEditor.viewColumn,
                    selection: targetEditor.selection,
                    preserveFocus: false
                }).then(() => {
                    // 确保焦点真正回到编辑器
                    vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
                });
            }, delay);
        } else {
            // 如果没有编辑器，只是确保焦点回到编辑器组
            EditorUtils._restoreTimers.setTimeout(() => {
                vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
            }, delay);
        }
    }
}
