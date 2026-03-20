/**
 * Preprocesses .qmd (Quarto) content by stripping:
 * 1. YAML front matter (between --- delimiters at the start of the file)
 * 2. Executable code chunks: ```{python}, ```{r}, ```{julia}, ```{ojs}, etc.
 * 3. Pandoc/Quarto attribute annotations on images/links: {width=565}, {.class}, etc.
 * 4. Quarto fenced divs: ::: {layout-ncol=2} ... :::
 *
 * Only prose/markdown content is retained.
 */
export function preprocessQmd(content: string): string {
  let result = content;

  // 1. Strip YAML front matter (must be at the very start of the file)
  result = result.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // 2. Strip executable code chunks: ```{lang...}...```
  // The language identifier is wrapped in curly braces, e.g. {python}, {r echo=FALSE}
  result = result.replace(
    /^```\s*\{[a-zA-Z][a-zA-Z0-9]*[^}]*\}[^\n]*\n[\s\S]*?^```[ \t]*$/gm,
    ''
  );

  // 3. Strip Pandoc attribute annotations that follow images/links
  // e.g. ![](image.png){width=565} → ![](image.png)
  //      [text](url){.class} → [text](url)
  result = result.replace(/(\]\([^)]*\))\{[^}]*\}/g, '$1');

  // 4. Strip Quarto fenced div markers: ::: {layout-ncol=2} and bare :::
  result = result.replace(/^:::.*$/gm, '');

  return result.trim();
}

export function isQmdFile(path: string): boolean {
  return path.toLowerCase().endsWith('.qmd');
}
