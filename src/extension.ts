import * as vscode from 'vscode';
import { CommentManager } from './commentManager';
import { CommentProvider } from './commentProvider';
import { CommentTreeProvider } from './commentTreeProvider';
import { TagManager } from './tagManager';
import { TagCompletionProvider } from './tagCompletionProvider';
import { TagDefinitionProvider } from './tagDefinitionProvider';
import * as path from 'path';
import * as fs from 'fs';

let commentManager: CommentManager;
let commentProvider: CommentProvider;
let commentTreeProvider: CommentTreeProvider;
let tagManager: TagManager;

// 全局变量，用于跟踪最后一次键盘活动时间
let lastKeyboardActivity = Date.now();
const KEYBOARD_ACTIVITY_THRESHOLD = 1000; // 1秒内有键盘活动才视为手动编辑

export function activate(context: vscode.ExtensionContext) {
    console.log('本地注释插件已激活');

    // 初始化管理器
    commentManager = new CommentManager(context);
    commentProvider = new CommentProvider(commentManager);
    commentTreeProvider = new CommentTreeProvider(commentManager);
    tagManager = new TagManager();

    // 初始化标签数据
    tagManager.updateTags(commentManager.getAllComments());

    // 注册用于修改树视图样式的CSS
    const decorationProvider = vscode.window.registerFileDecorationProvider({
        provideFileDecoration: (uri) => {
            if (uri.scheme === 'hidden-comment') {
                return {
                    propagate: true,
                    color: new vscode.ThemeColor('descriptionForeground'),
                    tooltip: '此注释当前无法匹配到代码'
                };
            }
            return undefined;
        }
    });
    context.subscriptions.push(decorationProvider);

    // 注册自动补全和定义提供器
    const completionProvider = new TagCompletionProvider(tagManager, commentManager);
    const definitionProvider = new TagDefinitionProvider(tagManager, commentManager);

    const completionDisposable = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file' },
        completionProvider,
        '@'
    );

    const definitionDisposable = vscode.languages.registerDefinitionProvider(
        { scheme: 'file' },
        definitionProvider
    );

    // 注册树视图
    const treeView = vscode.window.createTreeView('localComments', {
        treeDataProvider: commentTreeProvider,
        showCollapseAll: true
    });

    // 注册命令
    const addCommentCommand = vscode.commands.registerCommand('localComment.addComment', async () => {
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
                ''
            );
            
            if (content !== undefined && content.trim() !== '') {
                await commentManager.addComment(editor.document.uri, line, content);
                // 刷新标签和界面
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();
            }
        } catch (error) {
            console.error('添加注释时出错:', error);
            vscode.window.showErrorMessage(`添加注释失败: ${error}`);
        }
    });

    // 注册添加Markdown多行注释的命令
    const addMarkdownCommentCommand = vscode.commands.registerCommand('localComment.addMarkdownComment', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const line = editor.selection.active.line;
        const document = editor.document;
        const lineContent = document.lineAt(line).text;
        const fileName = document.fileName.split(/[/\\]/).pop() || '';
        
        // 检查当前行是否已有注释
        const comments = commentManager.getComments(editor.document.uri);
        const existingComment = comments.find(c => c.line === line);
        
        try {
            if (existingComment) {
                // 如果有现有注释，进入编辑模式
                const newContent = await showWebViewInput(
                    '编辑多行本地注释',
                    '支持 Markdown 语法和多行输入，使用 $标签名 声明标签，使用 @标签名 引用标签',
                    existingComment.content,
                    {
                        fileName,
                        lineNumber: line,
                        lineContent
                    }
                );
                
                if (newContent !== undefined && newContent !== existingComment.content) {
                    await commentManager.editComment(editor.document.uri, existingComment.id, newContent);
                    // 刷新标签和界面
                    tagManager.updateTags(commentManager.getAllComments());
                    commentProvider.refresh();
                    commentTreeProvider.refresh();
                    vscode.window.showInformationMessage('注释已更新');
                }
            } else {
                // 如果没有现有注释，添加新注释
                const content = await showWebViewInput(
                    '添加多行本地注释',
                    '支持 Markdown 语法和多行输入，使用 $标签名 声明标签，使用 @标签名 引用标签',
                    '',
                    {
                        fileName,
                        lineNumber: line,
                        lineContent
                    }
                );
                
                if (content !== undefined && content.trim() !== '') {
                    await commentManager.addComment(editor.document.uri, line, content);
                    // 刷新标签和界面
                    tagManager.updateTags(commentManager.getAllComments());
                    commentProvider.refresh();
                    commentTreeProvider.refresh();
                    vscode.window.showInformationMessage('注释已添加');
                }
            }
        } catch (error) {
            console.error('处理多行注释时出错:', error);
            vscode.window.showErrorMessage(`操作失败: ${error}`);
        }
    });

    // 注册转换选中文字为本地注释的命令
    const convertSelectionToCommentCommand = vscode.commands.registerCommand('localComment.convertSelectionToComment', async () => {
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
            commentProvider.refresh();
            commentTreeProvider.refresh();
        } catch (error) {
            console.error('转换选中文字为注释失败:', error);
            vscode.window.showErrorMessage('转换失败，请重试');
        }
    });

    const editCommentFromHoverCommand = vscode.commands.registerCommand('localComment.editCommentFromHover', async (args) => {
        try {
            let parsedArgs;
            
            // 检查参数是否已经是对象
            if (typeof args === 'object') {
                parsedArgs = args;
            } else if (typeof args === 'string') {
                try {
                    parsedArgs = JSON.parse(args);
                } catch (parseError) {
                    console.error('参数解析失败:', parseError);
                    vscode.window.showErrorMessage('参数格式错误');
                    return;
                }
            } else {
                vscode.window.showErrorMessage('参数类型不正确');
                return;
            }

            const { uri, commentId, line } = parsedArgs;
            
            if (!uri || !commentId || line === undefined) {
                vscode.window.showErrorMessage('参数不完整');
                return;
            }

            const documentUri = vscode.Uri.parse(uri);
            
            // 通过commentId直接查找注释，不依赖光标位置
            const comment = commentManager.getCommentById(documentUri, commentId);
            
            if (!comment) {
                vscode.window.showWarningMessage(`找不到指定的注释`);
                return;
            }

            // 获取上下文信息
            const fileName = documentUri.fsPath.split(/[/\\]/).pop() || '';
            const document = await vscode.workspace.openTextDocument(documentUri);
            // 使用注释保存的原始代码内容，而不是当前行的代码
            const lineContent = comment.lineContent || document.lineAt(comment.line).text;

            const newContent = await showWebViewInput(
                '修改注释内容',
                '支持 Markdown 语法和多行输入，使用 $标签名 声明标签，使用 @标签名 引用标签',
                comment.content,
                {
                    fileName,
                    lineNumber: comment.line,
                    lineContent
                }
            );

            if (newContent !== undefined && newContent !== comment.content) {
                await commentManager.editComment(documentUri, commentId, newContent);
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();
            }
        } catch (error) {
            console.error('从hover编辑注释时发生错误:', error);
            vscode.window.showErrorMessage(`编辑注释时发生错误: ${error}`);
        }
    });

    // 添加快速编辑命令（单行输入）
    const quickEditCommentFromHoverCommand = vscode.commands.registerCommand('localComment.quickEditCommentFromHover', async (args) => {
        try {
            let parsedArgs;
            
            if (typeof args === 'object') {
                parsedArgs = args;
            } else if (typeof args === 'string') {
                try {
                    parsedArgs = JSON.parse(args);
                } catch (parseError) {
                    console.error('参数解析失败:', parseError);
                    vscode.window.showErrorMessage('参数格式错误');
                    return;
                }
            } else {
                vscode.window.showErrorMessage('参数类型不正确');
                return;
            }

            const { uri, commentId, line } = parsedArgs;
            
            if (!uri || !commentId || line === undefined) {
                vscode.window.showErrorMessage('参数不完整');
                return;
            }

            const documentUri = vscode.Uri.parse(uri);
            const comment = commentManager.getCommentById(documentUri, commentId);
            
            if (!comment) {
                vscode.window.showWarningMessage(`找不到指定的注释`);
                return;
            }

            const newContent = await showQuickInputWithTagCompletion(
                '快速编辑注释',
                '支持标签引用 @标签名',
                comment.content
            );

            if (newContent !== undefined && newContent !== comment.content) {
                await commentManager.editComment(documentUri, commentId, newContent);
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();
            }
        } catch (error) {
            console.error('从hover快速编辑注释时发生错误:', error);
            vscode.window.showErrorMessage(`编辑注释时发生错误: ${error}`);
        }
    });

    // 添加editCommentInPlace命令
    const editCommentInPlaceCommand = vscode.commands.registerCommand('localComment.editCommentInPlace', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const selection = editor.selection;
        const line = selection.active.line;
        
        // 获取当前行的注释
        const comments = commentManager.getComments(editor.document.uri);
        const comment = comments.find(c => c.line === line);
        
        if (!comment) {
            vscode.window.showWarningMessage(`第 ${line + 1} 行没有本地注释`);
            return;
        }

        // 获取上下文信息
        const fileName = editor.document.uri.fsPath.split(/[/\\]/).pop() || '';
        const lineContent = editor.document.lineAt(line).text;

        const newContent = await showQuickInputWithTagCompletion(
            '编辑注释内容',
            '请修改注释内容... (支持 @标签名 引用标签)',
            comment.content
        );

        if (newContent !== undefined && newContent !== comment.content) {
            await commentManager.editComment(editor.document.uri, comment.id, newContent);
            tagManager.updateTags(commentManager.getAllComments());
            commentProvider.refresh();
            commentTreeProvider.refresh();
            vscode.window.showInformationMessage('注释已成功更新');
        }
    });

    const editCommentCommand = vscode.commands.registerCommand('localComment.editComment', async (uri: vscode.Uri, line: number) => {
        try {
            const comments = commentManager.getComments(uri);
            const comment = comments.find(c => c.line === line);
            
            if (!comment) {
                vscode.window.showErrorMessage('找不到指定的注释');
                return;
            }
            
            // 获取上下文信息
            const fileName = uri.fsPath.split(/[/\\]/).pop() || '';
            const document = await vscode.workspace.openTextDocument(uri);
            // 使用注释保存的原始代码内容，而不是当前行的代码
            const lineContent = comment.lineContent || document.lineAt(comment.line).text;
            
            // 使用新的WebView输入界面
            const newContent = await showWebViewInput(
                '编辑本地注释',
                '请修改注释内容...',
                comment.content,
                {
                    fileName,
                    lineNumber: comment.line,
                    lineContent
                }
            );
            
            if (newContent !== undefined && newContent.trim() !== '') {
                await commentManager.editComment(uri, comment.id, newContent);
                // 刷新标签和界面
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();
            }
        } catch (error) {
            console.error('编辑注释时出错:', error);
            vscode.window.showErrorMessage(`编辑注释失败: ${error}`);
        }
    });

    const removeCommentCommand = vscode.commands.registerCommand('localComment.removeComment', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const selection = editor.selection;
        const line = selection.active.line;
        
        await commentManager.removeComment(editor.document.uri, line);
        tagManager.updateTags(commentManager.getAllComments());
        commentProvider.refresh();
        commentTreeProvider.refresh();
    });

    const removeCommentFromHoverCommand = vscode.commands.registerCommand('localComment.removeCommentFromHover', async (args) => {
        try {
            let parsedArgs;
            
            // 检查参数是否已经是对象
            if (typeof args === 'object') {
                parsedArgs = args;
            } else if (typeof args === 'string') {
                try {
                    parsedArgs = JSON.parse(args);
                } catch (parseError) {
                    console.error('参数解析失败:', parseError);
                    vscode.window.showErrorMessage('参数格式错误');
                    return;
                }
            } else {
                vscode.window.showErrorMessage('参数类型不正确');
                return;
            }

            const { uri, commentId, line } = parsedArgs;
            
            if (!uri || !commentId || line === undefined) {
                vscode.window.showErrorMessage('参数不完整');
                return;
            }

            const documentUri = vscode.Uri.parse(uri);
            
            // 通过commentId直接查找注释，不依赖光标位置
            const comment = commentManager.getCommentById(documentUri, commentId);
            
            if (!comment) {
                vscode.window.showWarningMessage(`找不到指定的注释`);
                return;
            }

            // 删除注释
            await commentManager.removeCommentById(documentUri, commentId);
            tagManager.updateTags(commentManager.getAllComments());
            commentProvider.refresh();
            commentTreeProvider.refresh();
            vscode.window.showInformationMessage('注释已成功删除');
        } catch (error) {
            console.error('从hover删除注释时发生错误:', error);
            vscode.window.showErrorMessage(`删除注释时发生错误: ${error}`);
        }
    });

    const goToCommentCommand = vscode.commands.registerCommand('localComment.goToComment', async (filePath: string, line: number) => {
        try {
            const uri = vscode.Uri.file(filePath);
            
            // 首先验证注释是否还能找到对应的代码
            const fileComments = commentManager.getAllComments()[filePath] || [];
            const targetComment = fileComments.find(c => c.originalLine === line || c.line === line);
            
            if (!targetComment) {
                vscode.window.showWarningMessage(`找不到第 ${line + 1} 行的注释`);
                return;
            }

            // 打开文档
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            
            // 使用智能匹配验证注释是否还能找到对应的代码
            const comments = commentManager.getComments(uri);
            const matchedComment = comments.find(c => c.id === targetComment.id);
            
            if (matchedComment) {
                // 注释能找到对应代码，执行跳转到匹配位置
                const position = new vscode.Position(matchedComment.line, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                
                // 如果位置发生了变化，提示用户
                if (matchedComment.line !== targetComment.line) {
                    vscode.window.showInformationMessage(
                        `注释位置已更新：第 ${targetComment.line + 1} 行 → 第 ${matchedComment.line + 1} 行`
                    );
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
            console.error('跳转到注释时发生错误:', error);
            vscode.window.showErrorMessage('无法打开文件或跳转到指定位置');
        }
    });

    const goToTagDeclarationCommand = vscode.commands.registerCommand('localComment.goToTagDeclaration', async (args) => {
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
            
            vscode.window.showInformationMessage(`已跳转到标签 $${tagName} 的声明位置`);
            
        } catch (error) {
            console.error('跳转到标签声明时发生错误:', error);
            vscode.window.showErrorMessage(`跳转失败: ${error}`);
        }
    });

    const toggleCommentsCommand = vscode.commands.registerCommand('localComment.toggleComments', () => {
        commentProvider.toggleVisibility();
    });

    const refreshCommentsCommand = vscode.commands.registerCommand('localComment.refreshComments', () => {
        commentProvider.refresh();
    });

    const refreshTreeCommand = vscode.commands.registerCommand('localComment.refreshTree', () => {
        commentTreeProvider.refresh();
    });

    const deleteCommentFromTreeCommand = vscode.commands.registerCommand('localComment.deleteCommentFromTree', async (item) => {
        if ((item.contextValue === 'comment' || item.contextValue === 'hidden-comment') && item.filePath && item.comment) {
            const uri = vscode.Uri.file(item.filePath);
            await commentManager.removeComment(uri, item.comment.line);
            tagManager.updateTags(commentManager.getAllComments());
            commentProvider.refresh();
            commentTreeProvider.refresh();
        }
    });

    const editCommentFromTreeCommand = vscode.commands.registerCommand('localComment.editCommentFromTree', async (item) => {
        if ((item.contextValue === 'comment' || item.contextValue === 'hidden-comment') && item.filePath && item.comment) {
            // 获取上下文信息
            const fileName = item.filePath.split(/[/\\]/).pop() || '';
            const uri = vscode.Uri.file(item.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            // 使用注释保存的原始代码内容，而不是当前行的代码
            const lineContent = item.comment.lineContent || document.lineAt(item.comment.line).text;
            
            const newContent = await showWebViewInput(
                '修改注释内容',
                '支持 Markdown 语法和多行输入，使用 $标签名 声明标签，使用 @标签名 引用标签',
                item.comment.content,
                {
                    fileName,
                    lineNumber: item.comment.line,
                    lineContent
                }
            );

            if (newContent !== undefined && newContent !== item.comment.content) {
                await commentManager.editComment(uri, item.comment.id, newContent);
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();
            }
        }
    });

    const showStorageLocationCommand = vscode.commands.registerCommand('localComment.showStorageLocation', () => {
        const projectInfo = commentManager.getProjectInfo();
        const storageFile = commentManager.getStorageFilePath();
        
        let message = `📂 项目注释存储信息:\n\n`;
        message += `🏷️ 项目名称: ${projectInfo.name}\n`;
        message += `📁 项目路径: ${projectInfo.path}\n`;
        message += `💾 存储文件: ${storageFile}\n\n`;
        message += `ℹ️ 注意: 每个项目的注释数据独立存储`;
        
        vscode.window.showInformationMessage(
            message,
            '打开文件夹', '复制路径', '查看项目目录'
        ).then(selection => {
            if (selection === '打开文件夹') {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(storageFile));
            } else if (selection === '复制路径') {
                vscode.env.clipboard.writeText(storageFile);
                vscode.window.showInformationMessage('路径已复制到剪贴板');
            } else if (selection === '查看项目目录') {
                const projectDir = path.dirname(path.dirname(storageFile)); // 返回到projects目录
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(projectDir));
            }
        });
    });

    const showStorageStatsCommand = vscode.commands.registerCommand('localComment.showStorageStats', () => {
        const projectInfo = commentManager.getProjectInfo();
        const allComments = commentManager.getAllComments();
        const fileCount = Object.keys(allComments).length;
        const totalComments = Object.values(allComments).reduce((sum, comments) => sum + comments.length, 0);
        
        // 统计标签信息
        const tagDeclarations = tagManager.getTagDeclarations();
        const tagReferences = tagManager.getTagReferences();
        
        let message = `📊 ${projectInfo.name} 项目注释统计:\n\n`;
        message += `📁 包含注释的文件: ${fileCount} 个\n`;
        message += `💬 总注释数量: ${totalComments} 条\n`;
        message += `🏷️ 标签声明: ${tagDeclarations.size} 个\n`;
        message += `🔗 标签引用: ${tagReferences.length} 个\n\n`;
        
        if (fileCount > 0) {
            message += `📋 详细信息:\n`;
            for (const [filePath, comments] of Object.entries(allComments)) {
                const fileName = filePath.split(/[/\\]/).pop();
                message += `• ${fileName}: ${comments.length} 条注释\n`;
            }
        }
        
        if (tagDeclarations.size > 0) {
            message += `\n🏷️ 可用标签:\n`;
            for (const tagName of tagManager.getAvailableTagNames()) {
                message += `• $${tagName}\n`;
            }
        }
        
        message += `\n💾 存储位置: ${projectInfo.storageFile}`;
        message += `\nℹ️ 注意: 注释数据按项目分离存储`;
        
        vscode.window.showInformationMessage(message, { modal: true });
    });

    // 添加管理所有项目注释数据的命令
    const manageProjectsCommand = vscode.commands.registerCommand('localComment.manageProjects', async () => {
        try {
            const globalStorageDir = commentManager.getContext().globalStorageUri?.fsPath || commentManager.getContext().extensionPath;
            const projectsDir = path.join(globalStorageDir, 'projects');
            
            if (!fs.existsSync(projectsDir)) {
                vscode.window.showInformationMessage('暂无项目注释数据');
                return;
            }
            
            const files = fs.readdirSync(projectsDir).filter(file => file.endsWith('.json'));
            
            if (files.length === 0) {
                vscode.window.showInformationMessage('暂无项目注释数据');
                return;
            }
            
            let message = `📋 所有项目注释数据:\n\n`;
            message += `📁 项目数量: ${files.length} 个\n\n`;
            
            let totalFiles = 0;
            let totalComments = 0;
            
            for (const file of files) {
                const filePath = path.join(projectsDir, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const fileCount = Object.keys(data).length;
                    const commentCount = Object.values(data).reduce((sum: number, comments: any) => sum + comments.length, 0);
                    
                    totalFiles += fileCount;
                    totalComments += commentCount;
                    
                    // 从文件名解析项目名称（格式：项目名-哈希值.json）
                    const projectName = file.replace(/-[a-f0-9]+\.json$/, '');
                    message += `🗂️ ${projectName}: ${fileCount} 个文件, ${commentCount} 条注释\n`;
                } catch (error) {
                    console.error(`读取项目文件失败: ${file}`, error);
                }
            }
            
            message += `\n📊 总计: ${totalFiles} 个文件, ${totalComments} 条注释`;
            message += `\n💾 存储目录: ${projectsDir}`;
            
            vscode.window.showInformationMessage(
                message,
                '打开项目目录', '清理旧数据'
            ).then(selection => {
                if (selection === '打开项目目录') {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(projectsDir));
                } else if (selection === '清理旧数据') {
                    showCleanupDialog(projectsDir, files);
                }
            });
            
        } catch (error) {
            console.error('管理项目数据失败:', error);
            vscode.window.showErrorMessage('管理项目数据时发生错误');
        }
    });

    // 清理数据对话框
    async function showCleanupDialog(projectsDir: string, files: string[]) {
        const items = files.map(file => {
            const projectName = file.replace(/-[a-f0-9]+\.json$/, '');
            return {
                label: projectName,
                description: file,
                detail: `删除 ${projectName} 项目的注释数据`
            };
        });
        
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要删除的项目注释数据',
            canPickMany: true
        });
        
        if (selected && selected.length > 0) {
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除 ${selected.length} 个项目的注释数据吗？此操作不可恢复！`,
                '确定删除', '取消'
            );
            
            if (confirm === '确定删除') {
                let deletedCount = 0;
                for (const item of selected) {
                    try {
                        const filePath = path.join(projectsDir, item.description);
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    } catch (error) {
                        console.error(`删除文件失败: ${item.description}`, error);
                    }
                }
                
                vscode.window.showInformationMessage(
                    `已删除 ${deletedCount} 个项目的注释数据`
                );
            }
        }
    }

    // 监听文档变化
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
        // 获取当前时间
        const now = Date.now();
        // 只有在最近有键盘活动的情况下才更新代码快照
        const hasRecentKeyboardActivity = (now - lastKeyboardActivity < KEYBOARD_ACTIVITY_THRESHOLD);
        
        // 传递键盘活动信息给commentManager
        commentManager.handleDocumentChange(event, hasRecentKeyboardActivity);
        tagManager.updateTags(commentManager.getAllComments());
        commentProvider.refresh();
        commentTreeProvider.refresh();
    });

    // 监听活动编辑器变化
    const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(() => {
        commentProvider.refresh();
    });

    // 添加键盘事件监听
    const onDidChangeTextEditorSelection = vscode.window.onDidChangeTextEditorSelection(() => {
        // 更新最后一次键盘活动时间
        lastKeyboardActivity = Date.now();
    });

    // 添加键盘输入事件监听（更全面的键盘活动捕获）
    const onDidChangeTextEditorVisibleRanges = vscode.window.onDidChangeTextEditorVisibleRanges(() => {
        // 更新最后一次键盘活动时间
        lastKeyboardActivity = Date.now();
    });

    // 在注册自动补全和定义提供器的部分后添加
    const hoverDisposable = vscode.languages.registerHoverProvider(
        { scheme: 'file' },
        commentProvider
    );

    context.subscriptions.push(
        addCommentCommand,
        addMarkdownCommentCommand,
        convertSelectionToCommentCommand,
        editCommentFromHoverCommand,
        quickEditCommentFromHoverCommand,
        editCommentInPlaceCommand,
        editCommentCommand,
        removeCommentCommand,
        removeCommentFromHoverCommand,
        goToCommentCommand,
        goToTagDeclarationCommand,
        toggleCommentsCommand,
        refreshCommentsCommand,
        refreshTreeCommand,
        deleteCommentFromTreeCommand,
        editCommentFromTreeCommand,
        showStorageLocationCommand,
        showStorageStatsCommand,
        manageProjectsCommand,
        onDidChangeTextDocument,
        onDidChangeActiveTextEditor,
        onDidChangeTextEditorSelection,
        onDidChangeTextEditorVisibleRanges,
        commentProvider,
        treeView,
        completionDisposable,
        definitionDisposable,
        hoverDisposable
    );
    
    console.log('✅ 本地注释插件激活完成');
}

export function deactivate() {
    if (commentProvider) {
        commentProvider.dispose();
    }
}

// 单行快速输入函数（带标签补全）
async function showQuickInputWithTagCompletion(
    prompt: string, 
    placeholder: string, 
    value?: string
): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = placeholder;
        quickPick.title = prompt;
        quickPick.value = value || '';
        quickPick.canSelectMany = false;
        quickPick.ignoreFocusOut = true;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        
        let isShowingCompletions = false;
        
        const updateCompletions = (inputValue: string) => {
            const lastAtIndex = inputValue.lastIndexOf('@');
            
            if (lastAtIndex !== -1) {
                const afterAt = inputValue.substring(lastAtIndex + 1);
                
                if (/^[a-zA-Z0-9_]*$/.test(afterAt)) {
                    const availableTags = tagManager.getAvailableTagNames();
                    
                    if (availableTags.length > 0) {
                        const filteredTags = availableTags.filter(tag => 
                            afterAt === '' || tag.toLowerCase().startsWith(afterAt.toLowerCase())
                        );
                        
                        if (filteredTags.length > 0) {
                            const items = filteredTags.map(tag => ({
                                label: `@${tag}`,
                                description: '🏷️ 标签补全',
                                detail: `插入标签引用 @${tag}`,
                                originalTag: tag
                            }));
                            
                            quickPick.items = items;
                            isShowingCompletions = true;
                            
                            if (quickPick.items.length > 0) {
                                quickPick.activeItems = [quickPick.items[0]];
                            }
                        } else {
                            quickPick.items = [];
                            isShowingCompletions = false;
                        }
                    } else {
                        quickPick.items = [];
                        isShowingCompletions = false;
                    }
                } else {
                    quickPick.items = [];
                    isShowingCompletions = false;
                }
            } else {
                quickPick.items = [];
                isShowingCompletions = false;
            }
        };

        // 初始化
        updateCompletions(quickPick.value);

        // 监听输入变化
        quickPick.onDidChangeValue((inputValue) => {
            updateCompletions(inputValue);
        });

        // 选择逻辑
        quickPick.onDidAccept(() => {
            if (isShowingCompletions && quickPick.selectedItems.length > 0) {
                const selectedItem = quickPick.selectedItems[0];
                const currentValue = quickPick.value;
                const lastAtIndex = currentValue.lastIndexOf('@');
                
                if (lastAtIndex !== -1 && (selectedItem as any).originalTag) {
                    // 只替换@后面的部分
                    const beforeAt = currentValue.substring(0, lastAtIndex + 1); // 包含@
                    const newValue = beforeAt + (selectedItem as any).originalTag + ' '; // @标签名 + 空格
                    quickPick.value = newValue;
                    quickPick.items = [];
                    isShowingCompletions = false;
                    
                    // 继续编辑，不关闭对话框
                    updateCompletions(newValue);
                    return;
                }
            }
            
            // 如果不是选择补全项，则完成输入
            resolve(quickPick.value);
            quickPick.dispose();
        });

        quickPick.onDidHide(() => {
            resolve(undefined);
            quickPick.dispose();
        });

        quickPick.show();
    });
}

// 在文件末尾添加WebView多行输入函数
async function showWebViewInput(
    prompt: string, 
    placeholder: string = '', 
    existingContent: string = '',
    contextInfo?: {
        fileName?: string;
        lineNumber?: number;
        lineContent?: string;
        selectedText?: string;
    }
): Promise<string | undefined> {
    // 保存当前活动编辑器的引用，以便稍后恢复焦点
    const activeEditor = vscode.window.activeTextEditor;
    
    return new Promise((resolve) => {
        // 创建WebView面板
        const panel = vscode.window.createWebviewPanel(
            'localCommentInput',
            '本地注释输入',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: false
            }
        );

        // 修复：使用正确的方法名获取标签
        const allTags = tagManager.getAvailableTagNames();
        const tagSuggestions = allTags.map(tag => `@${tag}`).join(',');

        // HTML内容
        panel.webview.html = getWebviewContent(prompt, placeholder, existingContent, tagSuggestions, contextInfo);

        // 处理WebView消息
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'save':
                        resolve(message.content);
                        panel.dispose();
                        // WebView关闭后恢复编辑器焦点
                        setTimeout(() => restoreFocus(activeEditor), 100);
                        break;
                    case 'cancel':
                        resolve(undefined);
                        panel.dispose();
                        // WebView关闭后恢复编辑器焦点
                        setTimeout(() => restoreFocus(activeEditor), 100);
                        break;
                }
            }
        );

        // 面板关闭时返回undefined
        panel.onDidDispose(() => {
            resolve(undefined);
            // WebView关闭后恢复编辑器焦点
            setTimeout(() => restoreFocus(activeEditor), 100);
        });
    });
}

// 辅助函数：恢复编辑器焦点
function restoreFocus(editor: vscode.TextEditor | undefined) {
    if (editor) {
        vscode.window.showTextDocument(editor.document, {
            viewColumn: editor.viewColumn,
            selection: editor.selection,
            preserveFocus: false
        });
    }
}
function getWebviewContent(prompt: string, placeholder: string, existingContent: string, tagSuggestions: string, contextInfo?: {
    fileName?: string;
    lineNumber?: number;
    lineContent?: string;
    selectedText?: string;
}): string {
    // HTML转义函数
    const escapeHtml = (text: string): string => {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    // 构建上下文信息HTML
    let contextHtml = '';
    if (contextInfo) {
        contextHtml = '<div class="context-info">';
        contextHtml += '<div class="context-title">📍 代码上下文</div>';
        
        if (contextInfo.fileName) {
            contextHtml += `<div class="context-item">
                <span class="context-label">文件:</span>
                <span class="context-value">${escapeHtml(contextInfo.fileName)}</span>
            </div>`;
        }
        
        if (contextInfo.lineNumber !== undefined) {
            contextHtml += `<div class="context-item">
                <span class="context-label">行号:</span>
                <span class="context-value">第 ${contextInfo.lineNumber + 1} 行</span>
            </div>`;
        }
        
        if (contextInfo.selectedText) {
            contextHtml += `<div class="context-item">
                <span class="context-label">选中:</span>
                <div class="context-value">
                    <div class="code-preview">${escapeHtml(contextInfo.selectedText)}</div>
                </div>
            </div>`;
        } else if (contextInfo.lineContent) {
            contextHtml += `<div class="context-item">
                <span class="context-label">代码:</span>
                <div class="context-value">
                    <div class="code-preview">${escapeHtml(contextInfo.lineContent)}</div>
                </div>
            </div>`;
        }
        
        contextHtml += '</div>';
    }

    // 准备模板变量
    const templateVariables: Record<string, string> = {
        contextHtml,
        escapedPrompt: escapeHtml(prompt),
        escapedPlaceholder: escapeHtml(placeholder),
        escapedContent: escapeHtml(existingContent),
        tagSuggestions
    };

    // 读取模板文件
    const templatePath = path.join(__dirname, '..', 'src', 'templates', 'commentInput.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    // 使用正则表达式一次性替换所有变量
    template = template.replace(/\${(\w+)}/g, (match, key: string) => {
        return templateVariables[key] || match;
    });

    return template;
}
