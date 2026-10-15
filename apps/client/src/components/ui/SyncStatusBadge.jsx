export function SyncStatusBadge({ isOnline, apiConnected = isOnline, pendingSyncCount = 0 }) {
  const isConnected = isOnline && apiConnected;
  const statusLabel = !isOnline
    ? 'Modo local / IndexedDB'
    : !apiConnected
      ? 'API sin conexión'
      : pendingSyncCount > 0 ? 'Sincronizando cambios' : 'API conectada';

  return (
    <div className={`sync-status-badge ${isConnected && pendingSyncCount > 0 ? 'syncing' : ''}`} role="status" aria-live="polite">
      <span className={`sync-dot ${isConnected ? 'online' : 'offline'}`} />
      <span className="sync-label">{statusLabel}</span>

      {pendingSyncCount > 0 && (
        <span className="sync-pending">{pendingSyncCount} pendientes</span>
      )}
    </div>
  );
}
