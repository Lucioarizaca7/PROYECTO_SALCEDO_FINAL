export function SyncStatusBadge({ isOnline, apiConnected = isOnline, pendingSyncCount = 0 }) {
  const isConnected = isOnline && apiConnected;
  const statusLabel = !isOnline
    ? 'Sin señal · guardando en el celular'
    : !apiConnected
      ? 'API sin conexión'
      : pendingSyncCount > 0 ? 'Sincronizando cambios' : 'En línea';

  return (
    <div className={['sync-status-badge', !isConnected && 'sin-senal', isConnected && pendingSyncCount > 0 && 'syncing'].filter(Boolean).join(' ')} role="status" aria-live="polite">
      <span className={`sync-dot ${isConnected ? 'online' : 'offline'}`} />
      <span className="sync-label">{statusLabel}</span>

      {pendingSyncCount > 0 && (
        <span className="sync-pending">{pendingSyncCount} pendientes</span>
      )}
    </div>
  );
}
