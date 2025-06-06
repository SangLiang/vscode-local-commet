import * as vscode from 'vscode';
import { TagManager } from '../tagManager';
import { CommentManager } from '../commentManager';

export class TagDefinitionProvider implements vscode.DefinitionProvider {
    constructor(
        private tagManager: TagManager,
        private commentManager: CommentManager
    ) {}

    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        
        // 检查当前位置是否在注释中
        const comments = this.commentManager.getComments(document.uri);
        const currentComment = comments.find(c => c.line === position.line);
        
        if (!currentComment) {
            return [];
        }

        // 获取当前行的文本
        const lineText = document.lineAt(position.line).text;
        const lineLength = lineText.length;
        
        // 注释内容的起始位置：行末 + " 💬 " (4个字符)
        const contentStart = lineLength + 4;
        
        // 检查光标是否在注释区域内
        if (position.character < contentStart) {
            return [];
        }

        // 计算在注释内容中的相对位置
        const relativePosition = position.character - contentStart;
        const commentContent = currentComment.content;
        
        if (relativePosition < 0 || relativePosition > commentContent.length) {
            return [];
        }

        // 查找光标位置的标签引用
        const tagReference = this.findTagReferenceAtPosition(commentContent, relativePosition);
        
        if (!tagReference) {
            return [];
        }

        // 查找标签声明
        const declaration = this.tagManager.getTagDeclaration(tagReference.tagName);
        
        if (!declaration) {
            return [];
        }

        // 返回跳转位置
        const targetUri = vscode.Uri.file(declaration.filePath);
        const targetPosition = new vscode.Position(declaration.line, 0);
        const targetLocation = new vscode.Location(targetUri, targetPosition);

        return [targetLocation];
    }

    private findTagReferenceAtPosition(text: string, position: number): { tagName: string; start: number; end: number } | undefined {
        // 查找所有 @标签名 的位置
        const regex = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            const start = match.index;
            const end = match.index + match[0].length;
            
            if (position >= start && position <= end) {
                return {
                    tagName: match[1],
                    start,
                    end
                };
            }
        }
        
        return undefined;
    }
} 