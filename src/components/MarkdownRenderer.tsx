import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkDirective from 'remark-directive';
import remarkGemoji from 'remark-gemoji';
import remarkDeflist from 'remark-definition-list';
import remarkSupersub from 'remark-supersub';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import katex from 'katex';
import { convertFileSrc } from '@tauri-apps/api/core';
import { remarkCallouts } from '../utils/remarkCallouts';
import CodeBlock from './CodeBlock';
import MermaidBlock from './MermaidBlock';
import TabsetBlock from './TabsetBlock';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

/** Render inline math ($...$) in a plain text string to KaTeX HTML. */
function renderInlineMath(text: string): string {
  return text.replace(/\$(?!\$)([^$\n]+)\$(?!\$)/g, (_, math) => {
    try {
      return katex.renderToString(math, { throwOnError: false });
    } catch {
      return `$${math}$`;
    }
  });
}

interface Props {
  content: string;
  zoomLevel: number;
  theme: 'light' | 'dark';
  baseDir: string;
  onCommentClick?: (commentId: string, rect: DOMRect) => void;
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
  // Decode URL-encoded characters (e.g., %5C backslash from markdown parsers)
  try { src = decodeURIComponent(src); } catch { /* ignore malformed URIs */ }
  // Already absolute URL (http, https, data, asset)
  if (/^(https?:|data:|asset:|blob:)/i.test(src)) return src;
  // Absolute file path (e.g. C:\... or /...)
  if (/^([a-zA-Z]:\\|\/)/.test(src)) return convertFileSrc(normalizePath(src));
  // Relative path — resolve against the file's directory
  const sep = baseDir.includes('\\') ? '\\' : '/';
  const fullPath = baseDir + sep + src.replace(/\//g, sep);
  return convertFileSrc(normalizePath(fullPath));
}

export default function MarkdownRenderer({ content, zoomLevel, theme, baseDir, onCommentClick }: Props) {
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkMath,
      remarkDirective,
      remarkCallouts,
      remarkGemoji,
      remarkDeflist,
      remarkSupersub,
    ],
    []
  );

  const rehypePlugins = useMemo(
    () => [
      rehypeRaw,
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
      // Wrap in <figure> with visible caption when alt text is present
      img({ src, alt, ...props }: any) {
        const resolved = resolveImageSrc(src ?? '', baseDir);
        if (alt) {
          return (
            <figure>
              <img src={resolved} alt={alt} {...props} />
              <figcaption dangerouslySetInnerHTML={{ __html: renderInlineMath(alt) }} />
            </figure>
          );
        }
        return <img src={resolved} alt="" {...props} />;
      },

      // Route panel-tabset divs to TabsetBlock component
      div({ className, children, ...props }: any) {
        if (className === 'panel-tabset') {
          return <TabsetBlock>{children}</TabsetBlock>;
        }
        return <div className={className} {...props}>{children}</div>;
      },

      // Comment highlights
      mark({ className, children, ...props }: any) {
        const commentId = props['data-comment-id'];
        if (className === 'comment-highlight' && commentId && onCommentClick) {
          // If the highlighted content is a LaTeX expression ($...$), render it with
          // KaTeX so the math displays correctly inside the highlight.
          const textContent = typeof children === 'string' ? children : '';
          const isInlineMath = /^\$(?!\$)[^$]+\$(?!\$)$/.test(textContent);
          const displayContent = isInlineMath
            ? <span dangerouslySetInnerHTML={{ __html: renderInlineMath(textContent) }} />
            : children;
          return (
            <mark
              className="comment-highlight"
              data-comment-id={commentId}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                onCommentClick(commentId, rect);
              }}
            >
              {displayContent}
              <span className="comment-indicator" />
            </mark>
          );
        }
        return <mark className={className} {...props}>{children}</mark>;
      },
    }),
    [theme, baseDir, onCommentClick]
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
