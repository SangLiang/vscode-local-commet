import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommentStorage } from './commentStorage';

// Mock fs - 注意：这里不能使用外部变量，因为 vi.mock 会被提升到文件顶部
vi.mock('fs', () => {
  return {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      writeFile: vi.fn()
    }
  };
});

// Mock path
vi.mock('path', () => {
  return {
    dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/') || '/'),
    basename: vi.fn((p: string) => p.split('/').pop() || ''),
    join: vi.fn((...args: string[]) => args.join('/').replace(/\/+/g, '/')),
    resolve: vi.fn((...args: string[]) => args.join('/').replace(/\/+/g, '/'))
  };
});

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock storagePathUtils
vi.mock('../utils/storagePathUtils', () => ({
  StoragePathUtils: {
    getStoragePaths: vi.fn(() => ({
      commentsDir: '/workspace/project/.vscode/local-comment/comments',
      bookmarksDir: '/workspace/project/.vscode/local-comment/bookmarks',
      oldCommentsFile: '/global/storage/local-comments.json',
      oldBookmarksFile: '/global/storage/local-bookmarks.json'
    })),
    getCurrentCommentsFile: vi.fn(() => '/workspace/project/.vscode/local-comment/comments/comments.json'),
    fileExists: vi.fn(() => true),
    ensureNewPathExists: vi.fn(),
    ensureNewStorageInitialized: vi.fn(),
    ensureDirectoryExists: vi.fn(),
    listConfigFiles: vi.fn(() => ['comments.json', 'test.json']),
    loadConfig: vi.fn(() => ({ comments: 'comments.json' })),
    saveConfig: vi.fn(),
    isWritePermissionError: vi.fn((err: any) => err?.code === 'EACCES')
  },
  StoragePaths: {},
  StorageConfig: {}
}));

// Import fs after mock
import * as fs from 'fs';

// Mock vscode
vi.mock('vscode', () => {
  return {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/workspace/project' } }],
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() }))
    },
    window: {
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showTextDocument: vi.fn()
    },
    EventEmitter: vi.fn(() => ({
      event: vi.fn(),
      fire: vi.fn(),
      dispose: vi.fn()
    })),
    Uri: {
      file: (p: string) => ({ fsPath: p })
    },
    commands: {
      executeCommand: vi.fn()
    }
  };
});

// Import vscode after mock
import * as vscode from 'vscode';

describe('CommentStorage', () => {
  let storage: CommentStorage;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      globalStorageUri: { fsPath: '/global/storage' },
      globalState: {
        get: vi.fn(),
        update: vi.fn()
      },
      extensionPath: '/extension/path',
      subscriptions: []
    };

    // Default fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      comments: {},
      shareComments: {}
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('应该正确初始化', () => {
      storage = new CommentStorage(mockContext);
      expect(storage).toBeDefined();
      expect(storage.getContext()).toBe(mockContext);
    });
  });

  describe('getCommentsRef / getShareCommentsRef', () => {
    it('应该返回注释数据引用', () => {
      storage = new CommentStorage(mockContext);
      const comments = storage.getCommentsRef();
      const shareComments = storage.getShareCommentsRef();

      expect(comments).toBeDefined();
      expect(shareComments).toBeDefined();
      expect(typeof comments).toBe('object');
      expect(typeof shareComments).toBe('object');
    });

    it('返回的引用应该可修改', () => {
      storage = new CommentStorage(mockContext);
      const comments = storage.getCommentsRef();

      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'test',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'code'
        }
      ];

      expect(storage.getCommentsRef()['/test/file.ts']).toHaveLength(1);
    });
  });

  describe('getProjectInfo', () => {
    it('应该返回项目信息', () => {
      storage = new CommentStorage(mockContext);
      const info = storage.getProjectInfo();

      expect(info.name).toBe('project');
      expect(info.path).toBe('/workspace/project');
      expect(info.storageFile).toBeDefined();
    });

    it('应该在没有工作区时返回默认值', () => {
      // 临时修改 workspaceFolders
      const originalFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as any).workspaceFolders = [];

      storage = new CommentStorage(mockContext);
      const info = storage.getProjectInfo();

      expect(info.name).toBe('未知项目');
      expect(info.path).toBe('无工作区');

      // 恢复
      (vscode.workspace as any).workspaceFolders = originalFolders;
    });
  });

  describe('getStorageFilePath', () => {
    it('应该返回存储文件路径', () => {
      storage = new CommentStorage(mockContext);
      const path = storage.getStorageFilePath();

      expect(path).toBeDefined();
      expect(typeof path).toBe('string');
    });
  });

  describe('getAllComments', () => {
    it('应该合并本地和共享注释', () => {
      storage = new CommentStorage(mockContext);
      const comments = storage.getCommentsRef();
      const shareComments = storage.getShareCommentsRef();

      comments['/test/file.ts'] = [
        {
          id: 'local-1',
          line: 10,
          content: 'local comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'code'
        }
      ];

      shareComments['/test/file.ts'] = [
        {
          id: 'shared-1',
          line: 20,
          content: 'shared comment',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'code',
          userId: 'user-1'
        }
      ];

      const all = storage.getAllComments();

      expect(all['/test/file.ts']).toHaveLength(2);
    });

    it('应该过滤出有效的SharedComment', () => {
      storage = new CommentStorage(mockContext);
      const shareComments = storage.getShareCommentsRef();

      shareComments['/test/file.ts'] = [
        {
          id: 'shared-1',
          line: 20,
          content: 'shared comment',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'code',
          userId: 'user-1'
        },
        {
          id: 'invalid',
          line: 30,
          content: 'invalid comment',
          timestamp: Date.now(),
          originalLine: 30,
          lineContent: 'code'
          // 缺少 userId，不应该被识别为 SharedComment
        }
      ];

      const all = storage.getAllComments();

      expect(all['/test/file.ts']).toHaveLength(1);
    });
  });

  describe('getAllSharedComments', () => {
    it('应该只返回共享注释', () => {
      storage = new CommentStorage(mockContext);
      const comments = storage.getCommentsRef();
      const shareComments = storage.getShareCommentsRef();

      comments['/test/file.ts'] = [
        {
          id: 'local-1',
          line: 10,
          content: 'local comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'code'
        }
      ];

      shareComments['/test/file.ts'] = [
        {
          id: 'shared-1',
          line: 20,
          content: 'shared comment',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'code',
          userId: 'user-1'
        }
      ];

      const allShared = storage.getAllSharedComments();

      expect(allShared['/test/file.ts']).toHaveLength(1);
      expect(allShared['/test/file.ts'][0].id).toBe('shared-1');
    });
  });

  describe('loadComments', () => {
    it('应该加载注释数据', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        comments: {
          '/test/file.ts': [
            {
              id: '1',
              line: 10,
              content: 'loaded comment',
              timestamp: Date.now(),
              originalLine: 10,
              lineContent: 'code'
            }
          ]
        },
        shareComments: {}
      }));

      storage = new CommentStorage(mockContext);
      await storage.loadComments();

      const comments = storage.getCommentsRef();
      expect(comments['/test/file.ts']).toHaveLength(1);
      expect(comments['/test/file.ts'][0].content).toBe('loaded comment');
    });

    it('应该处理损坏的JSON', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      storage = new CommentStorage(mockContext);
      await storage.loadComments();

      const comments = storage.getCommentsRef();
      expect(comments).toEqual({});
    });

    it('应该处理文件不存在的情况', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      storage = new CommentStorage(mockContext);
      await storage.loadComments();

      const comments = storage.getCommentsRef();
      expect(comments).toEqual({});
    });

    it('空工作区加载时不应创建项目存储', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      storage = new CommentStorage(mockContext);
      await storage.loadComments();

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('saveComments', () => {
    it('应该保存注释数据', async () => {
      storage = new CommentStorage(mockContext);
      const comments = storage.getCommentsRef();

      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'test comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'code'
        }
      ];

      await storage.saveComments();

      expect(fs.promises.writeFile).toHaveBeenCalled();
      const writtenData = JSON.parse(vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string);
      expect(writtenData.comments['/test/file.ts']).toHaveLength(1);
    });
  });

  describe('replaceComments / replaceShareComments', () => {
    it('应该替换所有注释数据', () => {
      storage = new CommentStorage(mockContext);
      const comments = storage.getCommentsRef();

      comments['/test/file.ts'] = [
        {
          id: 'old',
          line: 10,
          content: 'old',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'old'
        }
      ];

      storage.replaceComments({
        '/new/file.ts': [
          {
            id: 'new',
            line: 20,
            content: 'new',
            timestamp: Date.now(),
            originalLine: 20,
            lineContent: 'new'
          }
        ]
      });

      expect(comments['/test/file.ts']).toBeUndefined();
      expect(comments['/new/file.ts']).toHaveLength(1);
    });
  });

  describe('updateStorageFile', () => {
    it('应该更新存储文件路径', () => {
      storage = new CommentStorage(mockContext);
      const originalPath = storage.getStorageFilePath();

      storage.updateStorageFile('/new/path/comments.json');

      expect(storage.getStorageFilePath()).toBe('/new/path/comments.json');
      expect(storage.getStorageFilePath()).not.toBe(originalPath);
    });
  });
});
