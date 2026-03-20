interface Props {
  onOpenFile: () => void;
  error?: string | null;
}

export default function EmptyState({ onOpenFile, error }: Props) {
  return (
    <div className="empty-state">
      {error ? (
        <p className="empty-state-error">{error}</p>
      ) : (
        <>
          <p className="empty-state-hint">Open a Markdown file to get started</p>
          <button className="empty-state-btn" onClick={onOpenFile}>
            Open File
          </button>
          <p className="empty-state-drag">
            Or drag and drop a <code>.md</code> / <code>.qmd</code> file onto this window
          </p>
        </>
      )}
    </div>
  );
}
