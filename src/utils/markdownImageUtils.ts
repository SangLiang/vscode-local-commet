import * as path from 'path';

/**
 * 将 Markdown 内容中的本地图片路径转换为 webview 可访问的 URI。
 *
 * 自定义 Webview 的 base URL 与工作区无关，直接以相对路径引用的本地图片
 * （`![](images/foo.svg)` 或 `<img src="images/foo.svg">`）无法加载。
 * 本函数把这类路径解析为绝对路径后交给 resolveUri（扩展侧用
 * `webview.asWebviewUri(vscode.Uri.file(absPath))`）生成可加载的 URI。
 *
 * 跳过：http/https/data/blob/vscode-resource 等已有协议、锚点、空路径。
 */

const IGNORED_SCHEMES = [
    'http:',
    'https:',
    'data:',
    'blob:',
    'vscode-resource:',
    'vscode-webview-resource:',
    'mailto:',
    'tel:',
];

/** 无需转换的 src（已有协议 / 锚点 / 空） */
export function isSkippableImageSrc(src: string | undefined): boolean {
    if (!src) {
        return true;
    }
    const trimmed = src.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
        return true;
    }
    const lower = trimmed.toLowerCase();
    return IGNORED_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

/** 解码并解析为绝对路径（支持相对路径、绝对路径与 file:// 前缀） */
export function resolveImagePathToAbsolute(src: string, mdFilePath: string): string {
    let decoded = src;
    try {
        decoded = decodeURIComponent(src);
    } catch {
        decoded = src;
    }

    let filePath = decoded;
    if (filePath.startsWith('file://')) {
        filePath = filePath.slice('file://'.length);
        if (process.platform === 'win32') {
            filePath = filePath.replace(/^\/+/, '');
        } else {
            filePath = filePath.replace(/^\/+/, '/');
        }
    }

    if (path.isAbsolute(filePath)) {
        return path.normalize(filePath);
    }
    return path.normalize(path.resolve(path.dirname(mdFilePath), filePath));
}

function resolveSrc(src: string, mdFilePath: string, resolveUri: (absPath: string) => string): string {
    if (isSkippableImageSrc(src)) {
        return src;
    }
    return resolveUri(resolveImagePathToAbsolute(src, mdFilePath));
}

/**
 * 将 Markdown 中本地图片引用替换为可加载 URI。
 * 支持 `![alt](path)` 与 `<img src="path">` 两种形式；路径可含空格（HTML 形式）。
 */
export function resolveMarkdownImagePaths(
    markdown: string,
    mdFilePath: string,
    resolveUri: (absPath: string) => string
): string {
    if (!markdown || !mdFilePath) {
        return markdown;
    }

    let result = markdown;

    result = result.replace(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (match, src: string) => {
        const resolved = resolveSrc(src, mdFilePath, resolveUri);
        return resolved === src ? match : match.split(src).join(resolved);
    });

    result = result.replace(/(<img[^>]*\bsrc=")([^"]+)("[^>]*>)/gi, (match, prefix: string, src: string, suffix: string) => {
        return prefix + resolveSrc(src, mdFilePath, resolveUri) + suffix;
    });

    result = result.replace(/(<img[^>]*\bsrc=')([^']+)('[^>]*>)/gi, (match, prefix: string, src: string, suffix: string) => {
        return prefix + resolveSrc(src, mdFilePath, resolveUri) + suffix;
    });

    return result;
}
