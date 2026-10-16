import { useEffect, useState } from 'react';

export function MerchantQrDialog({ merchant, onClose, onGeneratePortalPin }) {
  const [QrCode, setQrCode] = useState(null);
  // El PIN del portal solo existe en esta ventana: se imprime en el carnet y no se vuelve a mostrar.
  const [portalPin, setPortalPin] = useState(null);
  const [pinStatus, setPinStatus] = useState({ loading: false, error: '' });
  const qrValue = merchant.qr_code || `SISREC://comerciante/${merchant.id}`;

  useEffect(() => {
    let active = true;
    import('qrcode.react').then(({ QRCodeSVG }) => {
      if (active) setQrCode(() => QRCodeSVG);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const generatePin = async () => {
    if (portalPin && !window.confirm('¿Generar otro PIN? El que acaba de imprimir dejará de servir.')) return;
    setPinStatus({ loading: true, error: '' });
    try {
      const result = await onGeneratePortalPin(merchant.id);
      setPortalPin(result.pin);
      setPinStatus({ loading: false, error: '' });
    } catch (error) {
      setPinStatus({ loading: false, error: error.message });
    }
  };

  return (
    <div className="merchant-qr-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="merchant-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="merchant-qr-heading">
        <div className="merchant-qr-heading">
          <div>
            <span className="eyebrow">IDENTIFICACIÓN DE COMERCIANTE</span>
            <h2 id="merchant-qr-heading">Código QR</h2>
          </div>
          <button className="merchant-qr-close" type="button" onClick={onClose} aria-label="Cerrar código QR">×</button>
        </div>
        <div className="merchant-qr-print-area">
          {QrCode ? <QrCode value={qrValue} size={240} level="H" marginSize={3} title={`QR de ${merchant.nombre}`} /> : <div className="qr-code-loading" role="status">Generando código…</div>}
          <strong>{merchant.nombre}</strong>
          <span>{merchant.codigo}</span>
          <code>{qrValue}</code>
          {portalPin && <div className="merchant-qr-pin"><span>PIN del portal</span><strong>{portalPin}</strong></div>}
        </div>
        {onGeneratePortalPin && (
          <div className="merchant-qr-pin-panel">
            <p>{portalPin
              ? 'Imprima el carnet ahora: el PIN no se vuelve a mostrar. Generar otro invalida este.'
              : 'Con su DNI o código y este PIN, el comerciante consulta su deuda en el portal. Generar uno nuevo invalida el anterior.'}</p>
            <button type="button" className="secondary-button" onClick={generatePin} disabled={pinStatus.loading}>
              {pinStatus.loading ? 'Generando…' : portalPin ? 'Generar otro PIN' : 'Generar PIN del portal'}
            </button>
            {pinStatus.error && <div className="form-error" role="alert">{pinStatus.error}</div>}
          </div>
        )}
        <p className="merchant-qr-note">Este QR lleva el código del comerciante: correlativo, iniciales, rubro, los 3 últimos dígitos del DNI/RUC, zona, estado y fecha de registro.</p>
        <div className="merchant-qr-actions">
          <button type="button" className="secondary-button" onClick={() => window.print()}>Imprimir</button>
          <button type="button" className="primary-button" onClick={onClose}>Cerrar</button>
        </div>
      </section>
    </div>
  );
}
