export type TagType = 'declaration' | 'reference';

export interface MarkdownTag {
    text: string;
    tagName: string;
    type: TagType;
    start: number;
    end: number;
}

interface TextRange {
    start: number;
    end: number;
}

interface MarkdownFence {
    marker: '`' | '~';
    length: number;
    start: number;
}

const _Max_Fence_Indent = 3;
const _Min_Fence_Length = 3;

function getFenceMarker(line: string): { marker: '`' | '~'; length: number; rest: string } | undefined {
    let index = 0;
    while (index < line.length && line[index] === ' ') {
        index++;
    }

    if (index > _Max_Fence_Indent) {
        return undefined;
    }

    const marker = line[index];
    if (marker !== '`' && marker !== '~') {
        return undefined;
    }

    let markerEnd = index;
    while (markerEnd < line.length && line[markerEnd] === marker) {
        markerEnd++;
    }

    const length = markerEnd - index;
    if (length < _Min_Fence_Length) {
        return undefined;
    }

    return {
        marker,
        length,
        rest: line.substring(markerEnd)
    };
}

function getFencedCodeRanges(content: string): TextRange[] {
    const ranges: TextRange[] = [];
    let activeFence: MarkdownFence | undefined;
    let lineStart = 0;

    while (lineStart < content.length) {
        const newlineIndex = content.indexOf('\n', lineStart);
        const nextLineStart = newlineIndex === -1 ? content.length : newlineIndex + 1;
        let lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
        if (lineEnd > lineStart && content[lineEnd - 1] === '\r') {
            lineEnd--;
        }

        const line = content.substring(lineStart, lineEnd);
        const fenceMarker = getFenceMarker(line);

        if (!activeFence) {
            if (fenceMarker && !(fenceMarker.marker === '`' && fenceMarker.rest.includes('`'))) {
                activeFence = {
                    marker: fenceMarker.marker,
                    length: fenceMarker.length,
                    start: lineStart
                };
            }
        } else if (
            fenceMarker &&
            fenceMarker.marker === activeFence.marker &&
            fenceMarker.length >= activeFence.length &&
            fenceMarker.rest.trim().length === 0
        ) {
            ranges.push({ start: activeFence.start, end: nextLineStart });
            activeFence = undefined;
        }

        lineStart = nextLineStart;
    }

    if (activeFence) {
        ranges.push({ start: activeFence.start, end: content.length });
    }

    return ranges;
}

function isEscaped(content: string, index: number): boolean {
    let slashCount = 0;
    for (let current = index - 1; current >= 0 && content[current] === '\\'; current--) {
        slashCount++;
    }
    return slashCount % 2 === 1;
}

function isFollowedByBlankLine(content: string, newlineIndex: number, end: number): boolean {
    const nextLineStart = newlineIndex + 1;
    const nextNewlineIndex = content.indexOf('\n', nextLineStart);
    const nextLineEnd = nextNewlineIndex === -1 ? end : Math.min(nextNewlineIndex, end);
    return content.substring(nextLineStart, nextLineEnd).trim().length === 0;
}

function getInlineCodeRanges(content: string, start: number, end: number): TextRange[] {
    const ranges: TextRange[] = [];
    let index = start;

    while (index < end) {
        if (content[index] !== '`' || isEscaped(content, index)) {
            index++;
            continue;
        }

        let openingEnd = index;
        while (openingEnd < end && content[openingEnd] === '`') {
            openingEnd++;
        }
        const openingLength = openingEnd - index;
        let closingStart = openingEnd;
        let matchedEnd: number | undefined;

        while (closingStart < end) {
            // 行内代码可以跨普通换行，但不能跨越分隔 Markdown 块的空行
            if (content[closingStart] === '\n' && isFollowedByBlankLine(content, closingStart, end)) {
                break;
            }
            if (content[closingStart] !== '`') {
                closingStart++;
                continue;
            }

            let closingEnd = closingStart;
            while (closingEnd < end && content[closingEnd] === '`') {
                closingEnd++;
            }

            if (closingEnd - closingStart === openingLength) {
                matchedEnd = closingEnd;
                break;
            }
            closingStart = closingEnd;
        }

        if (matchedEnd === undefined) {
            index = openingEnd;
            continue;
        }

        ranges.push({ start: index, end: matchedEnd });
        index = matchedEnd;
    }

    return ranges;
}

function getMarkdownCodeRanges(content: string): TextRange[] {
    const fencedRanges = getFencedCodeRanges(content);
    const ranges = [...fencedRanges];
    let textStart = 0;

    for (const fencedRange of fencedRanges) {
        ranges.push(...getInlineCodeRanges(content, textStart, fencedRange.start));
        textStart = fencedRange.end;
    }
    ranges.push(...getInlineCodeRanges(content, textStart, content.length));

    return ranges.sort((a, b) => a.start - b.start);
}

/**
 * 将注释内容按照标签进行解析，识别普通文本中的特殊标签。
 * 支持的标签格式：
 * 声明标签：${标签名} （如 ${bug}、${todo}）
 * 引用标签：@标签名 （如 @bug、@todo）
 * 行内代码和 fenced code block 中的相同文本不会被识别为标签。
 *
 * @param content 要解析的 Markdown 注释内容
 * @returns 标签及其类型、名称和原文位置
 */
export function extractTagsFromMarkdown(content: string): MarkdownTag[] {
    const tags: MarkdownTag[] = [];
    const codeRanges = getMarkdownCodeRanges(content);
    const tagRegex = /(\$\{([\u4e00-\u9fa5a-zA-Z_][\u4e00-\u9fa5a-zA-Z0-9_]*)\})|(@([\u4e00-\u9fa5a-zA-Z_][\u4e00-\u9fa5a-zA-Z0-9_]*))/g;
    let codeRangeIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(content)) !== null) {
        while (codeRangeIndex < codeRanges.length && codeRanges[codeRangeIndex].end <= match.index) {
            codeRangeIndex++;
        }

        const codeRange = codeRanges[codeRangeIndex];
        if (codeRange && match.index >= codeRange.start && match.index < codeRange.end) {
            continue;
        }
        if (isEscaped(content, match.index)) {
            continue;
        }

        const isDeclaration = match[2] !== undefined;
        tags.push({
            text: match[0],
            tagName: isDeclaration ? match[2] : match[4],
            type: isDeclaration ? 'declaration' : 'reference',
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return tags;
}

export function findTagReferenceAtPosition(content: string, position: number): MarkdownTag | undefined {
    return extractTagsFromMarkdown(content).find(tag =>
        tag.type === 'reference' &&
        position >= tag.start &&
        position <= tag.end
    );
}

/** 使用同一次解析得到的位置替换标签引用，避免渲染时重复解析 Markdown。 */
export function replaceTagReferencesInMarkdown(
    content: string,
    tags: readonly MarkdownTag[],
    replacer: (tag: MarkdownTag) => string
): string {
    const references = tags.filter(tag => tag.type === 'reference');
    let result = '';
    let lastIndex = 0;

    for (const reference of references) {
        result += content.substring(lastIndex, reference.start);
        result += replacer(reference);
        lastIndex = reference.end;
    }

    return result + content.substring(lastIndex);
}
