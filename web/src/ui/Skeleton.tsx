export function SkeletonLine({ width }: { width?: string }) {
  return <div className="skeleton skeleton-line" style={width ? { width } : undefined} />;
}

export function SkeletonCard() {
  return <div className="skeleton skeleton-card" />;
}

export function SkeletonBlock() {
  return <div className="skeleton skeleton-block" />;
}

export function SkeletonPage() {
  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-header">
        <SkeletonLine width="40%" />
        <SkeletonLine width="25%" />
      </div>
      <SkeletonCard />
      <div style={{ height: '1rem' }} />
      <SkeletonCard />
    </div>
  );
}
