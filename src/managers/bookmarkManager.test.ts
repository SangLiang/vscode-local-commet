import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Bookmark, FileBookmarks } from './bookmarkManager';

// Mock 变量
const mockWorkspaceState = vi.hoisted(() => ({
  workspaceFolders: undefined as any,
}));

const mockGlobalState = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

const mockContext = vi.hoisted(() => ({
  globalStorageUri: { fsPath: '/tmp/vscode' },
  extensionPath: '/tmp/extension',
  subscriptions: [] as any[],
  globalState: mockGlobalState,
}));

const mockShowInfo = vi.hoisted(() => vi.fn());
const mockShowWarning = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockCreateOutputChannel = vi.hoisted(() => vi.fn(() => ({
  appendLine: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
})));

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return mockWorkspaceState.workspaceFolders;
    },
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    showInformationMessage: mockShowInfo,
    showWarningMessage: mockShowWarning,
    showErrorMessage: mockShowError,
    createOutputChannel: mockCreateOutputChannel,
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
  },
  EventEmitter: vi.fn(() => ({
    fire: vi.fn(),
    dispose: vi.fn(),
  })),
}));

// Mock fs
const mockExistsSync = vi.hoisted(() => vi.fn(() => false));
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

// Mock path
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    join: vi.fn((...args: string[]) => actual.join(...args)),
    dirname: vi.fn((p: string) => actual.dirname(p)),
    sep: actual.sep,
  };
});

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock storagePathUtils
const mockStoragePaths = vi.hoisted(() => ({
  commentsDir: '/workspace/.vscode/local-comment/comments',
  bookmarksDir: '/workspace/.vscode/local-comment/bookmarks',
  oldCommentsFile: '/tmp/old/comments.json',
  oldBookmarksFile: '/tmp/old/bookmarks.json',
}));

vi.mock('../utils/storagePathUtils', () => ({
  StoragePathUtils: {
    getStoragePaths: vi.fn(() => mockStoragePaths),
    getCurrentBookmarksFile: vi.fn(() => '/workspace/.vscode/local-comment/bookmarks/bookmarks.json'),
    fileExists: vi.fn(() => false),
    ensureNewPathExists: vi.fn(),
    ensureNewStorageInitialized: vi.fn(),
    ensureDirectoryExists: vi.fn(),
    listConfigFiles: vi.fn(() => ['bookmarks.json']),
    loadConfig: vi.fn(() => ({ comments: 'comments.json', bookmarks: 'bookmarks.json' })),
    saveConfig: vi.fn(),
    isWritePermissionError: vi.fn(() => false),
  },
}));

import { BookmarkManager } from './bookmarkManager';

describe('BookmarkManager 书签管理器测试', () => {
  let bookmarkManager: BookmarkManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceState.workspaceFolders = [{
      uri: { fsPath: '/workspace/project' },
      name: 'project',
      index: 0,
    }];
    mockExistsSync.mockReturnValue(false);
    mockGlobalState.get.mockReturnValue(false);
    bookmarkManager = new BookmarkManager(mockContext as any);
  });

  afterEach(() => {
    bookmarkManager.dispose();
  });

  describe('constructor - 构造函数', () => {
    /**
     * 测试目标: 使用上下文创建实例
     * 功能: 验证 BookmarkManager 实例可以正常创建
     */
    it('应该使用 context 创建实例', () => {
      expect(bookmarkManager).toBeDefined();
      expect(bookmarkManager.getAllBookmarks).toBeDefined();
    });

    /**
     * 测试目标: 无书签文件时初始化为空
     * 功能: 当存储文件不存在时，书签列表为空
     */
    it('当没有书签文件时应该初始化为空书签列表', () => {
      mockExistsSync.mockReturnValue(false);
      const newManager = new BookmarkManager(mockContext as any);
      const bookmarks = newManager.getAllBookmarks();
      expect(bookmarks).toEqual({});
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      newManager.dispose();
    });
  });

  describe('addBookmark - 添加书签', () => {
    /**
     * 测试目标: 添加书签到指定文件
     * 功能: 在指定文件的指定行添加书签
     */
    it('应该添加书签到指定文件', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].line).toBe(10);
      expect(bookmarks[0].filePath).toBe('/workspace/project/src/file.ts');
    });

    /**
     * 测试目标: 同一行不重复添加
     * 功能: 防止在同一文件的同一行创建重复书签
     */
    it('对于同一行不应该添加重复的书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);
      await bookmarkManager.addBookmark(uri, 10);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(1);
    });

    /**
     * 测试目标: 同一文件不同行添加多个书签
     * 功能: 在同一文件的不同行可以添加多个书签
     */
    it('应该允许在同一文件的不同行添加多个书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);
      await bookmarkManager.addBookmark(uri, 20);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(2);
    });
  });

  describe('removeBookmark - 删除书签', () => {
    /**
     * 测试目标: 按行号删除书签
     * 功能: 删除指定文件指定行的书签
     */
    it('应该根据行号删除书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);
      await bookmarkManager.addBookmark(uri, 20);

      await bookmarkManager.removeBookmark(uri, 10);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].line).toBe(20);
    });

    /**
     * 测试目标: 删除不存在的书签
     * 功能: 尝试删除不存在的位置的书签时无错误
     */
    it('删除不存在的书签时应该正常处理', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.removeBookmark(uri, 999);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(0);
    });
  });

  describe('toggleBookmark - 切换书签', () => {
    /**
     * 测试目标: 不存在时添加书签
     * 功能: 当指定位置没有书签时，toggle 会添加书签
     */
    it('当书签不存在时应该添加书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.toggleBookmark(uri, 10);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(1);
    });

    /**
     * 测试目标: 存在时删除书签
     * 功能: 当指定位置已有书签时，toggle 会删除该书签
     */
    it('当书签存在时应该删除书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);
      await bookmarkManager.toggleBookmark(uri, 10);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(0);
    });
  });

  describe('getBookmarks - 获取文件书签', () => {
    /**
     * 测试目标: 无书签时返回空数组
     * 功能: 获取没有书签的文件时返回空数组
     */
    it('对于没有书签的文件应该返回空数组', () => {
      const uri = { fsPath: '/workspace/project/src/nonexistent.ts' } as any;
      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toEqual([]);
    });

    /**
     * 测试目标: 返回文件的所有书签
     * 功能: 获取指定文件的所有书签列表
     */
    it('应该返回指定文件的所有书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);
      await bookmarkManager.addBookmark(uri, 20);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(2);
      expect(bookmarks[0].line).toBe(10);
      expect(bookmarks[1].line).toBe(20);
    });
  });

  describe('getAllBookmarks - 获取所有书签', () => {
    /**
     * 测试目标: 返回跨文件的所有书签
     * 功能: 获取所有文件的书签，按文件路径组织
     */
    it('应该返回所有文件的书签', async () => {
      const uri1 = { fsPath: '/workspace/project/src/file1.ts' } as any;
      const uri2 = { fsPath: '/workspace/project/src/file2.ts' } as any;

      await bookmarkManager.addBookmark(uri1, 10);
      await bookmarkManager.addBookmark(uri2, 20);

      const allBookmarks = bookmarkManager.getAllBookmarks();
      expect(Object.keys(allBookmarks)).toHaveLength(2);
    });

    /**
     * 测试目标: 无书签时返回空对象
     * 功能: 没有任何书签时返回空对象
     */
    it('当没有书签时应该返回空对象', () => {
      const allBookmarks = bookmarkManager.getAllBookmarks();
      expect(allBookmarks).toEqual({});
    });
  });

  describe('clearFileBookmarks - 清空文件书签', () => {
    /**
     * 测试目标: 清空指定文件的所有书签
     * 功能: 删除指定文件的所有书签并显示成功消息
     */
    it('应该清空指定文件的所有书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);
      await bookmarkManager.addBookmark(uri, 20);

      await bookmarkManager.clearFileBookmarks(uri);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      expect(bookmarks).toHaveLength(0);
      expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining('已清除'));
    });

    /**
     * 测试目标: 清空无书签的文件时显示提示
     * 功能: 尝试清空没有书签的文件时显示提示信息
     */
    it('清空没有书签的文件时应该显示提示', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.clearFileBookmarks(uri);

      expect(mockShowInfo).toHaveBeenCalledWith('该文件没有书签');
    });
  });

  describe('clearAllBookmarks - 清空所有书签', () => {
    /**
     * 测试目标: 清空整个项目的所有书签
     * 功能: 删除所有文件的所有书签并显示成功消息
     */
    it('应该清空所有书签', async () => {
      const uri1 = { fsPath: '/workspace/project/src/file1.ts' } as any;
      const uri2 = { fsPath: '/workspace/project/src/file2.ts' } as any;

      await bookmarkManager.addBookmark(uri1, 10);
      await bookmarkManager.addBookmark(uri2, 20);

      await bookmarkManager.clearAllBookmarks();

      const allBookmarks = bookmarkManager.getAllBookmarks();
      expect(allBookmarks).toEqual({});
      expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining('已清除'));
    });

    /**
     * 测试目标: 无书签时显示提示
     * 功能: 尝试清空但项目中没有书签时显示提示信息
     */
    it('当没有书签时应该显示提示', async () => {
      await bookmarkManager.clearAllBookmarks();
      expect(mockShowInfo).toHaveBeenCalledWith('项目中没有书签');
    });
  });

  describe('removeBookmarkById - 按ID删除书签', () => {
    /**
     * 测试目标: 根据ID删除书签
     * 功能: 使用书签的唯一标识符删除该书签
     */
    it('应该根据ID删除书签', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await bookmarkManager.addBookmark(uri, 10);

      const bookmarks = bookmarkManager.getBookmarks(uri);
      const bookmarkId = bookmarks[0].id;

      await bookmarkManager.removeBookmarkById(bookmarkId);

      const remaining = bookmarkManager.getBookmarks(uri);
      expect(remaining).toHaveLength(0);
    });

    /**
     * 测试目标: 删除不存在的ID
     * 功能: 尝试删除不存在的书签ID时正常处理
     */
    it('删除不存在的ID时应该正常处理', async () => {
      await bookmarkManager.removeBookmarkById('non-existent-id');
      expect(mockShowInfo).not.toHaveBeenCalled();
    });
  });

  describe('getProjectInfo - 获取项目信息', () => {
    /**
     * 测试目标: 获取工作区项目信息
     * 功能: 返回项目名称、路径和存储文件路径
     */
    it('当存在工作区时应该返回项目信息', () => {
      const info = bookmarkManager.getProjectInfo();
      expect(info.name).toBe('project');
      expect(info.path).toBe('/workspace/project');
      expect(info.storageFile).toBeDefined();
    });

    /**
     * 测试目标: 无工作区时返回未知项目
     * 功能: 当没有工作区时返回默认的"未知项目"信息
     */
    it('当没有工作区时应该返回"未知项目"', () => {
      mockWorkspaceState.workspaceFolders = undefined;
      const newManager = new BookmarkManager(mockContext as any);
      const info = newManager.getProjectInfo();
      expect(info.name).toBe('未知项目');
    });
  });

  describe('listAvailableBookmarksConfigs - 列出可用配置', () => {
    /**
     * 测试目标: 获取可用的配置文件列表
     * 功能: 返回书签目录下的所有配置文件名
     */
    it('应该返回可用的配置文件列表', () => {
      const configs = bookmarkManager.listAvailableBookmarksConfigs();
      expect(configs).toContain('bookmarks.json');
    });

    /**
     * 测试目标: 无工作区时返回空数组
     * 功能: 当没有工作区时返回空数组
     */
    it('当没有工作区时应该返回空数组', () => {
      mockWorkspaceState.workspaceFolders = undefined;
      const newManager = new BookmarkManager(mockContext as any);
      const configs = newManager.listAvailableBookmarksConfigs();
      expect(configs).toEqual([]);
    });
  });

  describe('getCurrentBookmarksConfig - 获取当前配置', () => {
    /**
     * 测试目标: 获取当前使用的配置名
     * 功能: 返回当前书签配置文件的名称
     */
    it('应该返回当前的配置文件名', () => {
      const config = bookmarkManager.getCurrentBookmarksConfig();
      expect(config).toBe('bookmarks.json');
    });

    /**
     * 测试目标: 无工作区时返回默认值
     * 功能: 当没有工作区时返回"default"
     */
    it('当没有工作区时应该返回默认值', () => {
      mockWorkspaceState.workspaceFolders = undefined;
      const newManager = new BookmarkManager(mockContext as any);
      const config = newManager.getCurrentBookmarksConfig();
      expect(config).toBe('default');
    });
  });
});
