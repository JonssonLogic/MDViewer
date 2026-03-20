import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { getMatches } from '@tauri-apps/plugin-cli';

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

export function useFileLoader() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filePathRef = useRef<string | null>(null);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  const openFile = useCallback(async (path: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const content = await invoke<string>('read_file', { path });
      setFilePath(path);
      setFileContent(content);
      await invoke('watch_file', { path });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      setError(friendlyError(e));
    }
  }, [openFile]);

  const refreshFile = useCallback(async () => {
    const path = filePathRef.current;
    if (!path) return;
    try {
      const content = await invoke<string>('read_file', { path });
      setFileContent(content);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    const setup = async () => {
      // Live reload: re-read on change; handle file deleted while watching
      const u1 = await listen('file-changed', async () => {
        const path = filePathRef.current;
        if (!path) return;
        try {
          const content = await invoke<string>('read_file', { path });
          setFileContent(content);
          setError(null);
        } catch (e) {
          const msg = friendlyError(e);
          // File was deleted — stop watching and show inline notice
          if (msg === 'File not found.') {
            invoke('stop_watching').catch(() => {});
            setError('File no longer available (deleted or moved).');
          } else {
            setError(msg);
          }
        }
      });

      // Drag-and-drop via Tauri v2 frontend API
      const u2 = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type === 'drop') {
          const path = event.payload.paths[0];
          if (!path) return;
          const ext = path.split('.').pop()?.toLowerCase() ?? '';
          if (ext === 'md' || ext === 'qmd' || ext === 'markdown') {
            await openFile(path);
          }
        }
      });

      unlistenRefs.current.push(u1, u2);

      // CLI argument
      try {
        const matches = await getMatches();
        const fileArg = matches.args['file'];
        if (fileArg?.value && typeof fileArg.value === 'string') {
          await openFile(fileArg.value);
        }
      } catch {
        // CLI plugin not active in this context — ignore
      }
    };

    setup();

    return () => {
      unlistenRefs.current.forEach((u) => u());
      invoke('stop_watching').catch(() => {});
    };
  }, [openFile]);

  return { filePath, fileContent, isLoading, error, openFile, openFileDialog, refreshFile };
}
