import { describe, it, expect } from 'vitest';
import {
  resolveCommentDecorationColor,
  colorKeyForStorage,
  isCommentEditNoop,
  buildDecorationColorSelectHtml,
  resolveCommentTreeIcon,
  buildCommentTreeIconSvg,
  DEFAULT_COMMENT_DECORATION_HEX
} from './commentDecorationColor';

describe('resolveCommentDecorationColor', () => {
  it('缺省时返回当前默认灰色', () => {
    expect(resolveCommentDecorationColor(undefined)).toBe(DEFAULT_COMMENT_DECORATION_HEX);
  });

  it('default 返回当前默认灰色', () => {
    expect(resolveCommentDecorationColor('default')).toBe('#6B7283');
  });

  it('合法 key 映射到对应 hex', () => {
    expect(resolveCommentDecorationColor('blue')).toBe('#3B82F6');
    expect(resolveCommentDecorationColor('green')).toBe('#22C55E');
    expect(resolveCommentDecorationColor('amber')).toBe('#F59E0B');
    expect(resolveCommentDecorationColor('red')).toBe('#EF4444');
    expect(resolveCommentDecorationColor('purple')).toBe('#A855F7');
  });

  it('非法值回退默认灰色', () => {
    expect(resolveCommentDecorationColor('not-a-color')).toBe(DEFAULT_COMMENT_DECORATION_HEX);
    expect(resolveCommentDecorationColor('#3B82F6')).toBe(DEFAULT_COMMENT_DECORATION_HEX);
  });
});

describe('colorKeyForStorage', () => {
  it('未传或 default 不写入字段', () => {
    expect(colorKeyForStorage(undefined)).toBeUndefined();
    expect(colorKeyForStorage('default')).toBeUndefined();
  });

  it('合法非默认 key 原样返回', () => {
    expect(colorKeyForStorage('blue')).toBe('blue');
  });

  it('非法值不写入字段', () => {
    expect(colorKeyForStorage('hotpink')).toBeUndefined();
  });
});

describe('isCommentEditNoop', () => {
  it('正文和颜色都未变时视为 noop', () => {
    expect(isCommentEditNoop('same', 'same', 'blue', 'blue')).toBe(true);
    expect(isCommentEditNoop('same', 'same', undefined, undefined)).toBe(true);
    expect(isCommentEditNoop('same', 'same', 'default', undefined)).toBe(true);
  });

  it('只改颜色时不是 noop', () => {
    expect(isCommentEditNoop('same', 'same', 'red', undefined)).toBe(false);
    expect(isCommentEditNoop('same', 'same', 'default', 'blue')).toBe(false);
  });

  it('只改正文时不是 noop', () => {
    expect(isCommentEditNoop('new', 'old', 'blue', 'blue')).toBe(false);
  });

  it('未传 savedColor 时只比较正文', () => {
    expect(isCommentEditNoop('same', 'same', undefined, 'blue')).toBe(true);
    expect(isCommentEditNoop('new', 'old', undefined, 'blue')).toBe(false);
  });
});

describe('buildDecorationColorSelectHtml', () => {
  it('渲染出色块按钮而不是文字下拉', () => {
    const html = buildDecorationColorSelectHtml('blue');
    expect(html).toContain('decoration-color-swatch');
    expect(html).toContain('data-key="blue"');
    expect(html).toContain('data-value="blue"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<option');
    expect(html).not.toContain('>蓝<');
  });
});

describe('resolveCommentTreeIcon', () => {
  it('未匹配时始终用 unresolved 图标且不上色', () => {
    expect(resolveCommentTreeIcon('blue', false)).toEqual({ iconId: 'comment-unresolved' });
    expect(resolveCommentTreeIcon(undefined, false)).toEqual({ iconId: 'comment-unresolved' });
  });

  it('可匹配且有颜色时返回烘焙进 SVG 的 hex', () => {
    expect(resolveCommentTreeIcon('red', true)).toEqual({
      iconId: 'comment',
      colorHex: '#EF4444'
    });
  });

  it('可匹配但无颜色时用 comment 图标且不上色', () => {
    expect(resolveCommentTreeIcon('default', true)).toEqual({ iconId: 'comment' });
    expect(resolveCommentTreeIcon(undefined, true)).toEqual({ iconId: 'comment' });
  });
});

describe('buildCommentTreeIconSvg', () => {
  it('把 hex 写进 fill，不使用 currentColor', () => {
    const svg = buildCommentTreeIconSvg('#EF4444');
    expect(svg).toContain('fill="#EF4444"');
    expect(svg).not.toContain('currentColor');
  });
});
