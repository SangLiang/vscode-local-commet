import { describe, it, expect, vi, beforeEach } from 'vitest';

// 使用 vi.hoisted 来创建可以在 mock 中使用的变量
const mockExistsSync = vi.hoisted(() => vi.fn<(p: string) => boolean>(() => true));

const mockJoinPath = vi.hoisted(() =>
  vi.fn((uri: { fsPath: string }, ...segments: string[]) => ({
    fsPath: [uri.fsPath, ...segments].join('\\'),
  }))
);

const mockFileUri = vi.hoisted(() =>
  vi.fn((fsPath: string) => ({ fsPath }))
);

const mockAsWebviewUri = vi.hoisted(() =>
  vi.fn((uri: { fsPath: string }) => ({ fsPath: uri.fsPath, toString: () => `webview://${uri.fsPath}` }))
);

// Mock vscode 模块 - 必须在其他 import 之前
vi.mock('vscode', () => ({
  Uri: {
    joinPath: mockJoinPath,
    file: mockFileUri,
  },
  WebviewPanel: {},
}));

// Mock fs 模块
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: vi.fn(),
}));

import { WebviewUtils } from './webviewUtils';

describe('WebviewUtils.buildResourceUris 缓存', () => {
    beforeEach(() => {
        mockExistsSync.mockReset();
        mockExistsSync.mockReturnValue(true);
        WebviewUtils.clearLibPathCache();
    });

    it('首次调用会探测 out/lib 是否存在', () => {
        const webview = { asWebviewUri: mockAsWebviewUri } as any;
        const extensionUri = { fsPath: 'D:\\ext', scheme: 'file' } as any;

        WebviewUtils.buildResourceUris(webview, extensionUri, { markedJs: true });

        expect(mockExistsSync).toHaveBeenCalled();
    });

    it('同一进程中第二次调用不再触发 existsSync', () => {
        const webview = { asWebviewUri: mockAsWebviewUri } as any;
        const extensionUri = { fsPath: 'D:\\ext', scheme: 'file' } as any;
        const options = { markedJs: true, mermaidJs: true, katexJs: true, katexCss: true, highlightJs: true, highlightCss: true };

        WebviewUtils.buildResourceUris(webview, extensionUri, options);
        const callCountAfterFirst = mockExistsSync.mock.calls.length;
        expect(callCountAfterFirst).toBeGreaterThan(0);

        WebviewUtils.buildResourceUris(webview, extensionUri, options);

        expect(mockExistsSync.mock.calls.length).toBe(callCountAfterFirst);
    });

    it('主题文件不存在时回退到默认 highlight.min.css', () => {
        mockExistsSync.mockReset();
        // 仅 src/lib/highlight.min.css 存在；out/lib 与主题文件均不存在
        mockExistsSync.mockImplementation((p: string) => p.includes('src') && p.includes('highlight.min.css'));

        const webview = { asWebviewUri: mockAsWebviewUri } as any;
        const extensionUri = { fsPath: 'D:\\ext', scheme: 'file' } as any;

        const uris = WebviewUtils.buildResourceUris(webview, extensionUri, {
            highlightCss: true,
            highlightTheme: 'nonexistent-theme',
        });

        expect(uris.highlightCssUri).toBe('webview://D:\\ext\\src\\lib\\highlight.min.css');
    });
});