import * as vscode from 'vscode';
import { LocalComment } from './commentManager';

/**
 * 注释匹配器 - 负责在文档内容变化时智能匹配注释位置
 */
export class CommentMatcher {
    /**
     * 智能匹配注释对应的行号
     * 优先通过代码内容匹配，行号作为辅助
     */
    public findMatchingLine(document: vscode.TextDocument, comment: LocalComment): number {
        const lineContent = comment.lineContent?.trim();
        
        // 如果没有保存的行内容（旧版本数据），严格隐藏注释
        // 不再提供兼容性支持，避免注释显示在错误的位置
        if (!lineContent || lineContent.length === 0) {
            console.warn(`⚠️ 注释 ${comment.id} 缺少代码内容快照，将被隐藏`);
            return -1; // 严格隐藏，不提供兼容性
        }

        // 1. 优先在原始行号位置查找匹配
        if (comment.line >= 0 && comment.line < document.lineCount) {
            const currentLineContent = document.lineAt(comment.line).text.trim();
            if (currentLineContent === lineContent) {
                return comment.line;
            }
        }

        // 1.5 优先检查注释行上面的行
        // 这对于添加行后删除导致注释位置下移的情况特别有效
        const previousLine = comment.line - 1;
        if (previousLine >= 0 && previousLine < document.lineCount) {
            const previousLineContent = document.lineAt(previousLine).text.trim();
            if (previousLineContent === lineContent) {
                console.log(`✅ 注释可能需要上移一行：从行 ${comment.line + 1} 到行 ${previousLine + 1}`);
                return previousLine;
            }
        }

        // 2. 计算动态搜索范围
        // 基于文件大小动态调整搜索范围，文件越大，搜索范围越大
        const calculateDynamicRange = (totalLines: number): number => {
            // 基础搜索范围
            let baseRange = 5; // 对于小文件默认为5行
            
            if (totalLines <= 100) {
                return baseRange; // 小文件使用默认范围
            } else if (totalLines <= 500) {
                // 中等大小文件：线性增长 (5-15行)
                return Math.floor(5 + (totalLines - 100) / 50);
            } else if (totalLines <= 2000) {
                // 大文件：更快的增长 (15-50行)
                return Math.floor(15 + (totalLines - 500) / 50);
            } else {
                // 超大文件：最大搜索范围 (50-100行)
                return Math.min(50 + Math.floor(totalLines / 100), 100);
            }
        };
        
        const searchRange = calculateDynamicRange(document.lineCount);
        console.log(`🔍 使用动态搜索范围: ±${searchRange} 行 (文件总行数: ${document.lineCount}行)`);
        
        const startLine = Math.max(0, comment.line - searchRange);
        const endLine = Math.min(document.lineCount - 1, comment.line + searchRange);

        for (let i = startLine; i <= endLine; i++) {
            if (i !== comment.line && i !== previousLine) { // 跳过已经检查过的行
                const currentLineContent = document.lineAt(i).text.trim();
                if (currentLineContent === lineContent) {
                    return i;
                }
            }
        }

        // 3. 在整个文档中查找精确匹配
        for (let i = 0; i < document.lineCount; i++) {
            if (i >= startLine && i <= endLine) {
                continue; // 跳过已经搜索过的范围
            }
            const currentLineContent = document.lineAt(i).text.trim();
            if (currentLineContent === lineContent) {
                return i;
            }
        }

        // 4. 使用模糊匹配（去除空格和标点符号的影响）
        const normalizedTarget = this.normalizeLineContent(lineContent);
        if (normalizedTarget && normalizedTarget.length > 0) {
            for (let i = 0; i < document.lineCount; i++) {
                const currentLineContent = document.lineAt(i).text.trim();
                const normalizedCurrent = this.normalizeLineContent(currentLineContent);
                if (normalizedCurrent && normalizedCurrent === normalizedTarget && normalizedCurrent.length > 0) {
                    return i;
                }
            }
        }

        // 5. 找不到匹配的内容，严格隐藏注释
        // 只在调试时显示详细信息
        return -1;
    }

    /**
     * 标准化行内容，用于模糊匹配
     * 移除空格、制表符和一些常见的标点符号
     */
    public normalizeLineContent(content: string): string {
        const normalized = content
            .replace(/\s+/g, '') // 移除所有空白字符
            .replace(/[;,{}()]/g, '') // 移除常见标点符号
            .toLowerCase(); // 转为小写
        
        // 避免过于短的内容造成误匹配
        // 标准化后的内容至少要有3个字符才考虑模糊匹配
        return normalized.length >= 3 ? normalized : '';
    }

    /**
     * 计算两个字符串的相似度
     */
    public calculateSimilarity(str1: string, str2: string): number {
        if (!str1 || !str2) return 0;
        
        // 简单的编辑距离算法
        const len1 = str1.length;
        const len2 = str2.length;
        
        if (len1 === 0) return len2 === 0 ? 1 : 0;
        if (len2 === 0) return 0;
        
        const matrix: number[][] = [];
        
        // 初始化矩阵
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        for (let j = 1; j <= len2; j++) {
            matrix[0][j] = j;
        }
        
        // 填充矩阵
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1, // 删除
                    matrix[i][j - 1] + 1, // 插入
                    matrix[i - 1][j - 1] + cost // 替换
                );
            }
        }
        
        // 编辑距离
        const distance = matrix[len1][len2];
        
        // 将距离转换为相似度分数（0到1之间）
        return 1 - distance / Math.max(len1, len2);
    }
} 