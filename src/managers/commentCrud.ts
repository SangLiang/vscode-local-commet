import * as vscode from 'vscode';
import { LocalComment } from './commentTypes';
import { CommentStorage } from './commentStorage';
import { generateId, findCommentIndex } from '../utils/idUtils';
import { logger } from '../utils/logger';
import { colorKeyForStorage } from '../utils/commentDecorationColor';

/**
 * 注释 CRUD 操作类
 *
 * 职责：
 * - 添加、编辑、删除、查询本地注释
 * - 不包含智能匹配逻辑（在 CommentMatching 中）
 * - 不包含共享注释管理（在 CommentSharing 中）
 *
 * 注意：本类不直接触发事件，事件由 CommentManager 协调器统一处理
 */
export class CommentCRUD {
  constructor(private storage: CommentStorage) {}

  /**
   * 获取指定行号的本地注释
   * @param filePath 文件路径
   * @param line 行号
   * @returns 本地注释对象，如果未找到则返回 undefined
   */
  getLocalCommentAtLine(filePath: string, line: number): LocalComment | undefined {
    const fileComments = this.storage.getCommentsRef()[filePath];
    if (!fileComments) {
      return undefined;
    }

    // 查找指定行的本地注释（排除共享注释）
    return fileComments.find(c => c.line === line && !('userId' in c)) as LocalComment | undefined;
  }

  /**
   * 根据注释 ID 获取注释
   * @param filePath 文件路径
   * @param commentId 注释ID
   * @returns 本地注释对象，如果未找到则返回 undefined
   */
  getCommentById(filePath: string, commentId: string): LocalComment | undefined {
    const fileComments = this.storage.getCommentsRef()[filePath];
    if (!fileComments) {
      return undefined;
    }

    return fileComments.find(c => c.id === commentId);
  }

  /**
   * 添加本地注释
   * @param uri 文件URI
   * @param line 行号
   * @param content 注释内容
   * @param lineContent 当前行的代码内容（用于智能定位）
   * @returns 创建的注释对象
   */
  async addComment(
    uri: vscode.Uri,
    line: number,
    content: string,
    lineContent: string,
    color?: string
  ): Promise<LocalComment> {
    const comments = this.storage.getCommentsRef();
    const filePath = uri.fsPath;

    if (!comments[filePath]) {
      comments[filePath] = [];
    }

    const comment: LocalComment = {
      id: generateId(),
      line: line,
      content: content,
      timestamp: Date.now(),
      originalLine: line,
      lineContent: lineContent.trim(),
      isShared: false
    };
    const storedColor = colorKeyForStorage(color);
    if (storedColor) {
      comment.color = storedColor;
    }

    // 检查是否已存在该行的本地注释，如果存在则替换
    const existingLocalIndex = comments[filePath].findIndex(c =>
      c.line === line && !('userId' in c) // 只检查本地注释
    );

    if (existingLocalIndex >= 0) {
      // 替换现有的本地注释
      comments[filePath][existingLocalIndex] = comment;
    } else {
      // 添加新的本地注释
      comments[filePath].push(comment);
    }

    return comment;
  }

  /**
   * 编辑本地注释内容
   * @param filePath 文件路径
   * @param commentId 注释ID
   * @param newContent 新内容
   * @returns 是否成功编辑
   */
  editComment(filePath: string, commentId: string, newContent: string, color?: string): boolean {
    const comments = this.storage.getCommentsRef();

    if (!comments[filePath]) {
      vscode.window.showWarningMessage('该文件没有本地注释');
      return false;
    }

    const commentIndex = findCommentIndex(comments[filePath], commentId);
    if (commentIndex === -1) {
      vscode.window.showWarningMessage('找不到指定的注释');
      return false;
    }

    comments[filePath][commentIndex].content = newContent;
    comments[filePath][commentIndex].timestamp = Date.now(); // 更新时间戳
    if (color !== undefined) {
      const storedColor = colorKeyForStorage(color);
      if (storedColor) {
        comments[filePath][commentIndex].color = storedColor;
      } else {
        delete comments[filePath][commentIndex].color;
      }
    }

    return true;
  }

  /**
   * 更新注释的行号和相关内容（用于智能匹配后更新位置）
   * @param filePath 文件路径
   * @param commentId 注释ID
   * @param newLine 新的行号
   * @param newLineContent 新行号对应的行内容
   * @returns 是否成功更新
   */
  updateCommentLine(
    filePath: string,
    commentId: string,
    newLine: number,
    newLineContent: string
  ): boolean {
    const comments = this.storage.getCommentsRef();

    // 检查文件是否存在本地注释
    if (!comments[filePath]) {
      vscode.window.showWarningMessage('该文件没有本地注释');
      return false;
    }

    // 根据注释ID查找注释在数组中的索引
    const commentIndex = findCommentIndex(comments[filePath], commentId);
    if (commentIndex === -1) {
      vscode.window.showWarningMessage('找不到指定的注释');
      return false;
    }

    // 更新注释的行号、行内容和时间戳
    comments[filePath][commentIndex].line = newLine;
    comments[filePath][commentIndex].lineContent = newLineContent;
    comments[filePath][commentIndex].timestamp = Date.now(); // 更新时间戳

    return true;
  }

  /**
   * 根据行号删除本地注释
   * @param filePath 文件路径
   * @param line 行号
   * @returns 是否成功删除
   */
  removeComment(filePath: string, line: number): boolean {
    const comments = this.storage.getCommentsRef();

    if (!comments[filePath]) {
      vscode.window.showWarningMessage('该文件没有本地注释');
      return false;
    }

    // 只删除本地注释，保留共享注释
    const initialLength = comments[filePath].length;
    comments[filePath] = comments[filePath].filter(c =>
      !(c.line === line && !('userId' in c)) // 只过滤掉本地注释
    );

    if (comments[filePath].length === initialLength) {
      vscode.window.showWarningMessage(`第 ${line + 1} 行没有本地注释`);
      return false;
    }

    // 如果该文件没有注释了，删除该文件的记录
    if (comments[filePath].length === 0) {
      delete comments[filePath];
    }

    return true;
  }

  /**
   * 根据 ID 删除本地注释
   * @param filePath 文件路径
   * @param commentId 注释ID
   * @returns 是否成功删除
   */
  removeCommentById(filePath: string, commentId: string): boolean {
    const comments = this.storage.getCommentsRef();

    if (!comments[filePath]) {
      vscode.window.showWarningMessage('该文件没有本地注释');
      return false;
    }

    const commentToRemove = comments[filePath].find(c => c.id === commentId);

    if (!commentToRemove) {
      vscode.window.showWarningMessage('找不到指定的注释');
      return false;
    }

    comments[filePath] = comments[filePath].filter(c => c.id !== commentId);

    // 如果该文件没有注释了，删除该文件的记录
    if (comments[filePath].length === 0) {
      delete comments[filePath];
    }

    return true;
  }

  /**
   * 清空文件的所有本地注释
   * @param filePath 文件路径
   * @returns 删除的注释数量
   */
  clearFileComments(filePath: string): number {
    const comments = this.storage.getCommentsRef();

    if (!comments[filePath] || comments[filePath].length === 0) {
      vscode.window.showWarningMessage('该文件没有本地注释');
      return 0;
    }

    // 只计算本地注释数量
    const localCommentCount = comments[filePath].filter(c => !('userId' in c)).length;

    if (localCommentCount === 0) {
      vscode.window.showWarningMessage('该文件没有本地注释');
      return 0;
    }

    // 只保留共享注释，删除所有本地注释
    comments[filePath] = comments[filePath].filter(c => 'userId' in c);

    // 如果该文件没有共享注释了，删除该文件的记录
    if (comments[filePath].length === 0) {
      delete comments[filePath];
    }

    return localCommentCount;
  }
}
