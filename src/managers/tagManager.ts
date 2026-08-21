import { LocalComment, SharedComment } from './commentTypes';
import { extractTagsFromMarkdown } from '../utils/tagParser';

export interface TagDeclaration {
    tagName: string;
    filePath: string;
    line: number;
    commentId: string;
    content: string;
}

export interface TagReference {
    tagName: string;
    filePath: string;
    line: number;
    commentId: string;
    startChar: number;
    endChar: number;
}

export class TagManager {
    private tagDeclarations: Map<string, TagDeclaration> = new Map();
    private tagReferences: TagReference[] = [];

    public updateTags(allComments: { [filePath: string]: (LocalComment | SharedComment)[] }): void {
        // 清空现有标签
        this.tagDeclarations.clear();
        this.tagReferences = [];

        // 扫描所有注释，提取标签
        for (const [filePath, comments] of Object.entries(allComments)) {
            for (const comment of comments) {
                this.extractTagsFromComment(filePath, comment);
            }
        }
    }

    private extractTagsFromComment(filePath: string, comment: LocalComment | SharedComment): void {
        const tags = extractTagsFromMarkdown(comment.content);

        for (const tag of tags) {
            if (tag.type === 'declaration') {
                // 提取标签声明 (${标签名})，支持中文；Markdown代码中的内容已由解析器过滤
                const declaration: TagDeclaration = {
                    tagName: tag.tagName,
                    filePath,
                    line: comment.line,
                    commentId: comment.id,
                    content: comment.content
                };
                this.tagDeclarations.set(tag.tagName, declaration);
            } else {
                // 提取标签引用 (@标签名)，支持中文；保留原文位置用于查找
                const reference: TagReference = {
                    tagName: tag.tagName,
                    filePath,
                    line: comment.line,
                    commentId: comment.id,
                    startChar: tag.start,
                    endChar: tag.end
                };
                this.tagReferences.push(reference);
            }
        }
    }

    public getTagDeclarations(): Map<string, TagDeclaration> {
        return this.tagDeclarations;
    }

    public getTagReferences(): TagReference[] {
        return this.tagReferences;
    }

    public getTagDeclaration(tagName: string): TagDeclaration | undefined {
        return this.tagDeclarations.get(tagName);
    }

    public getReferencesForTag(tagName: string): TagReference[] {
        return this.tagReferences.filter(ref => ref.tagName === tagName);
    }

    public getAvailableTagNames(): string[] {
        return Array.from(this.tagDeclarations.keys()).sort();
    }

    public findTagReferenceAtPosition(filePath: string, line: number, character: number): TagReference | undefined {
        return this.tagReferences.find(ref => 
            ref.filePath === filePath && 
            ref.line === line && 
            character >= ref.startChar && 
            character <= ref.endChar
        );
    }
}