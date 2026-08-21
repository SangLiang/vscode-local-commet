import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    TextDocumentChangeReason: {
        Undo: 1,
        Redo: 2
    }
}));

import * as vscode from 'vscode';
import { DocumentEventHandler } from './DocumentEventHandler';

function createHandler() {
    const handleDocumentChange = vi.fn();
    const container = {
        commentManager: {
            handleDocumentChange,
            getAllComments: vi.fn(() => ({}))
        },
        bookmarkManager: {
            handleDocumentChange: vi.fn()
        },
        tagManager: {
            updateTags: vi.fn()
        },
        commentProvider: {
            refresh: vi.fn()
        }
    };
    const handler = new DocumentEventHandler(container as any, {} as any);

    return { handler, handleDocumentChange };
}

function createEvent(isDirty: boolean, reason?: vscode.TextDocumentChangeReason) {
    return {
        document: {
            isDirty,
            uri: { fsPath: '/project/main.py' }
        },
        contentChanges: [{
            range: {
                start: { line: 0 },
                end: { line: 0 }
            },
            text: 'x'
        }],
        reason
    };
}

describe('DocumentEventHandler', () => {
    it('dirty 文档变化应作为编辑操作处理', () => {
        const { handler, handleDocumentChange } = createHandler();
        const event = createEvent(true);

        (handler as any).handleDocumentChange(event);

        expect(handleDocumentChange).toHaveBeenCalledWith(event, false);
        handler.dispose();
    });

    it('clean 文档的未知来源变化应作为外部文件更新处理', () => {
        const { handler, handleDocumentChange } = createHandler();
        const event = createEvent(false);

        (handler as any).handleDocumentChange(event);

        expect(handleDocumentChange).toHaveBeenCalledWith(event, true);
        handler.dispose();
    });

    it('使文档恢复 clean 的 Undo 不应被当作外部文件更新', () => {
        const { handler, handleDocumentChange } = createHandler();
        const event = createEvent(false, vscode.TextDocumentChangeReason.Undo);

        (handler as any).handleDocumentChange(event);

        expect(handleDocumentChange).toHaveBeenCalledWith(event, false);
        handler.dispose();
    });

    it('使文档恢复 clean 的 Redo 不应被当作外部文件更新', () => {
        const { handler, handleDocumentChange } = createHandler();
        const event = createEvent(false, vscode.TextDocumentChangeReason.Redo);

        (handler as any).handleDocumentChange(event);

        expect(handleDocumentChange).toHaveBeenCalledWith(event, false);
        handler.dispose();
    });
});
