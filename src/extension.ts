import * as vscode from 'vscode';
import { CommentManager } from './commentManager';
import { CommentProvider } from './commentProvider';
import { CommentTreeProvider } from './commentTreeProvider';
import { TagManager } from './tagManager';
import { TagCompletionProvider } from './tagCompletionProvider';
import { TagDefinitionProvider } from './tagDefinitionProvider';

let commentManager: CommentManager;
let commentProvider: CommentProvider;
let commentTreeProvider: CommentTreeProvider;
let tagManager: TagManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('本地注释插件已激活');

    // 初始化管理器
    commentManager = new CommentManager(context);
    commentProvider = new CommentProvider(commentManager);
    commentTreeProvider = new CommentTreeProvider(commentManager);
    tagManager = new TagManager();

    // 初始化标签数据
    tagManager.updateTags(commentManager.getAllComments());

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

            // 使用智能匹配验证注释是否还能找到对应的代码
            const comments = commentManager.getComments(uri);
            const matchedComment = comments.find(c => c.id === targetComment.id);
            
            if (!matchedComment) {
                // 注释无法匹配到代码，提示用户
                vscode.window.showWarningMessage(
                    `注释"${targetComment.content}"暂时找不到对应的代码。可能是代码被修改、删除，或者在不同的Git分支中。`, 
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
                return;
            }

            // 注释能找到对应代码，执行跳转
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            
            // 跳转到匹配后的正确位置
            const position = new vscode.Position(matchedComment.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            
            // 如果位置发生了变化，提示用户
            if (matchedComment.line !== targetComment.line) {
                vscode.window.showInformationMessage(
                    `注释位置已更新：第 ${targetComment.line + 1} 行 → 第 ${matchedComment.line + 1} 行`
                );
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
        if (item.contextValue === 'comment' && item.filePath && item.comment) {
            const uri = vscode.Uri.file(item.filePath);
            await commentManager.removeComment(uri, item.comment.line);
            tagManager.updateTags(commentManager.getAllComments());
            commentProvider.refresh();
            commentTreeProvider.refresh();
        }
    });

    const editCommentFromTreeCommand = vscode.commands.registerCommand('localComment.editCommentFromTree', async (item) => {
        if (item.contextValue === 'comment' && item.filePath && item.comment) {
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
        const storageFile = commentManager.getStorageFilePath();
        vscode.window.showInformationMessage(
            `注释数据存储位置: ${storageFile}`,
            '打开文件夹', '复制路径'
        ).then(selection => {
            if (selection === '打开文件夹') {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(storageFile));
            } else if (selection === '复制路径') {
                vscode.env.clipboard.writeText(storageFile);
                vscode.window.showInformationMessage('路径已复制到剪贴板');
            }
        });
    });

    const showStorageStatsCommand = vscode.commands.registerCommand('localComment.showStorageStats', () => {
        const allComments = commentManager.getAllComments();
        const fileCount = Object.keys(allComments).length;
        const totalComments = Object.values(allComments).reduce((sum, comments) => sum + comments.length, 0);
        
        // 统计标签信息
        const tagDeclarations = tagManager.getTagDeclarations();
        const tagReferences = tagManager.getTagReferences();
        
        let message = `📊 注释统计信息:\n\n`;
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
        
        vscode.window.showInformationMessage(message, { modal: true });
    });

    // 监听文档变化
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
        commentManager.handleDocumentChange(event);
        tagManager.updateTags(commentManager.getAllComments());
        commentProvider.refresh();
        commentTreeProvider.refresh();
    });

    // 监听活动编辑器变化
    const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(() => {
        commentProvider.refresh();
    });

    // 在注册自动补全和定义提供器的部分后添加
    const hoverDisposable = vscode.languages.registerHoverProvider(
        { scheme: 'file' },
        commentProvider
    );

    context.subscriptions.push(
        addCommentCommand,
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
        onDidChangeTextDocument,
        onDidChangeActiveTextEditor,
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
                        break;
                    case 'cancel':
                        resolve(undefined);
                        panel.dispose();
                        break;
                }
            }
        );

        // 面板关闭时返回undefined
        panel.onDidDispose(() => {
            resolve(undefined);
        });
    });
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

    const escapedContent = escapeHtml(existingContent);
    const escapedPrompt = escapeHtml(prompt);
    const escapedPlaceholder = escapeHtml(placeholder);
    
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
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>本地注释输入</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            line-height: 1.5;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .context-info {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 20px;
            font-size: 13px;
        }
        .context-title {
            font-weight: bold;
            color: var(--vscode-textPreformat-foreground);
            margin-bottom: 8px;
        }
        .context-item {
            margin: 4px 0;
            display: flex;
            align-items: flex-start;
        }
        .context-label {
            color: var(--vscode-descriptionForeground);
            min-width: 60px;
            margin-right: 8px;
        }
        .context-value {
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family);
            flex: 1;
            word-break: break-all;
        }
        .code-preview {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-textBlockQuote-border);
            border-radius: 3px;
            padding: 8px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            color: var(--vscode-textPreformat-foreground);
        }
        .header {
            margin-bottom: 20px;
        }
        .prompt {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-textPreformat-foreground);
        }
        .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .input-area {
            margin-bottom: 20px;
            position: relative;
        }
        .resize-hint {
            position: absolute;
            bottom: 8px;
            right: 12px;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            pointer-events: none;
            opacity: 0.6;
        }
        textarea {
            width: 100%;
            min-height: 300px;
            max-height: 600px;
            padding: 12px;
            padding-bottom: 24px; /* 为调整提示留出空间 */
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.5;
            resize: both; /* 允许水平和垂直调整 */
            box-sizing: border-box;
        }
        textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        .button-group {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        button {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-family: var(--vscode-font-family);
        }
        .save-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .save-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .cancel-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .cancel-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .autocomplete {
            position: relative;
        }
        .autocomplete-dropdown {
            position: absolute;
            background-color: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            min-width: 150px;
        }
        .autocomplete-item {
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        .autocomplete-item:last-child {
            border-bottom: none;
        }
        .autocomplete-item:hover,
        .autocomplete-item.selected {
            background-color: var(--vscode-list-hoverBackground);
        }
        .autocomplete-item .tag-name {
            color: var(--vscode-symbolIcon-functionForeground);
            font-weight: bold;
        }
        .autocomplete-item .tag-description {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-left: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        ${contextHtml}
        <div class="header">
            <div class="prompt">${escapedPrompt}</div>
            <div class="help-text">
                💡 支持多行输入，换行符请使用 \\n<br>
                🏷️ 使用 $标签名 声明标签，使用 @标签名 引用标签<br>
                ⌨️ 输入 @ 时会自动提示可用标签
            </div>
        </div>
        
        <div class="input-area">
            <div class="autocomplete">
                <textarea 
                    id="contentInput" 
                    placeholder="${escapedPlaceholder}"
                    autofocus
                >${escapedContent}</textarea>
                <div id="autocompleteDropdown" class="autocomplete-dropdown"></div>
            </div>
            <div class="resize-hint">↘ 可拖拽调整大小</div>
        </div>
        
        <div class="button-group">
            <button class="cancel-btn" onclick="cancel()">取消</button>
            <button class="save-btn" onclick="save()">保存</button>
        </div>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const textarea = document.getElementById('contentInput');
            
            // 标签自动补全
            const tagSuggestions = '${tagSuggestions}'.split(',').filter(tag => tag.length > 0);
            
            // 全局函数定义
            window.save = function() {
                const content = textarea.value;
                vscode.postMessage({
                    command: 'save',
                    content: content
                });
            };
            
            window.cancel = function() {
                vscode.postMessage({
                    command: 'cancel'
                });
            };
            
            // 自动补全功能
            const autocompleteDropdown = document.getElementById('autocompleteDropdown');
            let selectedIndex = -1;
            let filteredTags = [];
            let autocompleteVisible = false;
            
            function showAutocomplete(tags, cursorPos) {
                if (tags.length === 0) {
                    hideAutocomplete();
                    return;
                }
                
                filteredTags = tags;
                selectedIndex = 0;
                autocompleteVisible = true;
                
                // 清空下拉列表
                autocompleteDropdown.innerHTML = '';
                
                // 添加选项
                tags.forEach((tag, index) => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item' + (index === 0 ? ' selected' : '');
                    item.innerHTML = '<span class="tag-name">@' + tag + '</span><span class="tag-description">标签引用</span>';
                    item.addEventListener('click', () => {
                        insertTag(tag);
                    });
                    autocompleteDropdown.appendChild(item);
                });
                
                // 计算光标位置
                const position = getCaretPixelPosition(textarea, cursorPos);
                
                // 设置下拉框位置（相对于textarea）
                autocompleteDropdown.style.left = position.left + 'px';
                autocompleteDropdown.style.top = (position.top + position.height + 2) + 'px';
                autocompleteDropdown.style.display = 'block';
                
                // 确保下拉框不超出容器边界
                adjustDropdownPosition();
            }
            
            /**
             * 获取光标在textarea中的像素位置
             */
            function getCaretPixelPosition(textarea, caretPos) {
                // 创建一个隐藏的div，模拟textarea的样式
                const div = document.createElement('div');
                const style = window.getComputedStyle(textarea);
                
                // 复制textarea的样式到div
                div.style.position = 'absolute';
                div.style.visibility = 'hidden';
                div.style.whiteSpace = 'pre-wrap';
                div.style.wordWrap = 'break-word';
                div.style.top = '0px';
                div.style.left = '0px';
                
                // 复制重要的样式属性
                [
                    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
                    'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom',
                    'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth',
                    'width', 'height'
                ].forEach(prop => {
                    div.style[prop] = style[prop];
                });
                
                document.body.appendChild(div);
                
                // 设置文本内容到光标位置
                const textBeforeCaret = textarea.value.substring(0, caretPos);
                div.textContent = textBeforeCaret;
                
                // 创建一个span来标记光标位置
                const span = document.createElement('span');
                span.textContent = '|'; // 光标占位符
                div.appendChild(span);
                
                // 获取span的位置（即光标位置）
                const spanRect = span.getBoundingClientRect();
                const textareaRect = textarea.getBoundingClientRect();
                
                // 计算相对于textarea的位置
                const left = spanRect.left - textareaRect.left;
                const top = spanRect.top - textareaRect.top;
                const height = spanRect.height;
                
                // 清理
                document.body.removeChild(div);
                
                return {
                    left: Math.max(0, left),
                    top: Math.max(0, top),
                    height: height
                };
            }
            
            /**
             * 调整下拉框位置，确保不超出容器边界
             */
            function adjustDropdownPosition() {
                const dropdown = autocompleteDropdown;
                const container = textarea.parentElement;
                const containerRect = container.getBoundingClientRect();
                const dropdownRect = dropdown.getBoundingClientRect();
                
                // 如果下拉框超出右边界，向左调整
                if (dropdownRect.right > containerRect.right) {
                    const overflow = dropdownRect.right - containerRect.right;
                    const currentLeft = parseInt(dropdown.style.left);
                    dropdown.style.left = Math.max(0, currentLeft - overflow - 10) + 'px';
                }
                
                // 如果下拉框超出底部边界，显示在光标上方
                if (dropdownRect.bottom > containerRect.bottom) {
                    const currentTop = parseInt(dropdown.style.top);
                    const dropdownHeight = dropdownRect.height;
                    dropdown.style.top = (currentTop - dropdownHeight - 25) + 'px'; // 25是行高的估算
                }
            }
            
            function hideAutocomplete() {
                autocompleteVisible = false;
                autocompleteDropdown.style.display = 'none';
                selectedIndex = -1;
                filteredTags = [];
            }
            
            function updateSelection(direction) {
                if (!autocompleteVisible || filteredTags.length === 0) return;
                
                // 移除当前选中状态
                const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
                if (items[selectedIndex]) {
                    items[selectedIndex].classList.remove('selected');
                }
                
                // 更新选中索引
                selectedIndex += direction;
                if (selectedIndex < 0) selectedIndex = filteredTags.length - 1;
                if (selectedIndex >= filteredTags.length) selectedIndex = 0;
                
                // 添加新的选中状态
                if (items[selectedIndex]) {
                    items[selectedIndex].classList.add('selected');
                    items[selectedIndex].scrollIntoView({ block: 'nearest' });
                }
            }
            
            function insertTag(tag) {
                const cursorPos = textarea.selectionStart;
                const text = textarea.value;
                
                // 找到@的位置
                const beforeCursor = text.substring(0, cursorPos);
                const atIndex = beforeCursor.lastIndexOf('@');
                
                if (atIndex !== -1) {
                    // 替换@后的内容
                    const beforeAt = text.substring(0, atIndex);
                    const afterCursor = text.substring(cursorPos);
                    const newText = beforeAt + '@' + tag + ' ' + afterCursor;
                    
                    textarea.value = newText;
                    const newCursorPos = atIndex + tag.length + 2; // @tag + 空格
                    textarea.setSelectionRange(newCursorPos, newCursorPos);
                    textarea.focus();
                }
                
                hideAutocomplete();
            }
            
            textarea.addEventListener('input', function(e) {
                const cursorPos = e.target.selectionStart;
                const text = e.target.value;
                const beforeCursor = text.substring(0, cursorPos);
                
                // 检查是否刚输入了@
                const atMatch = beforeCursor.match(/@([a-zA-Z0-9_]*)$/);
                if (atMatch && tagSuggestions.length > 0) {
                    const searchTerm = atMatch[1].toLowerCase();
                    const availableTags = tagSuggestions.filter(tag => 
                        tag.startsWith('@') && 
                        tag.slice(1).toLowerCase().includes(searchTerm)
                    ).map(tag => tag.slice(1)); // 移除@前缀
                    
                    if (availableTags.length > 0) {
                        showAutocomplete(availableTags, cursorPos);
                    } else {
                        hideAutocomplete();
                    }
                } else {
                    hideAutocomplete();
                }
            });
            
            // 处理键盘导航
            textarea.addEventListener('keydown', function(e) {
                if (autocompleteVisible) {
                    switch (e.key) {
                        case 'ArrowDown':
                            e.preventDefault();
                            updateSelection(1);
                            break;
                        case 'ArrowUp':
                            e.preventDefault();
                            updateSelection(-1);
                            break;
                        case 'Enter':
                        case 'Tab':
                            e.preventDefault();
                            if (selectedIndex >= 0 && filteredTags[selectedIndex]) {
                                insertTag(filteredTags[selectedIndex]);
                            }
                            break;
                        case 'Escape':
                            e.preventDefault();
                            hideAutocomplete();
                            break;
                    }
                }
            });
            
            // 点击其他地方时隐藏自动补全
            document.addEventListener('click', function(e) {
                if (!autocompleteDropdown.contains(e.target) && e.target !== textarea) {
                    hideAutocomplete();
                }
            });
            
            // 全局快捷键支持
            document.addEventListener('keydown', function(e) {
                if (!autocompleteVisible) {
                    if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault();
                        window.save();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        window.cancel();
                    }
                }
            });
            
            // 设置焦点
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        })();
    </script>
</body>
</html>`;
}