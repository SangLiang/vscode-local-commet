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

const mockGetConfiguration = vi.hoisted(() =>
  vi.fn((section: string) => ({
    get: vi.fn((key: string, defaultValue: unknown) => {
      if (section === 'local-comment' && key === 'codeHighlight.theme') return 'github-dark';
      if (section === 'local-comment' && key === 'mermaid.theme') return 'default';
      if (section === 'local-comment' && key === 'markdownPreview.fontSize') return 0;
      if (section === 'editor' && key === 'fontSize') return 14;
      return defaultValue;
    }),
  }))
);

// Mock vscode 模块 - 必须在其他 import 之前
vi.mock('vscode', () => ({
  Uri: {
    joinPath: mockJoinPath,
    file: mockFileUri,
  },
  WebviewPanel: {},
  workspace: {
    getConfiguration: mockGetConfiguration,
  },
}));

// Mock fs 模块
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: vi.fn(),
}));

import { WebviewUtils, buildMarkdownPanelResourceOptions, buildMarkdownLocalResourceRoots, postMarkdownPreviewConfig, buildMarkdownScriptTags, buildContextHtml } from './webviewUtils';

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

describe('buildMarkdownPanelResourceOptions', () => {
    beforeEach(() => {
        mockGetConfiguration.mockClear();
    });

    it('默认包含 previewFind.js，customResources 顺序为 public→mermaidInteract→core→previewFind', () => {
        const options = buildMarkdownPanelResourceOptions({
            css: 'markdownInputs/commentInput.css',
            js: 'markdownInputs/commentInput.js',
        });

        expect(options.markedJs).toBe(true);
        expect(options.mermaidJs).toBe(true);
        expect(options.katexJs).toBe(true);
        expect(options.katexCss).toBe(true);
        expect(options.highlightJs).toBe(true);
        expect(options.highlightCss).toBe(true);
        expect(options.highlightTheme).toBe('github-dark');
        expect(options.css).toBe('markdownInputs/commentInput.css');
        expect(options.js).toBe('markdownInputs/commentInput.js');

        const names = options.customResources!.map(r => r.name);
        expect(names).toEqual([
            'publicJsUri',
            'mermaidChartInteractJsUri',
            'markdownRenderCoreJsUri',
            'previewFindJsUri'
        ]);
    });

    it('includePreviewFind=false 时不包含 previewFind，extraCustomResources 追加在末尾', () => {
        const options = buildMarkdownPanelResourceOptions({
            css: 'shareComment/shareComment.css',
            js: 'shareComment/shareComment.js',
            includePreviewFind: false,
            extraCustomResources: [
                { path: 'src/templates/markdownPreview/previewToc.js', name: 'previewTocJsUri' }
            ]
        });

        const names = options.customResources!.map(r => r.name);
        expect(names).toEqual([
            'publicJsUri',
            'mermaidChartInteractJsUri',
            'markdownRenderCoreJsUri',
            'previewTocJsUri'
        ]);
        expect(names).not.toContain('previewFindJsUri');
    });
});

describe('buildMarkdownLocalResourceRoots', () => {
    it('返回 common/src-lib/out-lib + 指定模板目录 + extra', () => {
        const extensionUri = { fsPath: 'D:\\ext', scheme: 'file' } as any;
        const extra = [{ fsPath: 'D:\\ws', scheme: 'file' } as any];

        const roots = buildMarkdownLocalResourceRoots(extensionUri, 'markdownInputs', extra);

        expect(roots).toHaveLength(5);
        expect(roots[0].fsPath).toBe('D:\\ext\\src\\templates\\markdownInputs');
        expect(roots[1].fsPath).toBe('D:\\ext\\src\\templates\\common');
        expect(roots[2].fsPath).toBe('D:\\ext\\src\\lib');
        expect(roots[3].fsPath).toBe('D:\\ext\\out\\lib');
        expect(roots[4].fsPath).toBe('D:\\ws');
    });

    it('不传 extra 时返回 4 个根目录', () => {
        const extensionUri = { fsPath: 'D:\\ext', scheme: 'file' } as any;
        const roots = buildMarkdownLocalResourceRoots(extensionUri, 'shareComment');
        expect(roots).toHaveLength(4);
    });
});

describe('postMarkdownPreviewConfig', () => {
    it('默认发送 mermaid 主题和预览字号（fontSize=0 时回退到 editor.fontSize）', () => {
        const postMessage = vi.fn();
        const webview = { postMessage } as any;

        postMarkdownPreviewConfig(webview);

        const commands = postMessage.mock.calls.map((c: unknown[]) => (c[0] as { command: string }).command);
        expect(commands).toContain('setMermaidTheme');
        expect(commands).toContain('setPreviewFontSize');

        const fontSizeMsg = postMessage.mock.calls.find(
            (c: unknown[]) => (c[0] as { command: string }).command === 'setPreviewFontSize'
        );
        expect((fontSizeMsg![0] as { fontSize: number }).fontSize).toBe(14);
    });

    it('sendAvailableTags=true 时发送 SET_AVAILABLE_TAGS', () => {
        const postMessage = vi.fn();
        const webview = { postMessage } as any;

        postMarkdownPreviewConfig(webview, {
            sendAvailableTags: true,
            availableTagNames: ['tag1', 'tag2']
        });

        const tagsMsg = postMessage.mock.calls.find(
            (c: unknown[]) => (c[0] as { command: string }).command === 'setAvailableTags'
        );
        expect(tagsMsg).toBeDefined();
        expect((tagsMsg![0] as { tagNames: string[] }).tagNames).toEqual(['tag1', 'tag2']);
    });

    it('sendTagSuggestions=true 时发送 UPDATE_TAG_SUGGESTIONS', () => {
        const postMessage = vi.fn();
        const webview = { postMessage } as any;

        postMarkdownPreviewConfig(webview, {
            sendTagSuggestions: true,
            tagSuggestions: '@tag1,@tag2'
        });

        const suggestMsg = postMessage.mock.calls.find(
            (c: unknown[]) => (c[0] as { command: string }).command === 'updateTagSuggestions'
        );
        expect(suggestMsg).toBeDefined();
        expect((suggestMsg![0] as { tagSuggestions: string }).tagSuggestions).toBe('@tag1,@tag2');
    });

    it('不开启开关时不发送 tags 相关消息', () => {
        const postMessage = vi.fn();
        const webview = { postMessage } as any;

        postMarkdownPreviewConfig(webview);

        const commands = postMessage.mock.calls.map((c: unknown[]) => (c[0] as { command: string }).command);
        expect(commands).not.toContain('setAvailableTags');
        expect(commands).not.toContain('updateTagSuggestions');
    });
});

describe('buildMarkdownScriptTags', () => {
    it('默认不生成 previewFind / previewToc 标签', () => {
        const tags = buildMarkdownScriptTags({
            publicJsUri: 'webview://public.js',
            mermaidChartInteractJsUri: 'webview://mermaid.js',
            markdownRenderCoreJsUri: 'webview://core.js',
            previewFindJsUri: 'webview://find.js',
            previewTocJsUri: 'webview://toc.js'
        });

        expect(tags.publicJsScript).toContain('webview://public.js');
        expect(tags.mermaidInteractJsScript).toContain('webview://mermaid.js');
        expect(tags.coreJsScript).toContain('webview://core.js');
        expect(tags.previewFindJsScript).toBe('');
        expect(tags.previewTocJsScript).toBe('');
    });

    it('includePreviewFind=true 时生成 previewFind 标签', () => {
        const tags = buildMarkdownScriptTags(
            {
                publicJsUri: 'webview://public.js',
                mermaidChartInteractJsUri: 'webview://mermaid.js',
                markdownRenderCoreJsUri: 'webview://core.js',
                previewFindJsUri: 'webview://find.js'
            },
            { includePreviewFind: true }
        );

        expect(tags.previewFindJsScript).toContain('webview://find.js');
        expect(tags.previewFindJsScript).toContain('previewFind.js 加载失败');
    });

    it('uri 缺失时对应标签为空字符串', () => {
        const tags = buildMarkdownScriptTags({});

        expect(tags.publicJsScript).toBe('');
        expect(tags.mermaidInteractJsScript).toBe('');
        expect(tags.coreJsScript).toBe('');
        expect(tags.previewFindJsScript).toBe('');
        expect(tags.previewTocJsScript).toBe('');
    });
});

describe('buildContextHtml', () => {
    it('contextInfo 为 undefined 且未开启 showEmptyHint 时返回空字符串', () => {
        expect(buildContextHtml(undefined)).toBe('');
    });

    it('contextInfo 为 undefined 且开启 showEmptyHint 时返回提示', () => {
        const html = buildContextHtml(undefined, { showEmptyHint: true });
        expect(html).toContain('暂无代码上下文信息');
        expect(html).toContain('context-item');
    });

    it('渲染 fileName / lineNumber', () => {
        const html = buildContextHtml({
            fileName: 'main.ts',
            lineNumber: 5
        });
        expect(html).toContain('文件:');
        expect(html).toContain('main.ts');
        expect(html).toContain('行号:');
        expect(html).toContain('第 6 行');
    });

    it('selectedText 优先于 contextLines', () => {
        const html = buildContextHtml({
            selectedText: 'const x = 1',
            contextLines: ['line1', 'line2']
        });
        expect(html).toContain('选中:');
        expect(html).toContain('const x = 1');
        expect(html).not.toContain('代码上下文:');
    });

    it('contextLines 渲染带行号与 target-line 高亮', () => {
        const html = buildContextHtml({
            lineNumber: 2,
            contextStartLine: 1,
            contextLines: ['a', 'b', 'c']
        });
        expect(html).toContain('代码上下文:');
        // 第 2 行（contextStartLine=1, index=1）应为 target-line
        expect(html).toContain('target-line');
        expect(html).toContain('context-line');
        // 行号显示从 contextStartLine+1 开始：2, 3, 4
        expect(html).toContain('>2<');
        expect(html).toContain('>3<');
        expect(html).toContain('>4<');
    });

    it('showSnapshotDiff=true 且 lineContent 与 originalLineContent 不同时显示当前代码对比', () => {
        const html = buildContextHtml({
            contextLines: ['a', 'b'],
            lineContent: 'new code',
            originalLineContent: 'old code'
        }, { showSnapshotDiff: true });
        expect(html).toContain('当前代码:');
        expect(html).toContain('current-code');
        expect(html).toContain('new code');
    });

    it('showSnapshotDiff=false 时不显示当前代码对比', () => {
        const html = buildContextHtml({
            contextLines: ['a', 'b'],
            lineContent: 'new code',
            originalLineContent: 'old code'
        });
        expect(html).not.toContain('当前代码:');
        expect(html).not.toContain('current-code');
    });

    it('showSnapshotDiff=true 且仅有 lineContent（无快照）时显示当前代码（新注释场景）', () => {
        const html = buildContextHtml({
            lineContent: 'new code'
        }, { showSnapshotDiff: true });
        expect(html).toContain('当前代码:');
        expect(html).toContain('new code');
    });

    it('showSnapshotDiff=true 且仅有 originalLineContent（无 contextLines）时显示注释快照', () => {
        const html = buildContextHtml({
            originalLineContent: 'old snapshot'
        }, { showSnapshotDiff: true });
        expect(html).toContain('注释快照:');
        expect(html).toContain('original-code');
        expect(html).toContain('old snapshot');
    });

    it('showSnapshotDiff=true 且 fileNotFound=true 时快照标签为「代码快照 (原文件已删除)」', () => {
        const html = buildContextHtml({
            fileNotFound: true,
            originalLineContent: 'old snapshot'
        }, { showSnapshotDiff: true });
        expect(html).toContain('代码快照 (原文件已删除)');
    });

    it('showFileNotFound=true 且 fileNotFound=true 时显示文件状态与原路径', () => {
        const html = buildContextHtml({
            fileNotFound: true,
            filePath: '/abs/path/file.ts'
        }, { showFileNotFound: true });
        expect(html).toContain('文件状态:');
        expect(html).toContain('原文件已删除或移动');
        expect(html).toContain('原路径:');
        expect(html).toContain('/abs/path/file.ts');
    });

    it('showFileNotFound=false 时不渲染 fileNotFound 分支', () => {
        const html = buildContextHtml({
            fileNotFound: true,
            filePath: '/abs/path/file.ts'
        });
        expect(html).not.toContain('文件状态:');
        expect(html).not.toContain('原文件已删除或移动');
    });
});