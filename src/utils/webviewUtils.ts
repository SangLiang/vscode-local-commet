import * as vscode from 'vscode';
import * as fs from 'fs';
import { IPC_MESSAGES } from '../constants';

/**
 * 资源 URI 构建选项
 */
export interface ResourceUriOptions {
    markedJs?: boolean;      // 是否需要 marked.js
    css?: string;            // CSS 文件相对路径（相对于 templates 目录）
    js?: string;             // JS 文件相对路径（相对于 templates 目录）
    mermaidJs?: boolean;     // 是否需要 mermaid.js
    katexJs?: boolean;       // 是否需要 katex.js
    katexCss?: boolean;     // 是否需要 katex.css
    highlightJs?: boolean;   // 是否需要 highlight.js
    highlightCss?: boolean;  // 是否需要 highlight.js CSS
    highlightTheme?: string;  // highlight.js 主题名称（如 'github-dark', 'vs2015' 等）
    customResources?: Array<{ path: string; name: string }>; // 自定义资源
}

/**
 * 构建的资源 URI 对象
 */
export interface ResourceUris {
    markedJsUri?: string;
    cssUri?: string;
    jsUri?: string;
    mermaidJsUri?: string;
    katexJsUri?: string;
    katexCssUri?: string;
    highlightJsUri?: string;
    highlightCssUri?: string;
    [key: string]: string | undefined; // 支持自定义资源
}

/**
 * Webview 工具类，提供统一的 HTML 模板处理功能
 */
export class WebviewUtils {
    // 模板缓存，避免重复读取文件
    private static templateCache: Map<string, string> = new Map();

    // lib 文件路径探测缓存，避免重复 existsSync（键：extensionUri.fsPath + '\\' + 文件名）
    private static libPathCache: Map<string, string> = new Map();

    /**
     * 解析 lib 文件路径：优先 out/lib，其次 src/lib，结果缓存避免重复探测
     * @returns 解析出的 Uri；out/lib 与 src/lib 均不存在时返回 undefined
     */
    private static resolveLibPath(extensionUri: vscode.Uri, fileName: string): vscode.Uri | undefined {
        const cacheKey = `${extensionUri.fsPath}\\${fileName}`;
        const cached = this.libPathCache.get(cacheKey);
        if (cached !== undefined) {
            return cached === '' ? undefined : vscode.Uri.file(cached);
        }

        let resolved: vscode.Uri | undefined;
        const outPath = vscode.Uri.joinPath(extensionUri, 'out', 'lib', fileName);
        if (fs.existsSync(outPath.fsPath)) {
            resolved = outPath;
        } else {
            const srcPath = vscode.Uri.joinPath(extensionUri, 'src', 'lib', fileName);
            if (fs.existsSync(srcPath.fsPath)) {
                resolved = srcPath;
            }
        }

        this.libPathCache.set(cacheKey, resolved ? resolved.fsPath : '');
        return resolved;
    }

    /**
     * 解析 lib 文件路径，文件不存在时回退到 src/lib（保持原 resolveLibPath 语义）
     */
    private static resolveLibPathOrSrc(extensionUri: vscode.Uri, fileName: string): vscode.Uri {
        return this.resolveLibPath(extensionUri, fileName)
            ?? vscode.Uri.joinPath(extensionUri, 'src', 'lib', fileName);
    }

    /**
     * 生成 CSP nonce（32字符的随机字符串）
     */
    public static getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * HTML 转义函数
     */
    public static escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 统一构建资源 URI
     * @param webview Webview 对象
     * @param extensionUri 扩展 URI
     * @param options 资源选项
     * @returns 资源 URI 对象
     */
    public static buildResourceUris(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
        options: ResourceUriOptions = {}
    ): ResourceUris {
        const uris: ResourceUris = {};

        // 构建 marked.js URI
        if (options.markedJs) {
            // 优先从 out/lib 加载（打包后的位置），如果不存在则从 src/lib 加载（开发环境）
            const markedJsPath = this.resolveLibPathOrSrc(extensionUri, 'marked.min.js');
            uris.markedJsUri = webview.asWebviewUri(markedJsPath).toString();
        }

        // 构建 CSS URI
        if (options.css) {
            const cssPath = vscode.Uri.joinPath(extensionUri, 'src', 'templates', options.css);
            uris.cssUri = webview.asWebviewUri(cssPath).toString();
        }

        // 构建 JS URI
        if (options.js) {
            const jsPath = vscode.Uri.joinPath(extensionUri, 'src', 'templates', options.js);
            uris.jsUri = webview.asWebviewUri(jsPath).toString();
        }

        // 构建 mermaid.js URI
        if (options.mermaidJs) {
            // 优先从 out/lib 加载（打包后的位置），如果不存在则从 src/lib 加载（开发环境）
            const mermaidJsPath = this.resolveLibPathOrSrc(extensionUri, 'mermaid.min.js');
            uris.mermaidJsUri = webview.asWebviewUri(mermaidJsPath).toString();
        }

        // 构建 katex.js URI
        if (options.katexJs) {
            // 优先从 out/lib 加载（打包后的位置），如果不存在则从 src/lib 加载（开发环境）
            const katexJsPath = this.resolveLibPathOrSrc(extensionUri, 'katex.min.js');
            uris.katexJsUri = webview.asWebviewUri(katexJsPath).toString();
        }

        // 构建 katex.css URI
        if (options.katexCss) {
            // 优先从 out/lib 加载（打包后的位置），如果不存在则从 src/lib 加载（开发环境）
            const katexCssPath = this.resolveLibPathOrSrc(extensionUri, 'katex.min.css');
            uris.katexCssUri = webview.asWebviewUri(katexCssPath).toString();
        }

        // 构建 highlight.js URI
        if (options.highlightJs) {
            // 优先从 out/lib 加载（打包后的位置），如果不存在则从 src/lib 加载（开发环境）
            const highlightJsPath = this.resolveLibPathOrSrc(extensionUri, 'highlight.min.js');
            uris.highlightJsUri = webview.asWebviewUri(highlightJsPath).toString();
        }

        // 构建 highlight.css URI
        if (options.highlightCss) {
            // 根据主题名称构建 CSS 文件名
            const themeName = options.highlightTheme || 'github-dark';
            const cssFileName = `${themeName}.min.css`;

            // 优先使用主题文件（out/lib → src/lib），不存在则回退到默认的 highlight.min.css
            const highlightCssPath = this.resolveLibPath(extensionUri, cssFileName)
                ?? this.resolveLibPathOrSrc(extensionUri, 'highlight.min.css');

            uris.highlightCssUri = webview.asWebviewUri(highlightCssPath).toString();
        }

        // 构建自定义资源 URI
        if (options.customResources) {
            for (const resource of options.customResources) {
                const resourcePath = vscode.Uri.joinPath(extensionUri, resource.path);
                uris[resource.name] = webview.asWebviewUri(resourcePath).toString();
            }
        }

        return uris;
    }

    /**
     * 加载模板文件（带缓存）
     * @param context 扩展上下文
     * @param templatePath 模板文件相对路径（相对于 src/templates 目录）
     * @param useCache 是否使用缓存（默认 true）
     * @returns 模板内容
     */
    public static loadTemplate(
        context: vscode.ExtensionContext,
        templatePath: string,
        useCache: boolean = true
    ): string {
        const cacheKey = templatePath;

        // 如果使用缓存且缓存中有，直接返回
        if (useCache && this.templateCache.has(cacheKey)) {
            return this.templateCache.get(cacheKey)!;
        }

        // 读取模板文件
        const fullPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'templates', templatePath);
        const content = fs.readFileSync(fullPath.fsPath, 'utf8');

        // 如果使用缓存，保存到缓存中
        if (useCache) {
            this.templateCache.set(cacheKey, content);
        }

        return content;
    }

    /**
     * 替换模板变量
     * 支持 ${variableName} 格式的变量替换
     * @param template 模板内容
     * @param variables 变量对象
     * @returns 替换后的模板内容
     */
    public static replaceTemplateVariables(
        template: string,
        variables: Record<string, string>
    ): string {
        return template.replace(/\${(\w+)}/g, (match, key: string) => {
            return variables[key] !== undefined ? variables[key] : '';
        });
    }

    /**
     * 清除模板缓存（可选，用于开发调试）
     */
    public static clearTemplateCache(): void {
        this.templateCache.clear();
    }

    /**
     * 清除 lib 路径探测缓存（可选，用于开发调试）
     */
    public static clearLibPathCache(): void {
        this.libPathCache.clear();
    }
}

/**
 * Markdown 面板（注释输入 / .md 预览 / 共享预览）共享的资源 options 构造参数。
 */
export interface MarkdownPanelResourceOptions {
    /** 模板相对路径，如 'markdownInputs/commentInput.css' */
    css: string;
    /** 模板相对路径，如 'markdownInputs/commentInput.js' */
    js: string;
    /** 是否包含 previewFind.js（注释输入页与 .md 预览页需要，共享预览页不需要）。默认 true */
    includePreviewFind?: boolean;
    /** 额外的自定义资源（追加在公共资源之后），如 .md 预览页的 previewToc.js */
    extraCustomResources?: Array<{ path: string; name: string }>;
}

/**
 * 构造 Markdown 面板通用的 buildResourceUris 入参。
 * 三处 Markdown Webview（注释输入 / .md 预览 / 共享预览）共用此 helper，
 * 仅 css/js 路径与是否需要 previewFind / previewToc 等差异通过 opts 控制。
 */
export function buildMarkdownPanelResourceOptions(
    opts: MarkdownPanelResourceOptions
): ResourceUriOptions {
    const includePreviewFind = opts.includePreviewFind !== false;
    const customResources: Array<{ path: string; name: string }> = [
        { path: 'src/templates/common/public.js', name: 'publicJsUri' },
        { path: 'src/templates/common/mermaidChartInteract.js', name: 'mermaidChartInteractJsUri' },
        { path: 'src/templates/common/markdownRenderCore.js', name: 'markdownRenderCoreJsUri' }
    ];
    if (includePreviewFind) {
        customResources.push({ path: 'src/templates/markdownPreview/previewFind.js', name: 'previewFindJsUri' });
    }
    if (opts.extraCustomResources) {
        customResources.push(...opts.extraCustomResources);
    }

    const config = vscode.workspace.getConfiguration('local-comment');
    const highlightTheme = config.get<string>('codeHighlight.theme', 'github-dark');

    return {
        markedJs: true,
        css: opts.css,
        js: opts.js,
        mermaidJs: true,
        katexJs: true,
        katexCss: true,
        highlightJs: true,
        highlightCss: true,
        highlightTheme,
        customResources
    };
}

/**
 * 构造 Markdown 面板通用的 localResourceRoots 列表。
 * @param extensionUri 扩展 URI
 * @param templateDir 模板目录名（如 'markdownInputs' / 'markdownPreview' / 'shareComment'）
 * @param extra 追加的 resource roots（如 .md 预览页的 workspace / 文件目录，
 *             或注释输入页需要复用 markdownPreview 目录下的 previewFind.js）
 */
export function buildMarkdownLocalResourceRoots(
    extensionUri: vscode.Uri,
    templateDir: string,
    extra: vscode.Uri[] = []
): vscode.Uri[] {
    return [
        vscode.Uri.joinPath(extensionUri, 'src', 'templates', templateDir),
        vscode.Uri.joinPath(extensionUri, 'src', 'templates', 'common'),
        vscode.Uri.joinPath(extensionUri, 'src', 'lib'),
        vscode.Uri.joinPath(extensionUri, 'out', 'lib'),
        ...extra
    ];
}

/**
 * postMarkdownPreviewConfig 的可选行为开关。
 */
export interface MarkdownPreviewConfigOptions {
    /** 是否发送可用标签白名单（SET_AVAILABLE_TAGS） */
    sendAvailableTags?: boolean;
    /** 可用标签名列表；sendAvailableTags 为 true 时必传 */
    availableTagNames?: string[];
    /** 是否发送标签建议（UPDATE_TAG_SUGGESTIONS），仅注释输入页需要 */
    sendTagSuggestions?: boolean;
    /** 标签建议字符串（如 '@tag1,@tag2'）；sendTagSuggestions 为 true 时必传 */
    tagSuggestions?: string;
}

/**
 * 向 Markdown 面板推送通用配置：mermaid 主题、预览字号、可用标签白名单、标签建议。
 * 三处 Markdown Webview 的 setTimeout(0, ...) 配置推送块共用此 helper。
 */
export function postMarkdownPreviewConfig(
    webview: vscode.Webview,
    opts: MarkdownPreviewConfigOptions = {}
): void {
    const config = vscode.workspace.getConfiguration('local-comment');

    webview.postMessage({
        command: IPC_MESSAGES.SET_MERMAID_THEME,
        theme: config.get<string>('mermaid.theme', 'default')
    });

    const previewFontSize = config.get<number>('markdownPreview.fontSize', 0);
    const fontSize = previewFontSize === 0
        ? vscode.workspace.getConfiguration('editor').get<number>('fontSize', 14)
        : previewFontSize;
    webview.postMessage({
        command: IPC_MESSAGES.SET_PREVIEW_FONT_SIZE,
        fontSize
    });

    if (opts.sendAvailableTags) {
        webview.postMessage({
            command: IPC_MESSAGES.SET_AVAILABLE_TAGS,
            tagNames: opts.availableTagNames ?? []
        });
    }

    if (opts.sendTagSuggestions && opts.tagSuggestions !== undefined) {
        webview.postMessage({
            command: IPC_MESSAGES.UPDATE_TAG_SUGGESTIONS,
            tagSuggestions: opts.tagSuggestions
        });
    }
}

/**
 * buildMarkdownScriptTags 的可选开关。
 */
export interface MarkdownScriptTagsOptions {
    /** 是否生成 previewFind.js 的 script 标签。默认 false */
    includePreviewFind?: boolean;
    /** 是否生成 previewToc.js 的 script 标签（仅 .md 预览页需要）。默认 false */
    includePreviewToc?: boolean;
}

/**
 * Markdown 面板通用的 <script> 标签拼接结果。
 */
export interface MarkdownScriptTags {
    publicJsScript: string;
    mermaidInteractJsScript: string;
    coreJsScript: string;
    previewFindJsScript: string;
    previewTocJsScript: string;
}

/**
 * 根据 resourceUris 拼接 Markdown 面板共用的 <script> 标签字符串。
 * 三处 getMarkdownWebviewContent / getWebviewContent / getShareCommentWebviewContent 共用。
 */
export function buildMarkdownScriptTags(
    resourceUris: ResourceUris,
    opts: MarkdownScriptTagsOptions = {}
): MarkdownScriptTags {
    const script = (uri: string | undefined, label: string): string =>
        uri ? `<script src="${uri}" onerror="console.error('${label} 加载失败')"></script>` : '';

    return {
        publicJsScript: script(resourceUris.publicJsUri, 'public.js'),
        mermaidInteractJsScript: script(resourceUris.mermaidChartInteractJsUri, 'mermaidChartInteract.js'),
        coreJsScript: script(resourceUris.markdownRenderCoreJsUri, 'markdownRenderCore.js'),
        previewFindJsScript: opts.includePreviewFind ? script(resourceUris.previewFindJsUri, 'previewFind.js') : '',
        previewTocJsScript: opts.includePreviewToc ? script(resourceUris.previewTocJsUri, 'previewToc.js') : ''
    };
}

/**
 * 代码上下文信息（注释输入页 / 共享预览页共用结构）。
 * 字段与原 markdownWebview.ts / shareCommentWebview.ts 内联类型保持一致。
 */
export interface ContextInfoLike {
    fileName?: string;
    lineNumber?: number;
    lineContent?: string;
    originalLineContent?: string;
    selectedText?: string;
    contextLines?: string[];
    contextStartLine?: number;
    fileNotFound?: boolean;
    filePath?: string;
}

/**
 * buildContextHtml 的可选行为开关。
 */
export interface BuildContextHtmlOptions {
    /** 是否渲染「原文件已删除/移动」分支（注释输入页 true，共享预览页 false）。默认 false */
    showFileNotFound?: boolean;
    /** 是否渲染代码快照 / 当前代码对比分支（注释输入页 true，共享预览页 false）。默认 false */
    showSnapshotDiff?: boolean;
    /** 无 contextInfo 时是否渲染「暂无代码上下文信息」提示（注释输入页 true，共享预览页 false）。默认 false */
    showEmptyHint?: boolean;
}

/**
 * 构建代码上下文信息的内层 HTML（不含外层 context-info / context-title / tab 壳）。
 * 注释输入页与共享预览页共用此 helper，差异通过 opts 控制。
 *
 * - 注释输入页：showFileNotFound / showSnapshotDiff / showEmptyHint 均为 true
 * - 共享预览页：三者均为 false（默认），仅渲染 fileName / lineNumber / selectedText / contextLines
 */
export function buildContextHtml(
    contextInfo: ContextInfoLike | undefined,
    opts: BuildContextHtmlOptions = {}
): string {
    const showFileNotFound = opts.showFileNotFound === true;
    const showSnapshotDiff = opts.showSnapshotDiff === true;
    const showEmptyHint = opts.showEmptyHint === true;

    if (!contextInfo) {
        return showEmptyHint
            ? '<div class="context-item"><span class="context-label">提示:</span><span class="context-value">暂无代码上下文信息</span></div>'
            : '';
    }

    let html = '';

    if (showFileNotFound && contextInfo.fileNotFound) {
        html += `<div class="context-item file-not-found">
            <span class="context-label">文件状态:</span>
            <span class="context-value">原文件已删除或移动</span>
        </div>`;
        if (contextInfo.filePath) {
            html += `<div class="context-item">
                <span class="context-label">原路径:</span>
                <span class="context-value">${WebviewUtils.escapeHtml(contextInfo.filePath)}</span>
            </div>`;
        }
    }

    if (contextInfo.fileName) {
        html += `<div class="context-item">
            <span class="context-label">文件:</span>
            <span class="context-value">${WebviewUtils.escapeHtml(contextInfo.fileName)}</span>
        </div>`;
    }

    if (contextInfo.lineNumber !== undefined) {
        html += `<div class="context-item">
            <span class="context-label">行号:</span>
            <span class="context-value">第 ${contextInfo.lineNumber + 1} 行</span>
        </div>`;
    }

    if (contextInfo.selectedText) {
        html += `<div class="context-item">
            <span class="context-label">选中:</span>
            <div class="context-value">
                <div class="code-preview">${WebviewUtils.escapeHtml(contextInfo.selectedText)}</div>
            </div>
        </div>`;
    } else if (contextInfo.contextLines && contextInfo.contextLines.length > 0) {
        html += `<div class="context-item">
            <span class="context-label">代码上下文:</span>
            <div class="context-value">
                <div class="code-context-preview">`;

        contextInfo.contextLines.forEach((line, index) => {
            const currentLineNumber = (contextInfo.contextStartLine || 0) + index;
            const isTargetLine = currentLineNumber === contextInfo.lineNumber;
            const lineClass = isTargetLine ? 'target-line' : 'context-line';
            const lineNumberDisplay = currentLineNumber + 1;

            html += `<div class="code-line ${lineClass}">
                <span class="line-number">${lineNumberDisplay}</span>
                <span class="line-content">${WebviewUtils.escapeHtml(line)}</span>
            </div>`;
        });

        html += `    </div>
            </div>
        </div>`;

        // 如果当前代码与快照不同，额外显示当前代码（仅注释输入页）
        if (showSnapshotDiff && contextInfo.lineContent && contextInfo.lineContent !== contextInfo.originalLineContent) {
            html += `<div class="context-item">
                <span class="context-label">当前代码:</span>
                <div class="context-value">
                    <div class="code-preview current-code">${WebviewUtils.escapeHtml(contextInfo.lineContent)}</div>
                </div>
            </div>`;
        }
    } else if (showSnapshotDiff && contextInfo.lineContent && !contextInfo.originalLineContent) {
        // 如果没有快照但有当前内容，显示当前内容（新注释场景）
        html += `<div class="context-item">
            <span class="context-label">当前代码:</span>
            <div class="context-value">
                <div class="code-preview current-code">${WebviewUtils.escapeHtml(contextInfo.lineContent)}</div>
            </div>
        </div>`;
    } else if (showSnapshotDiff && contextInfo.originalLineContent && !contextInfo.contextLines) {
        // 注释无法匹配到代码时，只显示注释保存的代码快照
        const snapshotLabel = contextInfo.fileNotFound ? '代码快照 (原文件已删除)' : '注释快照';
        html += `<div class="context-item">
            <span class="context-label">${snapshotLabel}:</span>
            <div class="context-value">
                <div class="code-preview original-code">${WebviewUtils.escapeHtml(contextInfo.originalLineContent)}</div>
            </div>
        </div>`;
    }

    return html;
}

