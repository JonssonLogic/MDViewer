import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useFileLoader } from './hooks/useFileLoader';
import Toolbar from './components/Toolbar';
import EmptyState from './components/EmptyState';
import MarkdownRenderer from './components/MarkdownRenderer';
import TableOfContents from './components/TableOfContents';
import ErrorBoundary from './components/ErrorBoundary';
import { preprocessQmd, isQmdFile } from './utils/qmdPreprocess';
import './styles/global.css';
import './styles/toc.css';
import './styles/markdown.css';

type Theme = 'light' | 'dark';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

function clampZoom(z: number) {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
}

export default function App() {
  const { filePath, fileContent, isLoading, error, openFileDialog, refreshFile } =
    useFileLoader();

  const mainRef = useRef<HTMLElement>(null);
  const prevFilePathRef = useRef<string | null>(null);
  const scrollPositionRef = useRef(0);

  const fileName = filePath ? (filePath.split(/[\\/]/).pop() ?? '') : '';
  const fileDir = filePath ? filePath.replace(/[\\/][^\\/]*$/, '') : '';

  const processedContent = useMemo(() => {
    if (!fileContent) return '';
    if (filePath && isQmdFile(filePath)) return preprocessQmd(fileContent);
    return fileContent;
  }, [fileContent, filePath]);

  // ── Zoom (CSS zoom on content only) ────────────────────────────
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const stored = localStorage.getItem('mdviewer-zoom');
    return stored ? clampZoom(parseFloat(stored)) : 1.0;
  });

  useEffect(() => { localStorage.setItem('mdviewer-zoom', String(zoomLevel)); }, [zoomLevel]);

  const zoomIn = useCallback(() => setZoomLevel(z => clampZoom(z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoomLevel(z => clampZoom(z - ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setZoomLevel(1.0), []);

  // ── Theme ───────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('mdviewer-theme') as Theme) || 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mdviewer-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'light' ? 'dark' : 'light'));
  }, []);

  // Dynamic window title
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    win.setTitle(fileName ? `MDViewer — ${fileName}` : 'MDViewer').catch(() => {});
  }, [fileName]);

  // Scroll to top on new file, restore position on live reload
  useEffect(() => {
    if (!mainRef.current) return;
    if (filePath !== prevFilePathRef.current) {
      mainRef.current.scrollTop = 0;
      prevFilePathRef.current = filePath;
    } else {
      mainRef.current.scrollTop = scrollPositionRef.current;
    }
  }, [processedContent, filePath]);

  const handleScroll = () => {
    if (mainRef.current) scrollPositionRef.current = mainRef.current.scrollTop;
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'o') { e.preventDefault(); openFileDialog(); }
      if (mod && e.key === 'r') { e.preventDefault(); refreshFile(); }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      if (mod && e.key === '-') { e.preventDefault(); zoomOut(); }
      if (mod && e.key === '0') { e.preventDefault(); zoomReset(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openFileDialog, refreshFile, zoomIn, zoomOut, zoomReset]);

  // Ctrl+scroll zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoomLevel(z => clampZoom(z - e.deltaY * 0.001));
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div className="app-container">
      <Toolbar
        fileName={fileName}
        onOpenFile={openFileDialog}
        zoomLevel={zoomLevel}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="content-layout">
        {filePath ? (
          <>
            <TableOfContents markdown={processedContent} contentRef={mainRef} />
            <main className="markdown-content" ref={mainRef} onScroll={handleScroll}>
              {isLoading && <div className="loading-bar" />}
              {error && <p className="content-error">{error}</p>}
              {!fileContent && !isLoading && (
                <p className="content-empty">This file is empty.</p>
              )}
              <ErrorBoundary>
                <MarkdownRenderer content={processedContent} zoomLevel={zoomLevel} theme={theme} baseDir={fileDir} />
              </ErrorBoundary>
            </main>
          </>
        ) : (
          <EmptyState onOpenFile={openFileDialog} error={error} />
        )}
      </div>
    </div>
  );
}
