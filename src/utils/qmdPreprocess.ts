/**
 * Preprocesses .qmd (Quarto) content by:
 * 1. Stripping YAML front matter (extracting metadata like bibliography path)
 * 2. Stripping executable code chunks ({python}, {r}, etc.)
 * 3. Converting Pandoc/Quarto attribute annotations on images/links to HTML
 * 4. Converting Quarto fenced divs to HTML <div> elements
 * 5. Converting table class annotations to wrapper divs
 * 6. Processing Quarto shortcodes (video, etc.)
 * 7. Processing cross-references (@fig-, @tbl-, @sec-)
 *
 * Attributes like {width="80%" .centered fig-align="center"} are parsed and
 * applied as HTML attributes/classes/styles instead of being stripped.
 */

import { processCitations, generateBibliography, type BibEntry } from './bibParser';

interface ParsedAttrs {
  attrs: Record<string, string>;
  classes: string[];
  styles: string[];
}

function parseQmdAttributes(raw: string): ParsedAttrs {
  const attrs: Record<string, string> = {};
  const classes: string[] = [];
  const styles: string[] = [];

  const inner = raw.replace(/^\{|\}$/g, '').trim();

  // Match tokens: .class, #id, key="value", key=value
  const tokenRe = /(\.[a-zA-Z_][\w-]*|#[a-zA-Z_][\w-]*|[a-zA-Z_][\w-]*\s*=\s*"[^"]*"|[a-zA-Z_][\w-]*\s*=\s*[^\s"]+)/g;
  let m;
  while ((m = tokenRe.exec(inner)) !== null) {
    const token = m[1];
    if (token.startsWith('.')) {
      classes.push(token.slice(1));
    } else if (token.startsWith('#')) {
      attrs['id'] = token.slice(1);
    } else {
      const eqIdx = token.indexOf('=');
      const key = token.slice(0, eqIdx).trim();
      const value = token.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');

      if (key === 'fig-align') {
        if (value === 'center') styles.push('margin-left:auto;margin-right:auto;display:block');
        else if (value === 'left') styles.push('margin-right:auto;display:block');
        else if (value === 'right') styles.push('margin-left:auto;display:block');
      } else if (key === 'fig-alt') {
        attrs['alt'] = value;
      } else if (key === 'fig-cap') {
        attrs['data-caption'] = value;
      } else if (key === 'style') {
        styles.push(value);
      } else {
        attrs[key] = value;
      }
    }
  }

  return { attrs, classes, styles };
}

function buildHtmlAttrs(parsed: ParsedAttrs): string {
  let html = '';
  for (const [k, v] of Object.entries(parsed.attrs)) {
    html += ` ${k}="${v}"`;
  }
  if (parsed.classes.length) html += ` class="${parsed.classes.join(' ')}"`;
  if (parsed.styles.length) html += ` style="${parsed.styles.join(';')}"`;
  return html;
}

/** Extract metadata from YAML front matter before stripping */
export function extractYamlMeta(content: string): { bibliography?: string; title?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1].replace(/\r/g, '');
  const meta: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return meta;
}

export function preprocessQmd(content: string, bibEntries?: BibEntry[]): string {
  // Normalize line endings to \n
  let result = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. Strip YAML front matter (must be at the very start of the file)
  result = result.replace(/^---\n[\s\S]*?\n---\n?/, '');

  // 1b. Strip HTML comments (including multi-line where --> is on its own line)
  // Replace with newline to preserve blank-line separation between surrounding elements
  result = result.replace(/<!--[\s\S]*?-->/g, '\n');

  // 2. Strip executable code chunks: ```{lang...}...```
  result = result.replace(
    /^```\s*\{[a-zA-Z][a-zA-Z0-9]*[^}]*\}[^\n]*\n[\s\S]*?^```[ \t]*$/gm,
    ''
  );

  // 3a. Convert images with attributes: ![alt](src){...} → <img ... />
  // Optionally wraps in <figure> if a data-caption is present
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]*)\)\{([^}]+)\}/g,
    (_match, alt: string, src: string, attrStr: string) => {
      const parsed = parseQmdAttributes(`{${attrStr}}`);
      // Use fig-alt as alt if provided, otherwise keep original
      const imgAlt = parsed.attrs['alt'] ?? alt;
      delete parsed.attrs['alt'];
      const caption = parsed.attrs['data-caption'];
      delete parsed.attrs['data-caption'];

      // Use explicit fig-cap if provided, otherwise use alt text as caption
      const figCaption = caption || alt;
      // Clear alt when using it as figcaption to avoid duplication in the renderer
      const effectiveAlt = figCaption ? '' : imgAlt;
      let html = `<img src="${src}" alt="${effectiveAlt}"${buildHtmlAttrs(parsed)} />`;

      if (figCaption) {
        html = `\n<figure>${html}<figcaption>${figCaption}</figcaption></figure>\n`;
      }
      return html;
    }
  );

  // 3b. Convert links with attributes: [text](url){...} → <a ...>text</a>
  // Negative lookbehind ensures we don't match images (which start with !)
  result = result.replace(
    /(?<!!)\[([^\]]*)\]\(([^)]*)\)\{([^}]+)\}/g,
    (_match, text: string, href: string, attrStr: string) => {
      const parsed = parseQmdAttributes(`{${attrStr}}`);
      return `<a href="${href}"${buildHtmlAttrs(parsed)}>${text}</a>`;
    }
  );

  // 4. Convert Quarto fenced divs to HTML <div> / </div>
  // Lines like :::note, :::tip are left untouched for remarkCallouts
  const lines = result.split('\n');
  let quartoDivDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const openMatch = lines[i].match(/^:::\s*(\{[^}]+\})\s*$/);
    if (openMatch) {
      const parsed = parseQmdAttributes(openMatch[1]);
      // Convert layout-ncol/layout-nrow to CSS grid styles
      const ncol = parsed.attrs['layout-ncol'];
      const nrow = parsed.attrs['layout-nrow'];
      if (ncol) {
        parsed.classes.push('quarto-layout-grid');
        parsed.styles.push(`grid-template-columns:repeat(${ncol},1fr)`);
        delete parsed.attrs['layout-ncol'];
      }
      if (nrow) {
        parsed.classes.push('quarto-layout-grid');
        parsed.styles.push(`grid-template-rows:repeat(${nrow},auto)`);
        delete parsed.attrs['layout-nrow'];
      }
      lines[i] = `<div${buildHtmlAttrs(parsed)}>`;
      quartoDivDepth++;
    } else if (/^:::\s*$/.test(lines[i]) && quartoDivDepth > 0) {
      lines[i] = '</div>';
      quartoDivDepth--;
    }
    // Lines like :::note, :::tip etc. are left untouched for remarkCallouts
  }
  result = lines.join('\n');

  // 4b. Convert panel-tabset content: split ## headings into tab panels
  result = result.replace(
    /<div class="panel-tabset">([\s\S]*?)<\/div>/g,
    (_match, inner: string) => {
      const sections = inner.split(/^##\s+(.+)$/gm).filter(s => s.trim());
      if (sections.length < 2) return _match;

      let tabsetHtml = '<div class="panel-tabset">';
      // sections alternate: label, content, label, content...
      for (let i = 0; i < sections.length - 1; i += 2) {
        const label = sections[i].trim();
        const content = (sections[i + 1] || '').trim();
        tabsetHtml += `\n<div data-tab-label="${label}">\n\n${content}\n\n</div>`;
      }
      tabsetHtml += '\n</div>';
      return tabsetHtml;
    }
  );

  // 5. Strip Quarto table class annotations: `: {.striped .hover}` after tables
  // These appear on a line by itself after a markdown table (possibly with a blank line between).
  // The default table CSS already provides striped rows and hover effects.
  result = result.replace(/^:[ \t]+\{[^}]+\}[ \t]*$/gm, '');

  // 6. Convert Quarto shortcodes
  // {{< pagebreak >}} → page break (rendered as horizontal rule)
  result = result.replace(/\{\{<\s*pagebreak\s*>\}\}/g, '\n<hr class="quarto-pagebreak" />\n');

  // {{< video url >}} → embedded video/iframe
  result = result.replace(
    /\{\{<\s*video\s+([^\s>]+)(?:\s+[^>]*)?\s*>\}\}/g,
    (_match, url: string) => {
      if (/youtube\.com|youtu\.be|vimeo\.com/.test(url)) {
        const embedUrl = url
          .replace(/watch\?v=/, 'embed/')
          .replace(/youtu\.be\//, 'youtube.com/embed/');
        return `<div class="quarto-video"><iframe src="${embedUrl}" frameborder="0" allowfullscreen style="width:100%;aspect-ratio:16/9;border-radius:var(--radius);"></iframe></div>`;
      }
      return `<div class="quarto-video"><video controls src="${url}" style="width:100%;border-radius:var(--radius);"></video></div>`;
    }
  );

  // Strip any remaining unhandled shortcodes
  result = result.replace(/\{\{<[^>]*>\}\}/g, '');

  // 7. Process cross-references: @fig-label, @tbl-label, @sec-label
  // First pass: collect labels from headings and figures
  const labelMap = new Map<string, { type: string; num: number }>();
  let figCount = 0;
  let tblCount = 0;

  // Scan for heading IDs (from rehype-slug format or explicit {#id})
  const headingRe = /^(#{1,6})\s+(.+?)(?:\s*\{#([^}]+)\})?\s*$/gm;
  let hm;
  let secCount = 0;
  while ((hm = headingRe.exec(result)) !== null) {
    const id = hm[3] || hm[2].toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
    if (id.startsWith('sec-')) {
      secCount++;
      labelMap.set(id, { type: 'Section', num: secCount });
    }
  }

  // Scan for figure labels (id="fig-..." in img/figure tags)
  const figLabelRe = /id="(fig-[^"]+)"/g;
  let fm2;
  while ((fm2 = figLabelRe.exec(result)) !== null) {
    figCount++;
    labelMap.set(fm2[1], { type: 'Figure', num: figCount });
  }

  // Scan for table labels
  const tblLabelRe = /id="(tbl-[^"]+)"/g;
  let tm;
  while ((tm = tblLabelRe.exec(result)) !== null) {
    tblCount++;
    labelMap.set(tm[1], { type: 'Table', num: tblCount });
  }

  // Second pass: replace @fig-label, @tbl-label, @sec-label references
  result = result.replace(
    /@((?:fig|tbl|sec)-[\w-]+)/g,
    (_match, label: string) => {
      const ref = labelMap.get(label);
      if (ref) {
        return `<a href="#${label}" class="cross-ref">${ref.type}\u00A0${ref.num}</a>`;
      }
      return `<a href="#${label}" class="cross-ref">${label}</a>`;
    }
  );

  // 7b. Convert markdown images with citations in alt text to <figure> HTML
  // so the image renders and the caption text gets citation processing in step 8.
  // ![caption with @cite](src) → <figure><img src="..." /><figcaption>caption with @cite</figcaption></figure>
  result = result.replace(
    /^!\[([^\]]*@[^\]]*)\]\(([^)]+)\)\s*$/gm,
    (_match, alt: string, src: string) => {
      return `\n<figure><img src="${src}" alt="" /><figcaption>${alt}</figcaption></figure>\n`;
    }
  );

  // 8. Process bibliography citations if bib entries are provided
  if (bibEntries && bibEntries.length > 0) {
    const { content: citedContent, citedKeys } = processCitations(result, bibEntries);
    result = citedContent;
    const bibHtml = generateBibliography(citedKeys, bibEntries);

    // Check for a ::: {#refs} ::: placeholder (Quarto convention for bibliography placement)
    // The fenced div step (4) converts ::: {#refs} to <div id="refs"> and ::: to </div>
    if (result.includes('id="refs"')) {
      result = result.replace(/<div id="refs">\s*<\/div>/, bibHtml);
    } else {
      // No explicit placement — append at end
      result += bibHtml;
    }
  }

  return result.trim();
}

export function isQmdFile(path: string): boolean {
  return path.toLowerCase().endsWith('.qmd');
}
