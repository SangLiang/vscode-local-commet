import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WebviewUtils, ResourceUris } from '../utils/webviewUtils';
import { logger } from '../utils/logger';
import { VIEW_TYPES, IPC_MESSAGES, COMMANDS, DELAY_TIMES } from '../constants';
import { TimerManager } from '../utils/timerUtils';
import { EditorUtils } from '../utils/editorUtils';
import { getErrorMessage } from '../utils/utils';
import { resolveMarkdownImagePaths, isVscodeResourceUri, decodeVscodeResourceUriToPath } from '../utils/markdownImageUtils';

/**
 * Markdown 文件自定义预览 Webview。
 *
 * 支持多文件同时预览：每个源文件对应一个面板，按规范化路径注册在 _panels 中。
 * 文档变更时仅刷新路径匹配的面板，互不干扰。
 */
export class MarkdownPreviewWebview {
    /** 按规范化文件路径索引的预览面板，允许多个 .md 同时预览 */
    private static readonly _panels = new Map<string, MarkdownPreviewWebview>();
    /** 最近一次打开/聚焦的面板（兼容旧逻辑，跳转等待场景使用） */
    private static currentPanel: MarkdownPreviewWebview | undefined;
    /** 批量 dispose 或扩展停用时为 true，避免逐个 restoreFocus */
    private static _isReplacing: boolean = false;
    /** 全局文档监听（只注册一次，分发给 _panels 中匹配的面板） */
    private static _workspaceSyncDisposables: vscode.Disposable[] | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private readonly activeEditor: vscode.TextEditor | undefined;
    /** 本面板绑定的源文件路径（已 normalize，用于与 document.uri 比较） */
    private readonly _previewFilePath: string;
    /** 本面板绑定的源文件原始路径（用于解析 Markdown 内相对图片路径） */
    private readonly _sourceFilePath: string;
    private readonly _syncTimerManager = new TimerManager();
    private _pendingSyncTimer: NodeJS.Timeout | undefined;
    private _lastSyncedContent: string | undefined;
    private availableTagNames: string[] = [];
    /** 本地图片 webview URI → 文件绝对路径，供导出 HTML 时内联资源 */
    private readonly _localImageUriMap = new Map<string, string>();

    private constructor(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        activeEditor: vscode.TextEditor | undefined,
        previewFilePath: string,
        availableTagNames?: string[]
    ) {
        this.panel = panel;
        this.context = context;
        this.activeEditor = activeEditor;
        this._previewFilePath = MarkdownPreviewWebview.normalizePreviewPath(previewFilePath);
        this._sourceFilePath = previewFilePath;
        this.availableTagNames = availableTagNames || [];

        this.panel.onDidDispose(() => this.dispose());
    }

    private static normalizePreviewPath(filePath: string): string {
        const normalized = path.normalize(vscode.Uri.file(filePath).fsPath);
        // Windows 下路径大小写不一致会导致同一文件匹配失败
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    /** 注册 workspace 级文档监听，避免每个面板重复订阅 */
    private static ensureWorkspaceSyncListeners(): void {
        if (MarkdownPreviewWebview._workspaceSyncDisposables) {
            return;
        }

        MarkdownPreviewWebview._workspaceSyncDisposables = [
            vscode.workspace.onDidChangeTextDocument((event) => {
                MarkdownPreviewWebview.handleDocumentChange(event);
            }),
            vscode.workspace.onDidSaveTextDocument((document) => {
                MarkdownPreviewWebview.handleDocumentSave(document);
            }),
        ];
    }

    private static handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (event.document.uri.scheme !== 'file') {
            return;
        }
        // 装饰器刷新等会触发无 contentChanges 的事件，跳过以免误刷新预览
        if (event.contentChanges.length === 0) {
            return;
        }

        for (const panel of MarkdownPreviewWebview._panels.values()) {
            if (!panel.isLiveSyncEnabled()) {
                continue;
            }
            if (!panel.matchesPreviewFile(event.document)) {
                continue;
            }
            panel.scheduleContentSync(event.document);
        }
    }

    /** liveSync 关闭时，仅在保存时更新各面板 */
    private static handleDocumentSave(document: vscode.TextDocument): void {
        if (document.uri.scheme !== 'file') {
            return;
        }

        for (const panel of MarkdownPreviewWebview._panels.values()) {
            if (panel.isLiveSyncEnabled() || !panel.matchesPreviewFile(document)) {
                continue;
            }
            panel.updateContent(document.getText());
        }
    }

    /** 扩展停用时由 ExtensionLifecycle 调用，释放监听并关闭所有预览 Tab */
    static disposeAll(): void {
        if (MarkdownPreviewWebview._workspaceSyncDisposables) {
            for (const disposable of MarkdownPreviewWebview._workspaceSyncDisposables) {
                disposable.dispose();
            }
            MarkdownPreviewWebview._workspaceSyncDisposables = undefined;
        }

        const panels = [...MarkdownPreviewWebview._panels.values()];
        MarkdownPreviewWebview._isReplacing = true;
        for (const panel of panels) {
            panel.panel.dispose();
        }
        MarkdownPreviewWebview._isReplacing = false;
        MarkdownPreviewWebview._panels.clear();
        MarkdownPreviewWebview.currentPanel = undefined;
    }

    /**
     * F5 重载后扩展侧 _panels 已清空，但 Webview Tab 可能仍存在。
     * 在创建第一个新面板前关闭这些遗留 Tab，避免重复面板与监听错乱。
     */
    private static async closeOrphanExtensionPreviewTabs(): Promise<void> {
        if (MarkdownPreviewWebview._panels.size > 0) {
            return;
        }

        const tabsToClose: vscode.Tab[] = [];

        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (!(tab.input instanceof vscode.TabInputWebview)) {
                    continue;
                }
                if (tab.input.viewType === VIEW_TYPES.MARKDOWN_PREVIEW) {
                    tabsToClose.push(tab);
                }
            }
        }

        if (tabsToClose.length === 0) {
            return;
        }

        try {
            await vscode.window.tabGroups.close(tabsToClose);
        } catch (error) {
            logger.error('关闭遗留 Markdown 预览标签页失败:', error);
        }
    }

    static async createOrShow(context: vscode.ExtensionContext, content: string, fileName: string, filePath: string, availableTagNames?: string[]): Promise<MarkdownPreviewWebview> {
        const activeEditor = vscode.window.activeTextEditor;
        const normalizedFilePath = MarkdownPreviewWebview.normalizePreviewPath(filePath);

        const existing = MarkdownPreviewWebview._panels.get(normalizedFilePath);
        if (existing) {
            existing.updateContent(content, availableTagNames);
            // preserveFocus：避免抢焦点导致侧栏/其他预览闪动
            existing.panel.reveal(undefined, true);
            MarkdownPreviewWebview.currentPanel = existing;
            return existing;
        }

        if (MarkdownPreviewWebview._panels.size === 0) {
            await MarkdownPreviewWebview.closeOrphanExtensionPreviewTabs();
        }

        // 在当前编辑器列开新 Tab，不占侧栏列，避免与已有分屏预览布局冲突
        const viewColumn = EditorUtils.selectViewColumnForPreviewTab(activeEditor);
        // 允许加载 .md 文件所在工作区的本地图片（相对路径图片需 asWebviewUri 后才能被 CSP 放行）
        const localResourceRoots = [
            vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', 'markdownPreview'),
            vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', 'common'),
            vscode.Uri.joinPath(context.extensionUri, 'src', 'lib'),
            vscode.Uri.joinPath(context.extensionUri, 'out', 'lib')
        ];
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (workspaceFolder) {
            localResourceRoots.push(workspaceFolder.uri);
        } else {
            localResourceRoots.push(vscode.Uri.file(path.dirname(filePath)));
        }
        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPES.MARKDOWN_PREVIEW,
            '预览: ' + fileName,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: localResourceRoots,
                enableCommandUris: false,
                enableFindWidget: false
            }
        );

        const webview = new MarkdownPreviewWebview(panel, context, activeEditor, filePath, availableTagNames);
        MarkdownPreviewWebview._panels.set(normalizedFilePath, webview);
        MarkdownPreviewWebview.currentPanel = webview;

        MarkdownPreviewWebview.ensureWorkspaceSyncListeners();
        webview.initialize(content, fileName);
        return webview;
    }

    static async previewFile(context: vscode.ExtensionContext, availableTagNames?: string[]): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('请先打开一个 Markdown 文件');
            return;
        }

        const document = activeEditor.document;
        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);
        const content = document.getText();

        await MarkdownPreviewWebview.createOrShow(context, content, fileName, filePath, availableTagNames);
    }

    private initialize(content: string, fileName: string): void {
        content = this.resolveMarkdownContent(content);
        const config = vscode.workspace.getConfiguration('local-comment');
        const highlightTheme = config.get<string>('codeHighlight.theme', 'github-dark');

        const resourceUris = WebviewUtils.buildResourceUris(this.panel.webview, this.context.extensionUri, {
            markedJs: true,
            css: 'markdownPreview/preview.css',
            js: 'markdownPreview/preview.js',
            mermaidJs: true,
            katexJs: true,
            katexCss: true,
            highlightJs: true,
            highlightCss: true,
            highlightTheme: highlightTheme,
            customResources: [
                { path: 'src/templates/common/public.js', name: 'publicJsUri' },
                { path: 'src/templates/common/mermaidChartInteract.js', name: 'mermaidChartInteractJsUri' },
                { path: 'src/templates/common/markdownRenderCore.js', name: 'markdownRenderCoreJsUri' },
                { path: 'src/templates/markdownPreview/previewFind.js', name: 'previewFindJsUri' },
                { path: 'src/templates/markdownPreview/previewToc.js', name: 'previewTocJsUri' }
            ]
        });

        this.panel.webview.html = this.getWebviewContent(content, fileName, resourceUris);
        this._lastSyncedContent = content;

        this.registerMessageHandler();

        let configPostTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
            configPostTimer = undefined;
            try {
                const config = vscode.workspace.getConfiguration('local-comment');
                const mermaidTheme = config.get<string>('mermaid.theme', 'default');
                this.panel.webview.postMessage({
                    command: IPC_MESSAGES.SET_MERMAID_THEME,
                    theme: mermaidTheme
                });

                const previewFontSize = config.get<number>('markdownPreview.fontSize', 0);
                let fontSize: number;
                if (previewFontSize === 0) {
                    const editorConfig = vscode.workspace.getConfiguration('editor');
                    fontSize = editorConfig.get<number>('fontSize', 14);
                } else {
                    fontSize = previewFontSize;
                }

                this.panel.webview.postMessage({
                    command: IPC_MESSAGES.SET_PREVIEW_FONT_SIZE,
                    fontSize: fontSize
                });

                // Webview 脚本就绪后再发配置，避免首屏渲染时 marked/mermaid 尚未加载
                this.panel.webview.postMessage({
                    command: IPC_MESSAGES.SET_AVAILABLE_TAGS,
                    tagNames: this.availableTagNames
                });
            } catch (error) {
                logger.error('发送配置失败:', error);
            }
        }, 0);

    }

    /** 将 Markdown 内的本地图片相对路径转换为 webview 可加载的 URI */
    private resolveMarkdownContent(content: string): string {
        if (!content || !this._sourceFilePath) {
            return content;
        }
        return resolveMarkdownImagePaths(content, this._sourceFilePath, (absPath) => {
            const uri = this.panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
            this._localImageUriMap.set(uri, absPath);
            return uri;
        });
    }

    private isLiveSyncEnabled(): boolean {
        return vscode.workspace.getConfiguration('local-comment')
            .get<boolean>('markdownPreview.liveSync', true);
    }

    private matchesPreviewFile(document: vscode.TextDocument): boolean {
        if (document.uri.scheme !== 'file') {
            return false;
        }
        return MarkdownPreviewWebview.normalizePreviewPath(document.uri.fsPath) === this._previewFilePath;
    }

    /** 防抖后推送内容，避免每次按键都完整重渲染 Mermaid 等重量级内容 */
    private scheduleContentSync(document: vscode.TextDocument): void {
        if (this._pendingSyncTimer) {
            this._syncTimerManager.clearTimeout(this._pendingSyncTimer);
        }
        this._pendingSyncTimer = this._syncTimerManager.setTimeout(() => {
            this._pendingSyncTimer = undefined;
            if (this.matchesPreviewFile(document)) {
                this.updateContent(document.getText());
            }
        }, DELAY_TIMES.MARKDOWN_PREVIEW_LIVE_SYNC);
    }

    private tagsEqual(next?: string[]): boolean {
        if (next === undefined) {
            return true;
        }
        if (next.length !== this.availableTagNames.length) {
            return false;
        }
        for (let i = 0; i < next.length; i++) {
            if (next[i] !== this.availableTagNames[i]) {
                return false;
            }
        }
        return true;
    }

    /** 通过 postMessage 增量更新 Webview；内容与标签均未变时跳过，减少闪动 */
    updateContent(content: string, availableTagNames?: string[]): void {
        const resolvedContent = this.resolveMarkdownContent(content);
        const contentUnchanged = resolvedContent === this._lastSyncedContent;
        const tagsUnchanged = this.tagsEqual(availableTagNames);
        if (contentUnchanged && tagsUnchanged) {
            return;
        }

        if (availableTagNames !== undefined) {
            this.availableTagNames = availableTagNames;
        }
        this._lastSyncedContent = resolvedContent;
        // liveSync 路径不传 tagNames，避免每次编辑都触发标签重渲染
        const payload: { command: string; content: string; tagNames?: string[] } = {
            command: IPC_MESSAGES.UPDATE_CONTENT,
            content: resolvedContent,
        };
        if (availableTagNames !== undefined) {
            payload.tagNames = this.availableTagNames;
        }
        this.panel.webview.postMessage(payload);
    }

    private registerMessageHandler(): void {
        this.panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === IPC_MESSAGES.GO_TO_SOURCE_LINE) {
                await this.handleGoToSourceLine(message.line);
                return;
            }

            if (message.command === IPC_MESSAGES.GO_TO_TAG_DECLARATION && message.tagName) {
                try {
                    await vscode.commands.executeCommand(
                        COMMANDS.GO_TO_TAG_DECLARATION,
                        { tagName: message.tagName }
                    );
                } catch (error) {
                    logger.error('跳转到标签声明失败:', error);
                    vscode.window.showErrorMessage(`跳转失败: ${getErrorMessage(error)}`);
                }
                return;
            }

            if (message.command !== IPC_MESSAGES.EXPORT_HTML || !message.html) return;

            let exportSuccess = false;
            let exportError = '';

            try {
                let html = message.html;
                let css = message.css || '';

                if (message.localImagePaths?.length) {
                    html = this.inlineLocalImages(html, message.localImagePaths);
                }

                if (message.remoteImageUrls?.length) {
                    html = await this.inlineRemoteImages(html, message.remoteImageUrls);
                }

                if (message.hasKatex) {
                    css = this.inlineKatexFonts(css);
                }

                const fullHtml = this.buildExportHtml(
                    html,
                    css,
                    message.fileName,
                    message.keepPrintBg,
                    !!message.hasMermaid
                );
                exportSuccess = await this.saveExportHtml(fullHtml, message.fileName);
            } catch (error) {
                exportError = getErrorMessage(error);
                vscode.window.showErrorMessage(`导出失败: ${exportError}`);
            } finally {
                // 通知 Webview 导出完成（成功、失败或用户取消）
                this.panel.webview.postMessage({
                    command: IPC_MESSAGES.EXPORT_HTML_COMPLETE,
                    success: exportSuccess,
                    error: exportError
                });
            }
        });
    }

    /** Alt+单击预览块时，跳转到本面板绑定的源文件行（非 currentPanel） */
    private async handleGoToSourceLine(line: number): Promise<void> {
        const filePath = this._previewFilePath;
        if (!filePath) {
            return;
        }
        if (typeof line !== 'number' || line < 0 || !Number.isFinite(line)) {
            return;
        }

        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);

            const existingEditor = vscode.window.visibleTextEditors.find(
                (editor) => MarkdownPreviewWebview.normalizePreviewPath(editor.document.uri.fsPath) === filePath
            );
            const viewColumn = existingEditor?.viewColumn
                ?? vscode.ViewColumn.One;

            const targetLine = Math.min(Math.max(0, Math.floor(line)), Math.max(0, document.lineCount - 1));
            const position = new vscode.Position(targetLine, 0);

            const editor = await vscode.window.showTextDocument(document, {
                viewColumn,
                preserveFocus: false,
                selection: new vscode.Range(position, position)
            });

            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            await vscode.commands.executeCommand('revealLine', {
                lineNumber: targetLine + 1,
                at: 'center'
            });
        } catch (error) {
            logger.error('跳转到源文件失败:', error);
            vscode.window.showErrorMessage(`跳转失败: ${getErrorMessage(error)}`);
        }
    }

    private inlineLocalImages(html: string, paths: string[]): string {
        for (const imgPath of paths) {
            try {
                const filePath = this._localImageUriMap.get(imgPath)
                    || decodeVscodeResourceUriToPath(imgPath)
                    || imgPath;
                const buf = fs.readFileSync(filePath);
                const ext = path.extname(filePath).slice(1);
                const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
                html = html.split(imgPath).join(dataUri);
            } catch {
            }
        }
        return html;
    }

    private async inlineRemoteImages(html: string, urls: string[]): Promise<string> {
        const axios = (await import('axios')).default;
        for (const url of urls) {
            if (isVscodeResourceUri(url)) {
                continue;
            }
            try {
                const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
                const contentType = response.headers['content-type'] || 'image/png';
                const base64 = Buffer.from(response.data).toString('base64');
                const dataUri = `data:${contentType};base64,${base64}`;
                html = html.split(url).join(dataUri);
            } catch {
            }
        }
        return html;
    }

    private inlineKatexFonts(cssText: string): string {
        const fontsDir = this.getKatexFontsDir();
        if (!fs.existsSync(fontsDir)) return cssText;

        return cssText.replace(/url\((?:'")?fonts\/([^)'"]+)(?:'")?\)/g, (match, fontFile) => {
            const fontPath = path.join(fontsDir, fontFile);
            try {
                const buf = fs.readFileSync(fontPath);
                const ext = fontFile.split('.').pop();
                const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : 'font/ttf';
                return `url("data:${mime};base64,${buf.toString('base64')}")`;
            } catch {
                return match;
            }
        });
    }

    private getKatexFontsDir(): string {
        const outFonts = path.join(this.context.extensionUri.fsPath, 'out', 'lib', 'fonts');
        if (fs.existsSync(outFonts)) return outFonts;
        return path.join(this.context.extensionUri.fsPath, 'node_modules', 'katex', 'dist', 'fonts');
    }

    private getMermaidExportScript(): string {
        const templatesRoot = path.join(this.context.extensionUri.fsPath, 'src', 'templates');
        const scriptFiles = [
            path.join(templatesRoot, 'common', 'public.js'),
            path.join(templatesRoot, 'common', 'mermaidChartInteract.js'),
            path.join(templatesRoot, 'markdownPreview', 'mermaidExport.js')
        ];
        const parts: string[] = [];
        for (const scriptPath of scriptFiles) {
            if (fs.existsSync(scriptPath)) {
                parts.push(fs.readFileSync(scriptPath, 'utf8'));
            }
        }
        return parts.join('\n');
    }

    private buildExportHtml(
        previewHtml: string,
        css: string,
        fileName: string,
        keepPrintBg: boolean = true,
        hasMermaid: boolean = false
    ): string {
        const safeName = fileName ? fileName.replace(/\.md$/i, '') : 'export';
        // 仅影响「打印」时是否保留背景色，与屏幕浏览时的表格边框无关
        const printStyles = keepPrintBg
            ? `@media print {
    * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
}`
            : '';
        const mermaidScript = hasMermaid
            ? `<script>\n${this.getMermaidExportScript()}\n</script>`
            : '';
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeName}</title>
    <style>
${css}
${printStyles}
    </style>
</head>
<body>
    <div class="container">
        <div class="content-area">
${previewHtml}
        </div>
    </div>
${mermaidScript}
</body>
</html>`;
    }

    private async saveExportHtml(html: string, fileName: string): Promise<boolean> {
        const defaultName = (fileName || 'export').replace(/\.md$/i, '.html');
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultName),
            filters: { 'HTML': ['html'] }
        });
        if (uri) {
            fs.writeFileSync(uri.fsPath, html, 'utf8');
            vscode.window.showInformationMessage(`已导出到 ${uri.fsPath}`);
            return true;
        }
        return false; // 用户取消保存
    }

    private getWebviewContent(content: string, fileName: string, resourceUris: ResourceUris): string {
        const nonce = WebviewUtils.getNonce();

        const publicJsUri = resourceUris?.publicJsUri || '';
        const publicJsScript = publicJsUri
            ? '<script src="' + publicJsUri + '" onerror="console.error(\'public.js 加载失败\')"></script>'
            : '';
        const mermaidInteractJsUri = resourceUris?.mermaidChartInteractJsUri || '';
        const mermaidInteractJsScript = mermaidInteractJsUri
            ? '<script src="' + mermaidInteractJsUri + '" onerror="console.error(\'mermaidChartInteract.js 加载失败\')"></script>'
            : '';
        const coreJsUri = resourceUris?.markdownRenderCoreJsUri || '';
        const coreJsScript = coreJsUri
            ? '<script src="' + coreJsUri + '" onerror="console.error(\'markdownRenderCore.js 加载失败\')"></script>'
            : '';
        const previewFindJsUri = resourceUris?.previewFindJsUri || '';
        const previewFindJsScript = previewFindJsUri
            ? '<script src="' + previewFindJsUri + '" onerror="console.error(\'previewFind.js 加载失败\')"></script>'
            : '';
        const previewTocJsUri = resourceUris?.previewTocJsUri || '';
        const previewTocJsScript = previewTocJsUri
            ? '<script src="' + previewTocJsUri + '" onerror="console.error(\'previewToc.js 加载失败\')"></script>'
            : '';

        const templateVariables: Record<string, string> = {
            fileName: WebviewUtils.escapeHtml(fileName),
            escapedContent: WebviewUtils.escapeHtml(content || ''),
            markedJsUri: resourceUris.markedJsUri || '',
            cssUri: resourceUris.cssUri || '',
            jsUri: resourceUris.jsUri || '',
            mermaidJsUri: resourceUris.mermaidJsUri || '',
            katexJsUri: resourceUris.katexJsUri || '',
            katexCssUri: resourceUris.katexCssUri || '',
            highlightJsUri: resourceUris.highlightJsUri || '',
            highlightCssUri: resourceUris.highlightCssUri || '',
            publicJsUri: publicJsUri,
            publicJsScript: publicJsScript,
            mermaidInteractJsScript: mermaidInteractJsScript,
            coreJsScript: coreJsScript,
            previewFindJsScript: previewFindJsScript,
            previewTocJsScript: previewTocJsScript,
            cspSource: this.panel.webview.cspSource
        };

        const template = WebviewUtils.loadTemplate(
            this.context,
            'markdownPreview/preview.html'
        );

        return WebviewUtils.replaceTemplateVariables(template, templateVariables);
    }

    dispose(): void {
        if (this._pendingSyncTimer) {
            this._syncTimerManager.clearTimeout(this._pendingSyncTimer);
            this._pendingSyncTimer = undefined;
        }
        this._syncTimerManager.dispose();

        MarkdownPreviewWebview._panels.delete(this._previewFilePath);
        if (MarkdownPreviewWebview.currentPanel === this) {
            MarkdownPreviewWebview.currentPanel = undefined;
        }

        if (!MarkdownPreviewWebview._isReplacing) {
            EditorUtils.restoreFocus(this.activeEditor);
        }
    }
}
