export function KpiCard({ label, value, change, trend = 'up', icon = '↗', accent = 'blue' }) {
  return (
    <div className="stat-card kpi-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${accent}`}>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-change">
        <span className={trend === 'down' ? 'downchange' : 'up'}>{change}</span>
      </div>
    </div>
  );
}
