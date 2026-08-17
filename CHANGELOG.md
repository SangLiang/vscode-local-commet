# Changelog

All notable changes to this project will be documented in this file.

[中文版](./CHANGELOG.zh-CN.md)

## [2.1.3] - 2026-08-17

### Changed

- Added a relation graph for all files, allowing navigation to the file containing a referenced @tag through the graph

- Grouped local comment actions into a parent menu to reduce right-click context menu clutter

- Optimized some code implementations


### Fixed

- Fixed an issue where split screen did not work when opening "Input Local Comment" in editors like Cursor

- Fixed an issue where SVG images displayed incorrectly when previewing .md files

- Fixed an issue where images could not be displayed after exporting a Markdown file to HTML

- Fixed an issue where clicking the file node itself in the relation graph did not navigate to the file

- Fixed an issue where local comment content appeared too far down the line when other lens providers (e.g., GitLens) were present

## [2.1.2] - 2026-08-03

### Changed

- Optimized Markdown preview styles, improved margins and fonts

- Fixed Mermaid diagram height being too tall, causing oversized image display

- Fixed an issue where code block color was too similar to the background in light themes

- Fixed a notification prompting login in the bottom-right corner when users are not using the multi-user collaboration version

- Optimized code structure related to Markdown rendering

## [2.1.1] - 2026-07-15

### Changed

- Added a table of contents panel to the Markdown preview

- Fixed some incorrect image path names

## [2.1.0] - 2026-07-07

### Added

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/active_bar.png)

- Added an Activity Bar view for better local comment management — easily switch between comment groups and migrate comments across groups.

- Added AI assist with a skill that helps users automatically generate local comments for source files.

- Added search in the Markdown file preview panel.

- Use [Alt + left mouse click] to jump from the Markdown preview to the `.md` source file for editing.

## [2.0.1] - 2026-06-26

### Fixed

- Fixed incorrect focus issue when previewing new Markdown files

### Improved

- Added test cases and refactored/optimized some code

## [2.0.0] - 2026-06-05

This release brings better support for `.md` files. I believe that with Local Comment, you can make Markdown documentation work great without relying on any external editors!

So I've bumped the version to 2.0.0 — this is a new exploration. The goal is no longer just writing local comments, but making Markdown content and knowledge management better.

### Added

- **Jump from Markdown files directly into source code**: Previously, all operations were within local comment annotations. Now I've extended native `.md` files as well. In the previous version, we could already preview native `.md` files nicely. In this version, while previewing Markdown content, you can also click `@tag` markers to jump! This means we can better integrate documentation content with code implementations.

  To use it: in a `.md` file, right-click and you'll see the `Insert tag reference` option. Click it to list all tag markers in the project, then select the one to insert. Preview the document via right-click "Preview Markdown". You'll see your `tag reference` displayed with different styling — click it to jump to the corresponding declaration.

- **Tag relation graph**: Visualize tag reference relationships within the project with a force-directed interactive graph (zoom, pan, click for details). Run `Local Comment: Show Tag Relation Graph` from the Command Palette to open.

  This feature can organize documentation in your project nicely. As long as you take a moment to add `${tag}` markers when writing docs, you can reference that document later and jump to it with a click. Yes, it sounds like Obsidian. But you know what — we can also jump directly into specific code implementations. That's the tool programmers deserve.

- **Export HTML experience optimization**: Show button loading state during export, display success message when complete.

### Improved

- **Markdown preview font**: Adjusted font for Markdown file preview to be more suitable for extended reading.

## [1.6.0] - 2026-06-04

### Added

Now you can preview Markdown files directly, with LaTeX formula support, Mermaid flowcharts, and even export to HTML!

- **Markdown file preview**: Preview `.md` files directly in VS Code without installing additional extensions. Supports Mermaid diagrams, LaTeX formulas, and syntax-highlighted code.
- **Diagram interactions**: Mermaid diagrams support zoom buttons (+/-), Ctrl+scroll to zoom, and mouse drag to pan.
- **Export to HTML**: The preview panel provides an "Export HTML" button that exports Markdown files (including rendered diagrams and formulas) to a self-contained HTML file with all CSS/JS/font resources inlined—viewable offline and easy to share or archive.
- Right-click menu integration: In the Markdown file editor, right-click and select "Preview Markdown" to open the preview panel.

## [1.5.2] - 2026-05-10

### Added

- Added documentation site with detailed usage instructions: https://sangliang.github.io/vscode-local-comment/

- Improved Markdown editing: unsaved changes now show a more prominent indicator

## [1.5.1] - 2026-04-14

### Changed

- Fixed incorrect Git repository URLs in package metadata.

- Fixed several known issues.

- Upgraded dependencies.

- Removed redundant code.

## [1.5.0] - 2026-03-19

### Added

- Added a CodeLens action button on code lines that contain local comments, so users can preview and edit local comment content via mouse click without using shortcuts.

- Allow users to toggle local comment gutter markers and CodeLens markers via VS Code settings.

- Added synchronized scroll progress between the preview area and the edit area in the Local Comments Markdown editor page, making it easier to locate and edit content in long documents.

### Changed

- Fixed an incorrect release date in the previous version.

- Adjusted the shared comment button color to match the other buttons.

## [1.4.1] - 2026-03-09

### Changed

- Fixed unexpected errors when migrating from legacy storage to project-local storage
- Code structure optimizations

## [1.4.0] - 2026-02-25

### Changed

- Storage path updated: by default, local comment data is now created under `.vscode/` in the current project; legacy data can be migrated from the global directory to this project path.

- Import/export improved: you can copy storage files (e.g. `.vscode/local-comment/comments/comments.json`) into the same path under `.vscode/` in a new project instead of using the import/export commands in the Command Palette.

- Multi-group local comments: you can use multiple comment groups by opening Local Comment settings and choosing a different comment config file (e.g. a different `comments.json` or custom `.json` in the comments folder) to switch between groups.

Press F1 to open the Command Palette, then run `switch comments config` to switch local comments groups or create a new local comment config.


![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/switch_storage_config.png)

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/multi_group_comments.png)


## [1.3.3] - 2026-02-03

### Added
- Allow adjusting the font size of Markdown editor rendering in editor settings; it now defaults to match the code editor font size

### Changed
- Adjusted styles on the Markdown input page: removed the drag-to-resize input area (no longer needed), improved the basic feature hint icons
- Adjusted some styles on the Code Corner login page
- Adjusted some documentation structure

### Friendly reminder
- In the next version, the file save path will be changed. A path like `.vscode/vscode-local-comments/comments/comments.json` will be created under the project. The data read priority for local comments will be: `.vscode/vscode-local-comments/comments/comments.json` > `%APPDATA%/Code/User/globalStorage/vscode-local-comment/projects/`. **Project-local storage path has higher priority than the global storage path.** A data migration option will be provided. **For data safety, please back up and export your data regularly to avoid loss.**

## [1.3.2] - 2026-01-22

### Added
- Syntax highlighting for code blocks in Markdown preview
- Config option to customize the code color theme in Markdown preview

### Changed
- Adjusted Markdown editor layout: reduced margins to free up more content space
- Various internal code structure optimizations

## [1.3.1] - 2025-12-26

### Added
- Support Chinese tags: `${中文标签}`
- Added a tag list in the editor context menu for the current file; click to jump to the selected tag

### Changed
- **Breaking**: Tag declaration format changed from `$tag` to `${tag}` to avoid conflicts with `$latex$` in LaTeX formulas

### Fixed
- Other minor issues

## [1.3.0] - 2025-11-26

### Added

Now you can add LaTeX formulas in local comments!

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/latex_support.png)

- LaTeX formula support in local comments
- Allow outputting logs to the editor Output channel

### Changed
- Rendering performance optimizations

## [1.2.2] - 2025-10-28

### Fixed
- Error when clearing bookmarks for the current file
- When there are no shared comments, users who are not logged in no longer get a prompt

### Removed
- Unused code

## [1.2.1] - 2025-09-03

### Fixed
- Could not save/exit normally when entering Markdown editing via mouse click

### Changed
- Other optimizations

## [1.2.0] - 2025-08-23

### Added

**Multi-user collaboration**

Display other users' (here admin user) comment information in the editor. You can see others' evaluations of code segments like reading WeChat Books:
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/other_comment.png)

Distinguish between users' local comment information and online shared information from others:
![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/local_and_online.png)

Manage your shared comments in the web interface:

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/manager.png)

**Note**: The multi-user collaboration version is not currently available for free public use.

- Multi-user collaboration: share local comments to the cloud and pull shared comments back to local
- Mermaid: zoom flowcharts with Ctrl + mouse wheel
- Mermaid: hand-drawn style mode
- Shared comments preview
- Allow users to copy shared comments directly into local comments
- In Markdown editor, click context content to switch comment line numbers

### Fixed
- Some known issues

### Notes
- This version introduced multi-user collaboration, but there is currently no public cloud server for testing.

## [1.1.3] - 2025-08-07

### Added

![image](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/render_mermaid.png)

- Mermaid flowchart support in Markdown comments

### Fixed
- Some known issues

### Notes
- A preview of upcoming multi-user collaboration features.

## [1.1.2] - 2025-07-24

### Added
- Support Ctrl+S to save while editing Markdown
- Added a command to clear bookmarks across all files

### Fixed
- Icon display issues on Linux
- Some known issues

## [1.1.1] - 2025-07-08

### Changed
- Markdown preview UI: switched to a tabbed layout

### Fixed
- Autocomplete popup position issues for `@` tags in large Markdown documents
- Other issues

## [1.1.0] - 2025-06-29

### Added
- Bookmark feature: Ctrl+Alt+K to toggle, Ctrl+Alt+J to jump to next bookmark
- Show initial snapshot content in the Markdown editor when code cannot be matched

### Fixed
- Some known issues

## [1.0.10] - 2025-06-28

### Added
- Manually match comments to code
- Jump to file from items in the local comment panel

### Changed
- Local comment panel file items are now sorted by usage frequency

### Fixed
- Some known issues

## [1.0.9] - 2025-06-25

### Added
- Markdown editor opens in split view
- More flexible import/export options (by project path or by comment content)

### Changed
- More context hints in the Markdown editor

### Fixed
- Some known issues

## [1.0.8] - 2025-06-14

### Changed
- Stricter matching algorithm to reduce comment/code mismatch after large code changes

### Removed
- Unused commands from the command line panel

### Fixed
- Other issues

## [1.0.7] - 2025-06-04

### Added
- Markdown edit preview
- Multi-language support for operation commands

### Fixed
- Incorrect comment styles in the comment tree after switching branches

## [1.0.6] - 2025-06-02

### Changed
- In the comment tree, local comments that cannot be found now appear in a darker color

## [1.0.5] - 2025-05-31

### Fixed
- Switching Git branches incorrectly triggered comment snapshot updates, causing comment position confusion

## [1.0.4] - 2025-05-31

### Added
- New shortcut: Ctrl+Shift+M to quickly add/modify local comments in Markdown mode

### Fixed
- Cursor focus was lost when returning to the code editor after finishing Markdown editing

## [1.0.3] - 2025-05-31

### Fixed
- Different projects incorrectly shared the same local comment storage file
- Other known issues

## [1.0.2] - 2025-05-30

### Fixed
- Comment position incorrect after switching branches
- Smart completion position incorrect during Markdown editing

## [1.0.1] - 2025-05-30

### Added
- Convert selected text to local comment (right-click selected text)
- Multi-line comment editor with rich editing
- Dual edit modes: quick mode and detailed (Markdown) mode
- Improved tag completion: show dropdown when typing `@`
- Hover action buttons: edit, Markdown edit, delete

### Docs
- Added usage examples for quick marking and writing long comments

## [1.0.0] - 2025-05-29

### Added
- Local comments without modifying original source files
- Tag system: `${tagName}` declaration and `@tagName` reference
- Smart navigation: click tag references to jump to declarations
- Auto-completion for available tags when typing `@`
- Tree view in the sidebar for all comments
- Shortcut to add comments (Ctrl+Shift+C)
- Syntax highlighting for tags in comments
- Cross-file tag reference support

