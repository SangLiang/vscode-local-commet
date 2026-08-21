import * as path from 'path';
import { FileComments, LocalComment } from '../managers/commentTypes';
import { extractTagsFromMarkdown } from './tagParser';

export interface CommentManageRow {
  id: string;
  filePath: string;
  line: number;
  summary: string;
  tagDeclarations: string[];
  updatedAt?: string;
  content: string;
  lineContent: string;
}

export function extractTagDeclarations(content: string): string[] {
  const tags = extractTagsFromMarkdown(content)
    .filter(tag => tag.type === 'declaration')
    .map(tag => tag.tagName);
  return [...new Set(tags)];
}

export function toCommentSummary(content: string, maxLength = 120): string {
  const plain = content
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLength) {
    return plain;
  }
  const ellipsis = '...';
  const sliceLen = Math.max(0, maxLength - ellipsis.length);
  return `${plain.slice(0, sliceLen)}${ellipsis}`;
}

function isLocalComment(comment: LocalComment & { userId?: string }): boolean {
  return !('userId' in comment);
}

function toRelativePath(absPath: string, workspaceRoot?: string): string {
  if (!workspaceRoot) {
    return absPath;
  }
  const rel = path.relative(workspaceRoot, absPath);
  return rel.startsWith('..') ? absPath : rel.replace(/\\/g, '/');
}

export function flattenCommentsToRows(
  comments: FileComments,
  workspaceRoot?: string
): CommentManageRow[] {
  const rows: CommentManageRow[] = [];
  for (const [absPath, fileComments] of Object.entries(comments)) {
    for (const comment of fileComments) {
      if (!isLocalComment(comment as LocalComment & { userId?: string })) {
        continue;
      }
      rows.push({
        id: comment.id,
        filePath: toRelativePath(absPath, workspaceRoot),
        line: comment.line,
        summary: toCommentSummary(comment.content),
        tagDeclarations: extractTagDeclarations(comment.content),
        updatedAt: comment.timestamp ? new Date(comment.timestamp).toISOString() : undefined,
        content: comment.content,
        lineContent: comment.lineContent,
      });
    }
  }
  return rows;
}

export type CommentKindFilter = '' | 'tag' | 'normal';

export interface CommentRowFilter {
  query?: string;
  commentKind?: CommentKindFilter;
  filePath?: string;
}

export function filterCommentRows(rows: CommentManageRow[], filter: CommentRowFilter): CommentManageRow[] {
  const query = filter.query?.trim().toLowerCase();
  const commentKind = filter.commentKind ?? '';
  const filePath = filter.filePath?.trim().toLowerCase();
  return rows.filter((row) => {
    const hasTag = row.tagDeclarations.length > 0;
    if (commentKind === 'tag' && !hasTag) {
      return false;
    }
    if (commentKind === 'normal' && hasTag) {
      return false;
    }
    if (filePath && !row.filePath.toLowerCase().includes(filePath)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      row.summary.toLowerCase().includes(query) ||
      row.filePath.toLowerCase().includes(query) ||
      row.content.toLowerCase().includes(query)
    );
  });
}

export type CommentRowSortKey = 'filePath' | 'line' | 'updatedAt';
export type SortDirection = 'asc' | 'desc';

export function sortCommentRows(
  rows: CommentManageRow[],
  sortKey: CommentRowSortKey = 'filePath',
  direction: SortDirection = 'asc'
): CommentManageRow[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === 'line') {
      return (a.line - b.line) * factor;
    }
    if (sortKey === 'updatedAt') {
      const av = a.updatedAt ?? '';
      const bv = b.updatedAt ?? '';
      return av.localeCompare(bv) * factor;
    }
    const fileCmp = a.filePath.localeCompare(b.filePath);
    if (fileCmp !== 0) {
      return fileCmp * factor;
    }
    return (a.line - b.line) * factor;
  });
}
