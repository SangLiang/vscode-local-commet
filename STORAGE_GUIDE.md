# 本地注释存储机制详解

## 📁 存储位置

本地注释数据存储在VSCode的全局存储目录中的一个JSON文件里：

### 存储路径
- **Windows**: `%APPDATA%/Code/User/globalStorage/[extension-id]/local-comments.json`
- **macOS**: `~/Library/Application Support/Code/User/globalStorage/[extension-id]/local-comments.json`
- **Linux**: `~/.config/Code/User/globalStorage/[extension-id]/local-comments.json`

### 实际路径示例
```
Windows: C:\Users\用户名\AppData\Roaming\Code\User\globalStorage\vscode-local-comment\local-comments.json
macOS: /Users/用户名/Library/Application Support/Code/User/globalStorage/vscode-local-comment/local-comments.json
Linux: /home/用户名/.config/Code/User/globalStorage/vscode-local-comment/local-comments.json
```

## 📊 数据结构

### JSON文件格式
```json
{
  "文件绝对路径1": [
    {
      "id": "唯一标识符",
      "line": 当前行号,
      "content": "注释内容",
      "timestamp": 时间戳,
      "originalLine": 原始行号,
      "lineContent": "该行的代码内容"
    }
  ],
  "文件绝对路径2": [
    // 该文件的注释数组
  ]
}
```

### 实际数据示例
```json
{
  "D:\\work\\project\\src\\main.js": [
    {
      "id": "1a2b3c4d5e",
      "line": 5,
      "content": "这个函数用于初始化应用",
      "timestamp": 1703123456789,
      "originalLine": 5,
      "lineContent": "function initApp() {"
    },
    {
      "id": "2b3c4d5e6f",
      "line": 12,
      "content": "需要优化这里的性能",
      "timestamp": 1703123567890,
      "originalLine": 12,
      "lineContent": "for (let i = 0; i < items.length; i++) {"
    }
  ],
  "D:\\work\\project\\src\\utils.js": [
    {
      "id": "3c4d5e6f7g",
      "line": 3,
      "content": "工具函数集合",
      "timestamp": 1703123678901,
      "originalLine": 3,
      "lineContent": "export const utils = {"
    }
  ]
}
```

## 🔧 存储机制详解

### 1. 数据字段说明

#### `id` - 唯一标识符
- **类型**: 字符串
- **生成方式**: `Date.now().toString(36) + Math.random().toString(36).substr(2)`
- **作用**: 用于精确定位和编辑特定注释

#### `line` - 当前行号
- **类型**: 数字（从0开始）
- **作用**: 注释在文件中的当前位置
- **动态更新**: 当代码发生变化时会自动调整

#### `content` - 注释内容
- **类型**: 字符串
- **作用**: 用户输入的注释文本
- **可编辑**: 支持后续修改

#### `timestamp` - 时间戳
- **类型**: 数字（毫秒）
- **作用**: 记录注释的创建/修改时间
- **更新时机**: 创建注释时和编辑注释时

#### `originalLine` - 原始行号
- **类型**: 数字
- **作用**: 记录注释最初添加时的行号
- **用途**: 智能重新定位时的参考点

#### `lineContent` - 行内容
- **类型**: 字符串
- **作用**: 保存注释所在行的代码内容
- **用途**: 当代码变化时，通过内容匹配重新定位注释

### 2. 存储操作

#### 加载注释 (`loadComments`)
```typescript
private async loadComments(): Promise<void> {
    try {
        // 确保存储目录存在
        const storageDir = path.dirname(this.storageFile);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        if (fs.existsSync(this.storageFile)) {
            const data = fs.readFileSync(this.storageFile, 'utf8');
            this.comments = JSON.parse(data);
        }
    } catch (error) {
        console.error('加载注释失败:', error);
        this.comments = {};
    }
}
```

#### 保存注释 (`saveComments`)
```typescript
private async saveComments(): Promise<void> {
    try {
        const storageDir = path.dirname(this.storageFile);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        
        fs.writeFileSync(this.storageFile, JSON.stringify(this.comments, null, 2));
    } catch (error) {
        console.error('保存注释失败:', error);
    }
}
```

### 3. 智能位置跟踪

当代码发生变化时，插件会自动调整注释位置：

#### 行号调整
- **上方插入代码**: 注释行号自动增加
- **上方删除代码**: 注释行号自动减少
- **注释行被修改**: 通过内容匹配重新定位

#### 内容匹配算法
```typescript
private findNewLinePosition(document: vscode.TextDocument, comment: LocalComment): number {
    const searchRange = 10; // 在原位置前后10行内搜索
    const startSearch = Math.max(0, comment.originalLine - searchRange);
    const endSearch = Math.min(document.lineCount - 1, comment.originalLine + searchRange);

    for (let i = startSearch; i <= endSearch; i++) {
        try {
            const lineText = document.lineAt(i).text.trim();
            if (lineText === comment.lineContent) {
                return i; // 找到匹配的行
            }
        } catch (error) {
            continue;
        }
    }
    
    // 如果找不到匹配，返回调整后的位置
    return Math.min(comment.line, document.lineCount - 1);
}
```

## 💾 数据持久化特性

### 1. 自动保存
- 每次添加、编辑、删除注释时自动保存
- 代码变化导致位置调整时自动保存
- 无需手动保存操作

### 2. 容错机制
- 文件读取失败时初始化为空对象
- 目录不存在时自动创建
- JSON解析失败时重置数据

### 3. 跨会话持久化
- 注释数据在VSCode重启后依然存在
- 不依赖于工作区，全局有效
- 支持多个项目的注释管理

## 🔍 查看存储数据

### 方法1：直接查看文件
1. 找到存储文件路径
2. 用文本编辑器打开 `local-comments.json`
3. 查看JSON格式的注释数据

### 方法2：通过插件查看
1. 使用侧边栏的"本地注释"面板
2. 查看所有文件的注释列表
3. 点击注释可跳转到对应位置

### 方法3：开发者工具
1. 按 `F12` 打开开发者工具
2. 在控制台中查看调试信息
3. 观察注释加载和保存的日志

## 🛠️ 数据管理

### 备份注释数据
```bash
# Windows
copy "%APPDATA%\Code\User\globalStorage\vscode-local-comment\local-comments.json" backup.json

# macOS/Linux
cp "~/Library/Application Support/Code/User/globalStorage/vscode-local-comment/local-comments.json" backup.json
```

### 恢复注释数据
```bash
# Windows
copy backup.json "%APPDATA%\Code\User\globalStorage\vscode-local-comment\local-comments.json"

# macOS/Linux
cp backup.json "~/Library/Application Support/Code/User/globalStorage/vscode-local-comment/local-comments.json"
```

### 清空所有注释
删除 `local-comments.json` 文件，或将其内容设置为 `{}`

## ⚠️ 注意事项

### 1. 文件路径依赖
- 注释与文件的**绝对路径**绑定
- 移动文件会导致注释"丢失"（实际上还在，但路径不匹配）
- 重命名文件夹也会影响注释的关联

### 2. 跨设备同步
- 注释数据存储在本地，不会自动同步
- 如需在多台设备间共享，需要手动复制存储文件
- 可以考虑将存储文件加入版本控制（但要注意隐私）

### 3. 性能考虑
- 大量注释可能影响加载速度
- 建议定期清理不需要的注释
- 文件变化时的位置调整可能有轻微延迟

### 4. 数据安全
- 注释内容以明文存储
- 敏感信息请谨慎添加到注释中
- 建议定期备份重要的注释数据 