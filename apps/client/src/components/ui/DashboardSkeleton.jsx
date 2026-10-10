export function DashboardSkeleton() {
  return (
    <section className="page dashboard-skeleton" aria-label="Cargando dashboard">
      <div className="skeleton-heading">
        <span className="skeleton-line skeleton-eyebrow" />
        <span className="skeleton-line skeleton-title" />
        <span className="skeleton-line skeleton-copy" />
      </div>
      <div className="stats-grid">
        {[1, 2, 3, 4].map((item) => <div className="stat-card skeleton-card" key={item}><span className="skeleton-line" /><span className="skeleton-line skeleton-value" /><span className="skeleton-line skeleton-short" /></div>)}
      </div>
      <div className="dashboard-grid">
        {[1, 2].map((item) => <div className="panel skeleton-panel" key={item}><span className="skeleton-line skeleton-panel-title" /><span className="skeleton-block" /></div>)}
      </div>
    </section>
  );
}
