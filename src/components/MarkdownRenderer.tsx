import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import remarkGemoji from 'remark-gemoji';
import remarkDeflist from 'remark-definition-list';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeHighlight from 'rehype-highlight';
import { convertFileSrc } from '@tauri-apps/api/core';
import { remarkCallouts } from '../utils/remarkCallouts';
import CodeBlock from './CodeBlock';
import MermaidBlock from './MermaidBlock';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

interface Props {
  content: string;
  zoomLevel: number;
  theme: 'light' | 'dark';
  baseDir: string;
}

/** Resolve `..` and `.` segments from a file path */
function normalizePath(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.' && part !== '') resolved.push(part);
  }
  // Preserve drive letter on Windows (e.g. "C:")
  const joined = resolved.join(sep);
  return /^[a-zA-Z]:/.test(p) ? joined : sep + joined;
}

function resolveImageSrc(src: string, baseDir: string): string {
  if (!src) return src;
  // Already absolute URL (http, https, data, asset)
  if (/^(https?:|data:|asset:|blob:)/i.test(src)) return src;
  // Absolute file path (e.g. C:\... or /...)
  if (/^([a-zA-Z]:\\|\/)/.test(src)) return convertFileSrc(normalizePath(src));
  // Relative path — resolve against the file's directory
  const sep = baseDir.includes('\\') ? '\\' : '/';
  const fullPath = baseDir + sep + src.replace(/\//g, sep);
  return convertFileSrc(normalizePath(fullPath));
}

export default function MarkdownRenderer({ content, zoomLevel, theme, baseDir }: Props) {
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkMath,
      remarkDirective,
      remarkCallouts,
      remarkGemoji,
      remarkDeflist,
    ],
    []
  );

  const rehypePlugins = useMemo(
    () => [
      rehypeKatex,
      rehypeSlug,
      [rehypeAutolinkHeadings, { behavior: 'wrap' }] as const,
      rehypeHighlight,
    ],
    []
  );

  const components = useMemo(
    () => ({
      // Route code blocks: mermaid → MermaidBlock, others → CodeBlock with badge
      code({ className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className ?? '');
        const language = match?.[1] ?? '';

        // Block code: has a language class injected by the pipeline
        if (language) {
          if (language === 'mermaid') {
            return <MermaidBlock chart={String(children).trimEnd()} theme={theme} />;
          }
          return (
            <CodeBlock language={language} className={className} {...props}>
              {children}
            </CodeBlock>
          );
        }

        // Inline code
        return <code className={className} {...props}>{children}</code>;
      },

      // Pass-through pre so CodeBlock/MermaidBlock control their own wrapper
      pre({ children }: any) {
        return <>{children}</>;
      },

      // Resolve image paths relative to the open file's directory
      img({ src, alt, ...props }: any) {
        const resolved = resolveImageSrc(src ?? '', baseDir);
        return <img src={resolved} alt={alt ?? ''} {...props} />;
      },
    }),
    [theme, baseDir]
  );

  return (
    <div className="markdown-body" style={{ zoom: zoomLevel }}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as any}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}
