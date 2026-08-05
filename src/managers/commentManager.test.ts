import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import type { LocalComment, SharedComment, FileComments } from './commentManager';

// Mock 变量
const mockWorkspaceState = vi.hoisted(() => ({
  workspaceFolders: undefined as any,
  textDocuments: [] as any[],
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

const mockExecuteCommand = vi.hoisted(() => vi.fn());

const mockGetConfiguration = vi.hoisted(() => vi.fn(() => ({
  get: vi.fn((key: string) => {
    if (key === 'server.apiUrl') return 'http://127.0.0.1:8000';
    return undefined;
  }),
  update: vi.fn(),
})));

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return mockWorkspaceState.workspaceFolders;
    },
    get textDocuments() {
      return mockWorkspaceState.textDocuments;
    },
    getConfiguration: mockGetConfiguration,
    openTextDocument: vi.fn(() => ({
      lineAt: vi.fn((line: number) => ({
        text: `line ${line} content`,
      })),
      lineCount: 100,
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    showInformationMessage: mockShowInfo,
    showWarningMessage: mockShowWarning,
    showErrorMessage: mockShowError,
    createOutputChannel: mockCreateOutputChannel,
    showTextDocument: vi.fn(),
  },
  commands: {
    executeCommand: mockExecuteCommand,
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
  },
  EventEmitter: vi.fn(() => ({
    fire: vi.fn(),
    dispose: vi.fn(),
    event: vi.fn(),
  })),
  Selection: vi.fn((startLine, startChar, endLine, endChar) => ({
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
    isEmpty: startLine === endLine && startChar === endChar,
  })),
  Position: vi.fn((line, character) => ({ line, character })),
  Range: vi.fn((start, end) => ({ start, end })),
  TextEditorRevealType: {
    InCenter: 2,
  },
}));

// Mock fs
const mockExistsSync = vi.hoisted(() => vi.fn(() => false));
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockPromisesWriteFile = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  promises: {
    writeFile: mockPromisesWriteFile,
  },
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

// Mock crypto
vi.mock('crypto', () => ({
  randomBytes: vi.fn(() => ({ toString: vi.fn(() => 'random123') })),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock timerUtils
vi.mock('../utils/timerUtils', () => ({
  TimerManager: vi.fn(() => ({
    setTimeout: vi.fn((fn: Function) => {
      fn();
      return 'timeout-id';
    }),
    clearTimeout: vi.fn(),
    dispose: vi.fn(),
  })),
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
    getCurrentCommentsFile: vi.fn(() => '/workspace/.vscode/local-comment/comments/comments.json'),
    fileExists: vi.fn(() => false),
    ensureNewPathExists: vi.fn(),
    ensureDirectoryExists: vi.fn(),
    listConfigFiles: vi.fn(() => ['comments.json']),
    loadConfig: vi.fn(() => ({ comments: 'comments.json', bookmarks: 'bookmarks.json' })),
    saveConfig: vi.fn(),
    isWritePermissionError: vi.fn(() => false),
  },
}));

// Mock commentMatcher
const mockBatchMatchComments = vi.hoisted(() => vi.fn(() => new Map()));
vi.mock('./commentMatcher', () => ({
  CommentMatcher: vi.fn(() => ({
    batchMatchComments: mockBatchMatchComments,
    batchMatchCommentsWithFullSearch: mockBatchMatchComments,
    batchMatchCommentsForLargeChanges: mockBatchMatchComments,
  })),
}));

const mockApiGet = vi.hoisted(() => vi.fn());
vi.mock('../apiService', () => ({
  apiService: { get: mockApiGet },
  ApiRoutes: {
    comment: {
      getProjectSharedComments: (projectId: number) => `/comment-shared/project/${projectId}`,
    },
  },
}));

import { CommentManager } from './commentManager';

const TEST_FILE = path.normalize('/workspace/project/src/file.ts');

function countAllComments(comments: FileComments): number {
  return Object.values(comments).reduce((sum, list) => sum + list.length, 0);
}

function createManagerFromStorage(storage: {
  comments?: FileComments;
  shareComments?: FileComments;
}): CommentManager {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify({
    comments: storage.comments ?? {},
    shareComments: storage.shareComments ?? {},
  }));
  return new CommentManager(mockContext as any);
}

function makeSharedComment(overrides: Partial<SharedComment> = {}): SharedComment {
  return {
    id: 'shared-1',
    line: 5,
    content: 'shared content',
    timestamp: 1,
    originalLine: 5,
    lineContent: 'const foo = 1',
    userId: 'user-1',
    ...overrides,
  };
}

function makeImportPayload(comments: FileComments): string {
  return JSON.stringify({
    comments,
    projectInfo: { name: 'import-project' },
    exportTime: '2026-01-01',
  });
}

describe('CommentManager 注释管理器测试', () => {
  let commentManager: CommentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceState.workspaceFolders = [{
      uri: { fsPath: '/workspace/project' },
      name: 'project',
      index: 0,
    }];
    mockExistsSync.mockReturnValue(false);
    mockGlobalState.get.mockReturnValue(false);
    commentManager = new CommentManager(mockContext as any);
  });

  afterEach(() => {
    commentManager.dispose();
  });

  describe('constructor - 构造函数', () => {
    /**
     * 测试目标: 使用上下文创建实例
     * 功能: 验证 CommentManager 实例可以正常创建，并包含必要的方法
     */
    it('应该使用 context 创建实例', () => {
      expect(commentManager).toBeDefined();
      expect(commentManager.getAllComments).toBeDefined();
      expect(commentManager.commentMatcher).toBeDefined();
    });

    /**
     * 测试目标: 无注释文件时初始化为空
     * 功能: 当存储文件不存在时，注释列表为空对象
     */
    it('当没有注释文件时应该初始化为空注释列表', () => {
      mockExistsSync.mockReturnValue(false);
      const newManager = new CommentManager(mockContext as any);
      const comments = newManager.getAllComments();
      expect(Object.keys(comments)).toHaveLength(0);
    });
  });

  describe('addComment - 添加注释', () => {
    /**
     * 测试目标: 添加注释到指定文件
     * 功能: 在指定文件的指定行添加注释内容
     */
    it('应该添加注释到指定文件', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Test comment');

      const comments = commentManager.getAllComments();
      expect(Object.keys(comments)).toHaveLength(1);
      expect(comments['/workspace/project/src/file.ts']).toHaveLength(1);
      expect(comments['/workspace/project/src/file.ts'][0].content).toBe('Test comment');
      expect(comments['/workspace/project/src/file.ts'][0].line).toBe(10);
    });

    /**
     * 测试目标: 同一行本地注释替换
     * 功能: 同一文件的同一行只能有一个本地注释，新注释会替换旧的
     */
    it('同一行的本地注释应该被替换', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'First comment');
      await commentManager.addComment(uri, 10, 'Second comment');

      const comments = commentManager.getAllComments();
      expect(comments['/workspace/project/src/file.ts']).toHaveLength(1);
      expect(comments['/workspace/project/src/file.ts'][0].content).toBe('Second comment');
    });
  });

  describe('editComment - 编辑注释', () => {
    /**
     * 测试目标: 编辑注释内容
     * 功能: 根据注释ID更新注释内容
     */
    it('应该编辑注释内容', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Original comment');

      const comments = commentManager.getAllComments();
      const commentId = comments['/workspace/project/src/file.ts'][0].id;

      await commentManager.editComment(uri, commentId, 'Edited comment');

      const updatedComments = commentManager.getAllComments();
      expect(updatedComments['/workspace/project/src/file.ts'][0].content).toBe('Edited comment');
    });

    /**
     * 测试目标: 编辑不存在的注释时显示警告
     * 功能: 尝试编辑不存在的注释ID时显示警告信息
     */
    it('编辑不存在的注释时应该显示警告', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.editComment(uri, 'non-existent-id', 'New content');

      expect(mockShowWarning).toHaveBeenCalledWith('该文件没有本地注释');
    });
  });

  describe('removeComment - 删除注释', () => {
    /**
     * 测试目标: 按行号删除注释
     * 功能: 删除指定文件指定行的所有本地注释
     */
    it('应该根据行号删除注释', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Comment 1');
      await commentManager.addComment(uri, 20, 'Comment 2');

      await commentManager.removeComment(uri, 10);

      const comments = commentManager.getAllComments();
      expect(comments['/workspace/project/src/file.ts']).toHaveLength(1);
      expect(comments['/workspace/project/src/file.ts'][0].line).toBe(20);
    });

    /**
     * 测试目标: 删除不存在的注释时显示警告
     * 功能: 尝试删除没有注释的行时显示警告信息
     */
    it('删除不存在的注释时应该显示警告', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.removeComment(uri, 999);

      expect(mockShowWarning).toHaveBeenCalledWith(expect.stringContaining('没有本地注释'));
    });
  });

  describe('removeCommentById - 按ID删除注释', () => {
    /**
     * 测试目标: 根据ID删除注释
     * 功能: 使用注释的唯一标识符删除该注释
     */
    it('应该根据ID删除注释', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Test comment');

      const comments = commentManager.getAllComments();
      const commentId = comments['/workspace/project/src/file.ts'][0].id;

      await commentManager.removeCommentById(uri, commentId);

      const remaining = commentManager.getAllComments();
      // 当文件的所有注释都被删除后，该文件的键也会被删除
      expect(remaining['/workspace/project/src/file.ts']).toBeUndefined();
    });
  });

  describe('getLocalCommentAtLine - 获取指定行的本地注释', () => {
    /**
     * 测试目标: 获取指定行的本地注释
     * 功能: 返回特定文件特定行的本地注释（不包括共享注释）
     */
    it('应该返回指定行的本地注释', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Line 10 comment');
      await commentManager.addComment(uri, 20, 'Line 20 comment');

      const comment = commentManager.getLocalCommentAtLine('/workspace/project/src/file.ts', 10);
      expect(comment).toBeDefined();
      expect(comment?.content).toBe('Line 10 comment');
    });

    /**
     * 测试目标: 无注释行返回 undefined
     * 功能: 当指定行没有注释时返回 undefined
     */
    it('对于没有注释的行应该返回 undefined', async () => {
      const comment = commentManager.getLocalCommentAtLine('/workspace/project/src/file.ts', 999);
      expect(comment).toBeUndefined();
    });

    /**
     * 测试目标: 无注释文件返回 undefined
     * 功能: 当文件没有任何注释时返回 undefined
     */
    it('对于没有注释的文件应该返回 undefined', () => {
      const comment = commentManager.getLocalCommentAtLine('/nonexistent/file.ts', 10);
      expect(comment).toBeUndefined();
    });
  });

  describe('getCommentById - 根据ID获取注释', () => {
    /**
     * 测试目标: 根据ID获取注释
     * 功能: 使用注释ID查找并返回该注释
     */
    it('应该根据ID返回注释', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Test comment');

      const comments = commentManager.getAllComments();
      const commentId = comments['/workspace/project/src/file.ts'][0].id;

      const comment = commentManager.getCommentById(uri, commentId);
      expect(comment).toBeDefined();
      expect(comment?.id).toBe(commentId);
    });

    /**
     * 测试目标: 不存在的ID返回 undefined
     * 功能: 当注释ID不存在时返回 undefined
     */
    it('对于不存在的ID应该返回 undefined', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      const comment = commentManager.getCommentById(uri, 'non-existent');
      expect(comment).toBeUndefined();
    });
  });

  describe('clearFileComments - 清空文件注释', () => {
    /**
     * 测试目标: 清空指定文件的所有注释
     * 功能: 删除指定文件的所有注释
     */
    it('应该清空指定文件的所有注释', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Comment 1');
      await commentManager.addComment(uri, 20, 'Comment 2');

      await commentManager.clearFileComments(uri);

      const comments = commentManager.getAllComments();
      expect(Object.keys(comments)).toHaveLength(0);
    });

    /**
     * 测试目标: 清空无注释文件时显示警告
     * 功能: 尝试清空没有注释的文件时显示警告信息
     */
    it('清空没有注释的文件时应该显示警告', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.clearFileComments(uri);

      expect(mockShowWarning).toHaveBeenCalledWith('该文件没有本地注释');
    });
  });

  describe('getProjectInfo - 获取项目信息', () => {
    /**
     * 测试目标: 获取工作区项目信息
     * 功能: 返回项目名称、路径和存储文件路径
     */
    it('当存在工作区时应该返回项目信息', () => {
      const info = commentManager.getProjectInfo();
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
      const newManager = new CommentManager(mockContext as any);
      const info = newManager.getProjectInfo();
      expect(info.name).toBe('未知项目');
    });
  });

  describe('listAvailableCommentsConfigs - 列出可用配置', () => {
    /**
     * 测试目标: 获取可用的配置文件列表
     * 功能: 返回注释目录下的所有配置文件名
     */
    it('应该返回可用的配置文件列表', () => {
      const configs = commentManager.listAvailableCommentsConfigs();
      expect(configs).toContain('comments.json');
    });

    /**
     * 测试目标: 无工作区时返回空数组
     * 功能: 当没有工作区时返回空数组
     */
    it('当没有工作区时应该返回空数组', () => {
      mockWorkspaceState.workspaceFolders = undefined;
      const newManager = new CommentManager(mockContext as any);
      const configs = newManager.listAvailableCommentsConfigs();
      expect(configs).toEqual([]);
    });
  });

  describe('getCurrentCommentsConfig - 获取当前配置', () => {
    /**
     * 测试目标: 获取当前使用的配置名
     * 功能: 返回当前注释配置文件的名称
     */
    it('应该返回当前的配置文件名', () => {
      const config = commentManager.getCurrentCommentsConfig();
      expect(config).toBe('comments.json');
    });

    /**
     * 测试目标: 无工作区时返回默认值
     * 功能: 当没有工作区时返回"default"
     */
    it('当没有工作区时应该返回默认值', () => {
      mockWorkspaceState.workspaceFolders = undefined;
      const newManager = new CommentManager(mockContext as any);
      const config = newManager.getCurrentCommentsConfig();
      expect(config).toBe('default');
    });
  });

  describe('findCommentIndex - 查找注释索引', () => {
    /**
     * 测试目标: 在数组中查找注释的索引
     * 功能: 根据注释ID在注释数组中查找其索引位置
     */
    it('应该在数组中找到注释的索引', async () => {
      const uri = { fsPath: '/workspace/project/src/file.ts' } as any;
      await commentManager.addComment(uri, 10, 'Test comment');

      const comments = commentManager.getAllComments();
      const commentId = comments['/workspace/project/src/file.ts'][0].id;

      const index = commentManager.findCommentIndex(
        comments['/workspace/project/src/file.ts'],
        commentId
      );
      expect(index).toBe(0);
    });

    /**
     * 测试目标: 不存在的注释返回 -1
     * 功能: 当注释ID在数组中不存在时返回 -1
     */
    it('对于不存在的注释应该返回 -1', () => {
      const index = commentManager.findCommentIndex([], 'non-existent');
      expect(index).toBe(-1);
    });
  });

  describe('handleSharedCommentsByAuthStatus - 处理共享注释认证状态', () => {
    it('当未登录时应该清除所有共享注释', async () => {
      const manager = createManagerFromStorage({
        shareComments: { [TEST_FILE]: [makeSharedComment()] },
      });

      await manager.handleSharedCommentsByAuthStatus(false);

      expect(Object.keys(manager.getAllSharedComments())).toHaveLength(0);
      manager.dispose();
    });

    it('当已登录时不应清除共享注释', async () => {
      const manager = createManagerFromStorage({
        shareComments: { [TEST_FILE]: [makeSharedComment()] },
      });

      await manager.handleSharedCommentsByAuthStatus(true);

      expect(countAllComments(manager.getAllSharedComments() as FileComments)).toBe(1);
      manager.dispose();
    });
  });

  describe('clearAllSharedComments - 清空所有共享注释', () => {
    it('应该清空所有共享注释并返回删除数量', async () => {
      const manager = createManagerFromStorage({
        shareComments: {
          [TEST_FILE]: [makeSharedComment()],
          '/workspace/project/src/other.ts': [makeSharedComment({ id: 'shared-2' })],
        },
      });

      const removed = await manager.clearAllSharedComments();

      expect(removed).toBe(2);
      expect(Object.keys(manager.getAllSharedComments())).toHaveLength(0);
      manager.dispose();
    });
  });

  describe('clearFileSharedComments - 清空文件共享注释', () => {
    it('应该清空指定文件的共享注释', async () => {
      const manager = createManagerFromStorage({
        shareComments: { [TEST_FILE]: [makeSharedComment()] },
      });
      const storedFile = Object.keys(manager.getAllSharedComments())[0];
      const uri = { fsPath: storedFile } as any;

      const removed = await manager.clearFileSharedComments(uri);

      expect(removed).toBe(1);
      expect(countAllComments(manager.getAllSharedComments() as FileComments)).toBe(0);
      manager.dispose();
    });

    it('文件无共享注释时应该显示警告', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      const removed = await commentManager.clearFileSharedComments(uri);

      expect(removed).toBe(0);
      expect(mockShowWarning).toHaveBeenCalledWith('该文件没有共享注释');
    });
  });

  describe('addCommentFromShared - 共享注释转本地', () => {
    it('应该将共享注释添加为本地注释', async () => {
      await commentManager.addCommentFromShared(
        TEST_FILE,
        5,
        'from shared',
        'const foo = 1',
        5,
        true
      );

      const local = commentManager.getLocalCommentAtLine(TEST_FILE, 5);
      expect(local?.content).toBe('from shared');
      expect(local?.lineContent).toBe('const foo = 1');
      expect(local?.isShared).toBe(false);
    });
  });

  describe('getComments - 智能匹配查询', () => {
    it('文档未打开时应该返回空数组', async () => {
      mockWorkspaceState.textDocuments = [];
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'hidden until open');

      const result = commentManager.getComments(uri);

      expect(result).toEqual([]);
    });

    it('匹配成功时应该返回注释并更新行号', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'matched comment');
      const commentId = commentManager.getAllComments()[TEST_FILE][0].id;

      mockWorkspaceState.textDocuments = [{
        uri: { fsPath: TEST_FILE },
        lineCount: 100,
        lineAt: vi.fn((line: number) => ({ text: `line ${line} content` })),
      }];
      mockBatchMatchComments.mockReturnValue(new Map([[commentId, 12]]));

      const result = commentManager.getComments(uri);

      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(12);
      expect(result[0].isMatched).toBe(true);
    });

    it('第 0 行注释无需匹配也应返回', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 0, 'file header comment');
      mockWorkspaceState.textDocuments = [{
        uri: { fsPath: TEST_FILE },
        lineCount: 100,
        lineAt: vi.fn((line: number) => ({ text: `line ${line} content` })),
      }];
      mockBatchMatchComments.mockReturnValue(new Map());

      const result = commentManager.getComments(uri);

      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(0);
    });
  });

  describe('handleDocumentChange / handleDocumentSave - 智能匹配事件', () => {
    it('Git 场景（无键盘活动）应该触发批量匹配', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'git scenario');
      const document = {
        uri: { fsPath: TEST_FILE },
        lineCount: 100,
        lineAt: vi.fn((line: number) => ({ text: `line ${line} content` })),
      };
      mockBatchMatchComments.mockReturnValue(new Map());

      await commentManager.handleDocumentChange(
        { document, contentChanges: [] } as any,
        false
      );

      expect(mockBatchMatchComments).toHaveBeenCalled();
    });

    it('文档保存时应该根据匹配结果更新注释行号', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'save scenario');
      const commentId = commentManager.getAllComments()[TEST_FILE][0].id;
      const document = {
        uri: { fsPath: TEST_FILE },
        lineCount: 100,
        lineAt: vi.fn((line: number) => ({ text: `line ${line} content` })),
      };
      mockBatchMatchComments.mockReturnValue(new Map([[commentId, 15]]));

      await commentManager.handleDocumentSave(document as any);

      expect(commentManager.getAllComments()[TEST_FILE][0].line).toBe(15);
    });
  });

  describe('exportComments - 导出注释', () => {
    it('应该将注释写入导出文件', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'export me');

      const success = await commentManager.exportComments('/tmp/export/comments.json');

      expect(success).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();
      const written = mockWriteFileSync.mock.calls.find(
        (call) => call[0] === '/tmp/export/comments.json'
      );
      expect(written).toBeDefined();
      const payload = JSON.parse(written![1] as string);
      expect(countAllComments(payload.comments)).toBe(1);
    });
  });

  describe('validateImportFile - 校验导入文件', () => {
    it('文件不存在时应该返回无效', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await commentManager.validateImportFile('/tmp/missing.json');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('文件不存在');
    });

    it('格式正确时应该返回统计信息', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(makeImportPayload({
        [TEST_FILE]: [{
          id: 'imp-1',
          line: 1,
          content: 'imported',
          timestamp: 1,
          originalLine: 1,
          lineContent: 'code',
        }],
      }));

      const result = await commentManager.validateImportFile('/tmp/import.json');

      expect(result.valid).toBe(true);
      expect(result.fileCount).toBe(1);
      expect(result.commentCount).toBe(1);
      expect(result.projectName).toBe('import-project');
    });
  });

  describe('analyzeImportPaths - 分析导入路径', () => {
    it('应该分析公共基础路径', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(makeImportPayload({
        'src/a.ts': [],
        'src/b.ts': [],
      }));

      const result = await commentManager.analyzeImportPaths('/tmp/import.json');

      expect(result.success).toBe(true);
      expect(result.filePaths).toEqual(['src/a.ts', 'src/b.ts']);
      expect(result.commonBasePath).toBe('src/');
    });
  });

  describe('importComments - 导入注释', () => {
    it('merge 模式应该合并新注释', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 1, 'existing');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(makeImportPayload({
        '/workspace/project/src/new.ts': [{
          id: 'new-1',
          line: 2,
          content: 'new comment',
          timestamp: 2,
          originalLine: 2,
          lineContent: 'new line',
        }],
      }));

      const result = await commentManager.importComments('/tmp/import.json', 'merge');

      expect(result.success).toBe(true);
      expect(result.importedComments).toBe(1);
      expect(countAllComments(commentManager.getAllComments())).toBe(2);
    });

    it('replace 模式应该替换现有注释', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 1, 'to be replaced');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(makeImportPayload({
        '/workspace/project/src/replaced.ts': [{
          id: 'rep-1',
          line: 3,
          content: 'replaced',
          timestamp: 3,
          originalLine: 3,
          lineContent: 'line',
        }],
      }));

      const result = await commentManager.importComments('/tmp/import.json', 'replace');

      expect(result.success).toBe(true);
      expect(countAllComments(commentManager.getAllComments())).toBe(1);
      const onlyComment = Object.values(commentManager.getAllComments())[0][0];
      expect(onlyComment.content).toBe('replaced');
    });
  });

  describe('getProjectSharedComments - 项目共享同步', () => {
    it('API 返回数据时应该保存到本地共享注释', async () => {
      mockApiGet.mockResolvedValue([{
        id: 101,
        file_path: TEST_FILE,
        project_id: 1,
        is_public: true,
        user_id: 9,
        username: 'tester',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        content: {
          id: 'c-101',
          line: 4,
          content: 'cloud shared',
          timestamp: 1,
          originalLine: 4,
          lineContent: 'cloud line',
        },
      }]);
      mockExistsSync.mockReturnValue(true);

      const result = await commentManager.getProjectSharedComments(1);

      expect(result).toHaveLength(1);
      expect(countAllComments(commentManager.getAllSharedComments() as FileComments)).toBe(1);
      const saved = Object.values(commentManager.getAllSharedComments())[0][0];
      expect(saved.content).toBe('cloud shared');
    });

    it('API 失败时应该返回 null', async () => {
      mockApiGet.mockRejectedValue(new Error('network error'));

      const result = await commentManager.getProjectSharedComments(1);

      expect(result).toBeNull();
      expect(mockShowError).toHaveBeenCalled();
    });
  });

  describe('getStorageFilePath - 获取存储文件路径', () => {
    /**
     * 测试目标: 获取存储文件路径
     * 功能: 返回当前使用的注释存储文件的完整路径
     */
    it('应该返回存储文件路径', () => {
      const path = commentManager.getStorageFilePath();
      expect(path).toBeDefined();
      expect(typeof path).toBe('string');
    });
  });

  describe('getContext - 获取扩展上下文', () => {
    /**
     * 测试目标: 获取扩展上下文
     * 功能: 返回创建 CommentManager 时传入的 VS Code 扩展上下文
     */
    it('应该返回扩展上下文', () => {
      const context = commentManager.getContext();
      expect(context).toBe(mockContext);
    });
  });

  describe('updateCommentLine - 更新注释行号', () => {
    /**
     * 测试目标: 正常更新注释行号和行内容
     * 功能: 根据注释ID更新其行号、行内容和时间戳
     */
    it('应该更新注释的行号和行内容', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'Test comment');
      const commentId = commentManager.getAllComments()[TEST_FILE][0].id;

      await commentManager.updateCommentLine(uri, commentId, 20, 'new line content');

      const comments = commentManager.getAllComments()[TEST_FILE];
      expect(comments[0].line).toBe(20);
      expect(comments[0].lineContent).toBe('new line content');
      expect(comments[0].timestamp).toBeGreaterThan(0);
    });

    /**
     * 测试目标: 文件无本地注释时显示警告
     * 功能: 当文件没有本地注释时，显示警告消息并返回
     */
    it('文件没有本地注释时应该显示警告', async () => {
      const uri = { fsPath: '/workspace/project/src/nonexistent.ts' } as any;

      await commentManager.updateCommentLine(uri, 'non-existent-id', 5, 'content');

      expect(mockShowWarning).toHaveBeenCalledWith('该文件没有本地注释');
    });

    /**
     * 测试目标: 找不到指定注释时显示警告
     * 功能: 当注释ID不存在时，显示警告消息并返回
     */
    it('找不到指定注释时应该显示警告', async () => {
      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'Test comment');

      await commentManager.updateCommentLine(uri, 'non-existent-id', 5, 'content');

      expect(mockShowWarning).toHaveBeenCalledWith('找不到指定的注释');
    });
  });

  describe('getAllComments - 获取所有注释（含合并逻辑）', () => {
    /**
     * 测试目标: 只有本地注释时正确返回
     * 功能: 当只有本地注释时，返回本地注释数据
     */
    it('只有本地注释时应该正确返回', () => {
      const manager = createManagerFromStorage({
        comments: {
          [TEST_FILE]: [{
            id: 'local-1',
            line: 10,
            content: 'local comment',
            timestamp: 1,
            originalLine: 10,
            lineContent: 'code',
            isShared: false,
          }],
        },
      });

      const allComments = manager.getAllComments();

      expect(Object.keys(allComments)).toHaveLength(1);
      expect(allComments[TEST_FILE]).toHaveLength(1);
      expect(allComments[TEST_FILE][0].content).toBe('local comment');
      manager.dispose();
    });

    /**
     * 测试目标: 只有共享注释时正确返回
     * 功能: 当只有共享注释时，返回共享注释数据
     */
    it('只有共享注释时应该正确返回', () => {
      const manager = createManagerFromStorage({
        shareComments: {
          [TEST_FILE]: [{
            id: 'shared-1',
            line: 5,
            content: 'shared comment',
            timestamp: 1,
            originalLine: 5,
            lineContent: 'shared code',
            userId: 'user-1',
          }],
        },
      });

      const allComments = manager.getAllComments();

      expect(Object.keys(allComments)).toHaveLength(1);
      expect(allComments[TEST_FILE]).toHaveLength(1);
      expect(allComments[TEST_FILE][0].content).toBe('shared comment');
      manager.dispose();
    });

    /**
     * 测试目标: 本地注释和共享注释同时存在时正确合并
     * 功能: 返回本地注释和共享注释的合并结果
     */
    it('本地和共享注释同时存在时应该正确合并', () => {
      const manager = createManagerFromStorage({
        comments: {
          [TEST_FILE]: [{
            id: 'local-1',
            line: 10,
            content: 'local comment',
            timestamp: 1,
            originalLine: 10,
            lineContent: 'local code',
            isShared: false,
          }],
        },
        shareComments: {
          [TEST_FILE]: [{
            id: 'shared-1',
            line: 5,
            content: 'shared comment',
            timestamp: 1,
            originalLine: 5,
            lineContent: 'shared code',
            userId: 'user-1',
          }],
        },
      });

      const allComments = manager.getAllComments();

      expect(allComments[TEST_FILE]).toHaveLength(2);
      const localComment = allComments[TEST_FILE].find(c => c.id === 'local-1');
      const sharedComment = allComments[TEST_FILE].find(c => c.id === 'shared-1');
      expect(localComment).toBeDefined();
      expect(sharedComment).toBeDefined();
      expect(sharedComment).toHaveProperty('userId');
      expect(localComment).not.toHaveProperty('userId');
      manager.dispose();
    });

    /**
     * 测试目标: 共享注释中包含非SharedComment类型时过滤
     * 功能: 通过 'userId' 属性过滤，只保留有效的SharedComment
     */
    it('共享注释中包含无效数据时应该过滤', () => {
      const manager = createManagerFromStorage({
        shareComments: {
          [TEST_FILE]: [
            {
              id: 'valid-shared',
              line: 5,
              content: 'valid shared comment',
              timestamp: 1,
              originalLine: 5,
              lineContent: 'code',
              userId: 'user-1',
            },
            {
              id: 'invalid-no-userid',
              line: 6,
              content: 'invalid comment without userId',
              timestamp: 1,
              originalLine: 6,
              lineContent: 'code',
            } as any,
          ],
        },
      });

      const allComments = manager.getAllComments();

      expect(allComments[TEST_FILE]).toHaveLength(1);
      expect(allComments[TEST_FILE][0].id).toBe('valid-shared');
      manager.dispose();
    });

    /**
     * 测试目标: 多文件时获取所有注释
     * 功能: 正确返回所有文件路径的注释并集
     */
    it('多文件时应该返回所有文件的注释并集', () => {
      const file1 = path.normalize('/workspace/project/src/file1.ts');
      const file2 = path.normalize('/workspace/project/src/file2.ts');
      const manager = createManagerFromStorage({
        comments: {
          [file1]: [{
            id: 'local-1',
            line: 1,
            content: 'file1 local',
            timestamp: 1,
            originalLine: 1,
            lineContent: 'code',
            isShared: false,
          }],
        },
        shareComments: {
          [file2]: [{
            id: 'shared-1',
            line: 2,
            content: 'file2 shared',
            timestamp: 1,
            originalLine: 2,
            lineContent: 'code',
            userId: 'user-1',
          }],
        },
      });

      const allComments = manager.getAllComments();

      expect(Object.keys(allComments)).toHaveLength(2);
      expect(allComments[file1]).toBeDefined();
      expect(allComments[file2]).toBeDefined();
      manager.dispose();
    });
  });

  describe('migrateOldData - 迁移旧数据', () => {
    /**
     * 测试目标: 正常迁移流程
     * 功能: 当旧文件存在时，迁移数据到新路径
     */
    it('应该迁移旧数据到新路径', async () => {
      const { StoragePathUtils } = await import('../utils/storagePathUtils');

      // 模拟旧文件存在
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        comments: {
          [TEST_FILE]: [{
            id: 'migrated-1',
            line: 5,
            content: 'migrated comment',
            timestamp: 1,
            originalLine: 5,
            lineContent: 'code',
            isShared: false,
          }],
        },
        shareComments: {},
      }));

      await commentManager.migrateOldData();

      // 验证写入新路径
      expect(mockWriteFileSync).toHaveBeenCalled();
      // 验证显示迁移成功消息
      expect(mockShowInfo).toHaveBeenCalledWith('注释数据已迁移到项目本地存储 (.vscode/local-comment/)');

      // 重置 mock
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(false);
    });

    /**
     * 测试目标: 权限不足时显示错误
     * 功能: 当写入新路径权限不足时，显示错误消息
     */
    it('权限不足时应该显示错误消息', async () => {
      const { StoragePathUtils } = await import('../utils/storagePathUtils');

      // 模拟权限错误
      vi.mocked(StoragePathUtils.ensureNewPathExists).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      vi.mocked(StoragePathUtils.isWritePermissionError).mockReturnValue(true);

      await commentManager.migrateOldData();

      expect(mockShowError).toHaveBeenCalledWith('迁移失败：无法写入 .vscode/local-comment（只读或权限不足）');

      // 重置 mock
      vi.mocked(StoragePathUtils.ensureNewPathExists).mockImplementation(() => {});
      vi.mocked(StoragePathUtils.isWritePermissionError).mockReturnValue(false);
    });

    /**
     * 测试目标: 无工作区时提前返回
     * 功能: 当没有工作区时，方法应该提前返回并显示警告
     */
    it('无工作区时应该提前返回', async () => {
      mockWorkspaceState.workspaceFolders = [];
      const newManager = new CommentManager(mockContext as any);

      await newManager.migrateOldData();

      // 无工作区时会显示"没有打开的工作区"警告
      expect(mockShowWarning).toHaveBeenCalledWith('没有打开的工作区');
      newManager.dispose();
    });
  });

  describe('saveComments - 保存注释（含权限回退）', () => {
    /**
     * 测试目标: 权限不足时回退到旧路径保存
     * 功能: 当写入新路径权限不足时，尝试写入旧路径
     */
    it('权限不足时应该回退到旧路径保存', async () => {
      const { StoragePathUtils } = await import('../utils/storagePathUtils');

      // 模拟权限错误但旧路径存在
      vi.mocked(StoragePathUtils.ensureNewPathExists).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      vi.mocked(StoragePathUtils.isWritePermissionError).mockReturnValue(true);
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(true);

      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'test comment');

      // 重置 mock
      vi.mocked(StoragePathUtils.ensureNewPathExists).mockImplementation(() => {});
      vi.mocked(StoragePathUtils.isWritePermissionError).mockReturnValue(false);
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(false);

      // 验证保存被调用（即使回退到旧路径）
      expect(mockPromisesWriteFile).toHaveBeenCalled();
    });

    /**
     * 测试目标: 旧路径也不存在时显示错误
     * 功能: 当新路径和旧路径都无法写入时，显示权限错误
     */
    it('新旧路径都无法写入时应该显示错误消息', async () => {
      const { StoragePathUtils } = await import('../utils/storagePathUtils');

      // 模拟权限错误且旧路径不存在
      vi.mocked(StoragePathUtils.ensureNewPathExists).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      vi.mocked(StoragePathUtils.isWritePermissionError).mockReturnValue(true);
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(false);

      const uri = { fsPath: TEST_FILE } as any;
      await commentManager.addComment(uri, 10, 'test comment');

      expect(mockShowError).toHaveBeenCalledWith('无法写入项目目录（只读或权限不足），请检查 .vscode 目录权限');

      // 重置 mock
      vi.mocked(StoragePathUtils.ensureNewPathExists).mockImplementation(() => {});
      vi.mocked(StoragePathUtils.isWritePermissionError).mockReturnValue(false);
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(false);
    });
  });

  describe('switchCommentsConfig - 切换注释配置', () => {
    /**
     * 测试目标: 正常切换到存在的配置文件
     * 功能: 当配置文件存在时，正常加载并切换
     */
    it('配置文件存在时应该正常切换', async () => {
      const { StoragePathUtils } = await import('../utils/storagePathUtils');

      // 配置文件存在
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(true);

      await commentManager.switchCommentsConfig('new-config.json');

      expect(mockShowInfo).toHaveBeenCalledWith('已切换到注释配置: new-config.json');

      // 重置 mock
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(false);
    });

    /**
     * 测试目标: 配置文件不存在时创建新配置
     * 功能: 当配置文件不存在时，用户选择创建应该创建新文件
     */
    it('配置文件不存在时选择创建应该创建新文件', async () => {
      const { StoragePathUtils } = await import('../utils/storagePathUtils');

      // 配置文件不存在
      vi.mocked(StoragePathUtils.fileExists).mockImplementation((filePath) => {
        if (filePath && filePath.includes('nonexistent.json')) return false;
        return true;
      });
      mockShowWarning.mockResolvedValue('创建');

      await commentManager.switchCommentsConfig('nonexistent.json');

      expect(mockShowWarning).toHaveBeenCalledWith(
        '配置文件不存在: nonexistent.json\n是否创建新的配置文件？',
        '创建',
        '取消'
      );
      expect(mockPromisesWriteFile).toHaveBeenCalled();

      // 重置 mock
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(false);
    });

    /**
     * 测试目标: 配置文件不存在时取消创建
     * 功能: 当配置文件不存在时，用户选择取消应该提前返回
     */
    it('配置文件不存在时选择取消应该提前返回', async () => {
      const { StoragePathUtils } = await import('../utils/storagePathUtils');

      // 配置文件不存在
      vi.mocked(StoragePathUtils.fileExists).mockImplementation((filePath) => {
        if (filePath && filePath.includes('nonexistent.json')) return false;
        return true;
      });
      mockShowWarning.mockResolvedValue('取消');

      await commentManager.switchCommentsConfig('nonexistent.json');

      expect(mockShowWarning).toHaveBeenCalled();
      expect(mockShowInfo).not.toHaveBeenCalledWith('已切换到注释配置: nonexistent.json');

      // 重置 mock
      vi.mocked(StoragePathUtils.fileExists).mockReturnValue(false);
    });

    /**
     * 测试目标: 无工作区时提前返回
     * 功能: 当没有工作区时，方法应该提前返回并显示警告
     */
    it('无工作区时应该提前返回', async () => {
      mockWorkspaceState.workspaceFolders = [];
      const newManager = new CommentManager(mockContext as any);

      await newManager.switchCommentsConfig('test.json');

      // 无工作区时会显示"没有打开的工作区"警告
      expect(mockShowWarning).toHaveBeenCalledWith('没有打开的工作区');
      newManager.dispose();
    });
  });

  describe('getAllSharedComments - 获取所有共享注释（含过滤）', () => {
    /**
     * 测试目标: 正确过滤返回SharedComment类型
     * 功能: 只返回包含 'userId' 属性的共享注释
     */
    it('应该只返回包含userId的共享注释', () => {
      const manager = createManagerFromStorage({
        shareComments: {
          [TEST_FILE]: [
            {
              id: 'valid-shared',
              line: 5,
              content: 'valid shared comment',
              timestamp: 1,
              originalLine: 5,
              lineContent: 'code',
              userId: 'user-1',
            },
            {
              id: 'invalid-no-userid',
              line: 6,
              content: 'invalid comment without userId',
              timestamp: 1,
              originalLine: 6,
              lineContent: 'code',
            } as any,
          ],
        },
      });

      const sharedComments = manager.getAllSharedComments();

      expect(Object.keys(sharedComments)).toHaveLength(1);
      expect(sharedComments[TEST_FILE]).toHaveLength(1);
      expect(sharedComments[TEST_FILE][0].id).toBe('valid-shared');
      expect(sharedComments[TEST_FILE][0].userId).toBe('user-1');
      manager.dispose();
    });

    /**
     * 测试目标: 无有效共享注释时返回空对象
     * 功能: 当所有共享注释都被过滤后，不返回该文件路径
     */
    it('没有有效共享注释时应该返回空对象', () => {
      const manager = createManagerFromStorage({
        shareComments: {
          [TEST_FILE]: [{
            id: 'invalid-no-userid',
            line: 6,
            content: 'invalid comment without userId',
            timestamp: 1,
            originalLine: 6,
            lineContent: 'code',
          } as any],
        },
      });

      const sharedComments = manager.getAllSharedComments();

      expect(Object.keys(sharedComments)).toHaveLength(0);
      manager.dispose();
    });

    /**
     * 测试目标: 多文件时只返回有有效共享注释的文件
     * 功能: 正确过滤多文件场景
     */
    it('多文件时应该只返回有有效共享注释的文件', () => {
      const file1 = path.normalize('/workspace/project/src/file1.ts');
      const file2 = path.normalize('/workspace/project/src/file2.ts');
      const manager = createManagerFromStorage({
        shareComments: {
          [file1]: [{
            id: 'valid-shared',
            line: 1,
            content: 'valid shared',
            timestamp: 1,
            originalLine: 1,
            lineContent: 'code',
            userId: 'user-1',
          }],
          [file2]: [{
            id: 'invalid-no-userid',
            line: 2,
            content: 'invalid comment without userId',
            timestamp: 1,
            originalLine: 2,
            lineContent: 'code',
          } as any],
        },
      });

      const sharedComments = manager.getAllSharedComments();

      expect(Object.keys(sharedComments)).toHaveLength(1);
      expect(sharedComments[file1]).toBeDefined();
      expect(sharedComments[file2]).toBeUndefined();
      manager.dispose();
    });
  });
});
