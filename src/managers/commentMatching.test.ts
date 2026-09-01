import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentMatching } from './commentMatching';
import { CommentMatcher } from './commentMatcher';
import { TimerManager } from '../utils/timerUtils';
import type { LocalComment, FileComments } from './commentTypes';

const docState = vi.hoisted(() => ({ lines: [] as string[], fsPath: '/file.ts' }));

vi.mock('vscode', () => ({
  workspace: {
    get textDocuments() {
      return [{
        uri: { fsPath: docState.fsPath },
        get lineCount() { return docState.lines.length; },
        lineAt: (i: number) => {
          if (i < 0 || i >= docState.lines.length) throw new Error('oob');
          return { text: docState.lines[i] };
        },
      }];
    },
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeEvent(changeLine: number): any {
  return {
    document: {
      uri: { fsPath: docState.fsPath },
      get lineCount() { return docState.lines.length; },
      lineAt: (i: number) => {
        if (i < 0 || i >= docState.lines.length) throw new Error('oob');
        return { text: docState.lines[i] };
      },
      isDirty: true,
      reason: undefined,
    },
    contentChanges: [{ range: { start: { line: changeLine }, end: { line: changeLine } }, text: '' }],
  };
}

describe('CommentMatching 智能匹配编排测试', () => {
  let matching: CommentMatching;
  let comments: FileComments;
  let comment: LocalComment;

  beforeEach(() => {
    // 行0与行1内容相同，注释在行1
    docState.lines = ['const foo = 1;', 'const foo = 1;', 'beta'];
    comment = { id: 'c1', line: 1, content: 'note', timestamp: 1000, originalLine: 1, lineContent: 'const foo = 1;', isShared: false };
    comments = { '/file.ts': [comment] };
    const storage = { getCommentsRef: () => comments, getShareCommentsRef: () => ({}) } as any;
    matching = new CommentMatching(storage, new CommentMatcher(), new TimerManager(), vi.fn());
  });

  it('getComments 不应回写 comment.line（读路径不写存储）', () => {
    // 行1内容已变，但 lineContent 仍是旧值；全文搜索会匹配到行0
    docState.lines = ['const foo = 1;', 'const foo = 1', 'beta'];
    const out = matching.getComments({ fsPath: '/file.ts' } as any);
    // 显示用 matchedComment.line 可以是 0，但存储里的 comment.line 必须保持 1
    expect(comment.line).toBe(1);
    expect(out.length).toBe(1);
  });

  it('编辑注释行：竞态 getComments 不错位，handleDocumentChange 能正确更新 lineContent', async () => {
    // 用户删除行1的分号：行1 -> 'const foo = 1'
    docState.lines = ['const foo = 1;', 'const foo = 1', 'beta'];
    // 竞态：装饰刷新先跑（lineContent 仍是旧值 'const foo = 1;'）
    const out1 = matching.getComments({ fsPath: '/file.ts' } as any);
    // 修复后：getComments 不再回写 comment.line，comment.line 应保持 1（不错位到 0）
    expect(comment.line).toBe(1);
    expect(comment.lineContent).toBe('const foo = 1;');
    // 然后 handleDocumentChange 才更新 lineContent（单行分支能找到 comment，因为 comment.line 仍 === 1）
    await matching.handleDocumentChange(makeEvent(1), false);
    expect(comment.line).toBe(1);
    expect(comment.lineContent).toBe('const foo = 1');
    // 再次 getComments：isExactMatch(1) 成功，注释显示在行1
    const out2 = matching.getComments({ fsPath: '/file.ts' } as any);
    expect(out2.length).toBe(1);
    expect(out2[0].line).toBe(1);
  });
});
