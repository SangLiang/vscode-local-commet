import * as vscode from 'vscode';
import * as fs from 'fs';

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

