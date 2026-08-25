import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LocalComment, SharedComment, ProjectSharedComment } from './commentTypes';
import { CommentStorage } from './commentStorage';
import { AuthManager } from './authManager';
import { apiService, ApiRoutes } from '../apiService';
import { findCommentIndex, generateId } from '../utils/idUtils';
import { toAbsolutePath } from '../utils/utils';
import { logger } from '../utils/logger';

/**
 * 共享注释管理类
 *
 * 职责：
 * - 共享注释本地存储管理
 * - 认证状态联动（登录/登出时处理共享注释）
 * - 云端项目共享注释拉取与同步
 * - 将共享注释转为本地注释
 *
 * 注意：本类不直接触发事件，事件由 CommentManager 协调器统一处理
 */
export class CommentSharing {
  constructor(
    private storage: CommentStorage,
    private authManager?: AuthManager
  ) {}

  /**
   * 清空所有共享注释
   * @returns 清空的共享注释数量
   */
  async clearAllSharedComments(): Promise<number> {
    const shareComments = this.storage.getShareCommentsRef();
    let totalRemoved = 0;

    // 计算所有共享注释数量
    for (const filePath of Object.keys(shareComments)) {
      const allComments = shareComments[filePath];
      // 过滤出只有 SharedComment 类型的数据
      const sharedComments = allComments.filter((comment): comment is SharedComment =>
        'userId' in comment
      );

      totalRemoved += sharedComments.length;
    }

    // 清空所有共享注释
    this.storage.replaceShareComments({});

    if (totalRemoved > 0) {
      vscode.window.showInformationMessage(`已清空所有共享注释，共删除 ${totalRemoved} 条共享注释`);
    } else {
      // 只有登录用户才显示"没有找到共享注释"提示
      if (this.authManager && this.authManager.isLoggedIn()) {
        vscode.window.showInformationMessage('没有找到共享注释');
      }
    }

    return totalRemoved;
  }

  /**
   * 根据登录状态处理共享注释
   * 当用户未登录时，清除所有共享注释
   * @param isLoggedIn 用户是否已登录
   */
  async handleSharedCommentsByAuthStatus(isLoggedIn: boolean): Promise<number> {
    if (!isLoggedIn) {
      return this.clearAllSharedComments();
    }
    return 0;
  }

  /**
   * 清空指定文件的共享注释
   * @param filePath 文件路径
   * @returns 清空的共享注释数量
   */
  async clearFileSharedComments(filePath: string): Promise<number> {
    const shareComments = this.storage.getShareCommentsRef();
    const allComments = shareComments[filePath] || [];
    // 过滤出只有 SharedComment 类型的数据
    const sharedComments = allComments.filter((comment): comment is SharedComment =>
      'userId' in comment
    );

    if (sharedComments.length === 0) {
      vscode.window.showWarningMessage('该文件没有共享注释');
      return 0;
    }

    const removedCount = sharedComments.length;

    // 删除该文件的共享注释
    delete shareComments[filePath];

    vscode.window.showInformationMessage(`已清空文件的所有共享注释，共删除 ${removedCount} 条共享注释`);

    return removedCount;
  }

  /**
   * 将共享注释转换为本地注释（保留原始的 lineContent）
   * @param filePath 文件路径
   * @param line 行号
   * @param content 注释内容
   * @param lineContent 原始行内容
   * @param originalLine 原始行号
   * @param isMatched 是否匹配
   */
  async addCommentFromShared(
    filePath: string,
    line: number,
    content: string,
    lineContent: string,
    originalLine: number,
    isMatched: boolean = true
  ): Promise<void> {
    try {
      const comments = this.storage.getCommentsRef();

      if (!comments[filePath]) {
        comments[filePath] = [];
      }

      // 创建本地注释，保留共享注释的原始 lineContent
      const comment: LocalComment = {
        id: generateId(),
        line: line,
        content: content,
        timestamp: Date.now(),
        originalLine: originalLine,
        lineContent: lineContent.trim(),
        isMatched: isMatched,
        isShared: false
      };

      // 检查是否已存在该行的本地注释，如果存在则替换
      const existingLocalIndex = comments[filePath].findIndex(c =>
        c.line === line && !('userId' in c)
      );

      if (existingLocalIndex >= 0) {
        // 替换现有的本地注释
        comments[filePath][existingLocalIndex] = comment;
      } else {
        // 添加新的本地注释
        comments[filePath].push(comment);
      }
    } catch (error) {
      logger.error('从共享注释添加本地注释失败:', error);
      throw error;
    }
  }

  /**
   * 获取项目中的所有共享注释
   * @param projectId 项目ID
   * @param pathMapping 路径映射配置，用于跨项目路径重映射
   * @returns 项目共享注释数组的 Promise
   */
  async getProjectSharedComments(
    projectId: number,
    pathMapping?: { oldBasePath: string; newBasePath: string }
  ): Promise<ProjectSharedComment[] | null> {
    try {
      const response = await apiService.get<ProjectSharedComment[]>(
        ApiRoutes.comment.getProjectSharedComments(projectId)
      );

      if (response && response.length > 0) {
        // 将项目共享注释转换为本地注释格式并存储
        await this.saveProjectSharedCommentsToLocal(response, pathMapping);
      }

      return response;
    } catch (error) {
      logger.error('获取项目共享注释失败:', error);
      vscode.window.showErrorMessage(`获取项目共享注释失败: ${error}`);
      return null;
    }
  }

  /**
   * 将项目共享注释数组保存到本地
   * @param projectSharedComments 项目共享注释数组
   * @param pathMapping 路径映射配置，用于跨项目路径重映射
   */
  private async saveProjectSharedCommentsToLocal(
    projectSharedComments: ProjectSharedComment[],
    pathMapping?: { oldBasePath: string; newBasePath: string }
  ): Promise<void> {
    try {
      let savedCount = 0;
      let skippedCount = 0;
      let remappedCount = 0;
      const shareComments = this.storage.getShareCommentsRef();

      for (const projectComment of projectSharedComments) {
        try {
          let targetFilePath = projectComment.file_path;
          const originalFilePath = projectComment.file_path;

          // 使用与导入功能相同的路径重映射逻辑
          if (pathMapping) {
            const { oldBasePath, newBasePath } = pathMapping;

            // 确保路径是绝对路径，以便进行正确的相对路径计算
            const oldFullPath = path.resolve(oldBasePath, originalFilePath);

            // 计算相对于旧基础路径的相对路径
            const relativePath = path.relative(oldBasePath, oldFullPath);

            // 构建新的绝对路径
            targetFilePath = path.join(newBasePath, relativePath);

            if (originalFilePath !== targetFilePath) {
              remappedCount++;
            }
          } else {
            // 如果没有路径映射，尝试将标准化路径转换为当前系统路径
            targetFilePath = toAbsolutePath(originalFilePath);

            // 如果转换后的路径与原始路径不同，记录重映射
            if (originalFilePath !== targetFilePath) {
              remappedCount++;
            }
          }

          // 检查文件是否存在
          if (!fs.existsSync(targetFilePath)) {
            logger.warn(`文件不存在，跳过共享注释: ${targetFilePath} (原始路径: ${originalFilePath})`);
            skippedCount++;
            continue;
          }

          // 确保文件共享注释数组存在
          if (!shareComments[targetFilePath]) {
            shareComments[targetFilePath] = [];
          }

          // 将 ProjectSharedComment 转换为 SharedComment
          const sharedComment: SharedComment = {
            id: projectComment.id.toString(), // 转换为字符串ID
            line: projectComment.content.line,
            content: projectComment.content.content,
            timestamp: projectComment.content.timestamp,
            originalLine: projectComment.content.originalLine,
            lineContent: projectComment.content.lineContent,
            isMatched: projectComment.content.isMatched,
            isShared: true, // 标记为共享注释
            userId: projectComment.user_id.toString(), // 用户ID
            userAvatar: projectComment.user_avatar, // 从API返回数据中获取用户头像
            username: projectComment.username // 从API返回数据中获取用户名
          };

          // 检查是否已存在相同的共享注释
          const existingSharedIndex = findCommentIndex(shareComments[targetFilePath], sharedComment.id);

          if (existingSharedIndex >= 0) {
            // 更新现有的共享注释
            shareComments[targetFilePath][existingSharedIndex] = sharedComment;
          } else {
            // 添加新的共享注释
            shareComments[targetFilePath].push(sharedComment);
          }

          savedCount++;
        } catch (error) {
          logger.error(`处理项目共享注释失败: ${projectComment.id}`, error);
          skippedCount++;
        }
      }

      logger.info(`项目共享注释处理完成: 保存 ${savedCount} 个，跳过 ${skippedCount} 个，重映射 ${remappedCount} 个路径`);

      if (savedCount > 0) {
        vscode.window.showInformationMessage(`已保存 ${savedCount} 个共享注释到本地`);
      }
    } catch (error) {
      logger.error('保存项目共享注释到本地失败:', error);
      vscode.window.showErrorMessage(`保存项目共享注释到本地失败: ${error}`);
    }
  }
}
