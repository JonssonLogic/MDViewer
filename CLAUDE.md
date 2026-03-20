# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MDViewer is a Tauri v2 desktop application for read-only viewing of Markdown (`.md`) and Quarto (`.qmd`) files. It uses a React + TypeScript frontend (Vite) and a Rust backend. Features include rich markdown rendering, syntax highlighting, math/KaTeX, Mermaid diagrams, callouts, a table of contents, zoom controls, dark mode, and live file reload.

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

## Architecture

### Two-Process Model
Tauri runs two processes that communicate via IPC:

- **Rust backend** (`src-tauri/src/`) — handles file I/O, file watching, CLI args, and WebView2 configuration. Commands are registered in `lib.rs` and invoked from the frontend via `invoke()`. Events flow from Rust → frontend via `app.emit()`.
- **React frontend** (`src/`) — handles all rendering, UI state, markdown processing, zoom, and theming. Communicates with Rust via `@tauri-apps/api/core` (`invoke`) and `@tauri-apps/api/event` (`listen`).

### Frontend Structure
```
src/
  hooks/useFileLoader.ts      # File open/read/watch + CLI args + drag-drop
  components/
    MarkdownRenderer.tsx      # react-markdown + full remark/rehype pipeline + image resolution
    CodeBlock.tsx             # Syntax-highlighted code with language badge + copy button
    MermaidBlock.tsx          # Client-side mermaid rendering (theme-aware)
    TableOfContents.tsx       # Auto-generated TOC with IntersectionObserver
    Toolbar.tsx               # Top bar: file name, zoom controls, theme toggle, Open button
    EmptyState.tsx            # Landing screen when no file is open
    ErrorBoundary.tsx         # React error boundary for render crashes
  utils/
    qmdPreprocess.ts          # Strip QMD front matter, code chunks, Pandoc attributes, fenced divs
    remarkCallouts.ts         # Custom remark plugin for :::note/tip/warning callout directives
  styles/
    global.css                # CSS variables (light + dark), reset, toolbar, zoom controls, app shell
    markdown.css              # Magazine-style rendering + dark mode overrides
    toc.css                   # TOC sidebar styles
```

### Key IPC Contracts
- `invoke('read_file', { path })` → `Result<String, String>` — reads file contents
- `invoke('watch_file', { path })` → starts debounced file watcher
- `invoke('stop_watching')` → drops the watcher
- `listen('file-changed', ...)` → fired when watched file changes on disk
- Drag-and-drop uses Tauri v2's frontend `onDragDropEvent()` API from `@tauri-apps/api/webview`

### Markdown Pipeline
`react-markdown` with a unified remark/rehype plugin chain:
- **remark plugins**: `remark-gfm`, `remark-math`, `remark-directive`, `remark-gemoji`, `remark-definition-list`, custom `remarkCallouts`
- **rehype plugins**: `rehype-katex`, `rehype-slug`, `rehype-autolink-headings`, `rehype-highlight`
- Custom component overrides for `code` (routes mermaid to `MermaidBlock`, others to `CodeBlock`), `pre` (pass-through), and `img` (resolves relative paths via `convertFileSrc`)
- KaTeX CSS and highlight.js `github-dark` theme are imported in `MarkdownRenderer.tsx`

### Image Path Resolution
Images with relative paths (e.g. `![](../graphics/fig.png)`) are resolved against the open file's directory. Paths are normalized to remove `..` segments (required by Tauri's asset protocol), then converted to `asset://` URLs via `convertFileSrc()`. Requires the `protocol-asset` Tauri feature and `assetProtocol.scope: ["**"]` in `tauri.conf.json`.

### QMD Preprocessing
Before passing `.qmd` content to `react-markdown`, `qmdPreprocess.ts` strips:
1. YAML front matter (`---` ... `---` at file start)
2. Executable code chunks (`` ```{python} ``, `` ```{r} ``, etc.)
3. Pandoc/Quarto attribute annotations on images/links (`{width=565}`, `{.class}`, etc.)
4. Quarto fenced div markers (`::: {layout-ncol=2}` ... `:::`)

### Zoom
CSS `zoom` property on `.markdown-body` — scales content only (toolbar and TOC are unaffected). State is in `App.tsx`, persisted to `localStorage`. Controls: toolbar buttons, `Ctrl++`/`Ctrl+-`/`Ctrl+0` keyboard shortcuts, and `Ctrl+scroll`. WebView2's native zoom is disabled via `SetIsZoomControlEnabled(false)` in `lib.rs` to prevent conflicts.

### Dark Mode
All colors use CSS custom properties in `:root`. A `[data-theme="dark"]` block in `global.css` overrides all variables. Toggle sets `document.documentElement.dataset.theme` and persists to `localStorage`. Mermaid diagrams re-render with the appropriate theme. Some elements with hardcoded light colors have explicit `[data-theme="dark"]` overrides in `markdown.css`.

### File Watching
The Rust backend uses the `notify` + `notify-debouncer-mini` crates. One watcher is held in `WatcherState(Mutex<Option<Debouncer>>)` — replacing the watcher automatically stops watching the previous file.

## Tauri Configuration
- `src-tauri/tauri.conf.json` — window settings (1200×800, min 600×400, centered), CLI arg definitions, asset protocol config, bundle config
- `src-tauri/capabilities/default.json` — security permissions (fs read + watch, dialog, cli)
- `src-tauri/Cargo.toml` — includes `protocol-asset` feature on `tauri`, `webview2-com` for Windows-specific WebView2 control
- The frontend dist is built to `dist/` and served from there in production

## Implementation Plan and Task Tracking

The full implementation plan is at:
`C:\Users\CV\.claude\plans\hazy-knitting-pike.md`

Current progress is tracked in [TODO.md](TODO.md) in this project root. **After completing each step, update TODO.md** by marking the step `[x]` and updating the "Last updated after" line at the bottom. This ensures any Claude instance resuming work can immediately see where to pick up.
