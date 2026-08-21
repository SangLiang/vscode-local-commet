import * as vscode from 'vscode';
import { LocalComment, SharedComment, FileComments } from './commentTypes';
import { CommentStorage } from './commentStorage';
import { CommentMatcher } from './commentMatcher';
import { TimerManager } from '../utils/timerUtils';
import { logger } from '../utils/logger';
import { DELAY_TIMES, COMMANDS } from '../constants';

/**
 * 注释智能匹配管理类
 *
 * 职责：
 * - 带智能匹配的 getComments
 * - 文档 change/save 时的行号同步
 * - 处理 Git 分支切换、大块代码变化等特殊场景
 *
 * 注意：本类不直接触发事件，事件由 CommentManager 协调器统一处理
 */
export class CommentMatching {
  constructor(
    private storage: CommentStorage,
    private commentMatcher: CommentMatcher,
    private timerManager: TimerManager,
    private onAsyncSave?: () => void
  ) {}

  /**
   * 获取注释（带智能匹配）
   * 文件首次加载场景：使用全文搜索进行智能匹配
   */
  getComments(uri: vscode.Uri): (LocalComment | SharedComment)[] {
    const comments = this.storage.getCommentsRef();
    const shareComments = this.storage.getShareCommentsRef();

    const filePath = uri.fsPath;
    const fileComments = comments[filePath] || [];
    const fileSharedComments = shareComments[filePath] || [];

    // 过滤出实际的 SharedComment 类型
    const validSharedComments = fileSharedComments.filter((c): c is SharedComment => 'userId' in c);

    // 合并本地注释和共享注释
    const allComments = [...fileComments, ...validSharedComments];

    // 获取当前文档内容进行智能匹配
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
    if (!document) {
      // 如果文档未打开，返回空数组（暂时隐藏注释）
      return [];
    }

    if (allComments.length === 0) {
      return [];
    }

    // 文件首次加载场景：使用支持全文搜索的批量匹配功能
    logger.debug(`文件首次加载场景，使用全文搜索进行智能匹配 (本地: ${fileComments.length}, 共享: ${validSharedComments.length})`);
    const matchResults = this.commentMatcher.batchMatchCommentsWithFullSearch(document, allComments);

    const matchedComments: (LocalComment | SharedComment)[] = [];
    let needsSave = false;

    for (const comment of allComments) {
      // 对于默认文件注释（第一行），直接添加到匹配结果中
      if (comment.line === 0) {
        matchedComments.push(comment);
        continue;
      }

      const matchedLine = matchResults.get(comment.id) ?? -1;

      if (matchedLine !== -1) {
        // 记录匹配状态为true
        comment.isMatched = true;

        // 创建一个新的注释对象，更新行号但保持原有信息
        let matchedComment: LocalComment | SharedComment;

        // 检查是否为共享注释，保持类型信息
        if ('userId' in comment) {
          const sharedComment = comment as SharedComment;
          matchedComment = {
            ...sharedComment,
            line: matchedLine,
            isMatched: true
          } as SharedComment;
        } else {
          matchedComment = {
            ...comment,
            line: matchedLine,
            isMatched: true
          };
        }
        matchedComments.push(matchedComment);

        // 如果位置发生了变化，更新存储的注释
        if (comment.line !== matchedLine) {
          comment.line = matchedLine;
          needsSave = true;
        }
      } else {
        // 标记为未匹配
        comment.isMatched = false;
      }
    }

    // 如果有位置更新，触发异步保存
    if (needsSave && this.onAsyncSave) {
      this.onAsyncSave();
    }

    return matchedComments;
  }

  /**
   * 处理文档变更事件
   * @param event 文档变更事件
   * @param isExternalChange 是否为外部文件更新（包括 Git 分支切换）
   */
  async handleDocumentChange(
    event: vscode.TextDocumentChangeEvent,
    isExternalChange: boolean = false
  ): Promise<void> {
    const filePath = event.document.uri.fsPath;
    const fileComments = this.storage.getCommentsRef()[filePath];

    if (!fileComments || fileComments.length === 0) {
      return;
    }

    // 外部文件更新可能来自Git分支切换，需要立即执行全文智能匹配
    if (isExternalChange) {
      logger.debug('检测到外部文件更新，立即执行全文智能匹配');
      await this.performSmartMatchingForFile(event.document);

      // 刷新注释显示
      this.timerManager.setTimeout(() => {
        vscode.commands.executeCommand(COMMANDS.REFRESH_COMMENTS);
      }, DELAY_TIMES.REFRESH_COMMENTS);
      return;
    }

    // 检测是否为多行变化或大块操作
    let isMultiLineChange = false;
    let totalLinesChanged = 0;
    let affectedLineCount = 0;

    for (const change of event.contentChanges) {
      const startLine = change.range.start.line;
      const endLine = change.range.end.line;
      const linesSpanned = endLine - startLine;

      // 检测多行变化的条件
      const newLineCount = (change.text.match(/\n/g) || []).length;

      if (linesSpanned > 0 || newLineCount > 0 || change.text.length > 100) {
        isMultiLineChange = true;
        totalLinesChanged += Math.max(linesSpanned, newLineCount);
        affectedLineCount += linesSpanned + newLineCount + 1;
      }
    }

    // 如果检测到多行变化（复制粘贴大块代码），立即执行智能匹配
    if (isMultiLineChange) {
      logger.debug(`🔄 检测到多行变化操作 (影响${affectedLineCount}行，变化${totalLinesChanged}行)，立即执行扩展范围智能匹配`);
      await this.performSmartMatchingForFileWithExtendedRange(event.document);

      // 刷新注释显示
      this.timerManager.setTimeout(() => {
        vscode.commands.executeCommand(COMMANDS.REFRESH_COMMENTS);
      }, DELAY_TIMES.REFRESH_COMMENTS);
      return;
    }

    // 如果是单行编辑，只检查是否直接编辑了有注释的行
    let hasDirectLineEdit = false;
    let directUpdates = 0;

    for (const change of event.contentChanges) {
      const changedLine = change.range.start.line;

      // 查找这一行是否有注释
      const commentOnLine = fileComments.find(comment => comment.line === changedLine);
      if (commentOnLine) {
        try {
          const currentLineContent = event.document.lineAt(changedLine).text.trim();
          if (currentLineContent !== (commentOnLine.lineContent || '').trim()) {
            commentOnLine.lineContent = currentLineContent;
            directUpdates++;
            hasDirectLineEdit = true;
          }
        } catch (error) {
          logger.warn(`更新注释内容快照失败:`, error);
        }
      }
    }

    // 如果有直接编辑，触发回调通知需要保存
    if (hasDirectLineEdit && this.onAsyncSave) {
      this.onAsyncSave();
      logger.debug(`直接更新完成，共更新 ${directUpdates} 个注释`);
    }
  }

  /**
   * 处理文档保存事件，执行智能匹配更新注释位置
   */
  async handleDocumentSave(document: vscode.TextDocument, onSave?: () => Promise<void>): Promise<void> {
    const filePath = document.uri.fsPath;
    const fileComments = this.storage.getCommentsRef()[filePath];

    if (!fileComments || fileComments.length === 0) {
      return;
    }

    logger.debug(`文件保存，开始智能匹配更新注释位置`);

    // 执行智能匹配
    let fileUpdates = 0;

    // 文件保存场景：使用常规匹配，确保不会有多个注释匹配到同一行
    const matchResults = this.commentMatcher.batchMatchComments(document, fileComments);

    for (const comment of fileComments) {
      const matchedLine = matchResults.get(comment.id) ?? -1;

      if (matchedLine !== -1) {
        // 注释找到了匹配位置，检查是否需要更新
        try {
          const currentLineContent = document.lineAt(matchedLine).text.trim();
          const storedLineContent = (comment.lineContent || '').trim();

          // 更新行号和代码快照
          if (currentLineContent !== storedLineContent && currentLineContent.length > 0) {
            comment.lineContent = currentLineContent;
            comment.line = matchedLine;
            fileUpdates++;
          } else if (comment.line !== matchedLine) {
            // 只是位置变化，代码内容没变
            comment.line = matchedLine;
            fileUpdates++;
          }
        } catch (error) {
          logger.warn(`无法更新注释 ${comment.id}:`, error);
        }
      }
    }

    if (fileUpdates > 0 && onSave) {
      await onSave();
      logger.debug(`智能匹配完成，更新了 ${fileUpdates} 个注释`);
    } else {
      logger.debug(`智能匹配完成，注释位置无需更新`);
    }

    // 更新完成后刷新注释树显示
    this.timerManager.setTimeout(() => {
      vscode.commands.executeCommand(COMMANDS.REFRESH_COMMENTS);
    }, 10);
  }

  /**
   * 为单个文件执行智能匹配（用于Git分支切换等场景）
   * @returns 更新的注释数量
   */
  async performSmartMatchingForFile(document: vscode.TextDocument, onUpdate?: () => Promise<void>): Promise<number> {
    const filePath = document.uri.fsPath;
    const fileComments = this.storage.getCommentsRef()[filePath];

    if (!fileComments || fileComments.length === 0) {
      return 0;
    }

    let fileUpdates = 0;

    // Git分支切换场景：使用支持全文搜索的批量匹配功能
    logger.debug(`Git分支切换场景，使用全文搜索进行智能匹配`);
    const matchResults = this.commentMatcher.batchMatchCommentsWithFullSearch(document, fileComments);

    for (const comment of fileComments) {
      const matchedLine = matchResults.get(comment.id) ?? -1;

      if (matchedLine !== -1) {
        // 注释找到了匹配位置，检查是否需要更新
        try {
          const currentLineContent = document.lineAt(matchedLine).text.trim();
          const storedLineContent = (comment.lineContent || '').trim();

          // 更新行号和代码快照
          if (currentLineContent !== storedLineContent && currentLineContent.length > 0) {
            comment.lineContent = currentLineContent;
            comment.line = matchedLine;
            fileUpdates++;
          } else if (comment.line !== matchedLine) {
            // 只是位置变化，代码内容没变
            comment.line = matchedLine;
            fileUpdates++;
          }
        } catch (error) {
          logger.warn(`Git分支切换时无法更新注释 ${comment.id}:`, error);
        }
      }
    }

    if (fileUpdates > 0 && onUpdate) {
      await onUpdate();
      logger.debug(`Git分支切换智能匹配完成，更新了 ${fileUpdates} 个注释`);
    } else {
      logger.debug(`Git分支切换智能匹配完成，注释位置无需更新`);
    }

    return fileUpdates;
  }

  /**
   * 为单个文件执行智能匹配（专门用于大块代码插入场景，使用扩展搜索范围）
   * @returns 更新的注释数量
   */
  async performSmartMatchingForFileWithExtendedRange(
    document: vscode.TextDocument,
    onUpdate?: () => Promise<void>
  ): Promise<number> {
    const filePath = document.uri.fsPath;
    const fileComments = this.storage.getCommentsRef()[filePath];

    if (!fileComments || fileComments.length === 0) {
      return 0;
    }

    let fileUpdates = 0;

    // 使用专门的大块变化匹配功能，使用扩展搜索范围
    const matchResults = this.commentMatcher.batchMatchCommentsForLargeChanges(document, fileComments);

    for (const comment of fileComments) {
      const matchedLine = matchResults.get(comment.id) ?? -1;

      if (matchedLine !== -1) {
        // 注释找到了匹配位置，检查是否需要更新
        try {
          const currentLineContent = document.lineAt(matchedLine).text.trim();
          const storedLineContent = (comment.lineContent || '').trim();

          // 更新行号和代码快照
          if (currentLineContent !== storedLineContent && currentLineContent.length > 0) {
            comment.lineContent = currentLineContent;
            comment.line = matchedLine;
            fileUpdates++;
          } else if (comment.line !== matchedLine) {
            // 只是位置变化，代码内容没变
            comment.line = matchedLine;
            fileUpdates++;
          }
        } catch (error) {
          logger.warn(`大块代码变化时无法更新注释 ${comment.id}:`, error);
        }
      }
    }

    if (fileUpdates > 0 && onUpdate) {
      await onUpdate();
      logger.debug(`大块代码变化智能匹配完成，更新了 ${fileUpdates} 个注释`);
    } else {
      logger.debug(`大块代码变化智能匹配完成，注释位置无需更新`);
    }

    return fileUpdates;
  }
}
