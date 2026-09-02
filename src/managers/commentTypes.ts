/**
 * 注释类型定义
 *
 * 集中管理所有注释相关类型，避免循环依赖
 * 被 commentManager, commentMatcher, utils 等模块共享
 */

/**
 * 本地注释接口
 */
export type CommentDecorationColor =
  | 'default'
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple';

export interface LocalComment {
  id: string;
  line: number; // 当前行号
  content: string; // 注释内容
  timestamp: number; // 时间戳
  originalLine: number; // 原始行号，用于跟踪位置变化
  lineContent: string; // 该行的内容，用于智能定位和作为代码快照
  isMatched?: boolean; // 标记注释是否匹配到代码
  isShared?: boolean; // 标记注释是否是共享的
  color?: CommentDecorationColor;
}

/**
 * 共享注释接口 - 扩展本地注释，添加用户信息
 */
export interface SharedComment extends LocalComment {
  userId: string; // 用户ID
  userAvatar?: string; // 用户头像URL
  username?: string; // 用户名
}

/**
 * 项目共享注释接口 - 用于云端项目共享
 */
export interface ProjectSharedComment {
  content: LocalComment; // 注释内容 - 使用 LocalComment 类型
  file_path: string; // 文件路径
  project_id: number; // 项目ID
  is_public: boolean; // 是否公开
  id: number; // 注释ID
  user_id: number; // 用户ID
  user_avatar?: string; // 用户头像URL
  username?: string; // 用户名
  created_at: string; // 创建时间
  updated_at: string; // 更新时间
}

/**
 * 文件注释映射 - 以文件路径为键，注释数组为值
 */
export interface FileComments {
  [filePath: string]: (LocalComment | SharedComment)[];
}
