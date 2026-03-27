import type { Comment } from '../types/comments';

// ─── Constants ───────────────────────────────────────────────────────

const BLOCK_START = '<!-- === MDVIEWER COMMENTS ===';
const BLOCK_END = '=== END MDVIEWER COMMENTS === -->';

const INSTRUCTION_HEADER = `Review comments on this document. Each comment targets a specific text passage
identified by its section heading path, paragraph number, and exact text match.
To address a comment: locate the target text in the indicated section and paragraph,
apply the suggested change, then remove that comment entry from this block.
When multiple comments share the same section and paragraph, consider them together
as changes for one comment may affect the text referenced by another.
Delete this entire block once all comments are resolved.`;

// ─── Section Map ─────────────────────────────────────────────────────

export interface SectionInfo {
  /** Full heading path, e.g. "## Methods > ### Data Collection" */
  path: string;
  /** The heading text including ## markers */
  heading: string;
  /** Heading level (1-6) */
  level: number;
  /** Start offset in content (start of heading line) */
  start: number;
  /** End offset in content (start of next same/higher-level heading, or end of doc) */
  end: number;
  /** Paragraphs within this section (split by blank lines), each with start/end offsets */
  paragraphs: { text: string; start: number; end: number }[];
}

/**
 * Build a map of all sections in the document.
 * Each section spans from its heading to the next heading of same or higher level.
 */
export function buildSectionMap(content: string): SectionInfo[] {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings: { level: number; text: string; fullLine: string; offset: number }[] = [];

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      fullLine: match[0],
      offset: match.index,
    });
  }

  // Build parent chain for heading paths
  const sections: SectionInfo[] = [];
  const parentStack: { level: number; text: string }[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];

    // Maintain parent stack — pop headings of same or deeper level
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].level >= h.level) {
      parentStack.pop();
    }

    const pathParts = [...parentStack.map(p => p.text), `${'#'.repeat(h.level)} ${h.text}`];
    const path = pathParts.join(' > ');

    parentStack.push({ level: h.level, text: `${'#'.repeat(h.level)} ${h.text}` });

    // Content of this section starts after the heading line
    const headingLineEnd = content.indexOf('\n', h.offset);
    const contentStart = headingLineEnd === -1 ? content.length : headingLineEnd + 1;

    // Find where this section ends — next heading of same or higher level
    let sectionEnd = content.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        sectionEnd = headings[j].offset;
        break;
      }
    }

    const sectionContent = content.slice(contentStart, sectionEnd);
    const paragraphs = splitIntoParagraphs(sectionContent, contentStart);

    sections.push({
      path,
      heading: h.fullLine,
      level: h.level,
      start: h.offset,
      end: sectionEnd,
      paragraphs,
    });
  }

  // Handle preamble (content before any heading)
  if (headings.length === 0 || headings[0].offset > 0) {
    const preambleEnd = headings.length > 0 ? headings[0].offset : content.length;
    const preambleContent = content.slice(0, preambleEnd);
    const paragraphs = splitIntoParagraphs(preambleContent, 0);
    if (paragraphs.length > 0 && paragraphs.some(p => p.text.trim())) {
      sections.unshift({
        path: '(preamble)',
        heading: '',
        level: 0,
        start: 0,
        end: preambleEnd,
        paragraphs,
      });
    }
  }

  return sections;
}

function splitIntoParagraphs(
  text: string,
  baseOffset: number
): { text: string; start: number; end: number }[] {
  const paragraphs: { text: string; start: number; end: number }[] = [];
  // Split on one or more blank lines
  const parts = text.split(/\n\s*\n/);
  let pos = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      pos += part.length + 1; // +1 for the newline we split on
      continue;
    }
    // Find actual position in original text
    const idx = text.indexOf(part, pos);
    if (idx !== -1) {
      paragraphs.push({
        text: trimmed,
        start: baseOffset + idx,
        end: baseOffset + idx + part.length,
      });
      pos = idx + part.length;
    }
  }

  return paragraphs;
}

// ─── Extract ─────────────────────────────────────────────────────────

/**
 * Extract the MDVIEWER COMMENTS block from raw file content.
 * Returns clean content (block removed) and parsed comments.
 */
export function extractComments(rawContent: string): {
  cleanContent: string;
  comments: Comment[];
} {
  const blockStartIdx = rawContent.lastIndexOf(BLOCK_START);
  if (blockStartIdx === -1) {
    return { cleanContent: rawContent, comments: [] };
  }

  const blockEndIdx = rawContent.indexOf(BLOCK_END, blockStartIdx);
  if (blockEndIdx === -1) {
    return { cleanContent: rawContent, comments: [] };
  }

  const blockContent = rawContent.slice(
    blockStartIdx + BLOCK_START.length,
    blockEndIdx
  );

  // Remove the block (and any preceding blank line) from content
  let cleanEnd = blockStartIdx;
  // Trim trailing whitespace/newlines before the block
  while (cleanEnd > 0 && (rawContent[cleanEnd - 1] === '\n' || rawContent[cleanEnd - 1] === '\r')) {
    cleanEnd--;
  }
  const cleanContent = rawContent.slice(0, cleanEnd) +
    rawContent.slice(blockEndIdx + BLOCK_END.length);

  const comments = parseCommentEntries(blockContent);
  return { cleanContent: cleanContent.trimEnd() + (cleanContent.trimEnd().length > 0 ? '\n' : ''), comments };
}

function parseCommentEntries(blockContent: string): Comment[] {
  const comments: Comment[] = [];
  // Match [comment:ID] ... until next [comment:] or end
  const entryRegex = /\[comment:([a-f0-9]+)\]\s*(.*)/g;
  const entries: { id: string; headerLine: string; startIdx: number }[] = [];

  let match;
  while ((match = entryRegex.exec(blockContent)) !== null) {
    entries.push({
      id: match[1],
      headerLine: match[2],
      startIdx: match.index + match[0].length,
    });
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Find where this entry's body ends (start of next [comment:...] line, or end of block)
    const nextEntryStart = i + 1 < entries.length
      ? blockContent.lastIndexOf('\n', entries[i + 1].startIdx - entries[i + 1].headerLine.length - entry.id.length - 12)
      : blockContent.length;

    const rawBody = blockContent.slice(entry.startIdx, nextEntryStart);

    // Parse header line attributes
    const header = entry.headerLine;
    const section = extractQuoted(header, 'section:') ?? '(preamble)';
    const paragraph = extractInt(header, 'paragraph:') ?? 1;
    const target = extractQuoted(header, 'target:') ?? '';
    const context = extractQuoted(header, 'context:') ?? '';

    // Parse context into before/after using {t} marker
    let contextBefore = '';
    let contextAfter = '';
    const tIdx = context.indexOf('{t}');
    if (tIdx !== -1) {
      contextBefore = context.slice(0, tIdx);
      contextAfter = context.slice(tIdx + 3);
    }

    // Parse body lines — everything indented, except the date line
    const bodyLines = rawBody.split('\n');
    const contentLines: string[] = [];
    let dateStr = '';

    for (const line of bodyLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const dateMatch = trimmed.match(/^\((\d{4}-\d{2}-\d{2})\)$/);
      if (dateMatch) {
        dateStr = dateMatch[1];
      } else {
        contentLines.push(trimmed);
      }
    }

    comments.push({
      id: entry.id,
      section,
      paragraph,
      targetText: target,
      contextBefore,
      contextAfter,
      body: contentLines.join('\n'),
      createdAt: dateStr || new Date().toISOString().slice(0, 10),
      updatedAt: dateStr || new Date().toISOString().slice(0, 10),
    });
  }

  return comments;
}

function extractQuoted(str: string, prefix: string): string | null {
  const idx = str.indexOf(prefix);
  if (idx === -1) return null;
  const start = str.indexOf('"', idx + prefix.length);
  if (start === -1) return null;
  // Find closing quote (handle escaped quotes)
  let end = start + 1;
  while (end < str.length) {
    if (str[end] === '\\' && end + 1 < str.length) {
      end += 2; // skip escaped char
      continue;
    }
    if (str[end] === '"') break;
    end++;
  }
  return str.slice(start + 1, end).replace(/\\"/g, '"');
}

function extractInt(str: string, prefix: string): number | null {
  const idx = str.indexOf(prefix);
  if (idx === -1) return null;
  const rest = str.slice(idx + prefix.length);
  const match = rest.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ─── Serialize ───────────────────────────────────────────────────────

/**
 * Serialize comments back into the file content.
 * Strips any existing comment block, then appends a new one if comments exist.
 */
export function serializeComments(
  originalRawContent: string,
  comments: Comment[]
): string {
  // Strip existing block
  const { cleanContent } = extractComments(originalRawContent);
  const base = cleanContent.trimEnd();

  if (comments.length === 0) {
    return base + '\n';
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(BLOCK_START);
  lines.push(INSTRUCTION_HEADER);

  for (const c of comments) {
    lines.push('');
    const context = `${escapeQuoted(c.contextBefore)}{t}${escapeQuoted(c.contextAfter)}`;
    const header = `[comment:${c.id}] section:"${escapeQuoted(c.section)}" paragraph:${c.paragraph} target:"${escapeQuoted(c.targetText)}" context:"${context}"`;
    lines.push(header);
    // Indent body lines
    for (const bodyLine of c.body.split('\n')) {
      lines.push(`  ${bodyLine}`);
    }
    lines.push(`  (${c.updatedAt})`);
  }

  lines.push(BLOCK_END);

  return base + '\n' + lines.join('\n') + '\n';
}

function escapeQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ─── Anchor ──────────────────────────────────────────────────────────

/**
 * Resolve comment positions in the clean content using the layered fallback strategy.
 * Sets `_offset` on each comment, or marks it as `orphaned`.
 */
export function anchorComments(
  cleanContent: string,
  comments: Comment[]
): Comment[] {
  const sections = buildSectionMap(cleanContent);

  return comments.map((comment) => {
    const resolved = { ...comment, orphaned: false, _offset: undefined as number | undefined };

    // Layer 1: Full path — section → paragraph → target
    const section = sections.find((s) => s.path === comment.section);
    if (section) {
      const para = section.paragraphs[comment.paragraph - 1];
      if (para) {
        const idx = para.text.indexOf(comment.targetText);
        if (idx !== -1) {
          // Find actual offset by searching in the original content slice
          const absIdx = cleanContent.indexOf(comment.targetText, para.start);
          if (absIdx !== -1) {
            resolved._offset = absIdx;
            return resolved;
          }
        }
      }

      // Layer 2: Section + target (paragraph index may be wrong)
      const sectionContent = cleanContent.slice(section.start, section.end);
      const targetIdx = sectionContent.indexOf(comment.targetText);
      if (targetIdx !== -1) {
        resolved._offset = section.start + targetIdx;
        return resolved;
      }
    }

    // Layer 3: Global target + context
    const globalMatches = findAllOccurrences(cleanContent, comment.targetText);
    if (globalMatches.length === 1) {
      resolved._offset = globalMatches[0];
      return resolved;
    }
    if (globalMatches.length > 1) {
      // Use context to disambiguate
      const contextStr = comment.contextBefore + comment.targetText + comment.contextAfter;
      for (const offset of globalMatches) {
        const start = Math.max(0, offset - comment.contextBefore.length - 10);
        const end = Math.min(cleanContent.length, offset + comment.targetText.length + comment.contextAfter.length + 10);
        const window = cleanContent.slice(start, end);
        if (window.includes(contextStr) || window.includes(comment.contextBefore.slice(-30) + comment.targetText)) {
          resolved._offset = offset;
          return resolved;
        }
      }
      // Fallback: take first match
      resolved._offset = globalMatches[0];
      return resolved;
    }

    // Layer 4: Not found — orphaned
    resolved.orphaned = true;
    return resolved;
  });
}

function findAllOccurrences(text: string, search: string): number[] {
  if (!search) return [];
  const results: number[] = [];
  let pos = 0;
  while (true) {
    const idx = text.indexOf(search, pos);
    if (idx === -1) break;
    results.push(idx);
    pos = idx + 1;
  }
  return results;
}

// ─── Highlight Injection ─────────────────────────────────────────────

/**
 * Inject <mark> tags into clean markdown content for each anchored comment.
 * Comments must have been processed by `anchorComments` first.
 */
export function injectCommentHighlights(
  cleanContent: string,
  comments: Comment[]
): string {
  // Filter to non-orphaned comments with resolved offsets, sort by offset descending
  // (inject from end to start so offsets remain valid)
  const anchored = comments
    .filter((c) => !c.orphaned && c._offset !== undefined)
    .sort((a, b) => (b._offset ?? 0) - (a._offset ?? 0));

  let result = cleanContent;

  for (const c of anchored) {
    const offset = c._offset!;
    const end = offset + c.targetText.length;

    // Verify the text at this offset still matches
    if (result.slice(offset, end) !== c.targetText) continue;

    const before = result.slice(0, offset);
    const after = result.slice(end);
    const tag = `<mark class="comment-highlight" data-comment-id="${c.id}">${c.targetText}</mark>`;
    result = before + tag + after;
  }

  return result;
}

// ─── Utilities ───────────────────────────────────────────────────────

/** Generate an 8-character hex ID */
export function generateCommentId(): string {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Given a character offset in clean content, determine the section path and paragraph index.
 */
export function locatePosition(
  cleanContent: string,
  offset: number
): { section: string; paragraph: number } {
  const sections = buildSectionMap(cleanContent);

  // Find the most specific (deepest) section containing this offset
  let bestSection: SectionInfo | null = null;
  for (const s of sections) {
    if (offset >= s.start && offset < s.end) {
      if (!bestSection || s.level > bestSection.level) {
        bestSection = s;
      }
    }
  }

  if (!bestSection) {
    return { section: '(preamble)', paragraph: 1 };
  }

  // Find which paragraph
  let paragraphIdx = 1;
  for (let i = 0; i < bestSection.paragraphs.length; i++) {
    const p = bestSection.paragraphs[i];
    if (offset >= p.start && offset < p.end + 1) {
      paragraphIdx = i + 1;
      break;
    }
    if (offset < p.start) {
      // Between paragraphs — assign to the previous one or the next
      paragraphIdx = Math.max(1, i);
      break;
    }
    paragraphIdx = i + 1; // default to last paragraph seen
  }

  return { section: bestSection.path, paragraph: paragraphIdx };
}

/**
 * Extract context around a target text at a given offset.
 * Returns ~80 chars (or sentence boundary) before and after.
 */
export function extractContext(
  cleanContent: string,
  offset: number,
  targetLength: number
): { contextBefore: string; contextAfter: string } {
  // Look for sentence boundaries or take ~80 chars
  const CONTEXT_LEN = 80;

  let beforeStart = Math.max(0, offset - CONTEXT_LEN);
  const beforeText = cleanContent.slice(beforeStart, offset);
  // Try to start at a sentence boundary
  const sentenceStart = beforeText.search(/[.!?]\s+[A-Z]/);
  if (sentenceStart !== -1 && sentenceStart < beforeText.length - 20) {
    beforeStart = beforeStart + sentenceStart + 1;
  }
  const contextBefore = cleanContent.slice(beforeStart, offset).trimStart();

  let afterEnd = Math.min(cleanContent.length, offset + targetLength + CONTEXT_LEN);
  const afterText = cleanContent.slice(offset + targetLength, afterEnd);
  // Try to end at a sentence boundary
  const sentenceEnd = afterText.search(/[.!?]\s/);
  if (sentenceEnd !== -1 && sentenceEnd > 10) {
    afterEnd = offset + targetLength + sentenceEnd + 1;
  }
  const contextAfter = cleanContent.slice(offset + targetLength, afterEnd).trimEnd();

  return { contextBefore, contextAfter };
}
