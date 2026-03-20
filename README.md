# MDViewer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A desktop application for viewing Markdown (`.md`) and Quarto (`.qmd`) files. Built with Tauri v2, React, and TypeScript.

## Features

- Rich markdown rendering with GFM, math/KaTeX, Mermaid diagrams, and syntax highlighting
- Quarto (`.qmd`) file support with automatic preprocessing
- Table of contents with scroll tracking
- Dark mode
- Zoom controls (toolbar, keyboard shortcuts, Ctrl+scroll)
- Live file reload on external changes
- Drag-and-drop file opening
- Callout/admonition blocks (note, tip, warning, etc.)

## End-User Requirements

None. The installers and portable ZIP are fully self-contained. The only runtime dependency is WebView2, which the NSIS installer downloads automatically if missing (it is pre-installed on Windows 10 1803+ and all Windows 11).

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install) (1.77.2+)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) (installed via npm)

Install dependencies:

```bash
npm install
```

Start the development server (launches Vite + Tauri window with hot reload):

```bash
npm run tauri dev
```

Other useful commands:

| Command | Purpose |
|---------|---------|
| `npm run build` | Build the frontend only (`tsc -b && vite build`) |
| `npm run lint` | Run ESLint on the frontend |
| `cd src-tauri && cargo check` | Type-check Rust backend without full build |

## Building for Distribution

The `scripts/build.ps1` PowerShell script handles building, packaging, and collecting all distributable artifacts.

### Basic Build

Produces an NSIS installer (`.exe`), an MSI installer (`.msi`), and a portable ZIP in the `./release/` directory:

```powershell
.\scripts\build.ps1
```

### Build Options

```powershell
# Build only the NSIS installer
.\scripts\build.ps1 -NsisOnly

# Build only the MSI installer
.\scripts\build.ps1 -MsiOnly

# Custom output directory
.\scripts\build.ps1 -OutputDir .\dist

# Bake file associations into the installer (installer auto-registers .md/.qmd)
.\scripts\build.ps1 -WithFileAssociations

# Skip the build step and just repackage existing artifacts
.\scripts\build.ps1 -SkipBuild
```

Flags can be combined:

```powershell
.\scripts\build.ps1 -NsisOnly -WithFileAssociations -OutputDir .\dist
```

### Build Output

After a successful build, the output directory contains:

| File | Description |
|------|-------------|
| `MDViewer_<version>_x64-setup.exe` | NSIS installer for Windows |
| `MDViewer_<version>_x64_en-US.msi` | MSI installer for Windows |
| `MDViewer-<version>-portable.zip` | Portable ZIP (exe + file association script) |

The build summary also prints SHA256 hashes for each artifact.

## File Associations

MDViewer can be associated with `.md`, `.markdown`, and `.qmd` files so they open in MDViewer on double-click.

### Via Installer

Build with the `-WithFileAssociations` flag and the NSIS/MSI installer will register the associations automatically during installation:

```powershell
.\scripts\build.ps1 -WithFileAssociations
```

### Manual Registration (Portable Install)

For portable installs or to register associations after a standard install, use the `register-file-associations.ps1` script:

```powershell
# Register — auto-detects MDViewer.exe in common locations
.\scripts\register-file-associations.ps1

# Register — specify the path explicitly
.\scripts\register-file-associations.ps1 -ExePath "C:\Tools\MDViewer\MDViewer.exe"

# Unregister — remove all MDViewer file associations
.\scripts\register-file-associations.ps1 -Unregister
```

The script modifies only the current user's registry (`HKCU`) — no admin elevation is required. It registers the following extensions:

| Extension | Description |
|-----------|-------------|
| `.md` | Markdown Document |
| `.markdown` | Markdown Document |
| `.qmd` | Quarto Document |

After registration, the associated files display the MDViewer icon in Explorer and open in MDViewer when double-clicked.

## Project Structure

```
src/                          # React frontend
  hooks/useFileLoader.ts      # File open/read/watch + CLI args + drag-drop
  components/
    MarkdownRenderer.tsx      # react-markdown + remark/rehype pipeline
    CodeBlock.tsx             # Syntax-highlighted code blocks
    MermaidBlock.tsx          # Mermaid diagram rendering
    TableOfContents.tsx       # Auto-generated TOC sidebar
    Toolbar.tsx               # Top bar (file name, zoom, theme, open)
    EmptyState.tsx            # Landing screen
  utils/
    qmdPreprocess.ts          # QMD front matter / code chunk stripping
    remarkCallouts.ts         # Custom callout directive plugin
  styles/
    global.css                # CSS variables, reset, app shell
    markdown.css              # Markdown content styling
    toc.css                   # TOC sidebar styles

src-tauri/                    # Rust backend
  src/lib.rs                  # Tauri setup, plugin registration
  src/commands.rs             # File read/watch IPC commands
  tauri.conf.json             # App config, window, CLI args, bundling

scripts/
  build.ps1                   # Build + package script
  register-file-associations.ps1  # File association helper
```

## License

This project is licensed under the [MIT License](LICENSE).
