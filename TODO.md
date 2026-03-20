# MDViewer — Task Tracker

Full implementation plan: `C:\Users\CV\.claude\plans\hazy-knitting-pike.md`

Update this file after completing each step.

---

## Status Legend
- [x] Done
- [ ] Not started
- [~] In progress

---

## Phase 1: Project Scaffolding

- [x] **Step 1** — Scaffold Tauri v2 + React + TypeScript project (Vite template + `tauri init`)
- [x] **Step 2** — Install Tauri plugins: `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-cli` (Rust + JS). Register plugins in `lib.rs`. Configure permissions in `capabilities/default.json`. Add CLI args to `tauri.conf.json`.
- [x] **Step 3** — Install all frontend npm packages: `react-markdown`, remark/rehype plugins, `mermaid`, `katex`, `github-slugger`, etc.

## Phase 2: Rust Backend — File Operations

- [x] **Step 4** — Implement Rust commands: `read_file`, `watch_file`, `stop_watching`. Add `notify` + `notify-debouncer-mini` crates. Create `src-tauri/src/commands.rs` with `WatcherState`.
- [x] **Step 5** — Add drag-and-drop handler in `lib.rs` using `on_webview_event`. Emit `"file-dropped"` event for `.md`/`.qmd` files.

## Phase 3: Frontend Core — File Loading

- [x] **Step 6** — Create app shell: `useFileLoader` hook, `Toolbar`, `EmptyState` components. Wire to basic `<pre>` display. Verify: open dialog works, live reload works, drag-drop works, CLI arg works.
- [x] **Step 7** — Implement `src/utils/qmdPreprocess.ts`: strip YAML front matter and `{python}`/`{r}` code chunks.

## Phase 4: Markdown Rendering Pipeline

- [x] **Step 8** — Build `MarkdownRenderer.tsx` with full remark/rehype plugin pipeline. Custom `code`/`pre` component overrides.
- [x] **Step 9** — Build `CodeBlock.tsx`: card-style wrapper with language badge pill and copy button.
- [x] **Step 10** — Build `MermaidBlock.tsx`: client-side mermaid rendering with `mermaid.render()`.
- [x] **Step 11** — Implement callouts/admonitions via `remark-directive` + custom `remarkCallouts` plugin.

## Phase 5: UI Layout and Magazine Styling

- [x] **Step 12** — Build full app layout: Toolbar + TOC sidebar + main content area. Implement `TableOfContents.tsx` with `github-slugger` and `IntersectionObserver`.
- [x] **Step 13** — Create magazine-style CSS: `global.css`, `markdown.css`, `toc.css`. CSS custom properties, serif typography, accent colors, card code blocks, colored callout bars.

## Phase 6: Polish

- [x] **Step 14** — Tauri window config (1200×800, min size, centered), file associations, dynamic window title.
- [x] **Step 15** — Keyboard shortcuts: `Ctrl+O` (open), `Ctrl+R` (refresh).
- [x] **Step 16** — Scroll position memory on live reload, loading indicator, content fade transition.

## Phase 7: Testing and Edge Cases

- [x] **Step 17** — Create `test-documents/test-all-features.md` and `test-documents/test.qmd`. Walk through all features visually.
- [x] **Step 18** — Error handling: file not found, non-UTF-8, empty file, deleted file while watching.

## Phase 8: Zoom + Dark Mode

- [x] **Step A1** — Zoom state in App.tsx: `zoomLevel` with localStorage persistence, keyboard shortcuts (`Ctrl++`/`Ctrl+-`/`Ctrl+0`).
- [x] **Step A2** — Toolbar zoom controls: `−`, percentage label, `+` buttons.
- [x] **Step A3** — Apply `zoom` CSS property on `.markdown-body` in MarkdownRenderer.
- [x] **Step A4** — Zoom control CSS styles in `global.css`.
- [x] **Step B1** — Dark theme CSS variables (`[data-theme="dark"]`) in `global.css`.
- [x] **Step B2** — Dark overrides in `markdown.css` and `toc.css` for hardcoded colors (inline code, tables, callouts, mermaid errors, TOC hover).
- [x] **Step B3** — Theme state + toggle in App.tsx with localStorage persistence.
- [x] **Step B4** — Theme toggle button (sun/moon) in Toolbar.
- [x] **Step B5** — Mermaid dark theme: reinitialize mermaid with `theme: 'dark'` when dark mode is active.

---

## Last updated after: Step B5 — Zoom + Dark Mode COMPLETE ✓
