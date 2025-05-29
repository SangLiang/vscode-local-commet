# 🏷️ 标签功能使用指南

## 概述

本地注释插件现在支持标签功能，让你可以在注释之间建立引用关系。通过标签，你可以：

- 使用 `$标签名` 声明标签
- 使用 `@标签名` 引用标签
- 自动补全标签名称
- 点击跳转到标签声明位置

## 🎯 基本用法

### 1. 声明标签

在注释中使用 `$标签名` 来声明一个标签：

```javascript
let a = 10;  // 本地注释: 这里是$a的声明地方
```

### 2. 引用标签

在其他注释中使用 `@标签名` 来引用已声明的标签：

```javascript
a = 20;  // 本地注释: 这里使用了@a
```

### 3. 自动补全

当你在注释中输入 `@` 时，会自动显示可用的标签列表：

1. 在注释中输入 `@`
2. 选择你想要引用的标签
3. 按 Enter 或 Tab 确认

### 4. 点击跳转

点击注释中的 `@标签名` 可以直接跳转到 `$标签名` 的声明位置。

## 📝 实际示例

### 示例1：变量声明和使用

```javascript
// 文件: main.js
let userConfig = {};  // 本地注释: $userConfig的初始化

function loadConfig() {
    // 本地注释: 这里加载@userConfig的配置
    userConfig = JSON.parse(localStorage.getItem('config'));
}

function saveConfig() {
    // 本地注释: 保存@userConfig到本地存储
    localStorage.setItem('config', JSON.stringify(userConfig));
}
```

### 示例2：函数定义和调用

```javascript
// 文件: utils.js
function validateEmail(email) {  // 本地注释: $validateEmail函数定义
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 文件: form.js
if (validateEmail(email)) {  // 本地注释: 调用@validateEmail验证邮箱
    // 处理有效邮箱
}
```

### 示例3：API端点文档

```javascript
// 文件: api.js
const API_BASE = 'https://api.example.com';  // 本地注释: $API_BASE基础URL

// 文件: user.js
fetch(`${API_BASE}/users`);  // 本地注释: 使用@API_BASE获取用户列表

// 文件: product.js
fetch(`${API_BASE}/products`);  // 本地注释: 使用@API_BASE获取产品列表
```

## 🔍 标签命名规则

标签名称必须遵循以下规则：

- 以字母或下划线开头
- 可以包含字母、数字、下划线
- 区分大小写
- 不能包含空格或特殊字符

### 有效的标签名称

```
$userConfig
$API_BASE
$validateEmail
$_privateVar
$config2
```

### 无效的标签名称

```
$2config      // 不能以数字开头
$user-config  // 不能包含连字符
$user config  // 不能包含空格
$user@config  // 不能包含特殊字符
```

## 🎨 视觉效果

### 标签高亮

- **标签声明** (`$标签名`): 蓝色加粗下划线
- **标签引用** (`@标签名`): 蓝色加粗下划线，鼠标悬停显示"点击跳转到声明位置"

### 悬停提示

- 悬停在 `$标签名` 上：显示"标签声明: $标签名"
- 悬停在 `@标签名` 上：显示"标签引用: @标签名" 和跳转提示

## 📊 标签统计

使用 `Ctrl+Shift+P` 打开命令面板，搜索"显示注释统计"可以查看：

- 标签声明数量
- 标签引用数量
- 可用标签列表

## 🔧 高级用法

### 1. 跨文件引用

标签可以在不同文件之间引用：

```javascript
// 文件: config.js
const DATABASE_URL = 'mongodb://localhost';  // 本地注释: $DATABASE_URL数据库连接

// 文件: models/user.js
mongoose.connect(DATABASE_URL);  // 本地注释: 连接到@DATABASE_URL
```

### 2. 多个标签

一个注释中可以包含多个标签：

```javascript
function processData(input) {  // 本地注释: $processData处理$input数据
    return input.map(item => item.value);
}

const result = processData(data);  // 本地注释: 使用@processData处理@input
```

### 3. 标签重命名

如果需要重命名标签：

1. 找到标签声明 (`$旧标签名`)
2. 修改为新的标签名 (`$新标签名`)
3. 所有引用该标签的地方 (`@旧标签名`) 都需要手动更新为 (`@新标签名`)

## ⚠️ 注意事项

### 1. 标签唯一性

- 每个标签名只能有一个声明
- 如果声明了重复的标签，后声明的会覆盖前面的

### 2. 引用有效性

- 只能引用已经声明的标签
- 如果引用了不存在的标签，跳转功能不会生效

### 3. 标签更新

- 当注释内容发生变化时，标签信息会自动更新
- 删除包含标签声明的注释会使相关引用失效

## 🚀 快捷操作

### 键盘快捷键

- `Ctrl+Shift+C`: 添加注释（支持标签）
- `Ctrl+Shift+E`: 编辑当前行注释
- `Ctrl+Shift+D`: 删除当前行注释

### 自动补全触发

- 在注释中输入 `@` 自动触发标签补全
- 使用方向键选择标签
- 按 `Enter` 或 `Tab` 确认选择

### 跳转操作

- 按住 `Ctrl` 并点击 `@标签名` 跳转到声明
- 或者直接点击 `@标签名` 也可以跳转

## 💡 最佳实践

### 1. 标签命名约定

```javascript
// 推荐：使用有意义的名称
const API_KEY = 'xxx';  // 本地注释: $API_KEY应用密钥

// 不推荐：使用模糊的名称
const key = 'xxx';  // 本地注释: $k密钥
```

### 2. 标签分类

```javascript
// 配置相关
const config = {};  // 本地注释: $config_main主配置

// API相关
const apiUrl = '';  // 本地注释: $api_base基础API

// 工具函数
function helper() {}  // 本地注释: $util_helper辅助函数
```

### 3. 文档化重要概念

```javascript
class UserManager {  // 本地注释: $UserManager用户管理核心类
    constructor() {
        // 本地注释: 初始化@UserManager实例
    }
}
```

## 🔄 与现有功能的集成

标签功能与现有的本地注释功能完全兼容：

- 注释清单面板会显示包含标签的注释
- 悬停编辑功能支持编辑包含标签的注释
- 智能位置跟踪会保持标签引用的准确性
- 存储机制会保存标签信息

通过标签功能，你可以建立更加结构化和关联性的注释系统，提高代码理解和维护效率！ 