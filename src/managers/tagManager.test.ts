import { describe, expect, it } from 'vitest';
import { TagManager } from './tagManager';

describe('TagManager', () => {
    it('不应索引 Markdown 代码中的标签', () => {
        const manager = new TagManager();
        manager.updateTags({
            '/project/model.py': [{
                id: 'comment-1',
                line: 10,
                originalLine: 10,
                lineContent: '@dataclass',
                timestamp: 1,
                content: [
                    '${data_model} 使用 @serializer',
                    '',
                    '`@property`',
                    '',
                    '```python',
                    '@dataclass',
                    'class User:',
                    '    pass',
                    '```',
                    '',
                    '```rust',
                    'let template = "${not_a_tag}";',
                    '```'
                ].join('\n')
            }]
        });

        expect([...manager.getTagDeclarations().keys()]).toEqual(['data_model']);
        expect(manager.getTagReferences().map(reference => reference.tagName)).toEqual(['serializer']);
    });
});
