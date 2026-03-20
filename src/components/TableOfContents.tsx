import { useMemo, useEffect, useRef, useState } from 'react';
import GithubSlugger from 'github-slugger';

interface Heading {
  level: number;
  text: string;
  id: string;
}

function extractHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const level = match[1].length;
    // Strip inline markdown formatting for display
    const text = match[2].replace(/[*_~`[\]]/g, '').trim();
    const id = slugger.slug(text);
    headings.push({ level, text, id });
  }
  return headings;
}

interface Props {
  markdown: string;
  contentRef: React.RefObject<HTMLElement | null>;
}

export default function TableOfContents({ markdown, contentRef }: Props) {
  const headings = useMemo(() => extractHeadings(markdown), [markdown]);
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Track active heading via IntersectionObserver
  useEffect(() => {
    if (!contentRef.current || headings.length === 0) return;

    observerRef.current?.disconnect();

    const headingEls = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[];

    if (headingEls.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible heading
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );

    headingEls.forEach((el) => observerRef.current!.observe(el));

    return () => observerRef.current?.disconnect();
  }, [headings, contentRef]);

  if (headings.length === 0) return null;

  const minLevel = Math.min(...headings.map((h) => h.level));

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="toc-sidebar" aria-label="Table of contents">
      <p className="toc-header">Contents</p>
      <ul className="toc-list">
        {headings.map((h, i) => (
          <li
            key={`${h.id}-${i}`}
            className={`toc-item toc-level-${h.level - minLevel}${activeId === h.id ? ' toc-active' : ''}`}
          >
            <button className="toc-link" onClick={() => handleClick(h.id)} title={h.text}>
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
