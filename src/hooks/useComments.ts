import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Comment } from '../types/comments';
import {
  extractComments,
  serializeComments,
  anchorComments,
  injectCommentHighlights,
  generateCommentId,
  locatePosition,
  extractContext,
} from '../utils/commentParser';

export function useComments(
  filePath: string | null,
  rawContent: string,
  setSaveGuard: () => void
) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [showComments, setShowComments] = useState<boolean>(() => {
    return localStorage.getItem('mdviewer-show-comments') !== 'false';
  });

  // The raw content with comment block stripped
  const cleanContentRef = useRef('');
  // The original raw content (for serialization)
  const rawContentRef = useRef('');

  // Parse comments when raw content changes (file load / external reload)
  useEffect(() => {
    if (!rawContent) {
      setComments([]);
      cleanContentRef.current = '';
      rawContentRef.current = '';
      setIsDirty(false);
      return;
    }

    const { cleanContent, comments: parsed } = extractComments(rawContent);
    cleanContentRef.current = cleanContent;
    rawContentRef.current = rawContent;

    // Anchor comments to resolve offsets
    const anchored = anchorComments(cleanContent, parsed);
    setComments(anchored);
    setIsDirty(false);
  }, [rawContent]);

  // Clean content (comment block stripped) for the rendering pipeline
  const cleanContent = useMemo(() => {
    if (!rawContent) return '';
    return cleanContentRef.current || extractComments(rawContent).cleanContent;
  }, [rawContent]);

  // Content with highlights injected (when comments are visible)
  const displayContent = useMemo(() => {
    if (!showComments || comments.length === 0) return cleanContent;
    return injectCommentHighlights(cleanContent, comments);
  }, [cleanContent, comments, showComments]);

  const addComment = useCallback((
    targetText: string,
    charOffset: number,
    body: string
  ) => {
    const clean = cleanContentRef.current;
    const { section, paragraph, paraStart, targetOffsetInPara } = locatePosition(clean, charOffset);
    const { contextBefore, contextAfter } = extractContext(clean, charOffset, targetText.length);
    const now = new Date().toISOString().slice(0, 10);

    const newComment: Comment = {
      id: generateCommentId(),
      section,
      paragraph,
      paraStart,
      targetText,
      targetOffsetInPara,
      contextBefore,
      contextAfter,
      body,
      createdAt: now,
      updatedAt: now,
      _offset: charOffset,
    };

    setComments(prev => anchorComments(clean, [...prev, newComment]));
    setIsDirty(true);
  }, []);

  const editComment = useCallback((id: string, newBody: string) => {
    const now = new Date().toISOString().slice(0, 10);
    setComments(prev =>
      prev.map(c => c.id === id ? { ...c, body: newBody, updatedAt: now } : c)
    );
    setIsDirty(true);
  }, []);

  const deleteComment = useCallback((id: string) => {
    setComments(prev => prev.filter(c => c.id !== id));
    setIsDirty(true);
  }, []);

  const saveComments = useCallback(async () => {
    if (!filePath) return;

    setSaveGuard();
    const newContent = serializeComments(rawContentRef.current, comments);

    try {
      await invoke('write_file', { path: filePath, content: newContent });
      rawContentRef.current = newContent;
      setIsDirty(false);
    } catch (e) {
      console.error('Failed to save comments:', e);
      throw e;
    }
  }, [filePath, comments, setSaveGuard]);

  const toggleShowComments = useCallback(() => {
    setShowComments(prev => {
      const next = !prev;
      localStorage.setItem('mdviewer-show-comments', String(next));
      return next;
    });
  }, []);

  return {
    comments,
    showComments,
    isDirty,
    cleanContent,
    displayContent,
    addComment,
    editComment,
    deleteComment,
    saveComments,
    toggleShowComments,
  };
}
