import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentCRUD } from './commentCrud';
import { CommentStorage } from './commentStorage';
import { LocalComment } from './commentTypes';

// Mock vscode
vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn()
  }
}));

// Mock CommentStorage
const createMockStorage = () => {
  const comments: { [filePath: string]: LocalComment[] } = {};
  return {
    getCommentsRef: () => comments,
    getShareCommentsRef: () => ({})
  } as unknown as CommentStorage;
};

describe('CommentCRUD', () => {
  let storage: CommentStorage;
  let crud: CommentCRUD;

  beforeEach(() => {
    storage = createMockStorage();
    crud = new CommentCRUD(storage);
  });

  describe('getLocalCommentAtLine', () => {
    it('应该返回指定行的本地注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'test comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      const result = crud.getLocalCommentAtLine('/test/file.ts', 10);
      expect(result).toBeDefined();
      expect(result?.content).toBe('test comment');
    });

    it('应该排除共享注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'local comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        },
        {
          id: '2',
          line: 20,
          content: 'shared comment',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'const y = 2;',
          userId: 'user-1'
        } as LocalComment & { userId: string }
      ];

      const result = crud.getLocalCommentAtLine('/test/file.ts', 20);
      // 共享注释应该被排除
      expect(result).toBeUndefined();
    });

    it('应该返回undefined当文件没有注释', () => {
      const result = crud.getLocalCommentAtLine('/test/nonexistent.ts', 10);
      expect(result).toBeUndefined();
    });
  });

  describe('getCommentById', () => {
    it('应该根据ID返回注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id-123',
          line: 10,
          content: 'test comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      const result = crud.getCommentById('/test/file.ts', 'test-id-123');
      expect(result).toBeDefined();
      expect(result?.id).toBe('test-id-123');
    });

    it('应该返回undefined当ID不存在', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id-123',
          line: 10,
          content: 'test comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      const result = crud.getCommentById('/test/file.ts', 'non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('addComment', () => {
    it('应该添加新注释到文件', async () => {
      const mockUri = { fsPath: '/test/file.ts' } as any;
      const comment = await crud.addComment(mockUri, 10, 'new comment', 'const x = 1;');

      expect(comment).toBeDefined();
      expect(comment.line).toBe(10);
      expect(comment.content).toBe('new comment');
      expect(comment.lineContent).toBe('const x = 1;');

      const comments = storage.getCommentsRef();
      expect(comments['/test/file.ts']).toHaveLength(1);
    });

    it('应该替换同一行的现有本地注释', async () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'old-id',
          line: 10,
          content: 'old comment',
          timestamp: Date.now() - 1000,
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      const mockUri = { fsPath: '/test/file.ts' } as any;
      const newComment = await crud.addComment(mockUri, 10, 'new comment', 'const x = 2;');

      expect(comments['/test/file.ts']).toHaveLength(1);
      expect(comments['/test/file.ts'][0].content).toBe('new comment');
      expect(comments['/test/file.ts'][0].id).not.toBe('old-id');
    });

    it('应该为新注释生成唯一ID', async () => {
      const mockUri = { fsPath: '/test/file.ts' } as any;
      const comment1 = await crud.addComment(mockUri, 10, 'comment 1', 'line 1');
      const comment2 = await crud.addComment(mockUri, 20, 'comment 2', 'line 2');

      expect(comment1.id).not.toBe(comment2.id);
    });

    it('传入非默认颜色时应写入 color 字段', async () => {
      const mockUri = { fsPath: '/test/file.ts' } as any;
      const comment = await crud.addComment(mockUri, 10, 'colored', 'line', 'blue');

      expect(comment.color).toBe('blue');
    });

    it('未传颜色或 default 时不应写入 color 字段', async () => {
      const mockUri = { fsPath: '/test/file.ts' } as any;
      const without = await crud.addComment(mockUri, 10, 'plain', 'line');
      const asDefault = await crud.addComment(mockUri, 20, 'plain default', 'line', 'default');

      expect(without.color).toBeUndefined();
      expect(asDefault.color).toBeUndefined();
    });
  });

  describe('editComment', () => {
    it('应该编辑注释内容', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id',
          line: 10,
          content: 'old content',
          timestamp: Date.now() - 1000,
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      const success = crud.editComment('/test/file.ts', 'test-id', 'new content');

      expect(success).toBe(true);
      expect(comments['/test/file.ts'][0].content).toBe('new content');
      expect(comments['/test/file.ts'][0].timestamp).toBeGreaterThan(Date.now() - 1000);
    });

    it('应该返回false当注释不存在', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id',
          line: 10,
          content: 'content',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      const success = crud.editComment('/test/file.ts', 'non-existent', 'new content');

      expect(success).toBe(false);
    });

    it('应该返回false当文件没有注释', () => {
      const success = crud.editComment('/test/nonexistent.ts', 'test-id', 'new content');
      expect(success).toBe(false);
    });

    it('未传 color 时只改正文并保留原颜色', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id',
          line: 10,
          content: 'old content',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;',
          color: 'blue'
        }
      ];

      crud.editComment('/test/file.ts', 'test-id', 'new content');

      expect(comments['/test/file.ts'][0].content).toBe('new content');
      expect(comments['/test/file.ts'][0].color).toBe('blue');
    });

    it('传入非默认颜色时应更新 color 字段', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id',
          line: 10,
          content: 'content',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      crud.editComment('/test/file.ts', 'test-id', 'content', 'red');

      expect(comments['/test/file.ts'][0].color).toBe('red');
    });

    it('传入 default 时应删除 color 字段', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id',
          line: 10,
          content: 'content',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;',
          color: 'green'
        }
      ];

      crud.editComment('/test/file.ts', 'test-id', 'content', 'default');

      expect(comments['/test/file.ts'][0].color).toBeUndefined();
    });
  });

  describe('updateCommentLine', () => {
    it('应该更新注释行号和内容', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id',
          line: 10,
          content: 'content',
          timestamp: Date.now() - 1000,
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      const success = crud.updateCommentLine('/test/file.ts', 'test-id', 20, 'const y = 2;');

      expect(success).toBe(true);
      expect(comments['/test/file.ts'][0].line).toBe(20);
      expect(comments['/test/file.ts'][0].lineContent).toBe('const y = 2;');
    });

    it('应该更新时间戳', () => {
      const oldTimestamp = Date.now() - 1000;
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'test-id',
          line: 10,
          content: 'content',
          timestamp: oldTimestamp,
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      crud.updateCommentLine('/test/file.ts', 'test-id', 20, 'const y = 2;');

      expect(comments['/test/file.ts'][0].timestamp).toBeGreaterThan(oldTimestamp);
    });
  });

  describe('removeComment', () => {
    it('应该根据行号删除本地注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'comment 1',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        },
        {
          id: '2',
          line: 20,
          content: 'comment 2',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'const y = 2;'
        }
      ];

      const success = crud.removeComment('/test/file.ts', 10);

      expect(success).toBe(true);
      expect(comments['/test/file.ts']).toHaveLength(1);
      expect(comments['/test/file.ts'][0].line).toBe(20);
    });

    it('应该只删除本地注释，保留共享注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'local comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        },
        {
          id: '2',
          line: 10,
          content: 'shared comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;',
          userId: 'user-1'
        } as LocalComment & { userId: string }
      ];

      const success = crud.removeComment('/test/file.ts', 10);

      expect(success).toBe(true);
      expect(comments['/test/file.ts']).toHaveLength(1);
      expect((comments['/test/file.ts'][0] as any).userId).toBe('user-1');
    });

    it('应该在删除所有注释后删除文件记录', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        }
      ];

      crud.removeComment('/test/file.ts', 10);

      expect(comments['/test/file.ts']).toBeUndefined();
    });
  });

  describe('removeCommentById', () => {
    it('应该根据ID删除注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: 'id-1',
          line: 10,
          content: 'comment 1',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        },
        {
          id: 'id-2',
          line: 20,
          content: 'comment 2',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'const y = 2;'
        }
      ];

      const success = crud.removeCommentById('/test/file.ts', 'id-1');

      expect(success).toBe(true);
      expect(comments['/test/file.ts']).toHaveLength(1);
      expect(comments['/test/file.ts'][0].id).toBe('id-2');
    });
  });

  describe('clearFileComments', () => {
    it('应该清空文件的所有本地注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'local comment',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'const x = 1;'
        },
        {
          id: '2',
          line: 20,
          content: 'shared comment',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'const y = 2;',
          userId: 'user-1'
        } as LocalComment & { userId: string }
      ];

      const count = crud.clearFileComments('/test/file.ts');

      expect(count).toBe(1); // 只删除本地注释
      expect(comments['/test/file.ts']).toHaveLength(1);
      expect((comments['/test/file.ts'][0] as any).userId).toBe('user-1');
    });

    it('应该在只剩共享注释时保留文件记录', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'local',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'line'
        },
        {
          id: '2',
          line: 20,
          content: 'shared',
          timestamp: Date.now(),
          originalLine: 20,
          lineContent: 'line',
          userId: 'user-1'
        } as LocalComment & { userId: string }
      ];

      crud.clearFileComments('/test/file.ts');

      expect(comments['/test/file.ts']).toBeDefined();
      expect(comments['/test/file.ts']).toHaveLength(1);
    });

    it('应该返回0当没有本地注释', () => {
      const comments = storage.getCommentsRef();
      comments['/test/file.ts'] = [
        {
          id: '1',
          line: 10,
          content: 'shared',
          timestamp: Date.now(),
          originalLine: 10,
          lineContent: 'line',
          userId: 'user-1'
        } as LocalComment & { userId: string }
      ];

      const count = crud.clearFileComments('/test/file.ts');

      expect(count).toBe(0);
    });
  });
});
