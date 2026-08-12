import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CommentManager, FileComments, LocalComment, SharedComment } from '../../managers/commentManager';
import { TagManager } from '../../managers/tagManager';
import { CommentProvider } from '../../providers/commentProvider';
import { CommentTreeProvider } from '../../providers/commentTreeProvider';
import { BookmarkManager } from '../../managers/bookmarkManager';
import { getFileNameFromPath } from '../../utils/pathUtils';

import { ApiRoutes } from '../../apiService';
import { ProjectManager } from '../../managers/projectManager';
import { buildExportData, ProjectInfo, getErrorMessage } from '../../utils/utils';
import { registerCommentCommands } from './comment';
import { registerBookmarkCommands } from './bookmark';
import { registerTagCommands } from './tagCommands';
import { registerTagRelationGraphCommands } from './tagRelationGraph';
import { AuthManager } from '../../managers/authManager';
import { logger } from '../../utils/logger';
import { AuthWebview } from '../authWebview';
import { UserInfoWebview } from '../userInfoWebview';
import { apiService } from '../../apiService';
import { COMMANDS } from '../../constants';
import { DialogUtils } from '../../utils/dialogUtils';
import { StoragePathUtils } from '../../utils/storagePathUtils';
import { MarkdownPreviewWebview } from '../markdownPreviewWebview';
import { showShareCommentWebview } from '../shareCommentWebview';

interface SharedCommentTreeCommandItem {
    sharedComment?: SharedComment;
    commentId?: string;
    filePath?: string;
}

interface ProjectCommentRecord {
    project_id: number;
    content: {
        version?: string;
        exportTime?: string;
        projectInfo?: ProjectInfo;
        comments?: FileComments;
        metadata?: {
            totalFiles?: number;
            totalComments?: number;
        };
    };
}

function isCommentMap(value: unknown): value is FileComments {
    if (!value || typeof value !== 'object') {
        return false;
    }
    return Object.values(value as Record<string, unknown>).every(Array.isArray);
}

export function registerCommands(
    context: vscode.ExtensionContext,
    commentManager: CommentManager,
    tagManager: TagManager,
    commentProvider: CommentProvider,
    commentTreeProvider: CommentTreeProvider,
    authManager: AuthManager,
    projectManager: ProjectManager,
    bookmarkManager?: BookmarkManager
) {

    const showStorageLocationCommand = vscode.commands.registerCommand(COMMANDS.SHOW_STORAGE_LOCATION, () => {
        const projectInfo = commentManager.getProjectInfo();
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const paths = StoragePathUtils.getStoragePaths(commentManager.getContext(), workspacePath);
            const currentCommentsFile = StoragePathUtils.getCurrentCommentsFile(paths, workspacePath);
            const currentCommentsConfig = commentManager.getCurrentCommentsConfig();
            const availableCommentsConfigs = commentManager.listAvailableCommentsConfigs();

            let message = `项目注释存储信息:\n\n`;
            message += `项目名称: ${projectInfo.name}\n`;
            message += `项目路径: ${projectInfo.path}\n`;
            message += `存储目录: ${paths.commentsDir}\n`;
            message += `当前配置: ${currentCommentsConfig}\n`;
            message += `配置文件: ${currentCommentsFile || '(无)'}\n`;
            message += `可用配置: ${availableCommentsConfigs.join(', ') || '(无)'}\n`;
            if (StoragePathUtils.fileExists(paths.oldCommentsFile)) {
                message += `\n⚠️ 检测到旧路径仍有数据: ${paths.oldCommentsFile}`;
            }

            const buttons = ['打开文件夹', '复制路径', '切换配置', '迁移旧数据'];
            vscode.window.showInformationMessage(message, ...buttons).then(selection => {
                if (selection === '打开文件夹') {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(paths.commentsDir));
                } else if (selection === '复制路径') {
                    vscode.env.clipboard.writeText(paths.newPath);
                    vscode.window.showInformationMessage('路径已复制到剪贴板');
                } else if (selection === '切换配置') {
                    vscode.commands.executeCommand(COMMANDS.SWITCH_COMMENTS_CONFIG);
                } else if (selection === '迁移旧数据') {
                    commentManager.migrateOldData();
                    if (bookmarkManager) {
                        bookmarkManager.migrateOldData();
                    }
                }
            });
        } else {
            const storageFile = commentManager.getStorageFilePath();
            let message = `项目注释存储信息:\n\n`;
            message += `项目名称: ${projectInfo.name}\n`;
            message += `项目路径: ${projectInfo.path}\n`;
            message += `存储文件: ${storageFile}\n\n`;
            message += `注意: 每个项目的注释数据独立存储`;
            vscode.window.showInformationMessage(message, '打开文件夹', '复制路径').then(selection => {
                if (selection === '打开文件夹') {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.dirname(storageFile)));
                } else if (selection === '复制路径') {
                    vscode.env.clipboard.writeText(storageFile);
                    vscode.window.showInformationMessage('路径已复制到剪贴板');
                }
            });
        }
    });

    // 切换注释配置文件命令
    const switchCommentsConfigCommand = vscode.commands.registerCommand(COMMANDS.SWITCH_COMMENTS_CONFIG, async () => {
        const availableConfigs = commentManager.listAvailableCommentsConfigs();
        const currentConfig = commentManager.getCurrentCommentsConfig();

        if (availableConfigs.length === 0) {
            // 无配置时直接创建默认配置，不弹窗确认
            await commentManager.createCommentsConfig('comments');
            await commentManager.switchCommentsConfig('comments.json');
            return;
        }

        const items: vscode.QuickPickItem[] = availableConfigs.map(file => ({
            label: `$(file) ${file}`,
            description: file === currentConfig ? '$(check) 当前使用' : '',
            detail: '位于 .vscode/local-comment/comments/ 目录',
            picked: file === currentConfig
        }));
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: '$(add) 创建新配置文件...',
            description: '创建新的注释配置文件',
            detail: '输入文件名后创建并自动切换',
            alwaysShow: true
        });

        const quickPick = vscode.window.createQuickPick();
        quickPick.items = items;
        quickPick.title = '选择注释配置文件';
        quickPick.placeholder = '选择要使用的配置文件';
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                if (selected.label.includes('创建新配置文件')) {
                    const fileName = await vscode.window.showInputBox({
                        prompt: '请输入配置文件名（不需要 .json 后缀）',
                        placeHolder: '例如: comments-dev',
                        validateInput: (value) => {
                            if (!value || value.trim().length === 0) return '文件名不能为空';
                            if (!/^[a-zA-Z0-9_-]+$/.test(value)) return '文件名只能包含字母、数字、下划线和连字符';
                            if (availableConfigs.includes(`${value}.json`)) return '配置文件已存在';
                            return null;
                        }
                    });
                    if (fileName) {
                        await commentManager.createCommentsConfig(fileName);
                        await commentManager.switchCommentsConfig(`${fileName}.json`);
                    }
                } else {
                    const fileName = selected.label.replace(/^\$\([^)]+\)\s*/, '').trim();
                    await commentManager.switchCommentsConfig(fileName);
                }
                quickPick.dispose();
            }
        });
        quickPick.show();
    });

    // 切换书签配置文件命令
    const switchBookmarksConfigCommand = vscode.commands.registerCommand(COMMANDS.SWITCH_BOOKMARKS_CONFIG, async () => {
        if (!bookmarkManager) return;
        const availableConfigs = bookmarkManager.listAvailableBookmarksConfigs();
        const currentConfig = bookmarkManager.getCurrentBookmarksConfig();

        if (availableConfigs.length === 0) {
            // 无配置时直接创建默认配置，不弹窗确认
            await bookmarkManager.createBookmarksConfig('bookmarks');
            await bookmarkManager.switchBookmarksConfig('bookmarks.json');
            return;
        }

        const items: vscode.QuickPickItem[] = availableConfigs.map(file => ({
            label: `$(file) ${file}`,
            description: file === currentConfig ? '$(check) 当前使用' : '',
            detail: '位于 .vscode/local-comment/bookmarks/ 目录',
            picked: file === currentConfig
        }));
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: '$(add) 创建新配置文件...',
            description: '创建新的书签配置文件',
            detail: '输入文件名后创建并自动切换',
            alwaysShow: true
        });

        const quickPick = vscode.window.createQuickPick();
        quickPick.items = items;
        quickPick.title = '选择书签配置文件';
        quickPick.placeholder = '选择要使用的配置文件';
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                if (selected.label.includes('创建新配置文件')) {
                    const fileName = await vscode.window.showInputBox({
                        prompt: '请输入配置文件名（不需要 .json 后缀）',
                        placeHolder: '例如: bookmarks-dev',
                        validateInput: (value) => {
                            if (!value || value.trim().length === 0) return '文件名不能为空';
                            if (!/^[a-zA-Z0-9_-]+$/.test(value)) return '文件名只能包含字母、数字、下划线和连字符';
                            if (availableConfigs.includes(`${value}.json`)) return '配置文件已存在';
                            return null;
                        }
                    });
                    if (fileName) {
                        await bookmarkManager.createBookmarksConfig(fileName);
                        await bookmarkManager.switchBookmarksConfig(`${fileName}.json`);
                    }
                } else {
                    const fileName = selected.label.replace(/^\$\([^)]+\)\s*/, '').trim();
                    await bookmarkManager.switchBookmarksConfig(fileName);
                }
                quickPick.dispose();
            }
        });
        quickPick.show();
    });

    // 迁移旧数据命令（注释+书签）
    const migrateOldDataCommand = vscode.commands.registerCommand(COMMANDS.MIGRATE_OLD_DATA, async () => {
        await commentManager.migrateOldData();
        if (bookmarkManager) {
            await bookmarkManager.migrateOldData();
        }
    });

    const showStorageStatsCommand = vscode.commands.registerCommand(COMMANDS.SHOW_STORAGE_STATS, () => {
        const projectInfo = commentManager.getProjectInfo();
        const allComments = commentManager.getAllComments();
        const allSharedComments = commentManager.getAllSharedComments();
        
        // 只统计本地注释，不包括共享注释
        let localFileCount = 0;
        let localTotalComments = 0;
        const localFileDetails: { [filePath: string]: number } = {};
        
        for (const [filePath, comments] of Object.entries(allComments)) {
            const localComments = comments.filter(comment => !('userId' in comment));
            if (localComments.length > 0) {
                localFileCount++;
                localTotalComments += localComments.length;
                localFileDetails[filePath] = localComments.length;
            }
        }
        
        // 统计共享注释信息
        const sharedFileCount = Object.keys(allSharedComments).length;
        const sharedTotalComments = Object.values(allSharedComments).reduce((sum, comments) => sum + comments.length, 0);
        
        // 统计标签信息
        const tagDeclarations = tagManager.getTagDeclarations();
        const tagReferences = tagManager.getTagReferences();
        
        let message = `${projectInfo.name} 项目注释统计:\n\n`;
        message += `本地注释:\n`;
        message += `  包含注释的文件: ${localFileCount} 个\n`;
        message += `  总注释数量: ${localTotalComments} 条\n`;
        message += `\n共享注释:\n`;
        message += `  包含注释的文件: ${sharedFileCount} 个\n`;
        message += `  总注释数量: ${sharedTotalComments} 条\n`;
        message += `\n标签信息:\n`;
        message += `  标签声明: ${tagDeclarations.size} 个\n`;
        message += `  标签引用: ${tagReferences.length} 个\n\n`;
        
        if (localFileCount > 0) {
            message += `本地注释详细信息:\n`;
            for (const [filePath, commentCount] of Object.entries(localFileDetails)) {
                const fileName = getFileNameFromPath(filePath);
                message += `• ${fileName}: ${commentCount} 条注释\n`;
            }
        }
        
        if (sharedFileCount > 0) {
            message += `\n共享注释详细信息:\n`;
            for (const [filePath, comments] of Object.entries(allSharedComments)) {
                const fileName = getFileNameFromPath(filePath);
                message += `• ${fileName}: ${comments.length} 条注释\n`;
            }
        }
        
        if (tagDeclarations.size > 0) {
            message += `\n️ 可用标签:\n`;
            for (const tagName of tagManager.getAvailableTagNames()) {
                message += `• $${tagName}\n`;
            }
        }
        
        message += `\n 存储位置: ${projectInfo.storageFile}`;
        message += `\n️ 注意: 注释数据按项目分离存储`;
        
        vscode.window.showInformationMessage(message, { modal: true });
    });

    // 添加管理所有项目注释数据的命令
    const manageProjectsCommand = vscode.commands.registerCommand(COMMANDS.MANAGE_PROJECTS, async () => {
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
            
            let message = ` 所有项目注释数据:\n\n`;
            message += ` 项目数量: ${files.length} 个\n\n`;
            
            let totalFiles = 0;
            let totalComments = 0;
            
            for (const file of files) {
                const filePath = path.join(projectsDir, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
                    if (!isCommentMap(data)) {
                        continue;
                    }
                    const fileCount = Object.keys(data).length;
                    const commentCount = Object.values(data).reduce((sum, comments) => sum + comments.length, 0);
                    
                    totalFiles += fileCount;
                    totalComments += commentCount;
                    
                    // 从文件名解析项目名称（格式：项目名-哈希值.json）
                    const projectName = file.replace(/-[a-f0-9]+\.json$/, '');
                    message += `${projectName}: ${fileCount} 个文件, ${commentCount} 条注释\n`;
                } catch (error) {
                    logger.error(`读取项目文件失败: ${file}`, error);
                }
            }
            
            message += `\n 总计: ${totalFiles} 个文件, ${totalComments} 条注释`;
            message += `\n 存储目录: ${projectsDir}`;
            
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
            logger.error('管理项目数据失败:', error);
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
            await DialogUtils.showConfirmDialog(
                `确定要删除 ${selected.length} 个项目的注释数据吗？此操作不可恢复！`,
                '确定删除',
                '取消',
                {
                    onConfirm: () => {
                        let deletedCount = 0;
                        for (const item of selected) {
                            try {
                                const filePath = path.join(projectsDir, item.description);
                                fs.unlinkSync(filePath);
                                deletedCount++;
                            } catch (error) {
                                logger.error(`删除文件失败: ${item.description}`, error);
                            }
                        }
                        
                        vscode.window.showInformationMessage(
                            `已删除 ${deletedCount} 个项目的注释数据`
                        );
                    }
                }
            );
        }
    }

    const toggleCommentsCommand = vscode.commands.registerCommand(COMMANDS.TOGGLE_COMMENTS, () => {
        commentProvider.toggleVisibility();
    });

    // 导出注释数据命令
    const exportCommentsCommand = vscode.commands.registerCommand(COMMANDS.EXPORT_COMMENTS, async () => {
        try {
            const projectInfo = commentManager.getProjectInfo();
            const allComments = commentManager.getAllComments();
            
            // 检查是否有注释数据
            const totalComments = Object.values(allComments).reduce((sum, comments) => sum + comments.length, 0);
            if (totalComments === 0) {
                vscode.window.showWarningMessage('当前项目没有注释数据可以导出');
                return;
            }

            // 让用户选择导出方式
            const exportOptions = [
                {
                    label: '$(save) 保存到本地',
                    description: '将注释数据保存到本地文件',
                    detail: '选择保存位置并下载到本地计算机',
                    value: 'local'
                },
                {
                    label: '$(cloud-upload) 上传到云端',
                    description: '将注释数据上传到云端服务器',
                    detail: '需要登录账户，数据将安全存储在云端',
                    value: 'cloud'
                }
            ];

            const selectedOption = await vscode.window.showQuickPick(exportOptions, {
                placeHolder: '选择导出方式',
                ignoreFocusOut: true
            });

            if (!selectedOption) {
                return; // 用户取消了操作
            }

            if (selectedOption.value === 'local') {
                // 本地保存流程
                await handleLocalExport(projectInfo, allComments, totalComments);
            } else if (selectedOption.value === 'cloud') {
                // 云端上传流程
                await handleCloudUpload(projectInfo, allComments, totalComments, authManager);
            }

        } catch (error) {
            logger.error('导出注释数据时发生错误:', error);
            vscode.window.showErrorMessage(`导出失败: ${getErrorMessage(error)}`);
        }
    });

    // 处理本地导出
    async function handleLocalExport(projectInfo: ProjectInfo, allComments: import('../../managers/commentManager').FileComments, totalComments: number) {
        // 生成默认文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const defaultFileName = `${projectInfo.name}-comments-${timestamp}.json`;

        // 让用户选择保存位置
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultFileName),
            filters: {
                'JSON文件': ['json'],
                '所有文件': ['*']
            },
            saveLabel: '导出注释数据'
        });

        if (!saveUri) {
            return; // 用户取消了操作
        }

        // 构建导出数据
        const exportData = buildExportData(projectInfo, allComments, totalComments);

        // 执行导出
        const success = await commentManager.exportComments(saveUri.fsPath);
        
        if (success) {
            const fileCount = Object.keys(allComments).length;
            vscode.window.showInformationMessage(
                `导出成功！已导出 ${fileCount} 个文件的 ${totalComments} 条注释`,
                '打开文件位置', '查看文件'
            ).then(selection => {
                if (selection === '打开文件位置') {
                    vscode.commands.executeCommand('revealFileInOS', saveUri);
                } else if (selection === '查看文件') {
                    vscode.commands.executeCommand('vscode.open', saveUri);
                }
            });
        } else {
            vscode.window.showErrorMessage('导出失败，请检查文件路径和权限');
        }
    }

    // 处理云端上传
    async function handleCloudUpload(projectInfo: ProjectInfo, allComments: import('../../managers/commentManager').FileComments, totalComments: number, authManager?: AuthManager) {
        // 检查 authManager 是否存在
        if (!authManager) {
            vscode.window.showErrorMessage('认证管理器未初始化');
            return;
        }
        
        // 检查用户是否已登录
        if (!authManager.isLoggedIn()) {
            const loginChoice = await DialogUtils.showConfirmDialog(
                '上传到云端需要先登录账户',
                '立即登录',
                '取消',
                {
                    onConfirm: () => {
                        // 显示登录界面
                        AuthWebview.createOrShow(context.extensionUri, authManager);
                    }
                }
            );
            
            if (!loginChoice) {
                return; // 用户取消
            }
            return;
        }

        // 获取关联的项目ID（使用容器注入的 ProjectManager）
        const associatedProjectId = projectManager.getAssociatedProject();
                    if (!associatedProjectId) {
                const associateChoice = await DialogUtils.showConfirmDialog(
                    '当前项目未关联云端项目，需要先关联项目才能上传',
                    '关联项目',
                    '取消',
                    {
                        onConfirm: () => {
                            // 显示用户信息面板，让用户关联项目
                            UserInfoWebview.createOrShow(context.extensionUri, authManager, projectManager, commentManager, bookmarkManager, tagManager);
                        }
                    }
                );
                
                if (!associateChoice) {
                    return; // 用户取消
                }
                return;
            }

        // 显示上传进度
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在上传注释数据到云端...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 0, message: '准备数据...' });
                
                // 构建导出数据
                const exportData = buildExportData(projectInfo, allComments, totalComments);

                progress.report({ increment: 30, message: '数据准备完成，正在上传...' });

                // 调用真实的API接口上传数据
                const uploadPayload = {
                    content: exportData,
                    project_id: parseInt(associatedProjectId)
                };

                // 获取认证token
                const token = authManager.getAuthToken();
                if (!token) {
                    throw new Error('认证token无效');
                }

                // 获取API基础URL
                const config = vscode.workspace.getConfiguration('local-comment');
                const apiUrl = config.get<string>('server.apiUrl');
                if (!apiUrl) {
                    throw new Error('API服务器地址未配置');
                }

                // 构建完整的API URL
                const fullApiUrl = `${apiUrl}${ApiRoutes.comment.uploadComments}`;

                // 发送API请求
                const response = await fetch(fullApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(uploadPayload)
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`上传失败: ${response.status} ${response.statusText} - ${errorData.message || '未知错误'}`);
                }

                const result = await response.json();
                
                progress.report({ increment: 70, message: '上传完成，正在验证...' });
                
                // 验证上传结果
                if (!result.id) {
                    throw new Error('上传验证失败：服务器未返回有效的记录ID');
                }
                
                progress.report({ increment: 100, message: '上传成功！' });

                // 显示成功消息
                const fileCount = Object.keys(allComments).length;
                const uploadTime = new Date(result.created_at).toLocaleString('zh-CN');
                vscode.window.showInformationMessage(
                    `云端上传成功！已上传 ${fileCount} 个文件的 ${totalComments} 条注释\n上传时间：${uploadTime}`,
                    
                );

            } catch (error) {
                logger.error('云端上传失败:', error);
                vscode.window.showErrorMessage(`云端上传失败: ${getErrorMessage(error)}`);
            }
        });
    }

    // 导入注释数据命令
    const importCommentsCommand = vscode.commands.registerCommand(COMMANDS.IMPORT_COMMENTS, async () => {
        try {
            // 让用户选择导入方式
            const importOptions = [
                {
                    label: '$(file) 从本地文件导入',
                    description: '从本地JSON文件导入注释数据',
                    detail: '选择本地保存的注释数据文件',
                    value: 'local'
                },
                {
                    label: '$(cloud-download) 从服务端导入',
                    description: '从云端服务器下载注释数据',
                    detail: '需要登录账户，从云端项目下载注释数据',
                    value: 'cloud'
                }
            ];

            const selectedOption = await vscode.window.showQuickPick(importOptions, {
                placeHolder: '选择导入方式',
                ignoreFocusOut: true
            });

            if (!selectedOption) {
                return; // 用户取消了操作
            }

            if (selectedOption.value === 'local') {
                // 本地文件导入流程
                await handleLocalImport();
            } else if (selectedOption.value === 'cloud') {
                // 服务端导入流程
                await handleCloudImport(authManager);
            }

        } catch (error) {
            logger.error('导入注释数据时发生错误:', error);
            vscode.window.showErrorMessage(`导入失败: ${getErrorMessage(error)}`);
        }
    });

    // 处理本地文件导入
    async function handleLocalImport() {
        try {
            // 让用户选择导入文件
            const openUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'JSON文件': ['json'],
                    '所有文件': ['*']
                },
                openLabel: '选择注释数据文件'
            });

            if (!openUri || openUri.length === 0) {
                return; // 用户取消了操作
            }

            const importPath = openUri[0].fsPath;

            // 验证导入文件
            const validation = await commentManager.validateImportFile(importPath);
            
            if (!validation.valid) {
                vscode.window.showErrorMessage(`文件验证失败: ${validation.message}`);
                return;
            }

            // 分析导入文件的路径信息
            const pathAnalysis = await commentManager.analyzeImportPaths(importPath);
            
            if (!pathAnalysis.success) {
                vscode.window.showErrorMessage(`路径分析失败: ${pathAnalysis.message}`);
                return;
            }

            // 获取当前项目信息
            const currentProject = commentManager.getProjectInfo();

            // 显示导入预览信息
            let previewMessage = `导入预览:\n\n`;
            previewMessage += `源项目: ${validation.projectName}\n`;
            previewMessage += `目标项目: ${currentProject.name}\n`;
            previewMessage += `导出时间: ${validation.exportTime}\n`;
            previewMessage += `文件数量: ${validation.fileCount} 个\n`;
            previewMessage += `注释数量: ${validation.commentCount} 条\n\n`;

            // 检查是否需要跨项目导入
            const needsCrossProjectImport = pathAnalysis.commonBasePath && 
                !pathAnalysis.commonBasePath.startsWith(currentProject.path.replace(/\\/g, '/'));

            let importOptions: Array<{
                label: string;
                description: string;
                detail: string;
                mode: 'merge' | 'replace';
            }> = [];

            if (needsCrossProjectImport) {
                // 跨项目导入选项
                previewMessage += `检测到跨项目导入需求\n`;
                previewMessage += `源项目路径: ${pathAnalysis.commonBasePath}\n`;
                previewMessage += `当前项目路径: ${currentProject.path}\n\n`;
                previewMessage += `请选择导入方式:`;

                importOptions = [
                    {
                        label: '路径重映射 + 合并',
                        description: '自动重映射文件路径并合并注释',
                        detail: `将源路径 ${pathAnalysis.commonBasePath} 映射到 ${currentProject.path}`,
                        mode: 'merge'
                    },
                    {
                        label: '路径重映射 + 替换',
                        description: '自动重映射文件路径并替换所有注释',
                        detail: '警告：这将删除当前项目的所有注释数据',
                        mode: 'replace'
                    }
                ];
            } else {
                // 同项目导入选项
                previewMessage += `请选择导入模式:`;

                importOptions = [
                    {
                        label: '合并导入',
                        description: '将导入的注释与现有注释合并',
                        detail: '如果存在相同ID的注释将跳过，保留现有数据',
                        mode: 'merge'
                    },
                    {
                        label: '替换导入',
                        description: '用导入的注释替换所有现有注释',
                        detail: '警告：这将删除当前项目的所有注释数据',
                        mode: 'replace'
                    }
                ];
            }

            // 让用户选择导入模式
            const importMode = await vscode.window.showQuickPick(importOptions, {
                placeHolder: '选择导入方式',
                ignoreFocusOut: true
            });

            if (!importMode) {
                return; // 用户取消了操作
            }

            // 如果是替换模式，再次确认
            if (importMode.mode === 'replace') {
                const confirm = await DialogUtils.showConfirmDialog(
                    '确定要替换所有现有注释数据吗？\n\n此操作将删除当前项目的所有注释，且不可恢复！',
                    '确定替换',
                    '取消',
                    { modal: true }
                );
                
                if (!confirm) {
                    return;
                }
            }

            // 准备路径映射配置
            let pathMapping: { oldBasePath: string; newBasePath: string } | undefined;
            
            if (needsCrossProjectImport && pathAnalysis.commonBasePath) {
                pathMapping = {
                    oldBasePath: pathAnalysis.commonBasePath,
                    newBasePath: currentProject.path.replace(/\\/g, '/') + '/'
                };
            }

            // 执行导入
            const result = await commentManager.importComments(
                importPath,
                importMode.mode,
                pathMapping
            );
            
            if (result.success) {
                // 刷新界面
                tagManager.updateTags(commentManager.getAllComments());
                commentProvider.refresh();
                commentTreeProvider.refresh();

                // 构建成功消息
                let successMessage = result.message;
                if (result.remappedFiles && result.remappedFiles > 0) {
                    successMessage += `\n 已重映射 ${result.remappedFiles} 个文件的路径`;
                }
                
                // 显示成功消息
                vscode.window.showInformationMessage(
                    `${successMessage}`,
                    '查看注释列表', '显示统计'
                ).then(selection => {
                    if (selection === '查看注释列表') {
                        vscode.commands.executeCommand('workbench.view.explorer');
                    } else if (selection === '显示统计') {
                        vscode.commands.executeCommand(COMMANDS.SHOW_STORAGE_STATS);
                    }
                });
            } else {
                vscode.window.showErrorMessage(result.message);
            }

        } catch (error) {
            logger.error('导入注释数据时发生错误:', error);
            vscode.window.showErrorMessage(`导入失败: ${getErrorMessage(error)}`);
        }
    }

    // 处理服务端导入
    async function handleCloudImport(authManager?: AuthManager) {
        try {
            // 检查 authManager 是否存在
            if (!authManager) {
                vscode.window.showErrorMessage('认证管理器未初始化');
                return;
            }
            
            // 检查用户是否已登录
            if (!authManager.isLoggedIn()) {
                const loginChoice = await DialogUtils.showConfirmDialog(
                    '从服务端导入需要先登录账户',
                    '立即登录',
                    '取消',
                    {
                        onConfirm: () => {
                            // 显示登录界面
                            AuthWebview.createOrShow(context.extensionUri, authManager);
                        }
                    }
                );
                
                if (!loginChoice) {
                    return; // 用户取消
                }
                return;
            }

            // 获取关联的项目ID（使用容器注入的 ProjectManager）
            const associatedProjectId = projectManager.getAssociatedProject();
            if (!associatedProjectId) {
                const associateChoice = await DialogUtils.showConfirmDialog(
                    '当前项目未关联云端项目，需要先关联项目才能导入',
                    '关联项目',
                    '取消',
                    {
                        onConfirm: () => {
                            // 显示用户信息面板，让用户关联项目
                            UserInfoWebview.createOrShow(context.extensionUri, authManager, projectManager, commentManager, bookmarkManager, tagManager);
                        }
                    }
                );
                
                if (!associateChoice) {
                    return; // 用户取消
                }
                return;
            }

            // 显示下载进度
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在从服务端下载注释数据...',
                cancellable: false
            }, async (progress) => {
                try {
                    progress.report({ increment: 0, message: '连接服务端...' });

                    // 调用API获取注释数据
                    const response = await apiService.get<ProjectCommentRecord[]>(ApiRoutes.comment.importComments);
                    
                    progress.report({ increment: 30, message: '数据下载完成，正在处理...' });

                    // 过滤出当前项目关联的注释数据
                    const projectComments = response.filter(item => 
                        item.project_id === parseInt(associatedProjectId)
                    );

                    if (projectComments.length === 0) {
                        vscode.window.showWarningMessage('当前项目在服务端没有找到注释数据');
                        return;
                    }

                    progress.report({ increment: 50, message: '数据过滤完成，正在转换格式...' });

                    // 提取注释数据（取最新的一个）
                    const latestComment = projectComments[projectComments.length - 1];
                    const commentData = latestComment.content;

                    // 验证数据格式
                    if (!commentData || !commentData.comments) {
                        throw new Error('服务端返回的注释数据格式不正确');
                    }

                    // 显示导入预览信息
                    const previewMessage = `导入预览:\n\n` +
                        `源项目: ${commentData.projectInfo?.name || '未知项目'}\n` +
                        `目标项目: ${commentManager.getProjectInfo().name}\n` +
                        `导出时间: ${commentData.exportTime || '未知时间'}\n` +
                        `文件数量: ${commentData.metadata?.totalFiles || 0} 个\n` +
                        `注释数量: ${commentData.metadata?.totalComments || 0} 条\n\n` +
                        `请选择导入模式:`;

                    const importOptions = [
                        {
                            label: '合并导入',
                            description: '将导入的注释与现有注释合并',
                            detail: '如果存在相同ID的注释将跳过，保留现有数据',
                            mode: 'merge'
                        },
                        {
                            label: '替换导入',
                            description: '用导入的注释替换所有现有注释',
                            detail: '警告：这将删除当前项目的所有注释数据',
                            mode: 'replace'
                        }
                    ];

                    progress.report({ increment: 70, message: '格式转换完成，等待用户确认...' });

                    // 让用户选择导入模式
                    const importMode = await vscode.window.showQuickPick(importOptions, {
                        placeHolder: '选择导入方式',
                        ignoreFocusOut: true
                    });

                    if (!importMode) {
                        return; // 用户取消了操作
                    }

                    // 如果是替换模式，再次确认
                    if (importMode.mode === 'replace') {
                        const confirm = await DialogUtils.showConfirmDialog(
                            '确定要替换所有现有注释数据吗？\n\n此操作将删除当前项目的所有注释，且不可恢复！',
                            '确定替换',
                            '取消',
                            { modal: true }
                        );
                        
                        if (!confirm) {
                            return;
                        }
                    }

                    progress.report({ increment: 80, message: '正在导入注释数据...' });

                    // 将服务端数据转换为临时文件格式
                    const tempData = {
                        version: commentData.version,
                        exportTime: commentData.exportTime,
                        projectInfo: commentData.projectInfo,
                        comments: commentData.comments,
                        metadata: commentData.metadata
                    };

                    // 创建临时文件路径
                    const tempDir = os.tmpdir();
                    const tempFile = path.join(tempDir, `temp-comments-${Date.now()}.json`);

                    // 写入临时文件
                    fs.writeFileSync(tempFile, JSON.stringify(tempData, null, 2));

                    try {
                        // 使用现有的导入逻辑处理数据
                        const result = await commentManager.importComments(
                            tempFile,
                            importMode.mode as 'merge' | 'replace'
                        );

                        // 删除临时文件
                        fs.unlinkSync(tempFile);

                        progress.report({ increment: 100, message: '导入完成！' });

                        if (result.success) {
                            // 刷新界面
                            tagManager.updateTags(commentManager.getAllComments());
                            commentProvider.refresh();
                            commentTreeProvider.refresh();

                            // 构建成功消息
                            let successMessage = result.message;
                            if (result.remappedFiles && result.remappedFiles > 0) {
                                successMessage += `\n 已重映射 ${result.remappedFiles} 个文件的路径`;
                            }
                            
                            // 显示成功消息
                            vscode.window.showInformationMessage(
                                `${successMessage}`,
                                '查看注释列表', '显示统计'
                            ).then(selection => {
                                if (selection === '查看注释列表') {
                                    vscode.commands.executeCommand('workbench.view.explorer');
                                } else if (selection === '显示统计') {
                                    vscode.commands.executeCommand(COMMANDS.SHOW_STORAGE_STATS);
                                }
                            });
                        } else {
                            vscode.window.showErrorMessage(result.message);
                        }

                    } catch (importError) {
                        // 确保删除临时文件
                        if (fs.existsSync(tempFile)) {
                            fs.unlinkSync(tempFile);
                        }
                        throw importError;
                    }

                } catch (error) {
                    logger.error('服务端导入失败:', error);
                    vscode.window.showErrorMessage(`服务端导入失败: ${getErrorMessage(error)}`);
                }
            });
            
        } catch (error) {
            logger.error('服务端导入失败:', error);
            vscode.window.showErrorMessage(`服务端导入失败: ${getErrorMessage(error)}`);
        }
    }

    // 认证相关命令
    const logoutCommand = vscode.commands.registerCommand(COMMANDS.LOGOUT, async () => {
        if (!authManager.isLoggedIn()) {
            vscode.window.showInformationMessage('您尚未登录');
            return;
        }
        
        await DialogUtils.showConfirmDialog(
            '确定要登出吗？',
            '确定',
            '取消',
            {
                onConfirm: async () => {
                    await authManager.logout();
                    vscode.window.showInformationMessage('已成功登出');
                }
            }
        );
    });

    // 刷新共享注释命令
    const refreshSharedCommentsCommand = vscode.commands.registerCommand(COMMANDS.REFRESH_SHARED_COMMENTS, async () => {
        try {
            if (!authManager.isLoggedIn()) {
                vscode.window.showWarningMessage('请先登录以刷新共享注释');
                return;
            }

            const associatedProjectId = projectManager.getAssociatedProject();
            if (!associatedProjectId) {
                vscode.window.showWarningMessage('请先关联项目以刷新共享注释');
                return;
            }

            const projectId = parseInt(associatedProjectId, 10);
            if (isNaN(projectId)) {
                vscode.window.showWarningMessage('项目ID无效');
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在刷新共享注释...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: '正在从服务器获取共享注释...' });
                
                const sharedComments = await commentManager.getProjectSharedComments(projectId);
                
                progress.report({ increment: 100, message: '刷新完成！' });

                if (sharedComments && sharedComments.length > 0) {
                    vscode.window.showInformationMessage(`成功刷新了 ${sharedComments.length} 条共享注释`);
                } else {
                    vscode.window.showInformationMessage('项目中没有共享注释');
                }
            });
        } catch (error) {
            logger.error('刷新共享注释失败:', error);
            vscode.window.showErrorMessage(`刷新共享注释失败: ${getErrorMessage(error)}`);
        }
    });

    // 显示共享注释Webview命令
    const showShareCommentCommand = vscode.commands.registerCommand(COMMANDS.SHOW_SHARE_COMMENT, async (treeItemOrParams: SharedCommentTreeCommandItem) => {
        try {
            let comment: SharedComment | undefined;
            let filePath: string;
            
            // 检查参数类型：可能是树项或hover参数
            if (treeItemOrParams?.sharedComment && treeItemOrParams.filePath) {
                // 从树项中获取共享注释数据
                comment = treeItemOrParams.sharedComment;
                filePath = treeItemOrParams.filePath;
            } else if (treeItemOrParams?.commentId && treeItemOrParams.filePath) {
                // 从hover参数中获取共享注释数据
                const allSharedComments = commentManager.getAllSharedComments();
                const sharedComments = allSharedComments[treeItemOrParams.filePath] || [];
                comment = sharedComments.find((c: LocalComment | SharedComment) => c.id === treeItemOrParams.commentId);
                
                if (!comment || !('userId' in comment)) {
                    vscode.window.showErrorMessage('无法找到指定的共享注释');
                    return;
                }
                
                filePath = treeItemOrParams.filePath;
            } else {
                vscode.window.showErrorMessage('无法获取共享注释数据');
                return;
            }
            
            // 构建上下文信息
            const contextInfo = {
                fileName: path.basename(filePath),
                lineNumber: comment.line,
                lineContent: comment.lineContent,
                filePath: filePath,
                commentContent: comment.content,
                sharedCommentId: comment.id,
                userId: comment.userId,
                username: comment.username,
                timestamp: comment.timestamp
            };
            
            // 显示Webview
            await showShareCommentWebview(
                commentManager.getContext(),
                commentManager,
                comment.content,
                `共享注释预览 - ${contextInfo.fileName}:${comment.line + 1}`,
                contextInfo
            );
            
        } catch (error) {
            logger.error('显示共享注释Webview失败:', error);
            vscode.window.showErrorMessage(`显示注释内容失败: ${getErrorMessage(error)}`);
        }
    });

    const previewMarkdownCommand = vscode.commands.registerCommand(COMMANDS.PREVIEW_MARKDOWN, () => {
        const availableTagNames = tagManager.getAvailableTagNames();
        void MarkdownPreviewWebview.previewFile(context, availableTagNames);
    });

    // 注册comment.ts中的命令
    const commentCommands = registerCommentCommands(
        commentManager,
        tagManager,
        commentProvider,
        commentTreeProvider,
        authManager,
        projectManager,
        context
    );

    // 注册bookmark.ts中的命令
    const bookmarkCommands = registerBookmarkCommands(bookmarkManager);

    // 注册tagCommands.ts中的命令
    const tagCommands = registerTagCommands(tagManager, commentManager);

    // 注册Tag关系图命令
    const tagRelationGraphCommands = registerTagRelationGraphCommands(context, commentManager);

    // 返回所有注册的命令，以便在extension.ts中添加到subscriptions
    return [
        showStorageLocationCommand,
        switchCommentsConfigCommand,
        switchBookmarksConfigCommand,
        migrateOldDataCommand,
        showStorageStatsCommand,
        manageProjectsCommand,
        toggleCommentsCommand,
        exportCommentsCommand,
        importCommentsCommand,
        // 认证相关命令
        logoutCommand,
        refreshSharedCommentsCommand,
        showShareCommentCommand,
        previewMarkdownCommand,
        ...commentCommands,
        ...bookmarkCommands,
        ...tagCommands,
        ...tagRelationGraphCommands,
    ];
} 