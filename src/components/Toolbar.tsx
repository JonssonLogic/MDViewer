interface Props {
  onOpenFile: () => void;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  rawView: boolean;
  onToggleRawView: () => void;
  showComments: boolean;
  onToggleComments: () => void;
  commentCount: number;
  commentsDirty: boolean;
  onSaveComments: () => void;
}

export default function Toolbar({
  onOpenFile,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  theme,
  onToggleTheme,
  rawView,
  onToggleRawView,
  showComments,
  onToggleComments,
  commentCount,
  commentsDirty,
  onSaveComments,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-title-group">
        <span className="toolbar-title">MDViewer</span>
      </div>

      <div className="toolbar-controls">
        {/* Zoom controls */}
        <div className="zoom-group">
          <button className="zoom-btn" onClick={onZoomOut} title="Zoom out (Ctrl+−)">−</button>
          <button className="zoom-label" onClick={onZoomReset} title="Reset zoom (Ctrl+0)">
            {Math.round(zoomLevel * 100)}%
          </button>
          <button className="zoom-btn" onClick={onZoomIn} title="Zoom in (Ctrl++)">+</button>
        </div>

        {/* Raw view toggle */}
        <button
          className={`theme-toggle-btn${rawView ? ' raw-view-active' : ''}`}
          onClick={onToggleRawView}
          title="Toggle raw source view (Ctrl+U)"
        >
          &lt;/&gt;
        </button>

        {/* Comment toggle */}
        <button
          className={`theme-toggle-btn${showComments ? ' comments-active' : ''}`}
          onClick={onToggleComments}
          title="Toggle comments (Ctrl+M)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v8A1.5 1.5 0 0113.5 12H5l-3.5 3V2.5z"/>
          </svg>
          {commentCount > 0 && (
            <span className="comment-count-badge">{commentCount}</span>
          )}
        </button>

        {/* Save comments */}
        {commentsDirty && (
          <button
            className="theme-toggle-btn comment-save-btn"
            onClick={onSaveComments}
            title="Save comments (Ctrl+S)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.5 1H2a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4.5L11.5 1zM8 13a2 2 0 110-4 2 2 0 010 4zM3 3h8v3H3V3z"/>
            </svg>
          </button>
        )}

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
