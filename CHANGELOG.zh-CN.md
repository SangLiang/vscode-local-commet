# 更新日志

本文件记录本项目所有重要变更。

## [2.2.0] - 2026-09-02

### 新增
- 为 local comment 注释内容在编辑的显示里添加颜色选择,用户可以根据注释的重要级别选择合适的注释颜色

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/local_comment_color.png)

- Markdown文件预览可以调整字体大小了。

### 修复

- 修复行内代码和 fenced code block 中的 `@...` 被渲染和索引为标签引用的问题(感谢来自[@abcdvvvv](https://github.com/abcdvvvv)的修复 [#7](https://github.com/SangLiang/vscode-local-comment/pull/7))

- 修复包括 Git 分支切换在内的外部文件更新无法立即触发注释全文匹配的问题 (根据[@abcdvvvv](https://github.com/abcdvvvv)提出的[#8](https://github.com/SangLiang/vscode-local-comment/pull/8)修改)

- 上一个版本修复[在有git lens等其他lens的情况下，local comment内容显示过于置后的问题]，会引发新的问题，导致用户选择带有本地注释的源码时无法选中最后一个字符后面，光标总是会落在最后一个字符的前面。这是vscode 自有的问题，这里回退到之前的设计。为了优先保证用户体验，用户的local comment注释内容可能会在git lens等其他的内容之后。

- 修复一些其他的已知bug。

## [2.1.3] - 2026-08-17

### 变更

- 为所有的文件都加入了关系图，可以通过关系图跳转到引用的@tag所属文件

- 为减少鼠标右键的篇幅，将local comment action放到了一个父级菜单中

- 优化了一些代码的实现


### 修复

- 修复在cursor等编辑器中，input local comment 打开时候分屏不生效的问题

- 修复在预览.md文件的时候，显示svg图片错误的问题

- 修复导出markdown文件为html文件后，图片无法显示的问题

- 修复在关系图中，文件本身的节点在点击后无法跳转的问题

- 修复在有git lens等其他lens的情况下，local comment内容显示过于置后的问题

## [2.1.2] - 2026-08-03

### 变更

- 优化了markdown预览的样式，优化了边距和字体

- 修复了mermaid图高度过高，导致图片过大的显示问题

- 修复了一个在浅色主题下，代码块颜色显示和背景过于相似的问题

- 修复了在用户未使用多人协同版本的情况下，右下角提示未登录的的提示

- 优化了部分和markdown渲染相关的代码结构


## [2.1.1] - 2026-07-15

### 变更

- markdown预览功能加入目录面板

- 更新一些不正确的图片路径名称

## [2.1.0] - 2026-07-07

### 新增

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/active_bar.png)

- 加入active bar，用户可以更好的去管理本地注释，可以很方便的切换group组，迁移不同组之间的本地注释内容。

- 添加AI辅助功能，提供一个skill，方便用户直接对源文件进行local comment的自动生成。

- 在markdown文件的预览页面中加入了查找功能

- 使用 [alt + 鼠标左键] 允许用户从markdown的预览页面跳转到.md的源码页面，方便用户编辑修改源码

## [2.0.1] - 2026-06-26

### 修复

- 修复markdown预览时候，预览新markdown文件的焦点不正确的问题

### 优化

- 加入测试用例，并重构优化了一些代码

## [2.0.0] - 2026-06-05

这次更新对.md类型的文件做了更好的支持。我相信，完全不依赖外部的md编辑器，在local comment中，就能把md文档做得很好用！

所以我把版本提升到了2.0.0，这是一次全新的探索，目标已经不仅在于写本地注释，更好的做好markdown的内容和知识管理了。

### 新增

- **从Markdown文件直接跳进源码**: 在此之前，我们所有的操作都是在local comment的注释里进行，现在，我把原生的.md文件也进行了拓展。上一个版本中，我们已经能很好的预览原生的.md文件了，这个版本，我们在预览md内容的同时，还能通过点击`@tag`标记进行跳转了。这意味着，我们可以更好的把文档内容和代码实现结合在一起了。

  具体使用的方法是在.md文件中，使用鼠标右键，可以看到有`insert tag reference`的选项，点击后，会列出项目中全部的tag标记，选择要插入的标记即可。然后，通过鼠标右键点击`preview markdown`预览文档。你会发现，你添加的`tag reference`是颜色不同的样式，点击后，会跳转到对应的声明处。

- **tag关系图**：可视化展示项目内标签之间的引用关系，支持力导向图交互（缩放、拖拽、点击查看详情）。在命令面板执行 `Local Comment: 显示标签关系图` 即可打开。

  这个功能可以很好的把项目里的文档组织起来，只要你在写文档的时候稍微有点耐心，给他们做一个`${tag}`标记，下次你就能直接引用该文档，再通过点击tag名称跳转过去。没错，听起来有obsidian那样的味道了。但你要知道，我们还能跳转进代码的具体实现，这才是程序员手里该有的工具。

- **导出 HTML 体验优化**：导出过程中显示按钮加载状态，完成后显示成功提示消息。

### 优化

- **Markdown 预览字体**：调整了 Markdown 文件预览时的字体，使其更适合长时间阅读。

## [1.6.0] - 2026-06-04

### 新增

现在你可以直接预览markdown文件了，支持latex的公式，支持mermaid流程图，甚至你可以直接导出为html文件！

- **Markdown 文件直接预览**：支持在 VS Code 中直接预览 `.md` 文件，无需额外安装其他扩展。支持 Mermaid 流程图、LaTeX 公式、代码语法高亮。
- **图表交互**：Mermaid 图表支持缩放按钮（+/-）、Ctrl+滚轮缩放、鼠标拖拽平移。
- **导出 HTML**：预览面板提供「导出 HTML」按钮，可将 Markdown 文件（含渲染后的图表、公式）导出为自包含的 HTML 文件（内嵌所有 CSS/JS/字体资源），无需网络即可查看，便于分享和存档。
- 右键菜单集成：在 Markdown 文件编辑器中点击右键，选择「预览 Markdown」即可打开预览面板。

## [1.5.2] - 2026-05-10

### 新增

- 加入了文档网站，更详细的说明使用方式：https://sangliang.github.io/vscode-local-comment/

- 优化markdown编辑功能，用户在编辑时候，对于未保存的内容，会有更明显的提示

## [1.5.1] - 2026-04-14

### 变更

- 修复了git仓库的名称错误的问题

- 修复了一些已知问题

- 升级了一些依赖

- 清理了一些冗余的代码

## [1.5.0] - 2026-03-19

### 新增

- 为含有local comment的代码行上添加了 code lens的点击按钮，方便用户在不使用快捷键的情况下直接用鼠标点击以预览和编辑local comment的内容。

- 允许用户自己在vscode setting的配置里开关代码行旁边的 local comment的 gutter标记和代码行上方的code lens标记。

- 增加了local comments Markdown编辑页面中，preview 区域和edit区域的进度条联动的功能。方便用户在长文章中找到需要编辑的位置。

### 变更

- 修复了上一个版本发布的日期错误的问题

- 调整了分享注释按钮的颜色，使其和其他按钮的配色统一

## [1.4.1] - 2026-03-09

### 变更

- 修复在从旧的存储记录迁移到本地项目下的存储时，意外报错的问题
- 优化一些代码结构

## [1.4.0] - 2026-02-25

### 变更

- 调整了存储文件的路径，默认将会在当前项目下的.vscode/路径下创建local comment所需要的存储文件，对于旧数据可以从全局目录迁移到当前路径下

- 导入导出的功能优化，允许通过直接复制粘贴存储文件(如 .vscode/local-comment/comments/comments.json)到新项目的.vscode相同路径下，而不需要使用命令面板中的导入导出功能。

- 允许多分组的local comment注释，可以通过打开local comment设置，选择不同的comment.json文件，来实现不同分组的注释切换。

按F1调出命令行，执行`switch comments config`即可切换local comments分组或者创建新的local comment

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/switch_storage_config.png)

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/multi_group_comments.png)

## [1.3.3] - 2026-02-03

### 新增
- 允许在编辑器设置中对Markdown编辑器渲染的字体大小进行调整，目前默认和代码编辑器的字体大小保持了一致

### 变更
- 对Markdown输入页面的样式进行了一些调整，去除了拖拽调整输入框的功能(目前已经不需要了)，优化了基本功能提示的小图标
- 调整了登录code corner登录页的一些样式
- 调整了一些文档的结构

### 友情提示
- 下个版本中，我将会对文件保存的路径进行调整，会在项目下创建`.vscode/vscode-local-comments/comments/comments.json` 这样的存储路径。
之后用户本地注释的数据读取优先级将会是 `.vscode/vscode-local-comments/comments/comments.json`> `%APPDATA%/Code/User/globalStorage/vscode-local-comment/projects/`，**项目本地的保存路径优先级要大于全局保存路径的优先级**。
当然，我会提供用户数据迁移的选项，但是在此期间，**为了用户数据安全着想，希望大家能按时备份，导出数据到本地，以免造成损失。**

## [1.3.2] - 2026-01-22

### 新增
- Markdown 预览中的代码支持语法高亮
- 支持在设置中调整 Markdown 预览代码的颜色主题

### 变更
- 调整 Markdown 编辑器布局：减少边距，释放更多内容空间
- 其他代码结构优化

## [1.3.1] - 2025-12-26

### 新增
- 支持中文标签：`${中文标签}`
- 右键菜单加入当前文件的标签列表，点击可跳转到指定位置

### 变更
- **破坏性变更**：为避免与 LaTeX 公式中的 `$latex$` 定义冲突，标签声明从 `$tag` 改为 `${tag}`（使用旧格式的用户需手动迁移）

### 修复
- 其他问题修复

## [1.3.0] - 2025-11-26

### 新增

现在在本地注释中可以添加latex公式啦！

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/latex_support.png)

- 本地注释支持 LaTeX 公式
- 支持在编辑器 Output 中输出日志信息

### 变更
- 渲染性能优化

## [1.2.2] - 2025-10-28

### 修复
- 清理当前文件书签时报错
- 没有共享注释时，未登录用户不再弹窗提示

### 移除
- 一些无用代码

## [1.2.1] - 2025-09-03

### 修复
- 从鼠标点击进入 Markdown 编辑后无法正常保存退出的问题

### 变更
- 其他优化

## [1.2.0] - 2025-08-23

### 新增

**多人协作**

在编辑器上显示其他人(此处为admin用户)的注释信息，你可以像看微信读书那样，看到别人对该段代码的评价:
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/other_comment.png)

用户的本地注释信息和线上其他人的分享的信息区分：
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/local_and_online.png)

在web页面，管理自己分享的comment:

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/manager.png)

**注意** :多人协作版暂不对外免费提供。

- 多人协作：支持分享本地注释到云端，并拉取云端注释到本地
- Mermaid：支持 Ctrl + 鼠标滚轮缩放流程图
- Mermaid：新增手绘模式
- 支持共享注释的预览
- 允许将共享注释直接复制导入到本地注释中
- Markdown 编辑器中支持通过点击上下文内容切换注释行号

### 修复
- 一些已知问题

### 说明
- 本版本已支持多人注释能力，但目前没有公共云服务器可供试用。

## [1.1.3] - 2025-08-07

### 新增

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/render_mermaid.png)

- 支持 Mermaid 流程图（可在 Markdown 注释中自由使用 Mermaid 语法）

### 修复
- 一些已知问题

### 说明
- 本次发布包含多人协同相关能力的预告与部分实现，仍需进一步打磨。

## [1.1.2] - 2025-07-24

### 新增
- 支持在编辑 Markdown 过程中使用 Ctrl+S 保存文本
- 命令面板加入清除所有文件书签的命令

### 修复
- Linux 平台图标样式显示异常
- 一些已知问题

## [1.1.1] - 2025-07-08

### 变更
- Markdown 预览位置优化：使用 Tab 选框样式

### 修复
- Markdown 行数过多时，使用 `@` 标签自动补全位置错误/不显示的问题
- 其他问题

## [1.1.0] - 2025-06-29

### 新增
- 书签功能：Ctrl+Alt+K 添加/移除书签，Ctrl+Alt+J 跳转到下一个书签
- 对未匹配到的代码，在 Markdown 编辑器中展示其初始快照内容

### 修复
- 一些已知问题

## [1.0.10] - 2025-06-28

### 新增
- 支持用户手动匹配注释到代码
- 本地注释面板文件项支持跳转到文件（辅助 tab 跳转）

### 变更
- 本地注释面板中的文件项按使用频率排序

### 修复
- 一些已知问题

## [1.0.9] - 2025-06-25

### 新增
- 使用 Markdown 编辑器时支持分屏显示
- 用户数据导入/导出选项更自由（支持按项目路径或按注释内容导入导出）

### 变更
- Markdown 编辑器中的上下文提示增多

### 修复
- 一些已知问题

## [1.0.8] - 2025-06-14

### 变更
- 使用更严格的匹配算法，降低大段代码改动后注释与代码位置不匹配的概率

### 移除
- 命令行 panel 中移除一些无用命令

### 修复
- 其他问题

## [1.0.7] - 2025-06-04

### 新增
- Markdown 编辑预览功能
- 操作命令支持多语言

### 修复
- comment tree 中切换分支后注释样式不正确的问题

## [1.0.6] - 2025-06-02

### 变更
- 注释树面板中找不到的本地注释会以更暗的颜色显示

## [1.0.5] - 2025-05-31

### 修复
- 切换 Git 分支时误触发更新注释代码快照，导致注释位置错乱的问题

## [1.0.4] - 2025-05-31

### 新增
- 新增快捷键 Ctrl+Shift+M：允许直接进入 Markdown 模式添加/修改本地注释

### 修复
- Markdown 编辑完成后返回代码编辑器时失去光标焦点的问题

## [1.0.3] - 2025-05-31

### 修复
- 不同项目使用同一份本地注释存储文件的问题
- 其他已知错误

## [1.0.2] - 2025-05-30

### 修复
- 切换分支导致的注释位置错误的问题
- Markdown 编辑时智能补全位置错误的问题

## [1.0.1] - 2025-05-30

### 新增
- 选中文字转换为注释：右键选中的文字可直接转换为本地注释并删除原文字
- 多行编辑器：新增专业的多行注释编辑界面，支持丰富的编辑功能
- 双重编辑模式：快捷模式（单行）与详细模式（多行富文本）
- 改进的标签补全：输入 `@` 时自动显示标签下拉列表
- 悬停操作按钮：编辑、Markdown 编辑、删除

### 文档
- 增加使用场景说明（快速标记代码段 / 编写长注释）

## [1.0.0] - 2025-05-29

### 新增
- 本地注释：不修改原文件即可在代码中添加本地注释
- 标签系统：支持 `${标签名}` 声明与 `@标签名` 引用
- 智能跳转：点击标签引用可跳转到声明位置
- 自动补全：输入 `@` 时自动提示可用标签
- 树形视图：侧边栏查看所有注释
- 快捷键支持：Ctrl+Shift+C 添加注释
- 语法高亮：标签在注释中高亮显示
- 跨文件支持：标签可在不同文件间引用

