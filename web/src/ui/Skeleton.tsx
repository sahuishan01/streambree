export function SkeletonLine({ width }: { width?: string }) {
  return <div className="skeleton skeleton-line" style={width ? { width } : undefined} />;
}

export function SkeletonCard() {
  return <div className="skeleton skeleton-card" />;
}

export function SkeletonBlock() {
  return <div className="skeleton skeleton-block" />;
}

/** Placeholder for a page header plus content blocks while data loads. */
export function SkeletonPage({ blocks = 2, className = 'page page-form' }: { blocks?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      <div className="page-head">
        <div style={{ width: '100%' }}>
          <div className="skeleton skeleton-title" />
          <SkeletonLine width="35%" />
        </div>
      </div>
      <div className="stack">
        {Array.from({ length: blocks }, (_, i) => <SkeletonBlock key={i} />)}
      </div>
    </div>
  );
}
