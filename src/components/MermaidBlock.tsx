import { useEffect, useState, useRef } from 'react';
import mermaid from 'mermaid';

let idCounter = 0;

interface Props {
  chart: string;
  theme: 'light' | 'dark';
}

export default function MermaidBlock({ chart, theme }: Props) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${idCounter++}`);

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    });

    // Use a fresh ID each render to avoid mermaid caching issues
    const id = `${idRef.current}-${Date.now()}`;

    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chart, theme]);

  if (error) {
    return (
      <div className="mermaid-error">
        <pre>{chart}</pre>
        <p className="mermaid-error-msg">Diagram error: {error}</p>
      </div>
    );
  }

  if (!svg) return <div className="mermaid-block mermaid-loading">Rendering diagram…</div>;

  return (
    <div
      className="mermaid-block"
      // mermaid.render() returns sanitized SVG — safe to set directly
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
