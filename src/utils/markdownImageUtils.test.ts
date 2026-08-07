import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    isSkippableImageSrc,
    resolveImagePathToAbsolute,
    resolveMarkdownImagePaths,
    isVscodeResourceUri,
    decodeVscodeResourceUriToPath,
} from './markdownImageUtils';

const MD_DIR = path.join(path.parse(process.cwd()).root, 'repo', 'docs');
/** 模拟 .md 文件完整路径（位于 MD_DIR 下） */
const MD_FILE = path.join(MD_DIR, 'guide.md');

/** 模拟扩展侧 asWebviewUri 的 URI 生成 */
function fakeResolveUri(absPath: string): string {
    return 'vscode-webview-resource://test/' + absPath.replace(/\\/g, '/');
}

describe('markdownImageUtils 工具函数测试', () => {
    describe('isSkippableImageSrc - 跳过判断', () => {
        it('空值、空字符串与锚点应跳过', () => {
            expect(isSkippableImageSrc('')).toBe(true);
            expect(isSkippableImageSrc('   ')).toBe(true);
            expect(isSkippableImageSrc('#section')).toBe(true);
        });

        it('带协议的网络 / data / blob / 资源 URI 应跳过', () => {
            expect(isSkippableImageSrc('https://example.com/a.svg')).toBe(true);
            expect(isSkippableImageSrc('http://example.com/a.svg')).toBe(true);
            expect(isSkippableImageSrc('data:image/svg+xml;base64,xxxx')).toBe(true);
            expect(isSkippableImageSrc('blob:xxxx')).toBe(true);
            expect(isSkippableImageSrc('vscode-resource:/a.svg')).toBe(true);
            expect(isSkippableImageSrc('vscode-webview-resource:/a.svg')).toBe(true);
        });

        it('相对路径不应跳过', () => {
            expect(isSkippableImageSrc('images/foo.svg')).toBe(false);
            expect(isSkippableImageSrc('./foo.svg')).toBe(false);
            expect(isSkippableImageSrc('../foo.svg')).toBe(false);
            expect(isSkippableImageSrc('C:\\foo.svg')).toBe(false);
        });
    });

    describe('resolveImagePathToAbsolute - 路径解析', () => {
        it('相对路径应基于 md 文件所在目录解析', () => {
            expect(resolveImagePathToAbsolute('images/foo.svg', MD_FILE))
                .toBe(path.normalize(path.join(MD_DIR, 'images', 'foo.svg')));
        });

        it('绝对路径应保持原样', () => {
            expect(resolveImagePathToAbsolute('D:/abs/foo.svg', MD_FILE))
                .toBe(path.normalize('D:/abs/foo.svg'));
        });

        it('file:// 前缀应剥去并解析', () => {
            const win = process.platform === 'win32';
            const result = resolveImagePathToAbsolute('file:///C:/foo.svg', MD_FILE);
            expect(result).toBe(path.normalize(win ? 'C:/foo.svg' : '/C:/foo.svg'));
        });

        it('URL 编码的空格应被解码', () => {
            expect(resolveImagePathToAbsolute('images/my%20file.svg', MD_FILE))
                .toBe(path.normalize(path.join(MD_DIR, 'images', 'my file.svg')));
        });
    });

    describe('resolveMarkdownImagePaths - 整体替换', () => {
        it('Markdown 图片语法应替换相对路径', () => {
            const md = '见 ![图](hex-map-generation-guide/offset-axial-map.svg) 所示';
            const out = resolveMarkdownImagePaths(md, MD_FILE, fakeResolveUri);
            expect(out).toContain('vscode-webview-resource://test/');
            expect(out).toContain(path.join('docs', 'hex-map-generation-guide', 'offset-axial-map.svg').replace(/\\/g, '/'));
        });

        it('HTML img 标签应替换相对路径并保留其它属性', () => {
            const md = '<img src="hex-map-generation-guide/offset-axial-map.svg" width="520" alt="offset↔axial 对照" />';
            const out = resolveMarkdownImagePaths(md, MD_FILE, fakeResolveUri);
            expect(out).toBe('<img src="vscode-webview-resource://test/D:/repo/docs/hex-map-generation-guide/offset-axial-map.svg" width="520" alt="offset↔axial 对照" />');
        });

        it('单引号 HTML img 也应替换', () => {
            const md = "<img src='foo.svg' width='100'>";
            const out = resolveMarkdownImagePaths(md, MD_FILE, fakeResolveUri);
            expect(out).toBe("<img src='vscode-webview-resource://test/D:/repo/docs/foo.svg' width='100'>");
        });

        it('远程 URL 与 data URI 不应被替换', () => {
            const md = '![a](https://example.com/a.svg)\n<img src="data:image/svg+xml;base64,xxxx">';
            const out = resolveMarkdownImagePaths(md, MD_FILE, fakeResolveUri);
            expect(out).toBe(md);
        });

        it('同一内容多个本地图片应全部替换', () => {
            const md = '![a](a.svg) 与 ![b](b.png)';
            const out = resolveMarkdownImagePaths(md, MD_FILE, fakeResolveUri);
            expect(out).toContain('docs/a.svg');
            expect(out).toContain('docs/b.png');
        });

        it('URL 编码的空格应解码后再替换', () => {
            const md = '![x](images/my%20file.svg)';
            const out = resolveMarkdownImagePaths(md, MD_FILE, fakeResolveUri);
            expect(out).toContain('docs/images/my file.svg');
        });
    });

    describe('isVscodeResourceUri - webview 资源 URI 识别', () => {
        it('新版 https://file%2B.vscode-resource 形式应识别为资源 URI', () => {
            expect(isVscodeResourceUri('https://file%2B.vscode-resource.vscode-cdn.net/d%3A/work/x.svg')).toBe(true);
            expect(isVscodeResourceUri('https://file+.vscode-resource.vscode-cdn.net/d%3A/work/x.svg')).toBe(true);
        });

        it('vscode-webview-resource 与 vscode-resource scheme 应识别为资源 URI', () => {
            expect(isVscodeResourceUri('vscode-webview-resource://abc/d%3A/work/x.svg')).toBe(true);
            expect(isVscodeResourceUri('vscode-resource://abc/d%3A/work/x.svg')).toBe(true);
        });

        it('普通远程 URL 与 data URI 不应识别为资源 URI', () => {
            expect(isVscodeResourceUri('https://example.com/a.svg')).toBe(false);
            expect(isVscodeResourceUri('http://example.com/a.svg')).toBe(false);
            expect(isVscodeResourceUri('data:image/svg+xml;base64,xxxx')).toBe(false);
            expect(isVscodeResourceUri('images/foo.svg')).toBe(false);
        });
    });

    describe('decodeVscodeResourceUriToPath - 资源 URI 还原为绝对路径', () => {
        it('新版 https 形式应解码出绝对路径', () => {
            expect(decodeVscodeResourceUriToPath('https://file%2B.vscode-resource.vscode-cdn.net/d%3A/work/docs/x.svg'))
                .toBe(path.normalize('D:/work/docs/x.svg'));
        });

        it('vscode-webview-resource 形式应解码出绝对路径', () => {
            expect(decodeVscodeResourceUriToPath('vscode-webview-resource://abc/d%3A/work/x.svg'))
                .toBe(path.normalize('D:/work/x.svg'));
        });

        it('Unix 风格路径应还原为绝对路径', () => {
            expect(decodeVscodeResourceUriToPath('https://file%2B.vscode-resource.vscode-cdn.net/home/user/x.svg'))
                .toBe(path.normalize('/home/user/x.svg'));
        });

        it('URL 编码的空格应被解码', () => {
            expect(decodeVscodeResourceUriToPath('https://file%2B.vscode-resource.vscode-cdn.net/d%3A/work/my%20file.svg'))
                .toBe(path.normalize('D:/work/my file.svg'));
        });

        it('非资源 URI 应返回 undefined', () => {
            expect(decodeVscodeResourceUriToPath('https://example.com/a.svg')).toBeUndefined();
            expect(decodeVscodeResourceUriToPath('images/foo.svg')).toBeUndefined();
            expect(decodeVscodeResourceUriToPath('')).toBeUndefined();
        });
    });
});
