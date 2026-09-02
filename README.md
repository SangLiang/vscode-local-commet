# Local Comment

[中文文档](./README_CN.md)

**Without changing your source files**, attach durable notes and bookmarks to code in VS Code: **Markdown**, **Mermaid**, **LaTeX**, **tag declarations**, **jump-to navigation**, and **tag relation graphs**.

> Not just a code annotation tool — starting from v2.0, Local Comment is also your **Markdown knowledge management assistant**. Link docs to code with `@tags`, generate tag relation graphs with one click, organize knowledge like Obsidian, but jump directly into code implementations.

**Documentation site:** [https://sangliang.github.io/vscode-local-comment/](https://sangliang.github.io/vscode-local-comment/)

---

## What it does

| Capability | Description |
|------------|-------------|
| **Local comments** | Stored in separate data; **not written into source files**; does not clutter Git commits with notes. |
| **Markdown knowledge management** | Write in `.md` files, link to code with `@tags`, click to jump — documents and code seamlessly connected. |
| **Tag relation graph** | **New in v2.0**: Generate a visual graph of tag references with one click; organize knowledge like Obsidian with zoom, pan, and click-to-view details. |
| **Activity Bar groups** | Dedicated Activity Bar view to manage comment groups—create, switch, rename, and batch-move comments to other groups from the manage panel. |
| **AI Assist** | Built-in Skill and prompt for Copilot, Cursor, and other AI agents to write comments into separate groups without touching source files. |
| **Tag jumps** | Declare with `${tagName}`, reference with `@tagName`, jump between comments, Markdown docs, and code; **Chinese tag names** supported. |
| **Smart anchoring** | Tries to follow lines as code moves; anchor on **meaningful code lines** (see best practices below). |
| **Mermaid / LaTeX** | Diagrams and formulas render in preview for technical explanations. |
| **Bookmarks** | Mark lines across files and navigate in order—pairs well with comments as a reading path. |
| **Sidebar tree** | Browse comments and bookmarks for the project and jump back to code. |
| **Projects / groups** | Multiple independent comment groups per project: switch between several configs under `.vscode/local-comment/` (e.g. notes for one branch vs another). |
| **Markdown preview & export** | Preview `.md` files (diagrams, formulas, **Ctrl+F search**); **Alt+click** to jump back to the matching source line; one-click export to self-contained HTML for sharing and offline viewing. |
| **Custom comment colors** | **New in v2.2**: Assign a color to a comment based on its importance, making notable comments stand out in the editor. |

**In short:** keep “how you read the code” in VS Code, **local and private by default**.

---

## 30-second start

1. Put the cursor on a line of code and press **`Ctrl+Shift+M`** to write a Markdown local comment (**the shortcut to remember**).
2. Click the **Local Comment** icon in the Activity Bar and use **Comment Groups** to view, switch, or manage multiple comment groups.
3. You can also open the **Local Comments** tree in the Explorer sidebar to browse and jump back to code.
4. For quick landmarks, **`Ctrl+Alt+K`** toggles a bookmark; **`Ctrl+Alt+J`** / **`Ctrl+Alt+Shift+J`** moves between bookmarks.

Full shortcut tables are at the end of this file.

---

## Feature demos

### Tag navigation

![Tag navigation](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/jump.gif)

### Markdown local comments

![Markdown local comments](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/markdown.gif)

### Activity Bar and comment groups

![Activity Bar comment groups](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/active_bar.png)

### Comments and bookmarks list

![Sidebar list](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/view_panel.png)

### Mermaid diagrams

![Mermaid rendering](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/render_mermaid.png)

### LaTeX formulas

You can embed LaTeX in local comments and render it in preview.

![LaTeX support](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/latex_support.png)

### Comment colors (New in v2.2)

Color-code your comments by importance level so the notable ones stand out at a glance in the editor.

![Comment colors](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/local_comment_color.png)

### Multi-user collaboration (optional)

Distinguish **your local notes** from **shared online annotations** (similar to highlights in a shared book).

![Others' comments](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/other_comment.png)

![Local vs online](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/local_and_online.png)

Manage comments you have shared from the web UI:

![Manage shared comments](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/manager.png)

**Note:** The multi-user collaboration offering is **not** currently available as a free public product.

---

## Why local comments?

Typical cases: **researching a codebase**, **design notes that should not land in the repo**, **recording how a bug was fixed**, **linking logic across files**, **study notes while reading others’ code**, **capturing scattered takeaways after AI-assisted edits**.

### Compared with common alternatives

- **Comments in source**: Pollutes the repo and code review; poor fit for long or private write-ups.
- **External docs / note apps**: Detached from the exact file and line; Markdown, Mermaid, and sync often mean extra tooling or cost.

### How Local Comment approaches it

- **Separated from source**: Data lives in its own storage; files stay clean.  
- **Per-project isolation**: Projects do not mix.  
- **Persistent across sessions**: Survives restarting VS Code.  
- **Tracks edits when possible**: Reduces “comment still there, code unrecognizable” drift.  
- **Private by default**: Local data; optional team sharing is described under **Multi-user collaboration** above.

---

## Core features

### 1. Markdown knowledge management (v2.0 core)

**Seamlessly connect Markdown documents to code:**

- **Reference code tags in Markdown**: In any `.md` file, right-click and select "Insert tag reference" to insert `@tagName`. When previewing, click these references to **jump directly to the tag definition in code**.
- **Tags as links**: Declare with `${tagName}` in code, reference with `@tagName` in Markdown — documents and code form a two-way connection.
- **Preview and export**: Right-click and select "Preview Markdown" for Mermaid diagrams, LaTeX formulas, and syntax-highlighted code; **Ctrl+F** to search in the preview; **Alt+click** a preview block to jump to the matching line in the `.md` source; click "Export HTML" to generate a self-contained file for offline viewing.

> 💡 **Use cases**: Write architecture docs referencing key code implementations with `@`; take notes while reading source, then jump back to code with one click.

### 2. Tag relation graph (New in v2.0)

**Generate a knowledge graph of your project with one click:**

- **Visual connections**: Run `Local Comment: Show Tag Relation Graph` from the Command Palette to generate a force-directed graph showing all tag declarations and references.
- **Interactive exploration**: Supports zoom, drag to pan, click nodes to view tag details — quickly understand how modules reference each other.
- **Knowledge network**: Organize your project knowledge like Obsidian, but **with the ability to jump directly into code implementations**.

> 💡 **Use cases**: When onboarding to a large codebase, use the relation graph to quickly understand core module dependencies; when writing technical specs, verify all related features are covered.

### 3. Local comments

- **Quick add**: `Ctrl+Shift+C` adds a simple comment on the current line.
- **Markdown**: `Ctrl+Shift+M` opens the multi-line editor (**recommended main entry**).
- **Edit**: `Ctrl+Shift+E` edits the comment bound to the current line.
- **Delete**: `Ctrl+Shift+D` removes the comment on the current line.
- **Selection to comment**: `Ctrl+Shift+T` turns the selection into a comment.
- **Colors** (**New in v2.2**): Choose a color for a comment to reflect its importance—for example mark **critical** notes in red so they stand out from routine ones.

### 4. Activity Bar and comment groups

**Manage multiple comment groups from the Activity Bar:**

- **Entry**: Click the **Local Comment** icon in the Activity Bar → **Comment Groups** view.
- **Group actions**: See the active group and list all groups; create, rename, or delete groups; click a group name to open the manage panel.
- **Switch groups**: Click **Apply** in the list to switch the active comment configuration.
- **Move across groups**: In the manage panel, select comments and use **Move to group** to batch-migrate them to another group.
- **Refresh list**: Click **↻** to refresh (common after AI generates a new group).

### 5. AI Assist

**Let AI write local comments without changing source files:**

- **Entry**: Activity Bar **Local Comment** → **AI Assist** view.
- **Built-in Skill**: Explains how to write AI-generated comments into a **new group** under `.vscode/local-comment/` (without overwriting existing groups).
- **Workflow**: Save or read the Skill → open the target source file → copy the prompt into Cursor, Copilot, or another AI chat → after AI finishes, **↻ refresh** in **Comment Groups** and switch to the new group.

### 6. Bookmarks

- **Toggle**: `Ctrl+Alt+K` adds or removes a bookmark on the current line.  
- **Visuals**: Gutter icons, scrollbar markers, hover details.  
- **Navigate**: `Ctrl+Alt+J` next, `Ctrl+Alt+Shift+J` previous, cross-file, wraps end-to-start.

---

## Best practices (very important)

Prefer attaching comments to **meaningful code lines** (e.g. the same line as a function declaration). **Avoid** empty lines or lines that are only punctuation:

```javascript
function test() { // local comment: this line is a stable anchor
  // ...
}
```

That makes it easier to stay aligned after **branch switches** or **large refactors**.

---

## Shortcuts

### Local comments

| Shortcut | Action | Notes |
|----------|--------|--------|
| `Ctrl+Shift+C` | Add local comment | Simple one-line comment |
| `Ctrl+Shift+M` | Add Markdown comment | **Core**: multi-line rich text |
| `Ctrl+Shift+E` | Edit comment | Quick edit for current line |
| `Ctrl+Shift+D` | Delete comment | Remove comment on current line |
| `Ctrl+Shift+T` | Selection to comment | Convert selection |
| - | Preview Markdown | Right-click menu or Command Palette (`.md` files only) |

### Markdown preview

| Shortcut | Action | Notes |
|----------|--------|--------|
| `Ctrl+F` | Search in preview | Find text in the Markdown preview panel |
| `Alt+left click` | Jump to source | Click a preview block to open the matching line in the `.md` file |

### Bookmarks

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+K` | Toggle bookmark |
| `Ctrl+Alt+J` | Next bookmark |
| `Ctrl+Alt+Shift+J` | Previous bookmark |

---

## Tags

Tags are the core concept of Local Comment, connecting code and documents.

**Two marking patterns**:
- **Declaration**: `${tagName}` — mark a code location, indicating "something worth noting here"
- **Reference**: `@tagName` — reference a declared tag in Markdown documents or comments

```javascript
// Declare tag in code
let userConfig = {};  // local comment: ${userConfig} user config definition

function loadConfig() { 
    // implementation...
}
```

```markdown
<!-- Reference tags in Markdown documents -->
## Configuration Loading Flow

On startup, the system loads @userConfig, see source code for implementation.

Related features: @errorHandling @permissionCheck
```

**Naming rules**: letters (any script), digits, underscores; must start with a letter or underscore; mixing scripts is allowed, e.g. `${bug修复}`.

### Using tags in Markdown

**Insert tag reference**:
1. Right-click in Markdown file → "Insert tag reference"
2. Select a tag from the list (shows all declared tags in the project)
3. Or type `@` to trigger auto-completion

**Click to jump**:
- When previewing Markdown, all `@tagName` are displayed with special styling
- **Click to jump directly to the code definition** — documents and code seamlessly connected

**Tag relation graph**:
Run `Local Comment: Show Tag Relation Graph` from the Command Palette to visualize the reference network of all tags, helping you discover hidden connections between knowledge.

---

## FAQ

**Q: Do comments go into Git?**  
A: By default data lives in local storage and is **not written into source files**. If you use `.vscode/local-comment/` under the project, whether it is committed depends on whether you track that folder in version control.

**Q: Do I lose comments when I switch branches?**  
A: Comment data is independent of Git branches; it is **not cleared** when you switch (still best to anchor on stable lines).

**Q: How do I back up?**  
A: Use **Export comment data** from the Command Palette, or back up the `.vscode/local-comment/` directory when you use project-local storage.

**Q: Can others see my comments?**  
A: **Not by default**; data stays local. Sharing follows the product design only if you enable the **multi-user collaboration** features.

---

## Data storage

### Locations

- **Inside the project (recommended, v1.4.0+):** `.vscode/local-comment/`  
  Migrating legacy data: use the migrate action in the project prompt, or open the Command Palette (`F1`), search for `local comment`, and run the migrate command.

- **Global base directory (legacy / compatibility)**  
  - **Windows:** `%APPDATA%/Code/User/globalStorage/vscode-local-comment/projects/`  
  - **macOS:** `~/Library/Application Support/Code/User/globalStorage/vscode-local-comment/projects/`  
  - **Linux:** `~/.config/Code/User/globalStorage/vscode-local-comment/projects/`

### Per-project file naming

Each project can have its own file shaped like: `[project-name]-[hash].json`.

With **`.vscode/local-comment/`**, you usually **do not need frequent import/export**—copy that folder to another machine or project to move data.

### Multiple comment and bookmark groups (v1.4.0+)

- **Comments:** `.vscode/local-comment/comments/`, default `comments.json`; add more JSON files (e.g. `work.json`, `study.json`).
- **Bookmarks:** `.vscode/local-comment/bookmarks/`, default `bookmarks.json`; same pattern for multiple files.
- **Switching:** Prefer the Activity Bar **Comment Groups** view for one-click switching; or VS Code Settings → search **local comment** → under **Local Comment: Storage**, change the active comments or bookmarks config file name; or run `switch comments config` from `F1`.

![Multi-group comments settings](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/multi_group_comments.png)

![Switch comments config command](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/switch_storage_config.png)

### Data characteristics

- Stored per project  
- Does not automatically pollute application source  
- Backup and restore supported  
- Persists across VS Code sessions  

---

## Contributing and feedback

- **GitHub Issues:** [https://github.com/SangLiang/vscode-local-comment/issues](https://github.com/SangLiang/vscode-local-comment/issues)  
- **Email:** sangliang_sa@qq.com  

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md). Chinese notes: [`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md).

## Support the author

This may sound silly, but chipping in for a bit of AI usage or buying the author a coffee goes a long way toward keeping the extension maintained.

![Support the author](https://raw.githubusercontent.com/SangLiang/vscode-local-comment/refs/heads/master/images/donate.jpg)

## License

MIT License
