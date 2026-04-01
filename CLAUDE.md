# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MDViewer is a Tauri v2 desktop application for viewing and commenting on Markdown (`.md`) and Quarto (`.qmd`) files. It uses a React + TypeScript frontend (Vite) and a Rust backend. Features include rich markdown rendering, syntax highlighting, math/KaTeX, Mermaid diagrams, callouts, a table of contents, zoom controls, dark mode, live file reload, multi-file tabs, a raw source view, bibliography/citation rendering, Quarto tabset support, and an inline commenting system with AI-readable storage.

## Commands

Node.js and Rust/Cargo are added permanently to `~/.bashrc` — no PATH prefix needed in new terminals.

| Command | Purpose |
|---------|---------|
| `npm run tauri dev` | Start dev mode (launches Vite dev server + Tauri window) |
| `npm run build` | Build the frontend (`tsc -b && vite build`) |
| `npm run tauri build` | Build the full distributable app |
| `cd src-tauri && cargo build` | Compile Rust backend only |
| `cd src-tauri && cargo check` | Type-check Rust without full build |
| `npm run lint` | Run ESLint on the frontend |
| `.\scripts\build.ps1 -WithFileAssociations` | Build distributable with `.md`/`.qmd` file associations |

## Architecture

### Two-Process Model
Tauri runs two processes that communicate via IPC:

- **Rust backend** (`src-tauri/src/`) — handles file I/O, file watching, CLI args, and WebView2 configuration. Commands are registered in `lib.rs` and invoked from the frontend via `invoke()`. Events flow from Rust → frontend via `app.emit()`.
- **React frontend** (`src/`) — handles all rendering, UI state, markdown processing, zoom, and theming. Communicates with Rust via `@tauri-apps/api/core` (`invoke`) and `@tauri-apps/api/event` (`listen`).

### Frontend Structure
```
src/
  types/
    comments.ts               # Comment interface (id, section, paragraph, target, context, body)
  hooks/
    useTabManager.ts           # Tab lifecycle, file open/read/watch, CLI args, drag-drop, save-guard
    useComments.ts             # Comment state management: CRUD, save, dirty tracking, visibility
  components/
    MarkdownRenderer.tsx       # react-markdown + full remark/rehype pipeline + image resolution + comment highlights
    CodeBlock.tsx              # Syntax-highlighted code with language badge + copy button
    MermaidBlock.tsx           # Client-side mermaid rendering (theme-aware)
    TabBar.tsx                 # Multi-file tab bar (open files, switch, close, middle-click close)
    TabsetBlock.tsx            # Interactive Quarto panel-tabset renderer
    TableOfContents.tsx        # Auto-generated TOC with IntersectionObserver
    RawSourceView.tsx          # Raw source view with custom markdown/QMD syntax highlighting
    Toolbar.tsx                # Top bar: zoom, theme, raw view, comment toggle, save button, Open
    CommentPopup.tsx           # Floating popup to view/edit/delete a comment
    CommentInput.tsx           # Floating input popover for creating new comments
    CommentPanel.tsx           # Sidebar listing all comments with orphan handling
    EmptyState.tsx             # Landing screen when no file is open
    ErrorBoundary.tsx          # React error boundary for render crashes
  utils/
    commentParser.ts           # Parse/serialize/anchor/highlight-inject comment blocks
    qmdPreprocess.ts           # Strip QMD front matter, code chunks, Pandoc attributes, fenced divs, citation rendering
    bibParser.ts               # BibTeX parser + citation processor + bibliography generator
    remarkCallouts.ts          # Custom remark plugin for :::note/tip/warning callout directives
  styles/
    global.css                 # CSS variables (light + dark), reset, toolbar, zoom controls, app shell
    markdown.css               # Magazine-style rendering + dark mode overrides
    comments.css               # Comment highlights, popups, panel, buttons (light + dark)
    toc.css                    # TOC sidebar styles
```

### Key IPC Contracts
- `invoke('read_file', { path })` → `Result<String, String>` — reads file contents
- `invoke('write_file', { path, content })` → `Result<(), String>` — writes file contents (used by comment save)
- `invoke('watch_file', { path })` → starts debounced file watcher
- `invoke('stop_watching')` → drops the watcher
- `listen('file-changed', ...)` → fired when watched file changes on disk
- Drag-and-drop uses Tauri v2's frontend `onDragDropEvent()` API from `@tauri-apps/api/webview`

### Markdown Pipeline
`react-markdown` with a unified remark/rehype plugin chain:
- **remark plugins**: `remark-gfm`, `remark-math`, `remark-directive`, `remark-gemoji`, `remark-definition-list`, custom `remarkCallouts`
- **rehype plugins**: `rehype-katex`, `rehype-slug`, `rehype-autolink-headings`, `rehype-highlight`, `rehype-raw`
- Custom component overrides for `code` (routes mermaid to `MermaidBlock`, others to `CodeBlock`), `pre` (pass-through), `img` (resolves relative paths via `convertFileSrc`), `div` (routes Quarto panel-tabsets to `TabsetBlock`), and `mark` (renders comment highlights with click handler)
- KaTeX CSS and highlight.js `github-dark` theme are imported in `MarkdownRenderer.tsx`

### Image Path Resolution
Images with relative paths (e.g. `![](../graphics/fig.png)`) are resolved against the open file's directory. Paths are normalized to remove `..` segments (required by Tauri's asset protocol), then converted to `asset://` URLs via `convertFileSrc()`. Requires the `protocol-asset` Tauri feature and `assetProtocol.scope: ["**"]` in `tauri.conf.json`.

### QMD Preprocessing
Before passing `.qmd` content to `react-markdown`, `qmdPreprocess.ts` strips and transforms:
1. YAML front matter (`---` ... `---` at file start), with `extractYamlMeta()` to extract `bibliography` and `title`
2. Executable code chunks (`` ```{python} ``, `` ```{r} ``, etc.)
3. Pandoc/Quarto attribute annotations on images/links (`{width=565}`, `{.class}`, etc.)
4. Quarto fenced div markers (`::: {layout-ncol=2}` ... `:::`)
5. `panel-tabset` divs — converted to `<div data-tab-label="...">` structure for `TabsetBlock`
6. Bibliography citations (`[@key]`) — resolved via `bibParser.ts` and appended as an HTML references section

### Bibliography / Citations
For `.qmd` files, `App.tsx` reads the `bibliography` field from YAML front matter, loads the `.bib` file via `invoke('read_file')`, and passes parsed `BibEntry[]` to `preprocessQmd()`. The `bibParser.ts` module provides:
- `parseBibtex(content)` — parses BibTeX into `BibEntry[]`
- `processCitations(content, entries)` — replaces `[@key]` / `[@key1; @key2]` inline citations with numbered superscripts
- `generateBibliography(citedKeys, entries)` — produces an HTML reference list

The bibliography is inserted at a `::: {#refs} :::` placeholder if present, otherwise appended at the end.

### Raw Source View
Toggled with `Ctrl+U` or the toolbar button. `RawSourceView.tsx` renders the file's raw content as a line-numbered table with custom syntax highlighting — a lightweight tokenizer that color-codes YAML front matter, headings, code fences, math, links, images, table pipes, HTML comments, callout markers, citations, Quarto shortcodes, and inline attributes. Always shows the unprocessed file content (not the comment-stripped or QMD-preprocessed version).

### Tabs
`useTabManager.ts` manages multiple open files as tabs. Each `Tab` holds `filePath`, `fileContent`, `scrollTop`, `isLoading`, and `error`. Tabs can be opened via the toolbar, drag-and-drop, CLI args, or `Ctrl+click` on links. `TabBar.tsx` renders the tab strip; middle-click or the × button closes a tab. `Ctrl+W` closes the active tab; `Ctrl+Tab` / `Ctrl+Shift+Tab` cycles through tabs.

### Zoom
CSS `zoom` property on `.markdown-body` — scales content only (toolbar and TOC are unaffected). State is in `App.tsx`, persisted to `localStorage`. Controls: toolbar buttons, `Ctrl++`/`Ctrl+-`/`Ctrl+0` keyboard shortcuts, and `Ctrl+scroll`. WebView2's native zoom is disabled via `SetIsZoomControlEnabled(false)` in `lib.rs` to prevent conflicts.

### Dark Mode
All colors use CSS custom properties in `:root`. A `[data-theme="dark"]` block in `global.css` overrides all variables. Toggle sets `document.documentElement.dataset.theme` and persists to `localStorage`. Mermaid diagrams re-render with the appropriate theme. Some elements with hardcoded light colors have explicit `[data-theme="dark"]` overrides in `markdown.css`.

### File Watching
The Rust backend uses the `notify` + `notify-debouncer-mini` crates. One watcher is held in `WatcherState(Mutex<Option<Debouncer>>)` — replacing the watcher automatically stops watching the previous file.

### Commenting System

Users can select text in the rendered view and attach comments. Comments are stored inside the `.md`/`.qmd` file in a way that is invisible to all standard markdown renderers (including Quarto) but clearly readable by AI in the raw source.

#### Storage Format
Comments are stored as a **single HTML comment block at the end of the file** — zero modifications to the document body. This is critical for Quarto compatibility (inline HTML comments break figures and fenced divs).

```markdown
(... normal document content, completely untouched ...)

<!-- === MDVIEWER COMMENTS ===
Review comments on this document. Each comment targets a specific text passage
identified by its section heading path, paragraph number, and exact text match.
To address a comment: locate the target text in the indicated section and paragraph,
apply the suggested change, then remove that comment entry from this block.
When multiple comments share the same section and paragraph, consider them together
as changes for one comment may affect the text referenced by another.
Delete this entire block once all comments are resolved.

[comment:a1f3] section:"## Introduction" paragraph:2 target:"some text" context:"before {t} after"
  The comment body here.
  (2026-03-27)
=== END MDVIEWER COMMENTS === -->
```

The block includes a self-documenting instruction header so any AI (Claude, ChatGPT, etc.) reading the raw file can immediately understand and act on the comments without knowledge of MDViewer.

#### Anchoring Strategy
Each comment stores multiple anchoring fields for resilient text location:
- `section` — heading path (e.g. `"## Methods > ### Data Collection"`)
- `paragraph` — 1-indexed paragraph within section
- `target` — exact text that was selected (most reliable anchor)
- `context` — full sentence or ~80 chars around the target with `{t}` placeholder

Layered fallback: section → paragraph → target → context → global search. If all fail, the comment is marked orphaned (visible in the comment panel with delete option).

#### Selection Handling for Non-Plain-Text
When a text selection includes rendered elements that don't match the markdown source (KaTeX math, figures, list items, table cells), `handleAddCommentClick` in `App.tsx` tries four strategies in order:

1. **Exact / whitespace-normalized** — direct `indexOf` on the clean source
2. **LaTeX extraction** — clones the DOM range, extracts the original LaTeX from KaTeX `<annotation encoding="application/x-tex">` elements, replaces rendered math with `$...$` / `$$...$$`, strips `<img>` tags, then searches again
3. **First line only** — uses just the first non-empty line of the selection (handles multi-item list selections and multi-cell table selections)
4. **DOM position fallback** — walks up the DOM from the selection's start container to the nearest block element (`<p>`, `<li>`, `<td>`, `<h1>`–`<h6>`, etc.), extracts the first ~30 chars of its plain text (skipping `.katex-mathml` duplicates), and searches for that in the source to get an approximate paragraph offset

If all four strategies fail the button is dismissed without action.

#### Content Pipeline Integration
The comment block is extracted from raw file content **before** QMD preprocessing runs, so the block is never seen by `qmdPreprocess.ts` (which strips HTML comments). The flow is:

```
rawContent → useComments.extractComments() → cleanContent
cleanContent → [if showComments] injectCommentHighlights() → displayContent
displayContent → [if .qmd] preprocessQmd() → processedContent
processedContent → MarkdownRenderer (with <mark> component override)
```

#### File Write & Save-Guard
The `write_file` Rust command writes comment changes back to the file. A save-guard mechanism in `useTabManager` prevents the file watcher from triggering a redundant reload when the app itself just wrote the file (1.5s debounce window via `saveGuardRef`).

#### UI Components
- **CommentInput** — floating popover for writing a new comment, appears near the text selection
- **CommentPopup** — floating card on highlighted text click, shows comment body with edit/delete buttons
- **CommentPanel** — sidebar listing all comments, click to scroll to them; orphaned comments shown separately
- **Toolbar** — speech bubble toggle button (with count badge), save button (appears when dirty, pulses)

#### Keyboard Shortcuts
- `Ctrl+M` — toggle comment visibility
- `Ctrl+S` — save comments (only when there are unsaved changes)
- `Escape` — close any open popup or input

## Keyboard Shortcuts (full list)

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open file dialog |
| `Ctrl+R` | Reload active file |
| `Ctrl+U` | Toggle raw source view |
| `Ctrl+M` | Toggle comment visibility |
| `Ctrl+S` | Save comments (when dirty) |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Ctrl+scroll` | Zoom |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Escape` | Close comment popup or input |

## Build Script
`scripts/build.ps1` automates the full release build:
- Checks prerequisites (Node, npm, Rust, Tauri CLI)
- Optionally patches `tauri.conf.json` with `.md`/`.markdown`/`.qmd` file associations (`-WithFileAssociations`)
- Runs `npm run tauri build`
- Restores original `tauri.conf.json` after build
- Collects the NSIS installer and creates a portable ZIP in `./release/`

**Important**: The script uses `[System.IO.File]::WriteAllText()` (not `Set-Content -Encoding UTF8`) to patch and restore `tauri.conf.json` — this avoids writing a UTF-8 BOM that would break Rust's serde JSON parser.

## Tauri Configuration
- `src-tauri/tauri.conf.json` — window settings (1200×800, min 600×400, centered), CLI arg definitions, asset protocol config, bundle config
- `src-tauri/capabilities/default.json` — security permissions (fs read + write + watch, dialog, cli)
- `src-tauri/Cargo.toml` — includes `protocol-asset` feature on `tauri`, `webview2-com` for Windows-specific WebView2 control
- The frontend dist is built to `dist/` and served from there in production