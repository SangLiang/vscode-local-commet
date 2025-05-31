# VSCode Local Comments

A helper tool for learning source code, onboarding new projects, and developing large projects with auxiliary comments and notes.

This extension allows you to add local comments, markdown notes, and file navigation tags in your code without affecting the original file or submitting to version control systems.

### Tag Navigation
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-commet/refs/heads/master/images/jump.gif)
### Markdown Local Comments
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-commet/refs/heads/master/images/markdown.gif)

## ✨ Main Features

### 📝 Local Comments
- **Add Comments**: Add local comments to any code line
- **Selection Conversion**: Right-click selected text to convert it to a local comment and delete the original text
- **Edit Comments**: Modify existing comment content anytime
- **Delete Comments**: Easily remove unwanted comments
- **Smart Position Tracking**: Automatically adjust comment positions when code changes
- **Multi-line Editor**: Professional multi-line comment editing interface with rich editing features

### 🏷️ Tag System
- **Tag Declaration**: Use `$tagName` to declare a tag
- **Tag Reference**: Use `@tagName` to reference a tag
- **Auto-completion**: Automatically display available tags when typing `@`
- **Click Navigation**: Click on tag references to jump directly to the declaration position
- **Cross-file Support**: Tags can be referenced between different files

### 💾 Data Management
- **Local Storage**: Comment data is stored locally and not synchronized to version control
- **Cross-session Persistence**: Comments persist after restarting VSCode
- **Smart Backup**: Automatic saving, supports manual backup and recovery

## 🔑 Best Practices

Local comments are best applied on the same line as function declarations. For example:

```javascript
function test { // local comment best placed here
  test code 
}
```

This reduces issues with comments not matching code positions after switching branches or making large code modifications. Try to avoid applying local comments on empty lines.

## 🚀 Quick Start

### Installation
1. Open VSCode
2. Press `Ctrl+Shift+X` to open the extensions panel
3. Search for "Local Comments"
4. Click Install

### Basic Usage

#### Adding Comments
1. Place the cursor on the code line where you want to add a comment
2. Press `Ctrl+Shift+C` or right-click and select "Add Local Comment"
3. Enter the comment content

#### Converting Selected Text to Comments
1. Select the text you want to convert to a comment
2. Right-click and select "Convert to Local Comment"
3. The selected text becomes a comment, and the original code is deleted

#### Multi-line Editing
1. Hover over an existing comment
2. Click the "📝 Markdown Edit" button
3. Use the resizable multi-line editor
4. Supports context display, tag auto-completion, and shortcuts

#### Using Tags
```javascript
let userConfig = {};  // Local Comment: This is where $userConfig is declared

function loadConfig() {// Local Comment: This loads the @userConfig configuration
    userConfig = JSON.parse(localStorage.getItem('config'));
}
```

## 📋 Feature Details

### Keyboard Shortcuts
- `Ctrl+Shift+C`: Add local comment
- `Ctrl+Shift+E`: Edit current line comment
- `Ctrl+Shift+D`: Delete current line comment

### Tag Functionality
- **Declare Tags**: `$tagName` - Declare a tag in comments
- **Reference Tags**: `@tagName` - Reference declared tags
- **Auto-completion**: Display available tag list when typing `@`
- **Jump Function**: Click `@tagName` to jump to the position of `$tagName`

### Comment Management
- **Sidebar Panel**: View "Local Comments" panel in the explorer
- **Comment List**: Display a list of comments for all files
- **Quick Jump**: Click on a comment item to jump to the corresponding position
- **Batch Operations**: Edit or delete comments in the panel

### Smart Features
- **Position Tracking**: Automatically adjust comment positions when code changes
- **Content Matching**: Intelligently reposition comments through line content
- **Cross-file References**: Tags can establish associations between different files

## 📊 Usage Statistics

Use the command palette (`Ctrl+Shift+P`) to search for the following commands:

- **Show Comment Statistics**: View comment count, tag statistics, etc.
- **Show Storage Location**: View the storage location of comment data

## 💾 Data Storage

### Storage Location
- **Base Directory**:
  - **Windows**: `%APPDATA%/Code/User/globalStorage/vscode-local-comment/projects/`
  - **macOS**: `~/Library/Application Support/Code/User/globalStorage/vscode-local-comment/projects/`
  - **Linux**: `~/.config/Code/User/globalStorage/vscode-local-comment/projects/`

### Project-specific Storage
Each project has its own storage file named: `[project-name]-[hash].json`

For example:
```
my-project-a1b2c3d4e5f6.json
another-project-g7h8i9j0k1l2.json
```

### Data Characteristics
- Comment data is stored locally per project
- Will not be submitted to version control systems
- Supports manual backup and recovery
- Persists across VSCode sessions
- Projects maintain independent comment databases

## 🎯 Use Cases

### 1. Code Understanding
```javascript
function complexAlgorithm() {  // Local Comment: $complexAlgorithm core algorithm
    // Complex algorithm implementation
}

// Elsewhere
if (needOptimization) {  // Local Comment: May need to optimize @complexAlgorithm here
    complexAlgorithm();
}
```

### 2. Temporary Marking
```javascript
const API_KEY = 'xxx';  // Local Comment: $API_KEY should be obtained from environment variables

fetch(url, {
    headers: { 'Authorization': API_KEY }  // Local Comment: Using @API_KEY for authentication
});
```

### 3. Learning Notes
```javascript
class EventEmitter {  // Local Comment: $EventEmitter observer pattern implementation
    on(event, callback) {  // Local Comment: Register event listener
        // Implementation code
    }
}

emitter.on('data', handler);  // Local Comment: Listening to @EventEmitter's data event
```

## 🔧 Development

### Build Project
```bash
npm install
npm run compile
```

### Debugging
1. Press `F5` to start debugging
2. Test the plugin in a new VSCode window

## 📝 Changelog

### Change Log

## [1.0.3] - 2025-05-31

### 🔨 Bug Fixes
- 🔨 Fixed the issue of different projects using the same local comment storage file
- 🎯 Various other known errors

## [1.0.2] - 2025-05-30

### 🔨 Bug Fixes
- 🔨 Fixed comment position errors caused by switching branches
- 💻 Fixed intelligent completion position errors during Markdown editing

## [1.0.1] - 2025-05-30

### 🎉 New Features

- ✨ **Convert Selected Text to Comments**: Right-click selected text to directly convert it to a local comment and delete the original text
- 📝 **Multi-line Editor**: Added a professional multi-line comment editing interface with rich editing features
- 🎨 **Dual Editing Modes**: 
  - Quick Mode: Single-line quick editing
  - Detailed Mode: Multi-line rich text editing
- ⌨️ **Enhanced Shortcuts**: 
  - Ctrl+Enter: Save edits
- 🏷️ **Improved Tag Completion**: Automatically display tag dropdown list when typing @ in the editor
- 🖱️ **Hover Operation Buttons**: 
  - ✏️ Edit: Quick single-line editing
  - 📝 Markdown Edit: Multi-line detailed editing  
  - 🗑️ Delete: Delete comments

### 📖 New Use Cases

#### Quick Code Segment Marking
1. Select the code that needs to be marked
2. Right-click and select "Convert to Local Comment"
3. The selected code becomes a comment, and the original code is automatically deleted

#### Writing Long Comments
1. Hover over a comment
2. Click the "📝 Markdown Edit" button
3. Write detailed explanations in the multi-line editor
4. Supports newlines (\n) and tag references

## [1.0.0] - 2025-05-29

### New Features
- ✨ Local Comment Function: Add local comments in code without modifying the original file
- 🏷️ Tag System: Support `$tagName` declaration and `@tagName` reference
- 🔗 Smart Navigation: Click on tag references to jump to declaration positions
- 💡 Auto-completion: Automatically suggest available tags when typing `@`
- 🌲 Tree View: View all comments in the sidebar
- ⌨️ Shortcut Support: Ctrl+Shift+C to add comments
- 🎨 Syntax Highlighting: Tags are highlighted in comments
- 📁 Cross-file Support: Tags can be referenced between different files

## 📄 License

MIT License

---

# VSCode 本地注释

学习源码，入手新项目，开发大型项目的辅助注释与笔记工具。

让你可以在代码中添加本地注释,markdown笔记，添加文件跳转tag，修改不会影响原文件或也不会提交到版本控制系统。

### tag跳转
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-commet/refs/heads/master/images/jump.gif)
### markdown本地注释
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-commet/refs/heads/master/images/markdown.gif)

## ✨ 主要功能

### 📝 本地注释
- **添加注释**: 在任意代码行添加本地注释
- **选中转换**: 右键选中的文字可直接转换为本地注释并删除原文字
- **编辑注释**: 随时修改已有的注释内容
- **删除注释**: 轻松删除不需要的注释
- **智能位置跟踪**: 代码变化时自动调整注释位置
- **多行编辑器**: 专业多行注释编辑界面，支持丰富的编辑功能

### 🏷️ 标签系统
- **标签声明**: 使用 `$标签名` 声明标签
- **标签引用**: 使用 `@标签名` 引用标签
- **自动补全**: 输入 `@` 时自动显示可用标签
- **点击跳转**: 点击标签引用直接跳转到声明位置
- **跨文件支持**: 标签可以在不同文件间引用

### 💾 数据管理
- **本地存储**: 注释数据存储在本地，不会同步到版本控制
- **跨会话持久化**: 重启VSCode后注释依然存在
- **智能备份**: 自动保存，支持手动备份和恢复

## 🔑最佳实践

本地注释最好应用在函数声明的同一行。如：

```javascript
function test { // local comment 最好在此行注释
  test code 
}
```

这样做可以减少因为在切换分支，或者大范围修改代码后，本地注释匹配不到代码位置的问题，尽可能不要在空行应用本地注释。


## 🚀 快速开始

### 安装
1. 打开VSCode
2. 按 `Ctrl+Shift+X` 打开扩展面板
3. 搜索 "本地注释"
4. 点击安装

### 基本使用

#### 添加注释
1. 将光标放在要添加注释的代码行
2. 按 `Ctrl+Shift+C` 或右键选择"添加本地注释"
3. 输入注释内容

#### 选中文字转换为注释
1. 选中要转换为注释的文字
2. 右键选择"转换为本地注释"
3. 选中的文字变成注释，原位置的代码被删除

#### 多行编辑
1. 悬停在已有注释上
2. 点击"📝 Markdown编辑"按钮
3. 使用可调整大小的多行编辑器
4. 支持上下文显示、标签自动补全和快捷键

#### 使用标签
```javascript
let userConfig = {};  // 本地注释: 这里是$userConfig的声明地方

function loadConfig() {// 本地注释: 这里加载@userConfig的配置
    userConfig = JSON.parse(localStorage.getItem('config'));
}
```

## 📋 功能详解

### 键盘快捷键
- `Ctrl+Shift+C`: 添加本地注释
- `Ctrl+Shift+E`: 编辑当前行注释
- `Ctrl+Shift+D`: 删除当前行注释

### 标签功能
- **声明标签**: `$标签名` - 在注释中声明一个标签
- **引用标签**: `@标签名` - 引用已声明的标签
- **自动补全**: 输入 `@` 时显示可用标签列表
- **跳转功能**: 点击 `@标签名` 跳转到 `$标签名` 的位置

### 注释管理
- **侧边栏面板**: 在资源管理器中查看"本地注释"面板
- **注释清单**: 显示所有文件的注释列表
- **快速跳转**: 点击注释项目跳转到对应位置
- **批量操作**: 在面板中编辑或删除注释

### 智能特性
- **位置跟踪**: 代码变化时自动调整注释位置
- **内容匹配**: 通过行内容智能重新定位注释
- **跨文件引用**: 标签可以在不同文件间建立关联

## 📊 使用统计

使用命令面板 (`Ctrl+Shift+P`) 搜索以下命令：

- **显示注释统计**: 查看注释数量、标签统计等信息
- **显示存储位置**: 查看注释数据的存储位置

## 💾 数据存储

### 存储位置
- **基础目录**:
  - **Windows**: `%APPDATA%/Code/User/globalStorage/vscode-local-comment/projects/`
  - **macOS**: `~/Library/Application Support/Code/User/globalStorage/vscode-local-comment/projects/`
  - **Linux**: `~/.config/Code/User/globalStorage/vscode-local-comment/projects/`

### 项目特定存储
每个项目都有自己的存储文件，命名为：`[项目名]-[哈希值].json`

例如：
```
my-project-a1b2c3d4e5f6.json
another-project-g7h8i9j0k1l2.json
```

### 数据特性
- 注释数据按项目分别存储在本地
- 不会被提交到版本控制系统
- 支持手动备份和恢复
- 跨VSCode会话持久化
- 各项目维护独立的注释数据库

## 🎯 使用场景

### 1. 代码理解
```javascript
function complexAlgorithm() {  // 本地注释: $complexAlgorithm核心算法
    // 复杂的算法实现
}

// 在其他地方
if (needOptimization) {  // 本地注释: 这里可能需要优化@complexAlgorithm
    complexAlgorithm();
}
```

### 2. 临时标记
```javascript
const API_KEY = 'xxx';  // 本地注释: $API_KEY需要从环境变量获取

fetch(url, {
    headers: { 'Authorization': API_KEY }  // 本地注释: 使用@API_KEY进行认证
});
```

### 3. 学习笔记
```javascript
class EventEmitter {  // 本地注释: $EventEmitter观察者模式实现
    on(event, callback) {  // 本地注释: 注册事件监听器
        // 实现代码
    }
}

emitter.on('data', handler);  // 本地注释: 监听@EventEmitter的data事件
```

## 🔧 开发

### 构建项目
```bash
npm install
npm run compile
```

### 调试
1. 按 `F5` 启动调试
2. 在新的VSCode窗口中测试插件

## 📝 更新日志

### 变更日志


## [1.0.3] - 2025-05-31

### 🔨 修复bug
- 🔨修复不同项目使用同一份本地注释储存文件的问题。
- 🎯其他的一些已知错误

## [1.0.2] - 2025-05-30

### 🔨 修复bug
- 🔨切换分支导致的注释位置错误的问题
- 💻Markdown编辑时，智能补全位置错误的问题


## [1.0.1] - 2025-05-30

### 🎉 新增功能

- ✨ **选中文字转换为注释**: 右键选中的文字，可直接转换为本地注释并删除原文字
- 📝 **多行编辑器**: 新增专业的多行注释编辑界面，支持丰富的编辑功能
- 🎨 **双重编辑模式**: 
  - 快捷模式：单行快速编辑
  - 详细模式：多行富文本编辑
- ⌨️ **增强快捷键**: 
  - Ctrl+Enter: 保存编辑
- 🏷️ **改进的标签补全**: 编辑器中输入@时自动显示标签下拉列表
- 🖱️ **悬停操作按钮**: 
  - ✏️ 编辑：快速单行编辑
  - 📝 Markdown编辑：多行详细编辑  
  - 🗑️ 删除：删除注释

### 📖 新增使用场景

#### 快速标记代码段
1. 选中需要标记的代码
2. 右键选择"转换为本地注释"
3. 选中的代码变成注释，原代码自动删除

#### 编写长注释
1. 悬停在注释上
2. 点击"📝 Markdown编辑"
3. 在多行编辑器中写入详细说明
4. 支持换行符(\n)和标签引用

## [1.0.0] - 2025-05-29

### 新增功能
- ✨ 本地注释功能：在代码中添加本地注释，不修改原文件
- 🏷️ 标签系统：支持 `$标签名` 声明和 `@标签名` 引用
- 🔗 智能跳转：点击标签引用可跳转到声明位置
- 💡 自动补全：输入 `@` 时自动提示可用标签
- 🌲 树形视图：在侧边栏查看所有注释
- ⌨️ 快捷键支持：Ctrl+Shift+C 添加注释
- 🎨 语法高亮：标签在注释中高亮显示
- 📁 跨文件支持：标签可在不同文件间引用

## 📄 License

MIT License
