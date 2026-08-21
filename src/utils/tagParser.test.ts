import { describe, expect, it } from 'vitest';
import {
    extractTagsFromMarkdown,
    findTagReferenceAtPosition,
    replaceTagReferencesInMarkdown
} from './tagParser';

describe('tagParser', () => {
    it('应提取普通 Markdown 文本中的声明和引用', () => {
        const content = '${model} 由 @solver 和 @变量_1 使用';

        expect(extractTagsFromMarkdown(content)).toEqual([
            { text: '${model}', tagName: 'model', type: 'declaration', start: 0, end: 8 },
            { text: '@solver', tagName: 'solver', type: 'reference', start: 11, end: 18 },
            { text: '@变量_1', tagName: '变量_1', type: 'reference', start: 21, end: 26 }
        ]);
    });

    it('应忽略行内代码中的标签', () => {
        const content = '正文 @todo，代码 `@dataclass`，之后 @done';

        expect(extractTagsFromMarkdown(content).map(tag => tag.text)).toEqual(['@todo', '@done']);
    });

    it('应支持多反引号行内代码', () => {
        const content = '``code `@classmethod` here`` 和 @realTag';

        expect(extractTagsFromMarkdown(content).map(tag => tag.text)).toEqual(['@realTag']);
    });

    it('行内代码中的反斜杠不应转义结束反引号', () => {
        const content = '`code\\` @outside';

        expect(extractTagsFromMarkdown(content).map(tag => tag.text)).toEqual(['@outside']);
    });

    it('行内代码不应跨越 Markdown 块之间的空行', () => {
        const content = '`unfinished\n\n@dataclass\nclass User:\n    pass`';

        expect(extractTagsFromMarkdown(content).map(tag => tag.text)).toEqual(['@dataclass']);
    });

    it('应忽略反引号和波浪号 fenced code block 中的标签', () => {
        const content = [
            '@before',
            '```python',
            '@dataclass',
            'class User:',
            '    pass',
            '```',
            '~~~rust',
            'let template = "${hidden}";',
            '~~~',
            '@after'
        ].join('\n');

        expect(extractTagsFromMarkdown(content).map(tag => tag.text)).toEqual(['@before', '@after']);
    });

    it('未闭合的 fenced code block 应保护到内容结尾', () => {
        const content = '@before\n```python\n@dataclass\nclass User:';

        expect(extractTagsFromMarkdown(content).map(tag => tag.text)).toEqual(['@before']);
    });

    it('不应把转义后的标签识别为标签', () => {
        const content = '\\@escaped \\${hidden} @visible ${shown}';

        expect(extractTagsFromMarkdown(content).map(tag => tag.text)).toEqual(['@visible', '${shown}']);
    });

    it('应按 Markdown 原文位置查找引用并忽略代码', () => {
        const content = '`@staticmethod` and @target';
        const targetStart = content.indexOf('@target');

        expect(findTagReferenceAtPosition(content, 2)).toBeUndefined();
        expect(findTagReferenceAtPosition(content, targetStart + 2)?.tagName).toBe('target');
    });

    it('替换引用时应完整保留代码中的 @ 内容', () => {
        const content = '`@staticmethod` and @target';
        const tags = extractTagsFromMarkdown(content);
        const result = replaceTagReferencesInMarkdown(content, tags, tag => `[${tag.text}](command:tag)`);

        expect(result).toBe('`@staticmethod` and [@target](command:tag)');
    });
});
