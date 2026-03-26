import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useTabManager } from './hooks/useTabManager';
import Toolbar from './components/Toolbar';
import TabBar from './components/TabBar';
import EmptyState from './components/EmptyState';
import MarkdownRenderer from './components/MarkdownRenderer';
import TableOfContents from './components/TableOfContents';
import ErrorBoundary from './components/ErrorBoundary';
import RawSourceView from './components/RawSourceView';
import { preprocessQmd, isQmdFile, extractYamlMeta } from './utils/qmdPreprocess';
import { parseBibtex, type BibEntry } from './utils/bibParser';
import { invoke } from '@tauri-apps/api/core';
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
  const {
    tabs,
    activeTabId,
    activeTab,
    openFileDialog,
    closeTab,
    switchTab,
    refreshActiveTab,
    setScrollRef,
  } = useTabManager();

  const mainRef = useRef<HTMLElement>(null);

  // Keep tab manager's scroll ref in sync with our main ref
  useEffect(() => {
    setScrollRef(mainRef.current);
  });

  const filePath = activeTab?.filePath ?? null;
  const fileContent = activeTab?.fileContent ?? '';
  const isLoading = activeTab?.isLoading ?? false;
  const error = activeTab?.error ?? null;

  const fileName = filePath ? (filePath.split(/[\\/]/).pop() ?? '') : '';
  const fileDir = filePath ? filePath.replace(/[\\/][^\\/]*$/, '') : '';

  // ── Bibliography loading ────────────────────────────────────────
  const [bibEntries, setBibEntries] = useState<BibEntry[]>([]);

  useEffect(() => {
    if (!fileContent || !filePath || !isQmdFile(filePath)) return;
    const meta = extractYamlMeta(fileContent);
    if (!meta.bibliography) return;
    // Resolve bibliography path relative to the file's directory
    const sep = fileDir.includes('\\') ? '\\' : '/';
    const bibPath = /^([a-zA-Z]:\\|\/)/.test(meta.bibliography)
      ? meta.bibliography
      : `${fileDir}${sep}${meta.bibliography.replace(/[/\\]/g, sep)}`;

    let cancelled = false;
    invoke<string>('read_file', { path: bibPath })
      .then(content => { if (!cancelled) setBibEntries(parseBibtex(content)); })
      .catch(() => { if (!cancelled) setBibEntries([]); });
    return () => { cancelled = true; };
  }, [fileContent, filePath, fileDir]);

  const processedContent = useMemo(() => {
    if (!fileContent) return '';
    if (filePath && isQmdFile(filePath)) return preprocessQmd(fileContent, bibEntries);
    return fileContent;
  }, [fileContent, filePath, bibEntries]);

  // ── Zoom (CSS zoom on content only) ────────────────────────────
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const stored = localStorage.getItem('mdviewer-zoom');
    return stored ? clampZoom(parseFloat(stored)) : 1.0;
  });

  useEffect(() => { localStorage.setItem('mdviewer-zoom', String(zoomLevel)); }, [zoomLevel]);

  const zoomIn = useCallback(() => setZoomLevel(z => clampZoom(z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoomLevel(z => clampZoom(z - ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setZoomLevel(1.0), []);

  // ── Raw view ────────────────────────────────────────────────────
  const [rawView, setRawView] = useState<boolean>(() => {
    return localStorage.getItem('mdviewer-raw-view') === 'true';
  });

  useEffect(() => { localStorage.setItem('mdviewer-raw-view', String(rawView)); }, [rawView]);

  const toggleRawView = useCallback(() => setRawView(v => !v), []);

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

  // Restore scroll position when switching tabs
  const prevTabIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mainRef.current || !activeTab) return;
    if (activeTabId !== prevTabIdRef.current) {
      mainRef.current.scrollTop = activeTab.scrollTop;
      prevTabIdRef.current = activeTabId;
    }
  }, [activeTabId, activeTab, processedContent]);

  const handleScroll = () => {
    // Scroll position is saved on tab switch via saveScrollPosition
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'o') { e.preventDefault(); openFileDialog(); }
      if (mod && e.key === 'r') { e.preventDefault(); refreshActiveTab(); }
      if (mod && e.key === 'u') { e.preventDefault(); toggleRawView(); }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      if (mod && e.key === '-') { e.preventDefault(); zoomOut(); }
      if (mod && e.key === '0') { e.preventDefault(); zoomReset(); }
      if (mod && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
      if (mod && e.key === 'Tab') {
        e.preventDefault();
        if (tabs.length > 1 && activeTabId) {
          const idx = tabs.findIndex(t => t.id === activeTabId);
          const nextIdx = e.shiftKey
            ? (idx - 1 + tabs.length) % tabs.length
            : (idx + 1) % tabs.length;
          switchTab(tabs[nextIdx].id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openFileDialog, refreshActiveTab, zoomIn, zoomOut, zoomReset, toggleRawView, activeTabId, closeTab, switchTab, tabs]);

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
        onOpenFile={openFileDialog}
        zoomLevel={zoomLevel}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        theme={theme}
        onToggleTheme={toggleTheme}
        rawView={rawView}
        onToggleRawView={toggleRawView}
      />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={switchTab}
        onCloseTab={closeTab}
      />
      <div className="content-layout">
        {activeTab ? (
          <>
            {!rawView && <TableOfContents markdown={processedContent} contentRef={mainRef} />}
            <main className="markdown-content" ref={mainRef} onScroll={handleScroll}>
              {isLoading && <div className="loading-bar" />}
              {error && <p className="content-error">{error}</p>}
              {!fileContent && !isLoading && (
                <p className="content-empty">This file is empty.</p>
              )}
              {rawView ? (
                <div className="raw-source-view" style={{ zoom: zoomLevel }}>
                  <div className="raw-source-pre">
                    <RawSourceView content={fileContent} fileName={fileName} />
                  </div>
                </div>
              ) : (
                <ErrorBoundary>
                  <MarkdownRenderer content={processedContent} zoomLevel={zoomLevel} theme={theme} baseDir={fileDir} />
                </ErrorBoundary>
              )}
            </main>
          </>
        ) : (
          <EmptyState onOpenFile={openFileDialog} error={error} />
        )}
      </div>
    </div>
  );
}
