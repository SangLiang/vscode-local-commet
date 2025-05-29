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
    console.log('🚀🚀🚀 本地注释插件开始激活 🚀🚀🚀');
    console.log('Context extensionPath:', context.extensionPath);
    console.log('VSCode version:', vscode.version);
    
    console.log('本地注释插件已激活');

    // 初始化管理器
    console.log('初始化管理器...');
    commentManager = new CommentManager(context);
    commentProvider = new CommentProvider(commentManager);
    commentTreeProvider = new CommentTreeProvider(commentManager);
    tagManager = new TagManager();

    // 初始化标签数据
    console.log('初始化标签数据...');
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
    console.log('🔧 开始注册命令...');
    const addCommentCommand = vscode.commands.registerCommand('localComment.addComment', async () => {
        console.log('🎯 addComment 命令被调用');
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('请先打开一个文件');
            return;
        }

        const selection = editor.selection;
        const line = selection.active.line;
        
        console.log('📍 准备调用 showInputBoxWithTagCompletion');
        const comment = await showInputBoxWithTagCompletion(
            '请输入注释内容',
            '在这里输入你的本地注释... (使用 $标签名 声明标签，使用 @标签名 引用标签)'
        );

        if (comment) {
            console.log('✅ 用户输入了注释:', comment);
            await commentManager.addComment(editor.document.uri, line, comment);
            tagManager.updateTags(commentManager.getAllComments());
            commentProvider.refresh();
            commentTreeProvider.refresh();
        } else {
            console.log('❌ 用户取消了输入');
        }
    });
    console.log('✅ addComment 命令注册完成');

    const editCommentFromHoverCommand = vscode.commands.registerCommand('localComment.editCommentFromHover', async (args) => {
        try {
            console.log('从hover编辑注释命令被调用，参数:', args);
            
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
                console.log('缺少参数:', { uri, commentId, line });
                return;
            }

            const documentUri = vscode.Uri.parse(uri);
            
            // 通过commentId直接查找注释，不依赖光标位置
            const comment = commentManager.getCommentById(documentUri, commentId);
            
            if (!comment) {
                vscode.window.showWarningMessage(`找不到指定的注释`);
                return;
            }

            const newContent = await showInputBoxWithTagCompletion(
                '修改注释内容',
                '在这里输入新的注释内容... (使用 $标签名 声明标签，使用 @标签名 引用标签)',
                comment.content
            );

            if (newContent !== undefined && newContent !== comment.content) {
                await commentManager.editComment(documentUri, commentId, newContent);
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();
                vscode.window.showInformationMessage('注释已成功更新');
            }
        } catch (error) {
            console.error('从hover编辑注释时发生错误:', error);
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

        const newContent = await showInputBoxWithTagCompletion(
            '修改注释内容',
            '在这里输入新的注释内容... (使用 $标签名 声明标签，使用 @标签名 引用标签)',
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

    const editCommentCommand = vscode.commands.registerCommand('localComment.editComment', async (args) => {
        try {
            console.log('编辑注释命令被调用，参数:', args);
            console.log('参数类型:', typeof args);
            
            if (!args) {
                vscode.window.showErrorMessage('缺少必要的参数');
                return;
            }

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

            const { uri, line, commentId } = parsedArgs;
            
            if (!uri || line === undefined || !commentId) {
                vscode.window.showErrorMessage('参数不完整');
                console.log('缺少参数:', { uri, line, commentId });
                return;
            }

            const documentUri = vscode.Uri.parse(uri);
            
            const existingComment = commentManager.getCommentById(documentUri, commentId);
            if (!existingComment) {
                vscode.window.showErrorMessage('找不到指定的注释');
                return;
            }

            const newContent = await showInputBoxWithTagCompletion(
                '修改注释内容',
                '在这里输入新的注释内容... (使用 $标签名 声明标签，使用 @标签名 引用标签)',
                existingComment.content
            );

            if (newContent !== undefined && newContent !== existingComment.content) {
                await commentManager.editComment(documentUri, commentId, newContent);
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();
                vscode.window.showInformationMessage('注释已成功更新');
            }
        } catch (error) {
            console.error('编辑注释时发生错误:', error);
            vscode.window.showErrorMessage(`编辑注释时发生错误: ${error}`);
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
            console.log('从hover删除注释命令被调用，参数:', args);
            
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
                console.log('缺少参数:', { uri, commentId, line });
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
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            
            // 跳转到指定行
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        } catch (error) {
            vscode.window.showErrorMessage('无法打开文件或跳转到指定位置');
        }
    });

    const goToTagDeclarationCommand = vscode.commands.registerCommand('localComment.goToTagDeclaration', async (args) => {
        try {
            console.log('跳转到标签声明命令被调用，参数:', args);
            
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

            console.log('查找标签声明:', tagName);
            
            // 查找标签声明
            const declaration = tagManager.getTagDeclaration(tagName);
            
            if (!declaration) {
                vscode.window.showWarningMessage(`找不到标签 $${tagName} 的声明`);
                return;
            }

            console.log('找到标签声明:', declaration);
            
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
            const newContent = await showInputBoxWithTagCompletion(
                '修改注释内容',
                '在这里输入新的注释内容... (使用 $标签名 声明标签，使用 @标签名 引用标签)',
                item.comment.content
            );

            if (newContent !== undefined && newContent !== item.comment.content) {
                const uri = vscode.Uri.file(item.filePath);
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

    console.log('📋 准备注册到context.subscriptions...');
    context.subscriptions.push(
        addCommentCommand,
        editCommentFromHoverCommand,
        editCommentInPlaceCommand,
        editCommentCommand,
        removeCommentCommand,
        removeCommentFromHoverCommand,
        goToCommentCommand,
        goToTagDeclarationCommand,
        toggleCommentsCommand,
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
        definitionDisposable
    );
    
    console.log('🎉 本地注释插件激活完成！');
}

export function deactivate() {
    if (commentProvider) {
        commentProvider.dispose();
    }
}

// 创建带有标签补全的输入框
async function showInputBoxWithTagCompletion(
    prompt: string, 
    placeholder: string, 
    value?: string
): Promise<string | undefined> {
    console.log('🚀 showInputBoxWithTagCompletion 函数被调用', { prompt, placeholder, value });
    
    return new Promise<string | undefined>((resolve) => {
        console.log('📝 创建QuickPick对话框');
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
            console.log('检查输入:', inputValue);
            
            const lastAtIndex = inputValue.lastIndexOf('@');
            
            if (lastAtIndex !== -1) {
                const afterAt = inputValue.substring(lastAtIndex + 1);
                console.log('@后的内容:', afterAt);
                
                if (/^[a-zA-Z0-9_]*$/.test(afterAt)) {
                    const availableTags = tagManager.getAvailableTagNames();
                    console.log('🏷️ 检测到@，可用标签:', availableTags);
                    
                    if (availableTags.length > 0) {
                        const filteredTags = availableTags.filter(tag => 
                            afterAt === '' || tag.toLowerCase().startsWith(afterAt.toLowerCase())
                        );
                        
                        if (filteredTags.length > 0) {
                            // 获取@之前的文本，作为前缀
                            const beforeAt = inputValue.substring(0, lastAtIndex);
                            
                            const items = filteredTags.map(tag => ({
                                label: `${beforeAt}@${tag}`,
                                description: '📁',
                                detail: `插入标签引用 @${tag} (自动添加空格)`,
                                // 保存原始标签名，用于后续处理
                                originalTag: tag
                            }));
                            
                            quickPick.items = items;
                            isShowingCompletions = true;
                            
                            // 强制显示下拉列表
                            if (quickPick.items.length > 0) {
                                // 设置第一个为选中状态
                                quickPick.activeItems = [quickPick.items[0]];
                            }
                            
                            console.log('🎯 已设置补全项目:', items.length, '个');
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
            console.log('📝 输入变化:', inputValue);
            updateCompletions(inputValue);
        });

        // 监听选择
        quickPick.onDidAccept(() => {
            if (isShowingCompletions && quickPick.selectedItems.length > 0) {
                const selectedItem = quickPick.selectedItems[0];
                const currentValue = quickPick.value;
                const lastAtIndex = currentValue.lastIndexOf('@');
                
                if (lastAtIndex !== -1 && (selectedItem as any).originalTag) {
                    const beforeAt = currentValue.substring(0, lastAtIndex + 1);
                    const newValue = beforeAt + (selectedItem as any).originalTag + ' ';
                    quickPick.value = newValue;
                    quickPick.items = [];
                    isShowingCompletions = false;
                    console.log('✅ 已插入标签: @' + (selectedItem as any).originalTag + ' (带空格)');
                    return;
                }
            }
            
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