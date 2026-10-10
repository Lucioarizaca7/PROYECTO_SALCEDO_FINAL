export function SyncStatusBadge({ isOnline, pendingSyncCount = 0 }) {
  const statusLabel = isOnline
    ? pendingSyncCount > 0 ? 'Sincronizando cambios' : 'Servidor conectado'
    : 'Modo local / IndexedDB';

  return (
    <div className={`sync-status-badge ${isOnline && pendingSyncCount > 0 ? 'syncing' : ''}`} role="status" aria-live="polite">
      <span className={`sync-dot ${isOnline ? 'online' : 'offline'}`} />
      <span className="sync-label">{statusLabel}</span>

      {pendingSyncCount > 0 && (
        <span className="sync-pending">{pendingSyncCount} pendientes</span>
      )}
    </div>
  );
}
