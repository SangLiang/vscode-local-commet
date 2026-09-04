import * as vscode from 'vscode';
import * as path from 'path';
import { CommentProvider } from '../../providers/commentProvider';
import { CommentTreeProvider } from '../../providers/commentTreeProvider';
import { CommentManager, LocalComment } from '../../managers/commentManager';
import { TagManager } from '../../managers/tagManager';
import { AuthManager } from '../../managers/authManager';
import { ProjectManager } from '../../managers/projectManager';
import { showMarkdownWebviewInput } from '../markdownWebview';
import { openCommentEditor } from '../commentEditActions';
import { showQuickInputWithTagCompletion } from '../../utils/quickInput';
import { getFileNameFromPath, getFileNameFromUri } from '../../utils/pathUtils';
import { getErrorMessage } from '../../utils/utils';
import { logger } from '../../utils/logger';
import { COMMANDS } from '../../constants';
import { DialogUtils } from '../../utils/dialogUtils';
import { isCommentEditNoop } from '../../utils/commentDecorationColor';

/**
 * 更新上下文信息接口
 */
export interface UpdatedContextInfo {
    lineNumber?: number;
    lineContent?: string;
}

export interface MarkdownContextInfo extends UpdatedContextInfo {
    fileName?: string;
    originalLineContent?: string;
    selectedText?: string;
    contextLines?: string[];
    contextStartLine?: number;
    filePath?: string;
    fileNotFound?: boolean;
}

/** Markdown 编辑面板「保存并继续」回调的返回结果，供 Webview 更新 dirty 基线 */
export type MarkdownSaveOutcome =
    | 'committed'
    | 'skipped-noop'
    | 'skipped-empty'
    | 'aborted'
    | 'failed';

export type MarkdownSaveCallback = (
    content: string,
    updatedContextInfo?: UpdatedContextInfo,
    callback?: () => void,
    color?: string
) => void | Promise<MarkdownSaveOutcome>;

export function registerCommentCommands(
    commentManager: CommentManager,
    tagManager: TagManager,
    commentProvider: CommentProvider,
    commentTreeProvider: CommentTreeProvider,
    authManager: AuthManager,
    projectManager: ProjectManager,
    context?: vscode.ExtensionContext
): vscode.Disposable[] {
    
    /**
     * 刷新所有本地注释相关的视图和显示
     * 统一处理注释内容、注释树等所有相关组件的刷新
     */
    function refreshAllCommentViews(): void {
        commentProvider.refresh();      // 更新编辑器里的本地注释内容
        commentTreeProvider.refresh();  // 刷新注释树
    }

    /**
     * 解析来自 hover 或命令调用的参数，并校验必填字段。
     *
     * 用于统一处理「编辑注释」「删除注释」「预览注释」等命令的入参：
     * - 支持传入已解析的普通对象（如从树视图传入的 item）
     * - 支持传入 JSON 字符串（如从 hover 或 Markdown 链接传入的序列化参数）
     *
     * @param args - 命令参数，可为 object 或 JSON 字符串
     * @param requiredKeys - 必填字段名列表，如 ['uri', 'commentId', 'line'] 或 ['uri', 'content']
     * @returns 解析并校验通过时返回键值对；失败时弹出错误提示并返回 null
     *
     * 失败情况与提示：
     * - 传入 string 但 JSON 解析失败 → 「参数格式错误」
     * - 传入既非 object 也非 string（如 number） → 「参数类型不正确」
     * - 缺少 requiredKeys 中任一字段或值为 null/undefined → 「参数不完整」
     */
    function parseCommentCommandArgs(args: unknown, requiredKeys: string[]): Record<string, unknown> | null {
        let parsed: Record<string, unknown>;
        if (typeof args === 'object' && args !== null) {
            parsed = args as Record<string, unknown>;
        } else if (typeof args === 'string') {
            try {
                parsed = JSON.parse(args) as Record<string, unknown>;
            } catch (parseError) {
                logger.error('参数解析失败:', parseError);
                vscode.window.showErrorMessage('参数格式错误');
                return null;
            }
        } else {
            vscode.window.showErrorMessage('参数类型不正确');
            return null;
        }
        for (const key of requiredKeys) {
            if (parsed[key] === undefined || parsed[key] === null) {
                vscode.window.showErrorMessage('参数不完整');
                return null;
            }
        }
        return parsed;
    }

    // 辅助函数：创建保存并继续的回调函数
    function createSaveAndContinueCallback(
        operation: 'edit' | 'add',
        uri: vscode.Uri,
        commentId: string,
        line: number,
        originalContent: string,
        originalColor?: string
    ) {
        // 辅助函数：处理编辑注释的逻辑
        async function handleEditComment(savedContent: string, updatedContextInfo?: UpdatedContextInfo, color?: string) {
            // 如果行号有变化，需要先更新注释的行号
            if (updatedContextInfo?.lineNumber !== undefined && updatedContextInfo.lineNumber !== line) {
                await commentManager.updateCommentLine(uri, commentId, updatedContextInfo.lineNumber, updatedContextInfo.lineContent || '');
            }
            return commentManager.editComment(uri, commentId, savedContent, color);
        }

        return async (savedContent: string, updatedContextInfo?: UpdatedContextInfo, callback?: () => void, color?: string): Promise<MarkdownSaveOutcome> => {
            try {
                // 对于添加操作，检查内容是否为空
                if (operation === 'add' && (!savedContent || savedContent.trim() === '')) {
                    callback && callback();
                    return 'skipped-empty';
                }
                
                // 对于编辑操作，检查内容或颜色是否发生变化
                if (operation === 'edit' && isCommentEditNoop(savedContent, originalContent, color, originalColor)) {
                    callback && callback();
                    return 'skipped-noop';
                }

                // 如果行号有变化，使用更新后的行号
                const finalLine = updatedContextInfo?.lineNumber ?? line;
                // 检查目标行是否已有其他注释
                if (updatedContextInfo?.lineNumber !== undefined && updatedContextInfo.lineNumber !== line) {
                    const allComments = commentManager.getAllComments();
                    const fileComments = allComments[uri.fsPath];
                    
                    if (fileComments) {
                        const existingComment = fileComments.find(c => c.line === finalLine && c.id !== commentId);
                        if (existingComment) {
                            const replaceExisting = await DialogUtils.showConfirmDialog(
                                `第${finalLine + 1}行已经有注释了：\n"${existingComment.content}"\n\n是否要替换它？`,
                                '替换现有注释',
                                '取消操作',
                                { modal: true }
                            );
                            
                            if (!replaceExisting) {
                                return 'aborted';
                            }
                            
                            // 删除现有注释
                            const existingIndex = commentManager.findCommentIndex(fileComments, existingComment.id);
                            if (existingIndex >= 0) {
                                fileComments.splice(existingIndex, 1);
                            }
                        }
                    }
                }
                const promise = operation === 'edit' 
                    ? handleEditComment(savedContent, updatedContextInfo, color)
                    : commentManager.addComment(uri, finalLine, savedContent, color);
                
                await promise;
                tagManager.updateTags(commentManager.getAllComments());
                refreshAllCommentViews();
                callback && callback();
                return 'committed';
            } catch (error) {
                logger.error('保存注释时发生错误:', error);
                vscode.window.showErrorMessage(`保存失败: ${error}`);
                return 'failed';
            }
        };
    }

    const refreshCommentsCommand = vscode.commands.registerCommand(COMMANDS.REFRESH_COMMENTS, () => {
        refreshAllCommentViews();
    });

    const refreshTreeCommand = vscode.commands.registerCommand(COMMANDS.REFRESH_TREE, () => {
        commentTreeProvider.refresh();
    });

    const deleteCommentFromTreeCommand = vscode.commands.registerCommand(COMMANDS.DELETE_COMMENT_FROM_TREE, async (item) => {
        if ((item.contextValue === 'comment' || item.contextValue === 'hidden-comment') && item.filePath && item.comment) {
            const uri = vscode.Uri.file(item.filePath);
            await commentManager.removeComment(uri, item.comment.line);
            tagManager.updateTags(commentManager.getAllComments());
            refreshAllCommentViews();
        }
    });

    const clearFileCommentsCommand = vscode.commands.registerCommand(COMMANDS.CLEAR_FILE_COMMENTS, async (item) => {
        if (item.contextValue === 'file' && item.filePath) {
            const fileName = getFileNameFromPath(item.filePath);
            await DialogUtils.showConfirmDialog(
                `确定要清除文件 "${fileName}" 的所有本地注释吗？此操作不可恢复！`,
                '确定清除',
                '取消',
                {
                    onConfirm: async () => {
                        const uri = vscode.Uri.file(item.filePath);
                        await commentManager.clearFileComments(uri);
                        tagManager.updateTags(commentManager.getAllComments());
                        refreshAllCommentViews();
                    }
                }
            );
        }
    });

    // 清空所有共享注释命令
    const clearAllSharedCommentsCommand = vscode.commands.registerCommand(COMMANDS.CLEAR_ALL_SHARED_COMMENTS, async () => {
        await DialogUtils.showConfirmDialog(
            '确定要清空所有共享注释吗？此操作不可恢复！',
            '确定清空',
            '取消',
            {
                onConfirm: async () => {
                    const removedCount = await commentManager.clearAllSharedComments();
                    if (removedCount > 0) {
                        tagManager.updateTags(commentManager.getAllComments());
                        refreshAllCommentViews();
                    }
                }
            }
        );
    });

    // 清空当前文件的共享注释命令
    const clearFileSharedCommentsCommand = vscode.commands.registerCommand(COMMANDS.CLEAR_FILE_SHARED_COMMENTS, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const uri = editor.document.uri;
        const fileName = getFileNameFromUri(uri);
        
        await DialogUtils.showConfirmDialog(
            `确定要清空文件 "${fileName}" 的所有共享注释吗？此操作不可恢复！`,
            '确定清空',
            '取消',
            {
                onConfirm: async () => {
                    const removedCount = await commentManager.clearFileSharedComments(uri);
                    if (removedCount > 0) {
                        tagManager.updateTags(commentManager.getAllComments());
                        refreshAllCommentViews();
                    }
                }
            }
        );
    });

    async function executeEditComment(
        uri: vscode.Uri,
        comment: Pick<LocalComment, 'id' | 'line' | 'content' | 'lineContent' | 'isShared' | 'color'>
    ) {
        await openCommentEditor({
            context: context!,
            commentManager,
            projectManager,
            authManager,
            uri,
            comment,
            onSaveAndContinue: createSaveAndContinueCallback('edit', uri, comment.id, comment.line, comment.content, comment.color),
        });
    }

    // 添加editCommentFromHover命令
    const editCommentFromHoverCommand = vscode.commands.registerCommand(COMMANDS.EDIT_COMMENT_FROM_HOVER, async (args) => {
        try {
            const parsedArgs = parseCommentCommandArgs(args, ['uri', 'commentId', 'line']);
            if (!parsedArgs) return;

            const { uri, commentId, line } = parsedArgs;
            const documentUri = vscode.Uri.parse(uri as string);
            const comment = commentManager.getCommentById(documentUri, commentId as string);
            
            if (!comment) {
                vscode.window.showWarningMessage(`找不到指定的注释`);
                return;
            }

            await executeEditComment(documentUri, comment);

        } catch (error) {
            logger.error('从hover编辑注释时发生错误:', error);
            vscode.window.showErrorMessage(`编辑注释时发生错误: ${getErrorMessage(error)}`);
        }
    });

    const editCommentFromTreeCommand = vscode.commands.registerCommand(COMMANDS.EDIT_COMMENT_FROM_TREE, async (item) => {
        if ((item.contextValue === 'comment' || item.contextValue === 'hidden-comment') && item.filePath && item.comment) {
            const uri = vscode.Uri.file(item.filePath);
            await executeEditComment(uri, item.comment);
        }
    });

    const goToCommentCommand = vscode.commands.registerCommand(COMMANDS.GO_TO_COMMENT, async (filePath: string, line: number, commentId?: string) => {
        try {
            const uri = vscode.Uri.file(filePath);
            
            const fileComments = commentManager.getAllComments()[filePath] || [];
            const sharedComments = commentManager.getAllSharedComments()[filePath] || [];
            
            let targetComment: LocalComment | undefined;
            let isSharedComment = false;
            
            if (commentId) {
                targetComment = fileComments.find(c => c.id === commentId);
                if (!targetComment) {
                    targetComment = sharedComments.find(c => c.id === commentId);
                    isSharedComment = true;
                }
            }
            
            if (!targetComment) {
                targetComment = fileComments.find(c => c.originalLine === line || c.line === line);
            }
            
            if (!targetComment) {
                targetComment = sharedComments.find(c => c.line === line);
                isSharedComment = true;
            }
            
            if (!targetComment) {
                vscode.window.showWarningMessage(`找不到第 ${line + 1} 行的注释`);
                return;
            }

            // 打开文档
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            
            // 对于共享注释，跳转到指定行并显示webview
            if (isSharedComment) {
                const position = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                
                // 显示共享注释的webview
                try {
                    // 动态导入shareCommentWebview模块
                    const { showShareCommentWebview } = await import('../shareCommentWebview');
                    
                    // 获取代码上下文信息
                    const contextLines = [];
                    const contextStartLine = Math.max(0, line - 2);
                    const contextEndLine = Math.min(document.lineCount - 1, line + 2);
                    
                    for (let i = contextStartLine; i <= contextEndLine; i++) {
                        contextLines.push(document.lineAt(i).text);
                    }
                    
                    // 构建上下文信息
                    const contextInfo = {
                        fileName: path.basename(filePath),
                        lineNumber: line,
                        lineContent: targetComment.lineContent || '',
                        contextLines: contextLines,
                        contextStartLine: contextStartLine,
                        filePath: filePath,
                        commentContent: targetComment.content
                    };
                    
                    // 显示webview
                    await showShareCommentWebview(
                        context as vscode.ExtensionContext,
                        commentManager,
                        targetComment.content,
                        `共享注释预览 - ${path.basename(filePath)}:${line + 1}`,
                        contextInfo
                    );
                    
                } catch (error) {
                    logger.error('显示共享注释webview失败:', error);
                    
                    // 如果webview显示失败，回退到原来的信息提示
                    const commentType = 'username' in targetComment && targetComment.username ? `[${targetComment.username}]` : 
                                      'userId' in targetComment && targetComment.userId ? `[用户${targetComment.userId}]` : '[未知用户]';
                    vscode.window.showInformationMessage(
                        `跳转到共享注释 ${commentType}: ${targetComment.content.substring(0, 50)}${targetComment.content.length > 50 ? '...' : ''}`,
                        '查看注释详情'
                    ).then(selection => {
                        if (selection === '查看注释详情') {
                            // 显示注释详细信息
                            const message = `共享注释详情:\n\n` +
                                          `用户: ${commentType}\n` +
                                          `内容: ${targetComment.content}\n` +
                                          `位置: 第 ${targetComment.line + 1} 行\n` +
                                          `代码: ${targetComment.lineContent || '未知'}\n` +
                                          `创建时间: ${new Date(targetComment.timestamp).toLocaleString()}`;
                            vscode.window.showInformationMessage(message, { modal: true });
                        }
                    });
                }
                return;
            }
            
            // 对于本地注释，使用智能匹配验证注释是否还能找到对应的代码
            const comments = commentManager.getComments(uri);
            const matchedComment = comments.find(c => c.id === targetComment.id);
            
            if (matchedComment) {
                // 注释能找到对应代码，执行跳转到匹配位置
                const position = new vscode.Position(matchedComment.line, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                
                // 如果位置或行内容发生了变化，静默更新存储，避免下次仍显示旧位置
                if (matchedComment.line !== targetComment.line || matchedComment.lineContent !== targetComment.lineContent) {
                    await commentManager.updateCommentLine(uri, targetComment.id, matchedComment.line, matchedComment.lineContent);
                }
            } else {
                // 注释无法匹配到代码，检查原始行是否仍然存在
                if (targetComment.line < document.lineCount) {
                    // 原始行仍然存在，跳转到原始行
                    const position = new vscode.Position(targetComment.line, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                    
                    vscode.window.showInformationMessage(
                        `注释"${targetComment.content.substring(0, 30)}${targetComment.content.length > 30 ? '...' : ''}"的代码内容已变化，已跳转到原始行`,
                        '查看注释详情'
                    ).then(selection => {
                        if (selection === '查看注释详情') {
                            // 显示注释详细信息
                            const message = `注释内容: ${targetComment.content}\n` +
                                          `原始代码: ${targetComment.lineContent || '未知'}\n` +
                                          `创建时间: ${new Date(targetComment.timestamp).toLocaleString()}`;
                            vscode.window.showInformationMessage(message, { modal: true });
                        }
                    });
                } else {
                    // 原始行也不存在，提示用户
                    vscode.window.showWarningMessage(
                        `注释"${targetComment.content.substring(0, 30)}${targetComment.content.length > 30 ? '...' : ''}"暂时找不到对应的代码。可能是代码被修改、删除，或者在不同的Git分支中。`, 
                        '查看注释详情'
                    ).then(selection => {
                        if (selection === '查看注释详情') {
                            // 显示注释详细信息
                            const message = `注释内容: ${targetComment.content}\n` +
                                          `原始代码: ${targetComment.lineContent || '未知'}\n` +
                                          `创建时间: ${new Date(targetComment.timestamp).toLocaleString()}`;
                            vscode.window.showInformationMessage(message, { modal: true });
                        }
                    });
                }
            }
        } catch (error) {
            logger.error('跳转到注释时发生错误:', error);
            vscode.window.showErrorMessage('无法打开文件或跳转到指定位置');
        }
    });

    const goToTagDeclarationCommand = vscode.commands.registerCommand(COMMANDS.GO_TO_TAG_DECLARATION, async (args) => {
        try {
            let tagName: string;
            
            // 处理参数
            if (typeof args === 'string') {
                try {
                    const parsed = JSON.parse(args);
                    tagName = parsed.tagName;
                } catch {
                    tagName = args; // 如果解析失败，直接使用字符串
                }
            } else if (args && typeof args === 'object' && args.tagName) {
                tagName = args.tagName;
            } else {
                vscode.window.showErrorMessage('无效的标签名称');
                return;
            }
            
            // 查找标签声明
            const declaration = tagManager.getTagDeclaration(tagName);
            
            if (!declaration) {
                vscode.window.showWarningMessage(`找不到标签 $${tagName} 的声明`);
                return;
            }
            
            // 跳转到声明位置
            const uri = vscode.Uri.file(declaration.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            
            const position = new vscode.Position(declaration.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            
        } catch (error) {
            logger.error('跳转到标签声明时发生错误:', error);
            vscode.window.showErrorMessage(`跳转失败: ${error}`);
        }
    });

    // 模糊匹配命令
    const fuzzyMatchCommentCommand = vscode.commands.registerCommand(COMMANDS.FUZZY_MATCH_COMMENT, async (item) => {
        if (!item || !item.comment || !item.filePath) {
            vscode.window.showErrorMessage('无效的注释项');
            return;
        }

        try {
            // 确保文档已打开
            const uri = vscode.Uri.file(item.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            
            // 使用CommentMatcher进行模糊匹配
            const commentMatcher = commentManager.commentMatcher;
            const candidates = commentMatcher.fuzzyMatchComment(document, item.comment, 8);
            
            if (candidates.length === 0) {
                vscode.window.showInformationMessage('未找到相似的代码行，无法进行模糊匹配');
                return;
            }

            // 根据置信度使用不同的Codicon图标
            const getConfidenceIcon = (confidence: 'high' | 'medium' | 'low') => {
                // 使用VS Code内置的Codicon图标
                switch (confidence) {
                    case 'high':
                        return '$(star-full)'; // 实心星星，表示高置信度
                    case 'medium':
                        return '$(star-half)'; // 半星，表示中等置信度
                    case 'low':
                        return '$(star-empty)'; // 空心星星，表示低置信度
                    default:
                        return '$(circle-outline)';
                }
            };

            // 定义候选项类型
            interface FuzzyMatchQuickPickItem extends vscode.QuickPickItem {
                candidate: {
                    line: number;
                    content: string;
                    similarity: number;
                    confidence: 'high' | 'medium' | 'low';
                } | null;
            }

            // 构建候选项列表
            const quickPickItems: FuzzyMatchQuickPickItem[] = candidates.map((candidate: {
                line: number;
                content: string;
                similarity: number;
                confidence: 'high' | 'medium' | 'low';
            }) => {
                const confidenceIcon = getConfidenceIcon(candidate.confidence);
                const similarityPercent = Math.round(candidate.similarity * 100);
                
                return {
                    label: `${confidenceIcon} 第${candidate.line + 1}行 (${similarityPercent}% 相似)`,
                    description: candidate.content.length > 60 ? 
                        candidate.content.substring(0, 60) + '...' : candidate.content,
                    detail: `置信度: ${candidate.confidence} | 相似度: ${similarityPercent}%`,
                    candidate: candidate
                };
            });

            // 添加取消选项
            quickPickItems.push({
                label: '取消匹配',
                description: '不进行匹配，保持注释隐藏状态',
                detail: '',
                candidate: null
            });

            // 显示选择对话框
            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: `为注释 "${item.comment.content}" 选择匹配的代码行 (选择后立即执行)`,
                ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selected || !selected.candidate) {
                return; // 用户取消或选择了取消选项
            }

            // 更新注释位置和代码快照
            const allComments = commentManager.getAllComments();
            const fileComments = allComments[item.filePath];
            
            if (fileComments) {
                const commentToUpdate = fileComments.find(c => c.id === item.comment.id);
                if (commentToUpdate) {
                    commentToUpdate.line = selected.candidate.line;
                    commentToUpdate.lineContent = selected.candidate.content;
                    commentToUpdate.isMatched = true;
                    
                    // 保存更改
                    await commentManager.saveComments();
                    
                    // 刷新界面
                    refreshAllCommentViews();
                    
                    // 跳转到匹配的行
                    const editor = await vscode.window.showTextDocument(document);
                    const position = new vscode.Position(selected.candidate.line, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                    
                    vscode.window.showInformationMessage(
                        `模糊匹配成功！注释已更新到第${selected.candidate.line + 1}行 (相似度: ${Math.round(selected.candidate.similarity * 100)}%)`
                    );
                }
            }

        } catch (error) {
            logger.error('模糊匹配失败:', error);
            vscode.window.showErrorMessage(`模糊匹配失败: ${getErrorMessage(error)}`);
        }
    });

    // 跳转到文件命令
    const goToFileCommand = vscode.commands.registerCommand(COMMANDS.GO_TO_FILE, async (item) => {
        if (!item || !item.filePath) {
            vscode.window.showErrorMessage('无效的文件项');
            return;
        }

        try {
            const uri = vscode.Uri.file(item.filePath);
            
            // 检查文件是否已经在编辑器中打开
            const existingEditor = vscode.window.visibleTextEditors.find(
                editor => editor.document.uri.fsPath === item.filePath
            );

            if (existingEditor) {
                // 文件已经打开，直接切换到该编辑器，保持原有的光标位置和选择
                await vscode.window.showTextDocument(existingEditor.document, {
                    viewColumn: existingEditor.viewColumn,
                    preview: false,
                    preserveFocus: false,
                    // 不设置selection，保持用户原有的光标位置
                });
            } else {
                // 文件未打开，打开文件并定位到顶部
                const document = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(document, {
                    preview: false, // 不使用预览模式，确保文件真正打开
                    preserveFocus: false // 将焦点切换到编辑器
                });

                // 新打开的文件，定位到顶部
                const position = new vscode.Position(0, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.Default);
            }

        } catch (error) {
            logger.error('打开文件失败:', error);
            vscode.window.showErrorMessage(`打开文件失败: ${getErrorMessage(error)}`);
        }
    });

    // 更新注释行号命令
    const updateCommentLineCommand = vscode.commands.registerCommand(COMMANDS.UPDATE_COMMENT_LINE, async (item) => {
        if (!item || !item.comment || !item.filePath) {
            vscode.window.showErrorMessage('无效的注释项');
            return;
        }

        try {
            // 确保文档已打开
            const uri = vscode.Uri.file(item.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            
            // 获取当前注释信息
            const comment = item.comment;
            const currentLine = comment.line + 1; // 转换为1基索引显示给用户
            
            // 显示输入框让用户输入新的行号
            const newLineInput = await vscode.window.showInputBox({
                prompt: `请输入新的行号 (当前: 第${currentLine}行) - 输入后立即执行`,
                placeHolder: '例如: 25',
                value: currentLine.toString(),
                validateInput: (value) => {
                    const lineNumber = parseInt(value);
                    if (isNaN(lineNumber)) {
                        return '请输入有效的数字';
                    }
                    if (lineNumber < 1) {
                        return '行号必须大于0';
                    }
                    if (lineNumber > document.lineCount) {
                        return `行号不能超过文件总行数 (${document.lineCount})`;
                    }
                    return null;
                }
            });

            if (!newLineInput) {
                return; // 用户取消了输入
            }

            const newLine = parseInt(newLineInput) - 1; // 转换为0基索引
            
            if (newLine === comment.line) {
                return;
            }

            // 获取新行的内容
            const newLineContent = document.lineAt(newLine).text.trim();

            // 检查新位置是否已经有其他注释
            const allComments = commentManager.getAllComments();
            const fileComments = allComments[item.filePath];
            
            if (fileComments) {
                const existingComment = fileComments.find(c => c.line === newLine && c.id !== comment.id);
                if (existingComment) {
                    const replaceExisting = await DialogUtils.showConfirmDialog(
                        `第${newLine + 1}行已经有注释了：\n"${existingComment.content}"\n\n是否要替换它？`,
                        '替换现有注释',
                        '取消操作',
                        { modal: true }
                    );
                    
                    if (!replaceExisting) {
                        return;
                    }
                    
                                    // 删除现有注释
                const existingIndex = commentManager.findCommentIndex(fileComments, existingComment.id);
                    if (existingIndex >= 0) {
                        fileComments.splice(existingIndex, 1);
                    }
                }

                // 更新注释位置和代码快照
                const commentToUpdate = fileComments.find(c => c.id === comment.id);
                if (commentToUpdate) {
                    commentToUpdate.line = newLine;
                    commentToUpdate.lineContent = newLineContent;
                    commentToUpdate.isMatched = true;
                    commentToUpdate.timestamp = Date.now(); // 更新时间戳
                    
                    // 保存更改
                    await commentManager.saveComments();
                    
                    // 更新标签系统
                    tagManager.updateTags(commentManager.getAllComments());
                    
                    // 刷新界面
                    refreshAllCommentViews();
                    
                    // 跳转到新的行
                    const editor = await vscode.window.showTextDocument(document);
                    const position = new vscode.Position(newLine, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                    
                    vscode.window.showInformationMessage(
                        `行号更新成功！注释从第${comment.line + 1}行移动到第${newLine + 1}行`
                    );
                }
            }

        } catch (error) {
            logger.error('更新注释行号失败:', error);
            vscode.window.showErrorMessage(`更新失败: ${getErrorMessage(error)}`);
        }
    });

    // 添加多行Markdown注释命令
    const addMarkdownCommentCommand = vscode.commands.registerCommand(COMMANDS.ADD_MARKDOWN_COMMENT, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const line = editor.selection.active.line;
        const document = editor.document;
        const lineContent = document.lineAt(line).text;
        const fileName = getFileNameFromPath(document.fileName);
        
        // 检查当前行是否已有注释
        const comments = commentManager.getComments(editor.document.uri);
        const existingComment = comments.find(c => c.line === line);
        
        const isUserLoggedIn = authManager.isLoggedIn();
        
        try {
            if (existingComment) {
                // 检查注释类型：如果是共享注释，我们需要查找该行是否有本地注释
                if ('userId' in existingComment) {
                    // 这是共享注释，查找该行是否有本地注释
                    const localComments = commentManager.getAllComments()[editor.document.uri.fsPath] || [];
                    const localComment = localComments.find(c => c.line === line && !('userId' in c));
                    
                    if (localComment) {
                        // 有本地注释，编辑本地注释
                        await executeEditComment(editor.document.uri, localComment);
                    } else {
                        // 没有本地注释，添加新的本地注释
                        const result = await showMarkdownWebviewInput(
                            context!,
                            '添加多行本地注释',
                            projectManager,
                            commentManager,
                            '支持 Markdown 语法和多行输入，使用 ${标签名} 声明标签，使用 @标签名 引用标签',
                            '',
                            {
                                fileName,
                                filePath: editor.document.uri.fsPath, // 添加完整的文件路径
                                lineNumber: line,
                                lineContent,
                                // 暂时不包含上下文，让webview先显示
                            },
                            '',
                            createSaveAndContinueCallback('add', editor.document.uri, '', line, ''),
                            isUserLoggedIn,
                            false // 新注释默认未分享
                        );
                        
                        // 注意：如果使用了saveAndContinue，内容会通过回调函数保存，这里不需要重复保存
                        if (result !== undefined) {
                            const content = typeof result === 'string' ? result : result.content;
                            const updatedContextInfo = typeof result === 'object' ? result.contextInfo : undefined;
                            
                            if (content.trim() !== '') {
                                // 如果行号有变化，使用更新后的行号
                                const finalLine = updatedContextInfo?.lineNumber ?? line;
                                await commentManager.addComment(editor.document.uri, finalLine, content);
                                // 刷新标签和界面
                                tagManager.updateTags(commentManager.getAllComments());
                                refreshAllCommentViews();
                            }
                        }
                    }
                } else {
                    // 这是本地注释，直接编辑
                    await executeEditComment(editor.document.uri, existingComment);
                }
            } else {
                // 如果没有现有注释，添加新注释
                // 优化：先显示编辑器，异步加载代码上下文
                const result = await showMarkdownWebviewInput(
                    context!,
                    '添加多行本地注释',
                    projectManager,
                    commentManager,
                    '支持 Markdown 语法和多行输入，使用 $标签名 声明标签，使用 @标签名 引用标签',
                    '',
                    {
                        fileName,
                        filePath: editor.document.uri.fsPath, // 添加完整的文件路径
                        lineNumber: line,
                        lineContent,
                        // 暂时不包含上下文，让webview先显示
                    },
                    '',
                    createSaveAndContinueCallback('add', editor.document.uri, '', line, ''),
                    isUserLoggedIn,
                    false // 新注释默认未分享
                );
                
                // 注意：如果使用了saveAndContinue，内容会通过回调函数保存，这里不需要重复保存
                if (result !== undefined) {
                    const content = typeof result === 'string' ? result : result.content;
                    const updatedContextInfo = typeof result === 'object' ? result.contextInfo : undefined;
                    
                    if (content.trim() !== '') {
                        // 如果行号有变化，使用更新后的行号
                        const finalLine = updatedContextInfo?.lineNumber ?? line;
                        await commentManager.addComment(editor.document.uri, finalLine, content);
                        // 刷新标签和界面
                        tagManager.updateTags(commentManager.getAllComments());
                        refreshAllCommentViews();
                    }
                }
            }
        } catch (error) {
            logger.error('处理多行注释时出错:', error);
            vscode.window.showErrorMessage(`操作失败: ${error}`);
        }
    });

    // 添加单行注释命令
    const addCommentCommand = vscode.commands.registerCommand(COMMANDS.ADD_COMMENT, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const line = editor.selection.active.line;
        
        try {
            // 使用单行快速输入界面
            const content = await showQuickInputWithTagCompletion(
                '添加本地注释',
                '请输入注释内容... (支持 @标签名 引用标签)',
                '',
                tagManager
            );
            
            if (content !== undefined && content.trim() !== '') {
                await commentManager.addComment(editor.document.uri, line, content);
                // 刷新标签和界面
                tagManager.updateTags(commentManager.getAllComments());
                refreshAllCommentViews();
            }
        } catch (error) {
            logger.error('添加注释时出错:', error);
            vscode.window.showErrorMessage(`添加注释失败: ${error}`);
        }
    });

    // 添加转换选中文字为注释的命令
    const convertSelectionToCommentCommand = vscode.commands.registerCommand(COMMANDS.CONVERT_SELECTION_TO_COMMENT, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showWarningMessage('请先选中要转换为注释的文字');
            return;
        }

        // 获取选中的文字
        const selectedText = editor.document.getText(selection);
        if (!selectedText.trim()) {
            vscode.window.showWarningMessage('选中的文字不能为空');
            return;
        }

        try {
            await commentManager.convertSelectionToComment(editor.document.uri, selection, selectedText);
            tagManager.updateTags(commentManager.getAllComments());
            refreshAllCommentViews();
        } catch (error) {
            logger.error('转换选中文字为注释失败:', error);
            vscode.window.showErrorMessage('转换失败，请重试');
        }
    });

    // 删除注释命令
    const removeCommentCommand = vscode.commands.registerCommand(COMMANDS.REMOVE_COMMENT, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const selection = editor.selection;
        const line = selection.active.line;
        
        await commentManager.removeComment(editor.document.uri, line);
        tagManager.updateTags(commentManager.getAllComments());
        refreshAllCommentViews();
    });

    // 从hover删除注释命令
    const removeCommentFromHoverCommand = vscode.commands.registerCommand(COMMANDS.REMOVE_COMMENT_FROM_HOVER, async (args) => {
        try {
            const parsedArgs = parseCommentCommandArgs(args, ['uri', 'commentId', 'line']);
            if (!parsedArgs) return;

            const { uri, commentId } = parsedArgs;
            const documentUri = vscode.Uri.parse(uri as string);
            
            // 通过commentId直接查找注释，不依赖光标位置
            const comment = commentManager.getCommentById(documentUri, commentId as string);
            
            if (!comment) {
                vscode.window.showWarningMessage(`找不到指定的注释`);
                return;
            }

            // 删除注释
            await commentManager.removeCommentById(documentUri, commentId as string);
            tagManager.updateTags(commentManager.getAllComments());
            refreshAllCommentViews();
            // 删除注释无需提示，用户可以直接看到结果
        } catch (error) {
            logger.error('从hover删除注释时发生错误:', error);
            vscode.window.showErrorMessage(`删除注释时发生错误: ${getErrorMessage(error)}`);
        }
    });

    // 预览注释内容命令
    const previewSharedCommentCommand = vscode.commands.registerCommand(COMMANDS.PREVIEW_SHARED_COMMENT, async (args) => {
        try {
            const parsedArgs = parseCommentCommandArgs(args, ['uri', 'content']);
            if (!parsedArgs) return;

            const { uri, commentId, line, content } = parsedArgs;
            const documentUri = vscode.Uri.parse(uri as string);
            const fileName = getFileNameFromUri(documentUri) || '未知文件';
            const lineNumber = line !== undefined ? (line as number) : 0;
            
            // 构建上下文信息
            const contextInfo = {
                fileName: fileName,
                lineNumber: lineNumber,
                lineContent: '',
                filePath: documentUri.fsPath,
                commentContent: content as string
            };

            // 导入并显示shareCommentWebview
            const { showShareCommentWebview } = await import('../shareCommentWebview');
            if (!context) {
                vscode.window.showErrorMessage('无法获取扩展上下文');
                return;
            }
            await showShareCommentWebview(
                context,
                commentManager,
                content as string,
                `注释预览 - ${fileName}:${lineNumber + 1}`,
                contextInfo
            );
        } catch (error) {
            logger.error('预览注释时发生错误:', error);
            vscode.window.showErrorMessage(`预览注释时发生错误: ${getErrorMessage(error)}`);
        }
    });

    return [
        goToCommentCommand,
        goToTagDeclarationCommand,
        refreshCommentsCommand,
        refreshTreeCommand,
        deleteCommentFromTreeCommand,
        clearFileCommentsCommand,
        clearAllSharedCommentsCommand,
        clearFileSharedCommentsCommand,
        fuzzyMatchCommentCommand,
        goToFileCommand,
        updateCommentLineCommand,
        editCommentFromTreeCommand,
        editCommentFromHoverCommand,
        addMarkdownCommentCommand,
        addCommentCommand,
        convertSelectionToCommentCommand,
        removeCommentCommand,
        removeCommentFromHoverCommand,
        previewSharedCommentCommand,
    ];
}
