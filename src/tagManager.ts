import { LocalComment } from './commentManager';

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

    public updateTags(allComments: { [filePath: string]: LocalComment[] }): void {
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

    private extractTagsFromComment(filePath: string, comment: LocalComment): void {
        const content = comment.content;

        // 提取标签声明 ($标签名)
        const declarationRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        while ((match = declarationRegex.exec(content)) !== null) {
            const tagName = match[1];
            const declaration: TagDeclaration = {
                tagName,
                filePath,
                line: comment.line,
                commentId: comment.id,
                content: comment.content
            };
            this.tagDeclarations.set(tagName, declaration);
        }

        // 提取标签引用 (@标签名)
        const referenceRegex = /\@([a-zA-Z_][a-zA-Z0-9_]*)/g;
        while ((match = referenceRegex.exec(content)) !== null) {
            const tagName = match[1];
            const reference: TagReference = {
                tagName,
                filePath,
                line: comment.line,
                commentId: comment.id,
                startChar: match.index,
                endChar: match.index + match[0].length
            };
            this.tagReferences.push(reference);
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