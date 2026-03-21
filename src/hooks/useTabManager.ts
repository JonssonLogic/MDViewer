import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { getMatches } from '@tauri-apps/plugin-cli';

export interface Tab {
  id: string;
  filePath: string;
  fileContent: string;
  isLoading: boolean;
  error: string | null;
  scrollTop: number;
}

function friendlyError(e: unknown): string {
  const msg = String(e);
  if (msg.includes('os error 2') || msg.includes('No such file') || msg.includes('cannot find'))
    return 'File not found.';
  if (msg.includes('invalid utf-8') || msg.includes('stream did not contain valid UTF-8'))
    return 'This file is not a valid text file (not UTF-8 encoded).';
  if (msg.includes('Access is denied') || msg.includes('os error 5'))
    return 'Access denied — cannot read this file.';
  return msg.replace(/^Error: /, '');
}

function pathsEqual(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\//g, '\\') === b.toLowerCase().replace(/\//g, '\\');
}

export function useTabManager() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  const pendingPaths = useRef(new Set<string>());
  const scrollRef = useRef<HTMLElement | null>(null);

  const setScrollRef = useCallback((el: HTMLElement | null) => {
    scrollRef.current = el;
  }, []);

  const saveScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    const id = activeTabIdRef.current;
    if (el && id) {
      const scrollTop = el.scrollTop;
      setTabs(prev => prev.map(t => t.id === id ? { ...t, scrollTop } : t));
    }
  }, []);

  const openFile = useCallback(async (rawPath: string) => {
    // Strip Windows UNC extended prefix (\\?\) which breaks asset protocol URLs
    const path = rawPath.startsWith('\\\\?\\') ? rawPath.slice(4) : rawPath;
    const normalizedPath = path.toLowerCase().replace(/\//g, '\\');

    // Check if already open — switch to it
    const existing = tabsRef.current.find(t => pathsEqual(t.filePath, path));
    if (existing) {
      saveScrollPosition();
      setActiveTabId(existing.id);
      return;
    }

    // Guard against concurrent opens of the same file (e.g. drag-drop firing twice)
    if (pendingPaths.current.has(normalizedPath)) return;
    pendingPaths.current.add(normalizedPath);

    const id = crypto.randomUUID();
    const newTab: Tab = {
      id,
      filePath: path,
      fileContent: '',
      isLoading: true,
      error: null,
      scrollTop: 0,
    };

    saveScrollPosition();
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);

    try {
      const content = await invoke<string>('read_file', { path });
      setTabs(prev => prev.map(t => t.id === id ? { ...t, fileContent: content, isLoading: false } : t));
      await invoke('watch_file', { path });
    } catch (e) {
      setTabs(prev => prev.map(t => t.id === id ? { ...t, error: friendlyError(e), isLoading: false } : t));
    } finally {
      pendingPaths.current.delete(normalizedPath);
    }
  }, [saveScrollPosition]);

  const closeTab = useCallback(async (id: string) => {
    const tab = tabsRef.current.find(t => t.id === id);
    if (!tab) return;

    // Only stop watching if no other tab has the same path
    const otherWithSamePath = tabsRef.current.some(t => t.id !== id && pathsEqual(t.filePath, tab.filePath));
    if (!otherWithSamePath) {
      try { await invoke('stop_watching_file', { path: tab.filePath }); } catch { /* ignore */ }
    }

    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== id);
      // If closing active tab, activate nearest sibling
      if (activeTabIdRef.current === id) {
        const idx = prev.findIndex(t => t.id === id);
        const next = remaining[Math.min(idx, remaining.length - 1)] ?? null;
        setActiveTabId(next?.id ?? null);
      }
      return remaining;
    });
  }, []);

  const switchTab = useCallback((id: string) => {
    if (id === activeTabIdRef.current) return;
    saveScrollPosition();
    setActiveTabId(id);
  }, [saveScrollPosition]);

  const openFileDialog = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'qmd', 'markdown'] }],
      });
      if (selected && typeof selected === 'string') {
        await openFile(selected);
      }
    } catch (e) {
      console.error('Dialog error:', friendlyError(e));
    }
  }, [openFile]);

  const refreshActiveTab = useCallback(async () => {
    const id = activeTabIdRef.current;
    const tab = id ? tabsRef.current.find(t => t.id === id) : null;
    if (!tab) return;
    try {
      const content = await invoke<string>('read_file', { path: tab.filePath });
      setTabs(prev => prev.map(t => t.id === id ? { ...t, fileContent: content, error: null } : t));
    } catch (e) {
      setTabs(prev => prev.map(t => t.id === id ? { ...t, error: friendlyError(e) } : t));
    }
  }, []);

  // Event listeners
  useEffect(() => {
    const unlistens: UnlistenFn[] = [];

    const setup = async () => {
      // File-changed: payload is the file path
      const u1 = await listen<string>('file-changed', async (event) => {
        const changedPath = event.payload;
        const matchingTabs = tabsRef.current.filter(t => pathsEqual(t.filePath, changedPath));
        if (matchingTabs.length === 0) return;

        try {
          const content = await invoke<string>('read_file', { path: changedPath });
          setTabs(prev => prev.map(t =>
            pathsEqual(t.filePath, changedPath)
              ? { ...t, fileContent: content, error: null }
              : t
          ));
        } catch (e) {
          const msg = friendlyError(e);
          if (msg === 'File not found.') {
            invoke('stop_watching_file', { path: changedPath }).catch(() => {});
            setTabs(prev => prev.map(t =>
              pathsEqual(t.filePath, changedPath)
                ? { ...t, error: 'File no longer available (deleted or moved).' }
                : t
            ));
          } else {
            setTabs(prev => prev.map(t =>
              pathsEqual(t.filePath, changedPath) ? { ...t, error: msg } : t
            ));
          }
        }
      });
      unlistens.push(u1);

      // Open-file: from single-instance plugin
      const u2 = await listen<string>('open-file', async (event) => {
        await openFile(event.payload);
      });
      unlistens.push(u2);

      // Drag-and-drop
      const u3 = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type === 'drop') {
          const path = event.payload.paths[0];
          if (!path) return;
          const ext = path.split('.').pop()?.toLowerCase() ?? '';
          if (ext === 'md' || ext === 'qmd' || ext === 'markdown') {
            await openFile(path);
          }
        }
      });
      unlistens.push(u3);

      // CLI argument
      try {
        const matches = await getMatches();
        const fileArg = matches.args['file'];
        if (fileArg?.value && typeof fileArg.value === 'string') {
          await openFile(fileArg.value);
        }
      } catch {
        // CLI plugin not active in this context
      }
    };

    setup();

    return () => {
      unlistens.forEach(u => u());
    };
  }, [openFile]);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null;

  return {
    tabs,
    activeTabId,
    activeTab,
    openFile,
    openFileDialog,
    closeTab,
    switchTab,
    refreshActiveTab,
    saveScrollPosition,
    setScrollRef,
  };
}
