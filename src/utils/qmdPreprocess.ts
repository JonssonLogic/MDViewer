/**
 * Preprocesses .qmd (Quarto) content by:
 * 1. Stripping YAML front matter
 * 2. Stripping executable code chunks ({python}, {r}, etc.)
 * 3. Converting Pandoc/Quarto attribute annotations on images/links to HTML
 * 4. Converting Quarto fenced divs to HTML <div> elements
 *
 * Attributes like {width="80%" .centered fig-align="center"} are parsed and
 * applied as HTML attributes/classes/styles instead of being stripped.
 */

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

export function preprocessQmd(content: string): string {
  let result = content;

  // 1. Strip YAML front matter (must be at the very start of the file)
  result = result.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

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

      let html = `<img src="${src}" alt="${imgAlt}"${buildHtmlAttrs(parsed)} />`;

      if (caption) {
        html = `<figure>${html}<figcaption>${caption}</figcaption></figure>`;
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
      lines[i] = `<div${buildHtmlAttrs(parsed)}>`;
      quartoDivDepth++;
    } else if (/^:::\s*$/.test(lines[i]) && quartoDivDepth > 0) {
      lines[i] = '</div>';
      quartoDivDepth--;
    }
    // Lines like :::note, :::tip etc. are left untouched for remarkCallouts
  }
  result = lines.join('\n');

  return result.trim();
}

export function isQmdFile(path: string): boolean {
  return path.toLowerCase().endsWith('.qmd');
}
