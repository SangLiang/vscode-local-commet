import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentMatcher } from './commentMatcher';
import { LocalComment, SharedComment } from './commentTypes';

vi.mock('vscode', () => ({}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeDocument(lines: string[]) {
  return {
    lineCount: lines.length,
    lineAt: (i: number) => {
      if (i < 0 || i >= lines.length) {
        throw new Error(`lineAt out of range: ${i}`);
      }
      return { text: lines[i] };
    },
  } as any;
}

function makeComment(
  partial: Partial<LocalComment> & Pick<LocalComment, 'id' | 'line' | 'lineContent'>
): LocalComment {
  return {
    content: 'comment',
    timestamp: 1000,
    originalLine: partial.line,
    ...partial,
  };
}

function makeSharedComment(
  partial: Partial<SharedComment> & Pick<SharedComment, 'id' | 'line' | 'lineContent' | 'userId'>
): SharedComment {
  return {
    content: 'shared',
    timestamp: 1000,
    originalLine: partial.line,
    ...partial,
  };
}

/** 构造足够长的占位行，避免与目标内容误匹配 */
function padLines(count: number, prefix = 'placeholder_line_'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

describe('CommentMatcher', () => {
  let matcher: CommentMatcher;

  beforeEach(() => {
    matcher = new CommentMatcher();
  });

  describe('batchMatchComments - 受限精确匹配', () => {
    it('精确命中：原行内容不变应返回原行号', () => {
      const doc = makeDocument(['alpha', 'const foo = 1;', 'beta']);
      const comment = makeComment({ id: 'c1', line: 1, lineContent: 'const foo = 1;' });

      const result = matcher.batchMatchComments(doc, [comment]);

      expect(result.get('c1')).toBe(1);
    });

    it('邻近漂移：内容下移一行应跟着走', () => {
      const doc = makeDocument(['alpha', 'inserted_line_here', 'const foo = 1;']);
      const comment = makeComment({ id: 'c1', line: 1, lineContent: 'const foo = 1;' });

      const result = matcher.batchMatchComments(doc, [comment]);

      expect(result.get('c1')).toBe(2);
    });

    it('邻近漂移：内容上移一行应跟着走', () => {
      const doc = makeDocument(['const foo = 1;', 'beta']);
      const comment = makeComment({ id: 'c1', line: 1, lineContent: 'const foo = 1;' });

      const result = matcher.batchMatchComments(doc, [comment]);

      expect(result.get('c1')).toBe(0);
    });

    it('搜索窗内漂移：非邻行但在范围内应命中', () => {
      const lines = padLines(40);
      lines[10] = 'unrelated_code_block_a';
      lines[18] = 'const uniqueWindowHit = 99;';
      const doc = makeDocument(lines);
      const comment = makeComment({
        id: 'c1',
        line: 10,
        lineContent: 'const uniqueWindowHit = 99;',
      });

      const result = matcher.batchMatchComments(doc, [comment]);

      expect(result.get('c1')).toBe(18);
    });

    it('超出搜索窗：受限模式应返回 -1', () => {
      const lines = padLines(60);
      lines[5] = 'original_anchor_line_xxx';
      lines[50] = 'const uniqueFarAwayMarker = 42;';
      const doc = makeDocument(lines);
      const comment = makeComment({
        id: 'c1',
        line: 5,
        lineContent: 'const uniqueFarAwayMarker = 42;',
      });

      const result = matcher.batchMatchComments(doc, [comment]);

      expect(result.get('c1')).toBe(-1);
    });

    it('空 lineContent 应返回 -1', () => {
      const doc = makeDocument(['const foo = 1;']);
      const comment = makeComment({ id: 'c1', line: 0, lineContent: '   ' });

      const result = matcher.batchMatchComments(doc, [comment]);

      expect(result.get('c1')).toBe(-1);
    });

    it('特征不足的行内容应返回 -1', () => {
      const doc = makeDocument(['}', 'const foo = 1;']);
      const comment = makeComment({ id: 'c1', line: 0, lineContent: '}' });

      const result = matcher.batchMatchComments(doc, [comment]);

      expect(result.get('c1')).toBe(-1);
    });

    it('两个本地注释争同一行时，较早者占用，较晚者失败', () => {
      const doc = makeDocument(['alpha', 'const sharedTarget = 1;', 'beta']);
      const older = makeComment({
        id: 'old',
        line: 0,
        lineContent: 'const sharedTarget = 1;',
        timestamp: 100,
      });
      const newer = makeComment({
        id: 'new',
        line: 2,
        lineContent: 'const sharedTarget = 1;',
        timestamp: 200,
      });

      const result = matcher.batchMatchComments(doc, [newer, older]);

      expect(result.get('old')).toBe(1);
      expect(result.get('new')).toBe(-1);
    });

    it('共享注释可与本地注释落在同一行', () => {
      const doc = makeDocument(['const sharedTarget = 1;']);
      const local = makeComment({
        id: 'local',
        line: 0,
        lineContent: 'const sharedTarget = 1;',
        timestamp: 100,
      });
      const shared = makeSharedComment({
        id: 'shared',
        line: 0,
        lineContent: 'const sharedTarget = 1;',
        userId: 'u1',
        timestamp: 200,
      });

      const result = matcher.batchMatchComments(doc, [local, shared]);

      expect(result.get('local')).toBe(0);
      expect(result.get('shared')).toBe(0);
    });
  });

  describe('batchMatchCommentsWithFullSearch - 全文精确匹配', () => {
    it('局部失败时，远处相同内容应被全文搜索找到', () => {
      const lines = padLines(60);
      lines[5] = 'original_anchor_line_xxx';
      lines[50] = 'const uniqueFarAwayMarker = 42;';
      const doc = makeDocument(lines);
      const comment = makeComment({
        id: 'c1',
        line: 5,
        lineContent: 'const uniqueFarAwayMarker = 42;',
      });

      const result = matcher.batchMatchCommentsWithFullSearch(doc, [comment]);

      expect(result.get('c1')).toBe(50);
    });

    it('全文也找不到时应返回 -1', () => {
      const doc = makeDocument(padLines(20));
      const comment = makeComment({
        id: 'c1',
        line: 3,
        lineContent: 'const doesNotExistAnywhere = 1;',
      });

      const result = matcher.batchMatchCommentsWithFullSearch(doc, [comment]);

      expect(result.get('c1')).toBe(-1);
    });
  });

  describe('batchMatchCommentsForLargeChanges - 大块变化', () => {
    it('应在扩展范围内命中漂移内容', () => {
      const lines = padLines(40);
      lines[10] = 'unrelated_code_block_b';
      lines[25] = 'const largeChangeTarget = 7;';
      const doc = makeDocument(lines);
      const comment = makeComment({
        id: 'c1',
        line: 10,
        lineContent: 'const largeChangeTarget = 7;',
      });

      const result = matcher.batchMatchCommentsForLargeChanges(doc, [comment]);

      expect(result.get('c1')).toBe(25);
    });
  });

  describe('fuzzyMatchComment - 手动模糊匹配', () => {
    it('应按相似度返回候选并限制数量', () => {
      const doc = makeDocument([
        'const fooBar = 1;',
        'const fooBar = 2;',
        'completely_different_line_xyz',
        'const fooBar=1;',
      ]);
      const comment = makeComment({
        id: 'c1',
        line: 0,
        lineContent: 'const fooBar = 1;',
      });

      const candidates = matcher.fuzzyMatchComment(doc, comment, 2);

      expect(candidates.length).toBeLessThanOrEqual(2);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].similarity).toBeGreaterThanOrEqual(candidates[candidates.length - 1].similarity);
      expect(candidates[0].line).toBe(0);
      expect(candidates[0].confidence).toBe('high');
    });

    it('无 lineContent 时返回空数组', () => {
      const doc = makeDocument(['const foo = 1;']);
      const comment = makeComment({ id: 'c1', line: 0, lineContent: '' });

      expect(matcher.fuzzyMatchComment(doc, comment)).toEqual([]);
    });
  });

  describe('纯工具方法', () => {
    it('normalizeLineContent 应移除空白与标点并转小写', () => {
      expect(matcher.normalizeLineContent('  Foo Bar; ')).toBe('foobar');
      expect(matcher.normalizeLineContent('ab')).toBe('');
    });

    it('calculateSimilarity 相同字符串应为 1，完全不同应较低', () => {
      expect(matcher.calculateSimilarity('abc', 'abc')).toBe(1);
      // 空串被 !str 早退为 0（len1===0 分支不可达）
      expect(matcher.calculateSimilarity('', '')).toBe(0);
      expect(matcher.calculateSimilarity('abc', '')).toBe(0);
      expect(matcher.calculateSimilarity('abcd', 'abce')).toBeGreaterThan(0.5);
      expect(matcher.calculateSimilarity('aaaa', 'bbbb')).toBeLessThan(0.5);
    });
  });
});
