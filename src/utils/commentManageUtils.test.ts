import { describe, it, expect } from 'vitest';
import {
  flattenCommentsToRows,
  filterCommentRows,
  sortCommentRows,
  extractTagDeclarations,
  toCommentSummary,
} from './commentManageUtils';
import { FileComments } from '../managers/commentTypes';

describe('commentManageUtils', () => {
  const sampleComments: FileComments = {
    '/proj/src/a.ts': [
      {
        id: 'c1',
        line: 10,
        content: '说明 @foo 引用',
        timestamp: 2000,
        originalLine: 10,
        lineContent: 'const x = 1;',
      },
      {
        id: 'c2',
        line: 20,
        content: '${todo} 待办事项',
        timestamp: 1000,
        originalLine: 20,
        lineContent: 'const y = 2;',
      },
    ],
    '/proj/src/b.ts': [
      {
        id: 'c3',
        line: 0,
        content: '# 标题',
        timestamp: 3000,
        originalLine: 0,
        lineContent: '',
      },
    ],
  };

  it('flattenCommentsToRows 应跳过共享注释并生成稳定 id', () => {
    const withShared: FileComments = {
      '/proj/x.ts': [
        { id: 'local', line: 1, content: 'a', timestamp: 1, originalLine: 1, lineContent: '' },
        { id: 'shared', line: 2, content: 'b', timestamp: 2, originalLine: 2, lineContent: '', userId: 'u1' },
      ],
    };
    const rows = flattenCommentsToRows(withShared, '/proj');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('local');
    expect(rows[0].filePath).toBe('x.ts');
  });

  it('extractTagDeclarations 应提取 ${tag} 声明', () => {
    expect(extractTagDeclarations('${bug} 修复问题')).toEqual(['bug']);
    expect(extractTagDeclarations('见 @foo 和 ${bar}')).toEqual(['bar']);
    expect(extractTagDeclarations('见 @foo 和 @bar_baz')).toEqual([]);
    expect(extractTagDeclarations('`${inline}`\n```python\ntemplate = "${block}"\n```')).toEqual([]);
  });

  it('toCommentSummary 应截断并去除 Markdown 标题标记', () => {
    const long = '# '.concat('x'.repeat(200));
    expect(toCommentSummary(long, 50).length).toBeLessThanOrEqual(50);
    expect(toCommentSummary('# Hello', 80)).toBe('Hello');
  });

  it('filterCommentRows 支持 query 与 commentKind', () => {
    const rows = flattenCommentsToRows(sampleComments, '/proj');
    expect(filterCommentRows(rows, { commentKind: 'tag' })).toHaveLength(1);
    expect(filterCommentRows(rows, { commentKind: 'tag' })[0].id).toBe('c2');
    expect(filterCommentRows(rows, { commentKind: 'normal' })).toHaveLength(2);
    const filtered = filterCommentRows(rows, { query: 'todo', commentKind: 'tag' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('c2');
  });

  it('sortCommentRows 默认按文件路径再按行号', () => {
    const rows = flattenCommentsToRows(sampleComments, '/proj');
    const sorted = sortCommentRows(rows, 'filePath', 'asc');
    expect(sorted[0].filePath).toBe('src/a.ts');
    expect(sorted[0].line).toBe(10);
    expect(sorted[1].line).toBe(20);
  });
});
