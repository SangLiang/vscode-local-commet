import * as vscode from 'vscode';

import * as path from 'path';

import { CommentManager } from '../managers/commentManager';

import { ProjectManager } from '../managers/projectManager';

import { AuthManager } from '../managers/authManager';

import { WebviewUtils } from '../utils/webviewUtils';

import { VIEW_TYPES, IPC_MESSAGES } from '../constants';

import {

    flattenCommentsToRows,

    filterCommentRows,

    sortCommentRows,

    CommentRowSortKey,

    SortDirection,

    CommentManageRow,

    CommentKindFilter,

} from '../utils/commentManageUtils';

import { openCommentEditor } from './commentEditActions';

import { MarkdownPreviewWebview } from './markdownPreviewWebview';

import { logger } from '../utils/logger';

import { getErrorMessage, buildExportData } from '../utils/utils';
import * as fs from 'fs';

import type { UpdatedContextInfo, MarkdownSaveOutcome } from './command/comment';
import type { FileComments } from '../managers/commentTypes';
import { isCommentEditNoop } from '../utils/commentDecorationColor';

function formatGroupDisplayName(fileName: string): string {
    return fileName.replace(/\.json$/i, '');
}



export class CommentManageWebviewPanel {

    public static currentPanel: CommentManageWebviewPanel | undefined;

    public static readonly viewType = VIEW_TYPES.COMMENT_MANAGE;

    private static _onGroupApplied?: () => void;
    private static _onCommentsMutated?: () => void;

    public static setOnGroupApplied(callback: () => void): void {
        CommentManageWebviewPanel._onGroupApplied = callback;
    }

    public static setOnCommentsMutated(callback: () => void): void {
        CommentManageWebviewPanel._onCommentsMutated = callback;
    }



    private readonly _panel: vscode.WebviewPanel;

    private readonly _extensionUri: vscode.Uri;

    private readonly _context: vscode.ExtensionContext;

    private readonly _commentManager: CommentManager;

    private readonly _projectManager: ProjectManager;

    private readonly _authManager: AuthManager;

    private _groupFileName: string;

    private _lastQuery?: string;

    private _lastCommentKind: CommentKindFilter = '';

    private _lastSortKey: CommentRowSortKey = 'filePath';

    private _lastSortDir: SortDirection = 'asc';

    private _disposables: vscode.Disposable[] = [];



    public static createOrShow(

        context: vscode.ExtensionContext,

        extensionUri: vscode.Uri,

        commentManager: CommentManager,

        projectManager: ProjectManager,

        authManager: AuthManager,

        groupFileName: string

    ): void {

        const title = `注释管理 - ${groupFileName}`;



        if (CommentManageWebviewPanel.currentPanel) {

            CommentManageWebviewPanel.currentPanel._panel.title = title;

            CommentManageWebviewPanel.currentPanel._groupFileName = groupFileName;

            CommentManageWebviewPanel.currentPanel.refreshRows();

            CommentManageWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);

            return;

        }

        const panel = vscode.window.createWebviewPanel(

            CommentManageWebviewPanel.viewType,

            title,

            vscode.ViewColumn.One,

            {

                enableScripts: true,

                localResourceRoots: [

                    vscode.Uri.joinPath(extensionUri, 'src', 'templates'),

                ],

                retainContextWhenHidden: true,

            }

        );



        CommentManageWebviewPanel.currentPanel = new CommentManageWebviewPanel(

            panel,

            context,

            extensionUri,

            commentManager,

            projectManager,

            authManager,

            groupFileName

        );

    }



    public static revive(

        panel: vscode.WebviewPanel,

        context: vscode.ExtensionContext,

        extensionUri: vscode.Uri,

        commentManager: CommentManager,

        projectManager: ProjectManager,

        authManager: AuthManager

    ): void {

        const groupFileName = commentManager.getCurrentCommentsConfig();

        CommentManageWebviewPanel.currentPanel = new CommentManageWebviewPanel(

            panel,

            context,

            extensionUri,

            commentManager,

            projectManager,

            authManager,

            groupFileName

        );

    }



    private constructor(

        panel: vscode.WebviewPanel,

        context: vscode.ExtensionContext,

        extensionUri: vscode.Uri,

        commentManager: CommentManager,

        projectManager: ProjectManager,

        authManager: AuthManager,

        groupFileName: string

    ) {

        this._panel = panel;

        this._context = context;

        this._extensionUri = extensionUri;

        this._commentManager = commentManager;

        this._projectManager = projectManager;

        this._authManager = authManager;

        this._groupFileName = groupFileName;



        this._update();



        this._disposables.push(

            commentManager.onDidChangeComments(() => {

                if (CommentManageWebviewPanel.currentPanel === this && this._isActiveGroup()) {

                    this.refreshRows();

                }

            })

        );



        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);



        this._panel.webview.onDidReceiveMessage(

            async (message) => {

                try {

                    switch (message.command) {

                        case IPC_MESSAGES.GET_COMMENT_ROWS:

                            this.refreshRows({

                                query: message.query,

                                commentKind: message.commentKind,

                                sortKey: message.sortKey,

                                sortDir: message.sortDir,

                            });

                            return;

                        case IPC_MESSAGES.OPEN_COMMENT_ROW:

                            if (message.filePath != null && message.line != null) {

                                await this._openRow(message.filePath, message.line);

                            }

                            return;

                        case IPC_MESSAGES.DELETE_COMMENT_ROWS:

                            await this._deleteCommentRows(message.ids ?? []);

                            return;

                        case IPC_MESSAGES.MOVE_COMMENT_ROWS:

                            await this._moveCommentRows(message.ids ?? []);

                            return;

                        case IPC_MESSAGES.EDIT_COMMENT_ROW:

                            if (message.id) {

                                await this._editCommentRow(message.id);

                            }

                            return;

                        case IPC_MESSAGES.PREVIEW_COMMENT_ROW:

                            if (message.id) {

                                await this._previewCommentRow(message.id);

                            }

                            return;

                        case IPC_MESSAGES.EXPORT_COMMENT_ROWS:

                            await this._exportCommentRows(message.ids ?? []);

                            return;

                        case IPC_MESSAGES.APPLY_COMMENT_GROUP_FROM_PANEL:

                            await this._applyViewingGroup();

                            return;

                    }

                } catch (error) {

                    logger.error('comment manage webview message failed', error);

                }

            },

            null,

            this._disposables

        );

    }



    public dispose(): void {

        CommentManageWebviewPanel.currentPanel = undefined;



        this._panel.dispose();



        while (this._disposables.length) {

            const disposable = this._disposables.pop();

            if (disposable) {

                disposable.dispose();

            }

        }

    }



    public onGroupApplied(groupFileName: string): void {

        this._groupFileName = groupFileName;

        this.refreshRows();

    }



    public refreshRows(params?: {

        query?: string;

        commentKind?: CommentKindFilter;

        sortKey?: CommentRowSortKey;

        sortDir?: SortDirection;

    }): void {

        if (params) {

            if (params.query !== undefined) {

                this._lastQuery = params.query;

            }

            if (params.commentKind !== undefined) {

                this._lastCommentKind = params.commentKind;

            }

            if (params.sortKey !== undefined) {

                this._lastSortKey = params.sortKey;

            }

            if (params.sortDir !== undefined) {

                this._lastSortDir = params.sortDir;

            }

        }



        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        let rows = flattenCommentsToRows(this._getCommentsForViewing(), workspaceRoot);

        const allRows = rows;

        const activeGroupFileName = this._commentManager.getCurrentCommentsConfig();

        const isActiveGroup = this._groupFileName === activeGroupFileName;



        if (this._lastQuery || this._lastCommentKind) {

            rows = filterCommentRows(rows, {

                query: this._lastQuery,

                commentKind: this._lastCommentKind,

            });

        }

        rows = sortCommentRows(rows, this._lastSortKey, this._lastSortDir);



        this._panel.webview.postMessage({

            command: IPC_MESSAGES.COMMENT_ROWS_RESULT,

            rows,

            allRows,

            groupFileName: this._groupFileName,

            activeGroupFileName,

            isActiveGroup,

        });

    }



    private _isActiveGroup(): boolean {

        return this._groupFileName === this._commentManager.getCurrentCommentsConfig();

    }



    private _getCommentsForViewing(): FileComments {

        if (this._isActiveGroup()) {

            return this._commentManager.getAllComments();

        }

        return this._commentManager.readCommentsFromConfigFile(this._groupFileName);

    }



    private async _applyViewingGroup(): Promise<void> {

        if (this._isActiveGroup()) {

            return;

        }

        await this._commentManager.switchCommentsConfig(this._groupFileName);

        CommentManageWebviewPanel._onGroupApplied?.();

        this.refreshRows();

    }



    private _ensureActiveGroupForEdit(): boolean {

        if (this._isActiveGroup()) {

            return true;

        }

        vscode.window.showWarningMessage('当前为预览模式，请先点击「应用此分组」后再编辑');

        return false;

    }



    private _getCurrentRows(): CommentManageRow[] {

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        return flattenCommentsToRows(this._getCommentsForViewing(), workspaceRoot);

    }



    private _findRowById(id: string): CommentManageRow | undefined {

        return this._getCurrentRows().find((row) => row.id === id);

    }



    private _resolveAbsPath(filePath: string): string {

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        return path.isAbsolute(filePath)

            ? filePath

            : path.join(workspaceRoot ?? '', filePath);

    }



    private async _deleteCommentRows(ids: string[]): Promise<void> {

        if (ids.length === 0) {

            return;

        }



        const choice =

            ids.length > 1

                ? await vscode.window.showWarningMessage(

                      `确定删除 ${ids.length} 条注释？`,

                      '删除',

                      '取消'

                  )

                : '删除';



        if (choice !== '删除') {

            return;

        }



        if (this._isActiveGroup()) {

            for (const id of ids) {

                const row = this._findRowById(id);

                if (!row) {

                    continue;

                }

                const absPath = this._resolveAbsPath(row.filePath);

                await this._commentManager.removeCommentById(vscode.Uri.file(absPath), id);

            }

            CommentManageWebviewPanel._onCommentsMutated?.();

        } else {

            const removed = await this._commentManager.removeCommentsFromConfig(this._groupFileName, ids);

            if (removed === 0) {

                vscode.window.showWarningMessage('未找到可删除的注释');

                return;

            }

            CommentManageWebviewPanel._onCommentsMutated?.();

        }

        this.refreshRows();

    }



    private async _moveCommentRows(ids: string[]): Promise<void> {

        if (ids.length === 0) {

            return;

        }



        const targetGroups = this._commentManager

            .listAvailableCommentsConfigs()

            .filter((fileName) => fileName !== this._groupFileName);

        if (targetGroups.length === 0) {

            vscode.window.showWarningMessage('没有其他分组可移动，请先新建目标分组');

            return;

        }



        const picked = await vscode.window.showQuickPick(

            targetGroups.map((fileName) => ({

                label: formatGroupDisplayName(fileName),

                description: fileName,

                fileName,

            })),

            {

                title: ids.length > 1 ? `移动 ${ids.length} 条注释到` : '移动注释到',

                placeHolder: '选择目标分组',

            }

        );

        if (!picked) {

            return;

        }



        const targetLabel = formatGroupDisplayName(picked.fileName);

        const confirmMessage =

            ids.length > 1

                ? `确定将 ${ids.length} 条注释移动到「${targetLabel}」？`

                : `确定将注释移动到「${targetLabel}」？`;

        const choice = await vscode.window.showWarningMessage(confirmMessage, '移动', '取消');

        if (choice !== '移动') {

            return;

        }



        const result = await this._commentManager.moveCommentsToGroup(

            this._groupFileName,

            picked.fileName,

            ids

        );



        if (result.moved === 0) {

            vscode.window.showWarningMessage(

                result.skipped > 0 ? '没有注释被移动（共享注释不可移动或未找到）' : '未找到可移动的注释'

            );

            return;

        }



        let message = `已移动 ${result.moved} 条注释到「${targetLabel}」`;

        if (result.skipped > 0) {

            message += `，跳过 ${result.skipped} 条`;

        }

        vscode.window.showInformationMessage(message);

        this.refreshRows();

        CommentManageWebviewPanel._onCommentsMutated?.();

    }



    private async _editCommentRow(id: string): Promise<void> {

        if (!this._ensureActiveGroupForEdit()) {

            return;

        }

        const row = this._findRowById(id);

        if (!row) {

            return;

        }



        const uri = vscode.Uri.file(this._resolveAbsPath(row.filePath));

        const comment = this._commentManager.getCommentById(uri, row.id);

        if (!comment) {

            return;

        }



        const originalContent = comment.content;

        const originalLine = comment.line;

        const originalColor = comment.color;



        await openCommentEditor({

            context: this._context,

            commentManager: this._commentManager,

            projectManager: this._projectManager,

            authManager: this._authManager,

            uri,

            comment,

            onSaveAndContinue: async (

                savedContent: string,

                updatedContextInfo?: UpdatedContextInfo,

                callback?: () => void,

                color?: string

            ): Promise<MarkdownSaveOutcome> => {

                try {

                    if (isCommentEditNoop(savedContent, originalContent, color, originalColor)) {

                        callback?.();

                        return 'skipped-noop';

                    }



                    if (

                        updatedContextInfo?.lineNumber !== undefined &&

                        updatedContextInfo.lineNumber !== originalLine

                    ) {

                        await this._commentManager.updateCommentLine(

                            uri,

                            row.id,

                            updatedContextInfo.lineNumber,

                            updatedContextInfo.lineContent || ''

                        );

                    }



                    await this._commentManager.editComment(uri, row.id, savedContent, color);

                    this.refreshRows();

                    callback?.();

                    return 'committed';

                } catch (error) {

                    logger.error('保存注释时发生错误:', error);

                    vscode.window.showErrorMessage(`保存失败: ${getErrorMessage(error)}`);

                    return 'failed';

                }

            },

        });

    }



    private async _previewCommentRow(id: string): Promise<void> {

        const row = this._findRowById(id);

        if (!row) {

            return;

        }



        const absPath = this._resolveAbsPath(row.filePath);

        await MarkdownPreviewWebview.createOrShow(

            this._context,

            row.content,

            row.filePath,

            absPath,

            []

        );

    }



    private async _exportCommentRows(ids: string[]): Promise<void> {

        const saveUri = await vscode.window.showSaveDialog({

            filters: { JSON: ['json'] },

            defaultUri: vscode.Uri.file(`comments-export-${Date.now()}.json`),

        });

        if (!saveUri) {

            return;

        }



        let ok: boolean;

        if (this._isActiveGroup()) {

            ok = ids.length

                ? await this._commentManager.exportCommentsSubset(saveUri.fsPath, ids)

                : await this._commentManager.exportComments(saveUri.fsPath);

        } else {

            ok = this._exportViewingGroupSubset(saveUri.fsPath, ids);

        }



        if (ok) {

            vscode.window.showInformationMessage('导出成功');

        } else {

            vscode.window.showErrorMessage('导出失败');

        }

    }



    private _exportViewingGroupSubset(exportPath: string, commentIds: string[]): boolean {

        try {

            const idSet = new Set(commentIds);

            const all = this._getCommentsForViewing();

            const subset: FileComments = {};

            for (const [filePath, comments] of Object.entries(all)) {

                const picked = comments.filter((c) => idSet.has(c.id) && !('userId' in c));

                if (picked.length > 0) {

                    subset[filePath] = picked;

                }

            }

            const totalComments = Object.values(subset).reduce((sum, arr) => sum + arr.length, 0);

            if (totalComments === 0) {

                return false;

            }

            const exportData = buildExportData(

                this._commentManager.getProjectInfo(),

                subset,

                totalComments

            );

            const exportDir = path.dirname(exportPath);

            if (!fs.existsSync(exportDir)) {

                fs.mkdirSync(exportDir, { recursive: true });

            }

            fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), 'utf8');

            return true;

        } catch (error) {

            logger.error('export viewing group subset failed', error);

            return false;

        }

    }



    private async _openRow(filePath: string, line: number): Promise<void> {

        try {

            const absPath = this._resolveAbsPath(filePath);

            const uri = vscode.Uri.file(absPath);

            const doc = await vscode.workspace.openTextDocument(uri);

            const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });

            const pos = new vscode.Position(Math.max(0, line), 0);

            editor.selection = new vscode.Selection(pos, pos);

            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

        } catch (error) {

            logger.error('open comment row failed', error);

            vscode.window.showErrorMessage(`无法打开文件: ${getErrorMessage(error)}`);

        }

    }



    private _update(): void {

        this._panel.title = `注释管理 - ${this._groupFileName}`;

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    }



    private _getHtmlForWebview(webview: vscode.Webview): string {

        const resourceUris = WebviewUtils.buildResourceUris(webview, this._extensionUri, {

            css: 'comment-manage/comment-manage.css',

            js: 'comment-manage/comment-manage.js',

        });



        const nonce = WebviewUtils.getNonce();

        const template = WebviewUtils.loadTemplate(

            this._commentManager.getContext(),

            'comment-manage/comment-manage.html'

        );



        return WebviewUtils.replaceTemplateVariables(template, {

            cspSource: webview.cspSource,

            cssUri: resourceUris.cssUri || '',

            jsUri: resourceUris.jsUri || '',

            nonce,

        });

    }

}


