import type { CommentDecorationColor } from '../managers/commentTypes';

export const DEFAULT_COMMENT_DECORATION_HEX = '#6B7283';

export const COMMENT_DECORATION_COLOR_OPTIONS: ReadonlyArray<{
  key: CommentDecorationColor;
  hex: string;
  label: string;
}> = [
  { key: 'default', hex: DEFAULT_COMMENT_DECORATION_HEX, label: '默认灰' },
  { key: 'blue', hex: '#3B82F6', label: '蓝' },
  { key: 'green', hex: '#22C55E', label: '绿' },
  { key: 'amber', hex: '#F59E0B', label: '琥珀' },
  { key: 'red', hex: '#EF4444', label: '红' },
  { key: 'purple', hex: '#A855F7', label: '紫' }
];

const COLOR_HEX_BY_KEY: Record<CommentDecorationColor, string> = Object.fromEntries(
  COMMENT_DECORATION_COLOR_OPTIONS.map(item => [item.key, item.hex])
) as Record<CommentDecorationColor, string>;

export function isCommentDecorationColor(value: unknown): value is CommentDecorationColor {
  return typeof value === 'string' && value in COLOR_HEX_BY_KEY;
}

export function resolveCommentDecorationColor(color?: string): string {
  if (isCommentDecorationColor(color)) {
    return COLOR_HEX_BY_KEY[color];
  }
  return DEFAULT_COMMENT_DECORATION_HEX;
}

/** 写入 JSON 用：default / 缺省 / 非法 → 不写字段 */
export function colorKeyForStorage(color?: string): CommentDecorationColor | undefined {
  if (isCommentDecorationColor(color) && color !== 'default') {
    return color;
  }
  return undefined;
}

export function isCommentEditNoop(
  savedContent: string,
  originalContent: string,
  savedColor?: string,
  originalColor?: string
): boolean {
  if (savedContent !== originalContent) {
    return false;
  }
  if (savedColor === undefined) {
    return true;
  }
  return colorKeyForStorage(savedColor) === colorKeyForStorage(originalColor);
}

export function buildDecorationColorSelectHtml(selected?: string): string {
  const selectedKey = isCommentDecorationColor(selected) ? selected : 'default';
  const swatches = COMMENT_DECORATION_COLOR_OPTIONS.map(item => {
    const isSelected = item.key === selectedKey;
    const selectedClass = isSelected ? ' is-selected' : '';
    const checked = isSelected ? 'true' : 'false';
    return `<button type="button" class="decoration-color-swatch${selectedClass}" role="radio" aria-checked="${checked}" data-key="${item.key}" title="${item.label}" style="background-color:${item.hex}"></button>`;
  }).join('');
  return `<div class="decoration-color-picker" id="decorationColorSelect" role="radiogroup" aria-label="行尾注释颜色" data-value="${selectedKey}">${swatches}</div>`;
}

export function resolveCommentTreeIcon(
  color: string | undefined,
  isMatchable: boolean
): { iconId: string; colorHex?: string } {
  if (!isMatchable) {
    return { iconId: 'comment-unresolved' };
  }
  if (isCommentDecorationColor(color) && color !== 'default') {
    return { iconId: 'comment', colorHex: COLOR_HEX_BY_KEY[color] };
  }
  return { iconId: 'comment' };
}

/** 静态 SVG：fill 写死 hex，避免 ThemeIcon 在树选中时被 list.activeSelectionForeground 盖掉 */
export function buildCommentTreeIconSvg(hex: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="${hex}" d="M14.5 2h-13l-.5.5v9l.5.5H4v2.5l.854.354L7.707 12H14.5l.5-.5v-9l-.5-.5zm-.5 9H7.5l-.354.146L5 13.293V11.5l-.5-.5H2V3h12v8z"/></svg>`;
}
