import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useTabManager } from './hooks/useTabManager';
import { useComments } from './hooks/useComments';
import Toolbar from './components/Toolbar';
import TabBar from './components/TabBar';
import EmptyState from './components/EmptyState';
import MarkdownRenderer from './components/MarkdownRenderer';
import TableOfContents from './components/TableOfContents';
import ErrorBoundary from './components/ErrorBoundary';
import RawSourceView from './components/RawSourceView';
import CommentPopup from './components/CommentPopup';
import CommentInput from './components/CommentInput';
import CommentPanel from './components/CommentPanel';
import { preprocessQmd, isQmdFile, extractYamlMeta } from './utils/qmdPreprocess';
import { parseBibtex, type BibEntry } from './utils/bibParser';
import { invoke } from '@tauri-apps/api/core';
import './styles/global.css';
import './styles/toc.css';
import './styles/markdown.css';
import './styles/comments.css';

type Theme = 'light' | 'dark';

// ── Comment selection helpers ─────────────────────────────────────────

/**
 * Extract source-faithful text from a DOM range by replacing KaTeX with its
 * original LaTeX source (from the MathML annotation) and stripping images.
 */
/** Walk up the live DOM from `node` to find the nearest .katex ancestor, or null. */
function findKatexAncestor(node: Node): Element | null {
  let n: Node | null = node;
  while (n) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).classList?.contains('katex')) {
      return n as Element;
    }
    n = n.parentNode;
  }
  return null;
}

function extractSourceTextFromRange(range: Range): string {
  try {
    const fragment = range.cloneContents();
    const katexEls = fragment.querySelectorAll('.katex');

    if (katexEls.length === 0) {
      // Selection is entirely within a .katex element — cloneContents() yields only
      // a partial .katex-html subtree with no .katex root. Walk up the live DOM instead.
      const liveKatex = findKatexAncestor(range.startContainer);
      if (liveKatex) {
        const annotation = liveKatex.querySelector('annotation[encoding="application/x-tex"]');
        if (annotation?.textContent) {
          const delim = liveKatex.parentElement?.classList.contains('katex-display') ? '$$' : '$';
          return `${delim}${annotation.textContent}${delim}`;
        }
      }
    } else {
      katexEls.forEach(el => {
        let annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        let isDisplay = el.parentElement?.classList.contains('katex-display') ?? false;

        // If the annotation is absent, the selection started inside this .katex element
        // (so .katex-mathml was excluded from the clone). Retrieve it from the live DOM.
        if (!annotation) {
          const liveKatex = findKatexAncestor(range.startContainer);
          if (liveKatex) {
            annotation = liveKatex.querySelector('annotation[encoding="application/x-tex"]');
            isDisplay = liveKatex.parentElement?.classList.contains('katex-display') ?? false;
          }
        }

        if (annotation?.textContent) {
          const delim = isDisplay ? '$$' : '$';
          el.replaceWith(`${delim}${annotation.textContent}${delim}`);
        }
      });
    }

    fragment.querySelectorAll('img').forEach(el => el.remove());
    return (fragment.textContent ?? '').trim();
  } catch {
    return '';
  }
}

/** Try to find text in markdown source — exact first, then whitespace-normalized. */
function findInContent(text: string, content: string): number {
  if (!text) return -1;
  const direct = content.indexOf(text);
  if (direct !== -1) return direct;
  const norm = text.replace(/\s+/g, ' ').trim();
  const normContent = content.replace(/\s+/g, ' ');
  return normContent.indexOf(norm);
}

/**
 * Find an approximate source offset by walking up the DOM to the nearest block
 * element and matching its first plain-text words (skipping KaTeX MathML).
 */
function findOffsetFromDOMRange(range: Range, cleanContent: string): number {
  const startNode = range.startContainer;
  let el: Element | null = startNode.nodeType === Node.TEXT_NODE
    ? startNode.parentElement
    : startNode as Element;

  const blockTags = new Set(['P', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);
  while (el && !blockTags.has(el.tagName)) el = el.parentElement;
  if (!el) return -1;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    let p: Element | null = node.parentElement;
    let skip = false;
    while (p && p !== el) {
      if (p.classList?.contains('katex-mathml')) { skip = true; break; }
      p = p.parentElement;
    }
    if (!skip && node.textContent?.trim()) {
      parts.push(node.textContent);
      if (parts.join('').trim().length >= 30) break;
    }
    node = walker.nextNode();
  }

  const probe = parts.join('').trim().slice(0, 30);
  if (probe.length < 3) return -1;
  return cleanContent.indexOf(probe);
}

/**
 * Count visible text characters from the start of the nearest block element to
 * range.startContainer[startOffset]. Used to rank duplicate-word occurrences by
 * how close they are to the actual selection position.
 */
function estimateSelectionOffsetInBlock(range: Range): number {
  const startNode = range.startContainer;
  let blockEl: Element | null = startNode.nodeType === Node.TEXT_NODE
    ? startNode.parentElement
    : startNode as Element;

  const blockTags = new Set(['P', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);
  while (blockEl && !blockTags.has(blockEl.tagName)) blockEl = blockEl.parentElement;
  if (!blockEl) return 0;

  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let count = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === startNode) {
      count += range.startOffset;
      break;
    }
    let p: Element | null = node.parentElement;
    let skip = false;
    while (p && p !== blockEl) {
      if (p.classList?.contains('katex-mathml')) { skip = true; break; }
      p = p.parentElement;
    }
    if (!skip) count += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  return count;
}

/**
 * Return true if `offset` falls inside an inline math expression ($...$) in `content`.
 * Counts unescaped single-$ delimiters before the offset; odd count means we're inside math.
 * $$ pairs are skipped (display math) so they don't affect the inline count.
 */
function isOffsetInsideInlineMath(content: string, offset: number): boolean {
  let count = 0;
  let i = 0;
  while (i < offset) {
    if (content[i] === '$') {
      if (content[i + 1] === '$') {
        i += 2; // skip display math delimiter pair — doesn't affect inline count
        continue;
      }
      if (i === 0 || content[i - 1] !== '\\') {
        count++;
      }
    }
    i++;
  }
  return count % 2 === 1;
}

/** Among all occurrences of `text` in `content`, return the index nearest to `approxOffset`. */
function findClosestOccurrence(text: string, content: string, approxOffset: number): number {
  let pos = 0;
  let bestIdx = -1;
  let bestDist = Infinity;
  while (true) {
    const idx = content.indexOf(text, pos);
    if (idx === -1) break;
    const dist = Math.abs(idx - approxOffset);
    if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    pos = idx + 1;
  }
  return bestIdx;
}

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
    setSaveGuard,
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

  // ── Comments ─────────────────────────────────────────────────────
  const {
    comments,
    showComments,
    isDirty: commentsDirty,
    cleanContent: commentCleanContent,
    displayContent: commentDisplayContent,
    addComment,
    editComment,
    deleteComment,
    saveComments,
    toggleShowComments,
  } = useComments(filePath, fileContent, setSaveGuard);

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

  // Use comment-aware content: displayContent has highlights when visible,
  // commentCleanContent has the block stripped but no highlights
  const contentForRendering = showComments ? commentDisplayContent : commentCleanContent;

  const processedContent = useMemo(() => {
    if (!contentForRendering) return '';
    if (filePath && isQmdFile(filePath)) return preprocessQmd(contentForRendering, bibEntries);
    return contentForRendering;
  }, [contentForRendering, filePath, bibEntries]);

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
      if (mod && e.key === 'm') { e.preventDefault(); toggleShowComments(); }
      if (mod && e.key === 's') { e.preventDefault(); if (commentsDirty) saveComments(); }
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
  }, [openFileDialog, refreshActiveTab, zoomIn, zoomOut, zoomReset, toggleRawView, toggleShowComments, saveComments, commentsDirty, activeTabId, closeTab, switchTab, tabs]);

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

  // ── Comment UI state ────────────────────────────────────────────
  const savedRangeRef = useRef<Range | null>(null);

  const [commentPopup, setCommentPopup] = useState<{
    commentId: string;
    position: { top: number; left: number };
  } | null>(null);

  const [commentInput, setCommentInput] = useState<{
    targetText: string;
    charOffset: number;
    position: { top: number; left: number };
  } | null>(null);

  const [addCommentBtn, setAddCommentBtn] = useState<{
    position: { top: number; left: number };
    targetText: string;
  } | null>(null);

  // Handle text selection → show "Add Comment" button
  const handleMouseUp = useCallback(() => {
    if (!showComments || rawView) {
      setAddCommentBtn(null);
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      // Small delay before hiding to allow clicking the button
      setTimeout(() => setAddCommentBtn(null), 200);
      return;
    }

    const text = sel.toString().trim();
    const range = sel.getRangeAt(0);
    savedRangeRef.current = range.cloneRange();
    const rect = range.getBoundingClientRect();
    const mainEl = mainRef.current;
    if (!mainEl) return;

    const mainRect = mainEl.getBoundingClientRect();
    setAddCommentBtn({
      position: {
        top: rect.bottom - mainRect.top + mainEl.scrollTop + 4,
        left: rect.left - mainRect.left + rect.width / 2,
      },
      targetText: text,
    });
  }, [showComments, rawView]);

  // When "Add Comment" button is clicked
  const handleAddCommentClick = useCallback(() => {
    if (!addCommentBtn) return;
    const { targetText, position } = addCommentBtn;
    const cleanContent = commentCleanContent;

    let offset = -1;
    let resolvedTarget = targetText;

    // Strategy 1: exact + whitespace-normalized match, with DOM disambiguation for
    // repeated targets (findInContent always returns the first hit, but the user may
    // have selected a later occurrence in the same paragraph).
    // If the hit lands inside a $...$ expression, discard it — Strategy 2 will extract
    // the full LaTeX source form and find the correct $...$ boundary.
    offset = findInContent(targetText, cleanContent);
    if (offset !== -1 && savedRangeRef.current) {
      const blockOffset = findOffsetFromDOMRange(savedRangeRef.current, cleanContent);
      if (blockOffset !== -1) {
        const approxOffset = blockOffset + estimateSelectionOffsetInBlock(savedRangeRef.current);
        const closest = findClosestOccurrence(targetText, cleanContent, approxOffset);
        if (closest !== -1) offset = closest;
      }
    }
    if (offset !== -1 && isOffsetInsideInlineMath(cleanContent, offset)) {
      offset = -1; // let Strategy 2 expand to the full $...$ expression
    }

    // Strategy 2: replace KaTeX rendering with LaTeX source, strip images
    if (offset === -1 && savedRangeRef.current) {
      const sourceText = extractSourceTextFromRange(savedRangeRef.current);
      if (sourceText && sourceText !== targetText) {
        offset = findInContent(sourceText, cleanContent);
        if (offset !== -1) resolvedTarget = sourceText;
      }
    }

    // Strategy 3: first non-empty line only (handles multi-item lists, table rows)
    if (offset === -1) {
      const firstLine = targetText.split('\n').find(l => l.trim())?.trim() ?? '';
      if (firstLine && firstLine !== targetText) {
        offset = findInContent(firstLine, cleanContent);
        if (offset !== -1) resolvedTarget = firstLine;
      }
    }

    // Strategy 4: DOM position fallback — anchor to surrounding paragraph
    if (offset === -1 && savedRangeRef.current) {
      offset = findOffsetFromDOMRange(savedRangeRef.current, cleanContent);
      if (offset !== -1) resolvedTarget = targetText.slice(0, 60).trim();
    }

    if (offset === -1) {
      console.warn('Could not find selection in source markdown');
      setAddCommentBtn(null);
      return;
    }

    setCommentInput({ targetText: resolvedTarget, charOffset: offset, position });
    setAddCommentBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [addCommentBtn, commentCleanContent]);

  // Submit new comment
  const handleCommentSubmit = useCallback((body: string) => {
    if (!commentInput) return;
    addComment(commentInput.targetText, commentInput.charOffset, body);
    setCommentInput(null);
  }, [commentInput, addComment]);

  // Handle clicking a comment highlight in the rendered view
  const handleCommentClick = useCallback((commentId: string, rect: DOMRect) => {
    const mainEl = mainRef.current;
    if (!mainEl) return;
    const mainRect = mainEl.getBoundingClientRect();
    setCommentPopup({
      commentId,
      position: {
        top: rect.bottom - mainRect.top + mainEl.scrollTop + 4,
        left: rect.left - mainRect.left,
      },
    });
  }, []);

  // Scroll to a comment from the panel
  const handleScrollToComment = useCallback((commentId: string) => {
    const el = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Flash the highlight
      el.classList.add('comment-highlight-flash');
      setTimeout(() => el.classList.remove('comment-highlight-flash'), 1500);
    }
  }, []);

  const activeComment = commentPopup
    ? comments.find(c => c.id === commentPopup.commentId)
    : null;

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
        showComments={showComments}
        onToggleComments={toggleShowComments}
        commentCount={comments.length}
        commentsDirty={commentsDirty}
        onSaveComments={saveComments}
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
            <main
              className="markdown-content"
              ref={mainRef}
              onScroll={handleScroll}
              onMouseUp={handleMouseUp}
            >
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
                  <MarkdownRenderer
                    content={processedContent}
                    zoomLevel={zoomLevel}
                    theme={theme}
                    baseDir={fileDir}
                    onCommentClick={showComments ? handleCommentClick : undefined}
                  />
                </ErrorBoundary>
              )}

              {/* Add Comment button (floating near selection) */}
              {addCommentBtn && showComments && !rawView && (
                <button
                  className="add-comment-btn"
                  style={{ top: addCommentBtn.position.top, left: addCommentBtn.position.left }}
                  onMouseDown={(e) => { e.preventDefault(); handleAddCommentClick(); }}
                >
                  + Comment
                </button>
              )}

              {/* Comment input popover */}
              {commentInput && (
                <CommentInput
                  position={commentInput.position}
                  onSubmit={handleCommentSubmit}
                  onCancel={() => setCommentInput(null)}
                />
              )}

              {/* Comment popup (view/edit/delete) */}
              {commentPopup && activeComment && (
                <CommentPopup
                  commentId={activeComment.id}
                  body={activeComment.body}
                  date={activeComment.updatedAt}
                  targetText={activeComment.targetText}
                  position={commentPopup.position}
                  onEdit={editComment}
                  onDelete={deleteComment}
                  onClose={() => setCommentPopup(null)}
                />
              )}
            </main>

            {/* Comment panel sidebar */}
            {showComments && !rawView && comments.length > 0 && (
              <CommentPanel
                comments={comments}
                onScrollTo={handleScrollToComment}
                onDelete={deleteComment}
              />
            )}
          </>
        ) : (
          <EmptyState onOpenFile={openFileDialog} error={error} />
        )}
      </div>
    </div>
  );
}
