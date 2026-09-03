import * as vscode from 'vscode';
import * as path from 'path';
import { CommentManager, LocalComment, SharedComment, FileComments } from '../managers/commentManager';
import { FileHeatManager } from '../managers/fileHeatManager';
import { BookmarkManager, Bookmark } from '../managers/bookmarkManager';
import { logger } from '../utils/logger';
import { COMMANDS } from '../constants';
import { resolveCommentTreeIcon, buildCommentTreeIconSvg } from '../utils/commentDecorationColor';

const commentTreeIconUriCache = new Map<string, vscode.Uri>();

function commentTreeIconUri(hex: string): vscode.Uri {
    const cached = commentTreeIconUriCache.get(hex);
    if (cached) {
        return cached;
    }
    const svg = buildCommentTreeIconSvg(hex);
    const uri = vscode.Uri.from({
        scheme: 'data',
        path: `image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    });
    commentTreeIconUriCache.set(hex, uri);
    return uri;
}

export class CommentTreeProvider implements vscode.TreeDataProvider<CommentTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<CommentTreeItem | undefined | null | void> = new vscode.EventEmitter<CommentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CommentTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private disposables: vscode.Disposable[] = [];
    
    constructor(private commentManager: CommentManager, private fileHeatManager?: FileHeatManager, private bookmarkManager?: BookmarkManager) {
        // 监听文件热度更新事件，只有在热度更新时才刷新排序
        if (this.fileHeatManager) {
            const heatUpdateDisposable = this.fileHeatManager.onDidUpdateHeat(() => {
                logger.debug('[CommentTreeProvider] 文件热度更新，触发注释树刷新');
                this.refresh(); // 热度更新时刷新注释树排序
            });
            this.disposables.push(heatUpdateDisposable);
        }
        
        // 监听书签变化事件
        if (this.bookmarkManager) {
            const bookmarkUpdateDisposable = this.bookmarkManager.onDidChangeBookmarks(() => {
                logger.debug('🔖 [CommentTreeProvider] 书签变化，触发注释树刷新');
                this.refresh();
            });
            this.disposables.push(bookmarkUpdateDisposable);
        }
    }

    refresh(): void {
        logger.debug('🔄 [CommentTreeProvider] 执行完整刷新 - 触发树数据变更事件');
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CommentTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CommentTreeItem): Thenable<CommentTreeItem[]> {
        if (!element) {
            // 根节点，返回所有有注释的文件
            return Promise.resolve(this.getFileNodes());
        } else if (element.contextValue === 'file') {
            // 文件节点，返回该文件的所有注释和书签
            return Promise.resolve(this.getCommentAndBookmarkNodes(element.filePath!));
        }
        return Promise.resolve([]);
    }

    private getFileNodes(): CommentTreeItem[] {
        const allComments = this.commentManager.getAllComments();
        const allBookmarks = this.bookmarkManager?.getAllBookmarks() || {};
        const fileNodes: CommentTreeItem[] = [];

        // 获取所有有注释或书签的文件
        const allFiles = new Set([...Object.keys(allComments), ...Object.keys(allBookmarks)]);

        for (const filePath of allFiles) {
            const allFileComments = allComments[filePath] || [];
            const bookmarks = allBookmarks[filePath] || [];
            
            // 只统计本地注释，不包括共享注释
            const localComments = allFileComments.filter(comment => !('userId' in comment));
            const totalCount = localComments.length + bookmarks.length;
            
            if (totalCount > 0) {
                const fileName = path.basename(filePath);
                
                // 创建文件节点的显示名称，统一显示风格
                let displayName = `${fileName} (${totalCount})`;
                
                let tooltip = filePath;
                
                // 如果有文件热度管理器，添加热度信息
                if (this.fileHeatManager) {
                    const heatInfo = this.fileHeatManager.getFileHeatInfo(filePath);
                    const heatScore = this.fileHeatManager.calculateHeatScore(filePath);
                    
                    if (heatInfo && heatScore > 0) {
                        // 在tooltip中显示详细的热度信息
                        const lastAccessTime = new Date(heatInfo.lastAccessTime).toLocaleString();
                        const activeMinutes = Math.round(heatInfo.totalActiveTime / (60 * 1000));
                        
                        tooltip = `${filePath}\n\n文件热度信息:\n` +
                                `热度分数: ${heatScore.toFixed(1)}\n` +
                                `访问次数: ${heatInfo.accessCount}\n` +
                                `最后访问: ${lastAccessTime}\n` +
                                `活跃时间: ${activeMinutes}分钟`;
                    }
                }
                
                const fileNode = new CommentTreeItem(
                    displayName,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'file'
                );
                fileNode.filePath = filePath;
                fileNode.tooltip = tooltip;
                
                // 为当前编辑的高热度文件设置特殊图标
                const currentEditor = vscode.window.activeTextEditor;
                const isCurrentFile = currentEditor && currentEditor.document.uri.fsPath === filePath;
                const currentHeatScore = this.fileHeatManager ? this.fileHeatManager.calculateHeatScore(filePath) : 0;
                const hasHeat = currentHeatScore > 0;
                
                if (isCurrentFile && hasHeat) {
                    // 使用火焰图标表示当前编辑的高热度文件
                    fileNode.iconPath = new vscode.ThemeIcon('heart');
                } else {
                    // 使用默认的文件图标
                    fileNode.iconPath = new vscode.ThemeIcon('file-code');
                }
                
                fileNodes.push(fileNode);
            }
        }

        if (fileNodes.length === 0) {
            const emptyNode = new CommentTreeItem(
                '暂无本地注释和书签',
                vscode.TreeItemCollapsibleState.None,
                'empty'
            );
            emptyNode.iconPath = new vscode.ThemeIcon('info');
            return [emptyNode];
        }

        // 按文件热度排序
        if (this.fileHeatManager) {
            const filePaths = fileNodes.map(node => node.filePath!);
            const sortedFilePaths = this.fileHeatManager.getFilesByHeat(filePaths);
            
            // 重新排序文件节点
            const sortedFileNodes: CommentTreeItem[] = [];
            for (const filePath of sortedFilePaths) {
                const node = fileNodes.find(n => n.filePath === filePath);
                if (node) {
                    sortedFileNodes.push(node);
                }
            }
            return sortedFileNodes;
        }

        // 如果没有热度管理器，按文件名排序
        return fileNodes.sort((a, b) => {
            const nameA = path.basename(a.filePath || '');
            const nameB = path.basename(b.filePath || '');
            return nameA.localeCompare(nameB);
        });
    }

    private getCommentNodes(filePath: string): CommentTreeItem[] {
        // 使用getComments方法获取最新的注释状态
        const uri = vscode.Uri.file(filePath);
        const matchedComments = this.commentManager.getComments(uri);
        const commentNodes: CommentTreeItem[] = [];

        // 获取所有注释（包括未匹配的）
        const allComments = this.commentManager.getAllComments()[filePath] || [];

        // 创建匹配注释的Map，提高查找效率
        const matchedCommentsMap = new Map(
            matchedComments.map(comment => [comment.id, comment])
        );

        // 处理所有注释，包括未匹配的
        for (const comment of allComments) {
            // 跳过共享注释，暂时不在注释树中显示
            const isSharedComment = 'userId' in comment;
            if (isSharedComment) {
                continue; // 跳过共享注释
            }
            
            // 使用Map快速查找匹配的注释
            const matchedComment = matchedCommentsMap.get(comment.id);
            const isMatchable = matchedComment !== undefined;
            
            // 构建标签
            const label = `第${(matchedComment?.line || comment.line) + 1}行: ${comment.content}`;
            
            const commentNode = new CommentTreeItem(
                label,
                vscode.TreeItemCollapsibleState.None,
                isMatchable ? 'comment' : 'hidden-comment' // 恢复使用hidden-comment类型来区分未匹配的注释
            );
            
            commentNode.filePath = filePath;
            commentNode.comment = matchedComment || comment;
            
            // 创建Markdown格式的tooltip
            const markdownTooltip = new vscode.MarkdownString();
            markdownTooltip.appendMarkdown(comment.content);
            
            if (!isMatchable) {
                markdownTooltip.appendMarkdown('\n\n*注释当前无法匹配到代码，已被隐藏*');
                commentNode.resourceUri = vscode.Uri.parse(`hidden-comment:${comment.id}`);
            }

            const treeIcon = resolveCommentTreeIcon(comment.color, isMatchable);
            commentNode.iconPath = treeIcon.colorHex
                ? commentTreeIconUri(treeIcon.colorHex)
                : new vscode.ThemeIcon(treeIcon.iconId);
            
            commentNode.tooltip = markdownTooltip;
            
            // 添加命令，点击时跳转到对应位置
            // 即使是隐藏注释也可以尝试跳转，用户可能想手动查找
            commentNode.command = {
                command: COMMANDS.GO_TO_COMMENT,
                title: '跳转到注释',
                arguments: [filePath, matchedComment?.line || comment.line]
            };

            commentNodes.push(commentNode);
        }

        // 按行号排序
        return commentNodes.sort((a, b) => {
            const lineA = a.comment?.line ?? Number.MAX_SAFE_INTEGER;
            const lineB = b.comment?.line ?? Number.MAX_SAFE_INTEGER;
            return lineA - lineB;
        });
    }

    private getCommentAndBookmarkNodes(filePath: string): CommentTreeItem[] {
        const commentNodes = this.getCommentNodes(filePath);
        const bookmarkNodes = this.getBookmarkNodes(filePath);
        
        // 合并注释和书签节点，按行号排序
        const allNodes = [...commentNodes, ...bookmarkNodes];
        if (allNodes.length === 0) {
            const fallbackNode = new CommentTreeItem(
                '该文件暂无可展示条目',
                vscode.TreeItemCollapsibleState.None,
                'empty'
            );
            fallbackNode.iconPath = new vscode.ThemeIcon('info');
            fallbackNode.tooltip = '当前文件节点包含数据，但未生成可展示的注释/书签子节点';
            return [fallbackNode];
        }

        return allNodes.sort((a, b) => {
            const lineA = a.comment?.line ?? a.bookmark?.line ?? Number.MAX_SAFE_INTEGER;
            const lineB = b.comment?.line ?? b.bookmark?.line ?? Number.MAX_SAFE_INTEGER;
            return lineA - lineB;
        });
    }

    private getBookmarkNodes(filePath: string): CommentTreeItem[] {
        if (!this.bookmarkManager) {
            return [];
        }

        const uri = vscode.Uri.file(filePath);
        const bookmarks = this.bookmarkManager.getBookmarks(uri);
        const bookmarkNodes: CommentTreeItem[] = [];

        for (const bookmark of bookmarks) {
            // 构建书签显示标签，包含行内容
            let label = `第${bookmark.line + 1}行: `;
            
            // 如果有自定义标签，优先显示标签
            if (bookmark.label) {
                label += ` - ${bookmark.label}`;
            }
            // 如果有行内容，显示行内容（截断过长的内容）
            else if (bookmark.lineContent) {
                const maxLength = 50; // 最大显示长度
                const content = bookmark.lineContent.length > maxLength 
                    ? bookmark.lineContent.substring(0, maxLength) + '...'
                    : bookmark.lineContent;
                label += ` - ${content}`;
            }
            
            const bookmarkNode = new CommentTreeItem(
                label,
                vscode.TreeItemCollapsibleState.None,
                'bookmark'
            );
            
            bookmarkNode.filePath = filePath;
            bookmarkNode.bookmark = bookmark;
            bookmarkNode.iconPath = new vscode.ThemeIcon('bookmark');
            
            // 创建tooltip
            const markdownTooltip = new vscode.MarkdownString();
            markdownTooltip.appendMarkdown(`**书签**\n\n`);
            markdownTooltip.appendMarkdown(`位置: 第 ${bookmark.line + 1} 行\n\n`);
            if (bookmark.label) {
                markdownTooltip.appendMarkdown(`标签: ${bookmark.label}\n\n`);
            }
            markdownTooltip.appendMarkdown(`创建时间: ${new Date(bookmark.timestamp).toLocaleString()}`);
            bookmarkNode.tooltip = markdownTooltip;
            
            // 添加命令，点击时跳转到对应位置
            bookmarkNode.command = {
                command: COMMANDS.GO_TO_BOOKMARK,
                title: '跳转到书签',
                arguments: [filePath, bookmark.line]
            };

            bookmarkNodes.push(bookmarkNode);
        }

        return bookmarkNodes;
    }

    dispose(): void {
        // 清理所有disposables
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

export class CommentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
    }

    filePath?: string;
    comment?: LocalComment | SharedComment;
    bookmark?: Bookmark;
}

// 为CommentTreeProvider添加dispose方法
export interface CommentTreeProviderDisposable {
    dispose(): void;
}