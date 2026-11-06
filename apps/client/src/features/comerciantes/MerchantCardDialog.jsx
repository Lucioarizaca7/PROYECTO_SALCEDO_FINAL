import { useCallback, useEffect, useState } from 'react';

// El QR del reverso abre el portal con la llave en el fragmento (#): el navegador no lo envía al
// servidor ni queda en sus registros. PortalPage lo lee, entra y lo borra de la barra de direcciones.
const enlacePortal = (llave) => `${window.location.origin}/portal#llave=${llave.replace(/-/g, '')}`;

// Carnet del comerciante (Penpot, pantalla "04 · Emitir carnet"): al frente el QR que escanea el
// cobrador, al reverso la llave del portal. La llave solo existe en esta ventana.
export function MerchantCardDialog({ merchants, onIssue, onClose }) {
  const [QrCode, setQrCode] = useState(null);
  const [emitidos, setEmitidos] = useState(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const conCarnet = merchants.filter((item) => item.carnet_emitido_en);
  const lote = merchants.length > 1;

  useEffect(() => {
    let active = true;
    import('qrcode.react').then(({ QRCodeSVG }) => {
      if (active) setQrCode(() => QRCodeSVG);
    });
    return () => { active = false; };
  }, []);

  const cerrar = useCallback(() => {
    if (emitidos && !window.confirm('La llave no se volverá a mostrar. ¿Ya imprimió o entregó el carnet?')) return;
    onClose();
  }, [emitidos, onClose]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') cerrar();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cerrar]);

  const emitir = async () => {
    setEnviando(true);
    setError('');
    try {
      setEmitidos(await onIssue(merchants.map((item) => item.id)));
    } catch (issueError) {
      setError(issueError.message || 'No se pudo emitir el carnet');
    } finally {
      setEnviando(false);
    }
  };

  const qr = (value, title) => (QrCode
    ? <QrCode value={value} size={116} level="M" marginSize={1} title={title} />
    : <span className="carnet-qr-cargando" role="status">…</span>);

  return (
    <div className="merchant-qr-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) cerrar(); }}>
      <section className="merchant-qr-dialog carnet-dialog" role="dialog" aria-modal="true" aria-labelledby="carnet-heading">
        <div className="merchant-qr-heading">
          <div>
            <span className="eyebrow">Portal del comerciante</span>
            <h2 id="carnet-heading">
              {emitidos
                ? (lote ? `${emitidos.length} carnets emitidos` : `Carnet emitido · ${emitidos[0].nombre}`)
                : (lote ? `Emitir ${merchants.length} carnets` : `Emitir carnet · ${merchants[0].nombre}`)}
            </h2>
          </div>
          <button className="merchant-qr-close" type="button" onClick={cerrar} aria-label="Cerrar">×</button>
        </div>

        {!emitidos ? (
          <>
            <p className="carnet-intro">
              Al frente va el QR que escanea el cobrador; al reverso, la llave con la que el comerciante consulta sus pagos y su deuda desde su celular. El PIN, si lo tiene, sigue sirviendo.
            </p>
            {lote && (
              <ul className="carnet-lista">
                {merchants.slice(0, 6).map((item) => <li key={item.id}><strong>{item.codigo}</strong> {item.nombre}</li>)}
                {merchants.length > 6 && <li>y {merchants.length - 6} más</li>}
              </ul>
            )}
            {conCarnet.length > 0 && (
              <div className="offline-banner" role="alert">
                {lote
                  ? `${conCarnet.length} ya tienen carnet: sus llaves anteriores dejarán de funcionar.`
                  : `Ya tiene un carnet del ${conCarnet[0].carnet_emitido_en}: su llave anterior dejará de funcionar.`}
              </div>
            )}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="merchant-qr-actions">
              <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
              <button type="button" className="primary-button" disabled={enviando} onClick={emitir}>
                {enviando ? 'Emitiendo…' : lote ? `Emitir ${merchants.length} carnets` : 'Emitir carnet'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="offline-banner" role="status">
              <strong>Imprima o entregue {emitidos.length > 1 ? 'los carnets' : 'el carnet'} ahora.</strong> La llave no se volverá a mostrar. Si se pierde, emita un carnet nuevo: el anterior deja de funcionar.
            </div>
            <div className="carnet-hoja">
              {emitidos.map((card) => (
                <article className="carnet" key={card.comerciante_id} aria-label={`Carnet de ${card.nombre}`}>
                  <div className="carnet-cara">
                    <div className="carnet-qr">
                      {qr(`SISREC://comerciante/${card.codigo}`, `QR de identificación de ${card.nombre}`)}
                      <small>Muestre este lado al cobrador</small>
                    </div>
                    <div className="carnet-datos">
                      <span className="carnet-marca"><span className="marca-logo" aria-hidden="true">S</span>SISREC Salcedo</span>
                      <span className="carnet-rotulo">Comerciante</span>
                      <strong>{card.nombre}</strong>
                      <span className="carnet-codigo">{card.codigo}</span>
                      <span className="carnet-puesto">{[card.puestos, card.zona].filter(Boolean).join(' · ')}</span>
                    </div>
                  </div>
                  <div className="carnet-cara carnet-reverso">
                    <div className="carnet-qr">{qr(enlacePortal(card.llave), `QR de acceso al portal de ${card.nombre}`)}</div>
                    <div className="carnet-datos">
                      <span className="carnet-rotulo carnet-rotulo-dorado">Portal del comerciante</span>
                      <span>Escanee para ver sus pagos y su deuda</span>
                      <span className="carnet-rotulo">Llave de acceso</span>
                      <code className="carnet-llave">{card.llave}</code>
                      <small className="carnet-aviso">No muestre este lado a nadie.</small>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="merchant-qr-actions">
              <button type="button" className="secondary-button" onClick={() => window.print()}>Imprimir carnet{emitidos.length > 1 ? 's' : ''}</button>
              <button type="button" className="primary-button" onClick={cerrar}>Listo, ya lo entregué</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
