import { useEffect, useRef, useState } from 'react';

const scannerElementId = 'sisrec-qr-reader';

export function QrScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const closeButtonRef = useRef(null);
  const timeoutRef = useRef(null);
  const handledRef = useRef(false);
  const [status, setStatus] = useState('Solicitando acceso a la cámara...');
  const [error, setError] = useState('');
  const [canUseFlash, setCanUseFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  useEffect(() => {
    let mounted = true;
    let scanner = null;
    const previousFocus = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();

    const stopScanner = async () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      try {
        if (scanner?.isScanning) await scanner.stop();
      } catch {
        // The scanner may already have been stopped after a successful read.
      }
      try {
        scanner.clear();
      } catch {
        // The scanner element may already have been removed during unmount.
      }
      scannerRef.current = null;
    };

    const onSuccess = async (decodedText) => {
      if (handledRef.current) return;
      handledRef.current = true;
      setStatus('Código detectado. Buscando comerciante...');
      await stopScanner();
      if (mounted) onScanRef.current(decodedText);
    };

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (!mounted) return;
        scanner = new Html5Qrcode(scannerElementId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
          onSuccess,
          () => undefined
        );
        if (!mounted) {
          await stopScanner();
          return;
        }
        setStatus('Apunta el código QR del comerciante');
        const torch = scanner.getRunningTrackCameraCapabilities?.().torchFeature?.();
        setCanUseFlash(Boolean(torch?.isSupported?.()));
      } catch (cameraError) {
        if (mounted) {
          setError(cameraError?.message || 'No se pudo iniciar la cámara. Revisa los permisos del navegador.');
          setStatus('');
        }
      }
    };

    timeoutRef.current = window.setTimeout(() => {
      if (!handledRef.current && mounted) {
        setStatus('');
        setError('No se detectó un QR en 10 segundos. Puedes cerrar y buscar manualmente.');
      }
    }, 10000);
    startScanner();
    return () => {
      mounted = false;
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      stopScanner();
    };
  }, []);

  const toggleFlash = async () => {
    const scanner = scannerRef.current;
    try {
      await scanner?.applyVideoConstraints({ advanced: [{ torch: !flashOn }] });
      setFlashOn((current) => !current);
    } catch {
      setError('La cámara no pudo cambiar el estado del flash.');
    }
  };

  return (
    <div className="qr-scanner-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="qr-scanner-modal" role="dialog" aria-modal="true" aria-labelledby="qr-scanner-title">
        <div className="qr-scanner-heading">
          <div>
            <span className="eyebrow">COBRO EN CAMPO</span>
            <h2 id="qr-scanner-title">Escanear QR</h2>
          </div>
          <button ref={closeButtonRef} className="qr-scanner-close-icon" type="button" onClick={onClose} aria-label="Cerrar escáner">×</button>
        </div>

        <p className="qr-scanner-instruction">Apunta el código QR del comerciante</p>
        <div className="qr-camera-frame">
          <div id={scannerElementId} />
          <span className="qr-guide" aria-hidden="true" />
        </div>
        {status && <p className="qr-scanner-status" role="status" aria-live="polite">{status}</p>}
        {error && <p className="qr-scanner-error" role="alert">{error}</p>}

        <div className="qr-scanner-actions">
          {canUseFlash && <button type="button" className="secondary-button" onClick={toggleFlash}>{flashOn ? 'Apagar flash' : 'Encender flash'}</button>}
          <button type="button" className="primary-button" onClick={onClose}>Cerrar y buscar manualmente</button>
        </div>
      </section>
    </div>
  );
}
