import { useCallback, useEffect, useState } from 'react';

// El QR del reverso abre el portal con la llave en el fragmento (#), que el navegador no envía al servidor.
const portalLink = (llave) => `${window.location.origin}${window.location.pathname}#portal?llave=${llave.replace(/-/g, '')}`;

const formatDate = (value) => (value ? new Date(value.replace(' ', 'T')).toLocaleDateString('es-PE') : '');

export function MerchantCardDialog({ merchants, onIssue, onClose }) {
  const [QrCode, setQrCode] = useState(null);
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const replacing = merchants.filter((item) => item.tiene_llave);
  const batch = merchants.length > 1;

  useEffect(() => {
    let active = true;
    import('qrcode.react').then(({ QRCodeSVG }) => {
      if (active) setQrCode(() => QRCodeSVG);
    });
    return () => { active = false; };
  }, []);

  // La llave solo existe en esta pantalla: antes de cerrarla se confirma que ya se imprimió.
  const handleClose = useCallback(() => {
    if (issued && !window.confirm('La llave no se volverá a mostrar. ¿Ya imprimió o entregó el carnet?')) return;
    onClose();
  }, [issued, onClose]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleIssue = async () => {
    setBusy(true);
    setError('');
    try {
      setIssued(await onIssue(merchants.map((item) => item.id)));
    } catch (issueError) {
      setError(issueError.message || 'No se pudo emitir el carnet');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="merchant-qr-backdrop merchant-card-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <section className="merchant-qr-dialog merchant-card-dialog" role="dialog" aria-modal="true" aria-labelledby="merchant-card-heading">
        <div className="merchant-qr-heading">
          <div>
            <span className="eyebrow">PORTAL DEL COMERCIANTE</span>
            <h2 id="merchant-card-heading">{batch ? `Emitir ${merchants.length} carnets` : 'Emitir carnet'}</h2>
          </div>
          <button className="merchant-qr-close" type="button" onClick={handleClose} aria-label="Cerrar">×</button>
        </div>

        {!issued ? (
          <>
            <p className="merchant-card-intro">
              El carnet lleva al frente el QR que escanea el cobrador y al reverso la llave con la que el comerciante consulta sus pagos desde su celular.
            </p>
            <ul className="merchant-card-list">
              {merchants.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <strong>{item.codigo}</strong> {item.nombre}
                  {item.tiene_llave && <span> · carnet del {formatDate(item.llave_emitida_en)}</span>}
                </li>
              ))}
              {merchants.length > 6 && <li>y {merchants.length - 6} más</li>}
            </ul>
            {replacing.length > 0 && (
              <div className="merchant-card-warning" role="alert">
                {replacing.length === 1 && !batch
                  ? 'Este comerciante ya tiene carnet: el anterior dejará de funcionar y su sesión en el celular se cerrará.'
                  : `${replacing.length} ya tienen carnet: los anteriores dejarán de funcionar y sus sesiones se cerrarán.`}
              </div>
            )}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="merchant-qr-actions">
              <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
              <button type="button" className="primary-button" disabled={busy} onClick={handleIssue}>
                {busy ? 'Emitiendo…' : replacing.length ? 'Emitir carnet nuevo' : 'Emitir carnet'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="merchant-card-warning" role="status">
              Imprima o entregue {issued.length > 1 ? 'los carnets' : 'el carnet'} ahora: la llave no se volverá a mostrar.
            </div>
            <div className="merchant-card-sheet">
              {issued.map((card) => (
                <article className="merchant-card" key={card.id} aria-label={`Carnet de ${card.nombre}`}>
                  <div className="merchant-card-face">
                    <span className="merchant-card-brand">SISREC Salcedo · Comerciante</span>
                    {QrCode ? <QrCode value={`SISREC://comerciante/${card.id}`} size={112} level="M" marginSize={1} title={`QR de identificación de ${card.nombre}`} /> : <span className="merchant-card-qr-loading">…</span>}
                    <strong>{card.nombre}</strong>
                    <span>{card.codigo}</span>
                    <small>Muestre este lado al cobrador</small>
                  </div>
                  <div className="merchant-card-face merchant-card-back">
                    <span className="merchant-card-brand">Portal del comerciante</span>
                    {QrCode ? <QrCode value={portalLink(card.llave)} size={112} level="M" marginSize={1} title={`QR de acceso al portal de ${card.nombre}`} /> : <span className="merchant-card-qr-loading">…</span>}
                    <span>Llave de acceso</span>
                    <code className="merchant-card-key">{card.llave}</code>
                    <small>Escanee para ver sus pagos. No muestre este lado.</small>
                  </div>
                </article>
              ))}
            </div>
            <div className="merchant-qr-actions">
              <button type="button" className="secondary-button" onClick={() => window.print()}>Imprimir</button>
              <button type="button" className="primary-button" onClick={handleClose}>Listo</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
