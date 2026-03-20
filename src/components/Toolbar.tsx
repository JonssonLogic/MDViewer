interface Props {
  fileName: string;
  onOpenFile: () => void;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function Toolbar({
  fileName,
  onOpenFile,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  theme,
  onToggleTheme,
}: Props) {
  return (
    <header className="toolbar">
      <span className="toolbar-title">{fileName || 'MDViewer'}</span>

      <div className="toolbar-controls">
        {/* Zoom controls */}
        <div className="zoom-group">
          <button className="zoom-btn" onClick={onZoomOut} title="Zoom out (Ctrl+−)">−</button>
          <button className="zoom-label" onClick={onZoomReset} title="Reset zoom (Ctrl+0)">
            {Math.round(zoomLevel * 100)}%
          </button>
          <button className="zoom-btn" onClick={onZoomIn} title="Zoom in (Ctrl++)">+</button>
        </div>

        {/* Theme toggle */}
        <button className="theme-toggle-btn" onClick={onToggleTheme} title="Toggle dark mode">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>

        <button className="toolbar-open-btn" onClick={onOpenFile}>
          Open File
        </button>
      </div>
    </header>
  );
}
