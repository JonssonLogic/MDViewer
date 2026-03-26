/**
 * Lightweight BibTeX parser for rendering bibliography references.
 * Handles common entry types: @article, @book, @inproceedings, @misc, @phdthesis, @techreport, etc.
 */

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

/**
 * Parse a BibTeX string into structured entries.
 */
export function parseBibtex(content: string): BibEntry[] {
  const entries: BibEntry[] = [];
  // Match @type{key, ... } blocks — handles nested braces in field values
  const entryRe = /@(\w+)\s*\{([^,]+),/g;
  let match;

  while ((match = entryRe.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const key = match[2].trim();

    // Skip non-entry types like @string, @preamble, @comment
    if (type === 'string' || type === 'preamble' || type === 'comment') continue;

    // Find the matching closing brace for this entry
    let depth = 1;
    let pos = match.index + match[0].length;
    const start = pos;
    while (pos < content.length && depth > 0) {
      if (content[pos] === '{') depth++;
      else if (content[pos] === '}') depth--;
      pos++;
    }
    const body = content.slice(start, pos - 1);

    const fields: Record<string, string> = {};
    // Parse field = {value} or field = "value" or field = number
    const fieldRe = /(\w[\w-]*)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      const fieldName = fm[1].toLowerCase();
      const value = (fm[2] ?? fm[3] ?? fm[4] ?? '').trim();
      // Clean up LaTeX commands and extra braces
      fields[fieldName] = cleanLatex(value);
    }

    entries.push({ type, key, fields });
  }

  return entries;
}

/** Remove common LaTeX formatting commands and extra braces */
function cleanLatex(text: string): string {
  return text
    .replace(/\{\\[a-zA-Z]+\s*/g, '') // remove \command{
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1') // \textbf{X} → X
    .replace(/[{}]/g, '') // remove remaining braces
    .replace(/~/g, '\u00A0') // non-breaking space
    .replace(/\\&/g, '&')
    .replace(/\\\\/g, '')
    .replace(/--/g, '–')
    .trim();
}

/**
 * Format a BibEntry as an HTML string for display in a bibliography section.
 */
export function formatBibEntry(entry: BibEntry): string {
  const f = entry.fields;
  const parts: string[] = [];

  // Authors
  if (f.author) {
    parts.push(formatAuthors(f.author));
  }

  // Year
  if (f.year) {
    parts.push(`(${f.year}).`);
  }

  // Title
  if (f.title) {
    parts.push(`<em>${f.title}</em>.`);
  }

  // Journal/booktitle/publisher
  if (f.journal) {
    let journalPart = f.journal;
    if (f.volume) journalPart += `, ${f.volume}`;
    if (f.number) journalPart += `(${f.number})`;
    if (f.pages) journalPart += `, ${f.pages}`;
    parts.push(`${journalPart}.`);
  } else if (f.booktitle) {
    parts.push(`In <em>${f.booktitle}</em>.`);
  }

  if (f.publisher) {
    parts.push(`${f.publisher}.`);
  }

  // DOI or URL
  if (f.doi) {
    parts.push(`<a href="https://doi.org/${f.doi}">doi:${f.doi}</a>`);
  } else if (f.url) {
    parts.push(`<a href="${f.url}">${f.url}</a>`);
  }

  return parts.join(' ');
}

/** Format author names: "Last, First and Last, First" → "Last, F., & Last, F." */
function formatAuthors(authors: string): string {
  return authors
    .split(/\s+and\s+/)
    .map(a => a.trim())
    .filter(Boolean)
    .join(', & ') + '.';
}

/**
 * Process citation keys in markdown content.
 * Replaces [@key] and [@key1; @key2] with numbered superscript links.
 * Skips citations inside HTML tag attributes to avoid breaking tags.
 * Returns the processed content and ordered list of cited keys.
 */
export function processCitations(
  content: string,
  entries: BibEntry[]
): { content: string; citedKeys: string[] } {
  const keyToEntry = new Map(entries.map(e => [e.key, e]));
  const citedKeys: string[] = [];
  const keyToNumber = new Map<string, number>();

  function getRef(key: string): string | null {
    if (!keyToEntry.has(key)) return null;
    if (!keyToNumber.has(key)) {
      citedKeys.push(key);
      keyToNumber.set(key, citedKeys.length);
    }
    return String(keyToNumber.get(key)!);
  }

  // Split content into HTML tags and text segments, only process text segments
  // This prevents citations inside alt="..." or other attributes from being replaced with HTML
  const parts = content.split(/(<[^>]+>)/g);
  const processed = parts.map(part => {
    // Skip HTML tags entirely
    if (part.startsWith('<')) return part;

    // Process bracketed citations: [@key], [@key1; @key2]
    let result = part.replace(
      /\[(-?@[\w:./-]+(?:\s*;\s*-?@[\w:./-]+)*)\]/g,
      (_match, inner: string) => {
        const keys = inner.split(/\s*;\s*/).map((k: string) => k.replace(/^-?@/, ''));
        const refs: string[] = [];
        for (const key of keys) {
          const num = getRef(key);
          if (!num) { refs.push(`[${key}?]`); continue; }
          refs.push(`<a href="#ref-${key}" class="citation-link">${num}</a>`);
        }
        return `<sup>[${refs.join(', ')}]</sup>`;
      }
    );

    // Process bare @key citations
    result = result.replace(
      /(?<![[\w@])@([a-zA-Z][\w]*)/g,
      (_match, key: string) => {
        const num = getRef(key);
        if (!num) return _match;
        return `<sup><a href="#ref-${key}" class="citation-link">${num}</a></sup>`;
      }
    );

    return result;
  }).join('');

  return { content: processed, citedKeys };
}

/**
 * Generate a bibliography HTML section from cited entries.
 */
export function generateBibliography(
  citedKeys: string[],
  entries: BibEntry[]
): string {
  if (citedKeys.length === 0) return '';

  const keyToEntry = new Map(entries.map(e => [e.key, e]));
  const items = citedKeys.map((key, i) => {
    const entry = keyToEntry.get(key);
    if (!entry) return '';
    return `<li id="ref-${key}" class="bib-entry"><span class="bib-number">[${i + 1}]</span><span class="bib-content">${formatBibEntry(entry)}</span></li>`;
  }).filter(Boolean);

  return `\n\n<div class="bibliography">\n<h2>References</h2>\n<ol class="bib-list">\n${items.join('\n')}\n</ol>\n</div>`;
}
