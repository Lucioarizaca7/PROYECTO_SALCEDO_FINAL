// Recibo del cobro: huella corta, impresión térmica por Bluetooth (o print del navegador) y WhatsApp.

export async function createReceiptHash(payload) {
  const encoder = new TextEncoder();
  const source = `${payload.cobradorId}|${payload.comercianteId}|${payload.puestoId || ''}|${payload.fechaCobro}|${payload.monto}|${payload.codigoComprobante}|${payload.salt || Date.now()}`;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return Array.from(new Uint8Array(digest)).slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Impresión del navegador solo del recibo: se copia a #print-recibo, hijo directo de body, y el CSS de
// impresión (styles.css) oculta todo lo demás y usa el papel de 80 mm. Sirve también para "Guardar como PDF"
// en el celular. Al volver de la ventana de impresión se quita la copia.
export function imprimirReciboEnNavegador() {
  const original = document.getElementById('receiptCard');
  if (!original) { window.print(); return; }
  document.getElementById('print-recibo')?.remove();
  const contenedor = document.createElement('div');
  contenedor.id = 'print-recibo';
  const copia = original.cloneNode(true);
  copia.removeAttribute('id');
  contenedor.appendChild(copia);
  document.body.appendChild(contenedor);
  document.body.classList.add('print-recibo');
  const limpiar = () => {
    document.body.classList.remove('print-recibo');
    contenedor.remove();
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  window.print();
  // Algunos navegadores del celular no disparan afterprint: se limpia igual al rato.
  setTimeout(() => { if (document.body.contains(contenedor)) limpiar(); }, 60000);
}

// Sin impresora Bluetooth (o si falla) se usa la impresión del navegador; el recibo queda en la cola de impresión.
export async function printThermalReceipt(receipt, setPrintStatus = () => {}) {
  if (!receipt) return;

  if (!('bluetooth' in navigator)) {
    imprimirReciboEnNavegador();
    return;
  }

  setPrintStatus({ isPrinting: true, error: null });

  try {
    const { getBluetoothPrinter } = await import('../../utils/bluetoothPrint');
    const printer = getBluetoothPrinter();

    // Primero con la impresora ya emparejada; si no hay, se pide elegir una.
    if (!(await printer.initialize())) await printer.requestDevice();
    await printer.printReceiptWithQueue(receipt);

    setTimeout(() => setPrintStatus({ isPrinting: false, error: null }), 1500);
  } catch (error) {
    console.warn('Bluetooth printing failed:', error);
    setPrintStatus({ isPrinting: false, error: error.message });
    imprimirReciboEnNavegador();
  }
}

// Web Share API si existe; si no, o si falla, wa.me.
export function shareViaWhatsApp(receipt) {
  if (!receipt) return;

  const mensaje = `Recibo ${receipt.comprobante} SISREC Salcedo - S/ ${receipt.monto.toFixed(2)}`;
  const openWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');

  if (navigator.share) {
    navigator.share({ title: `Recibo ${receipt.comprobante}`, text: mensaje }).catch(openWhatsApp);
  } else {
    openWhatsApp();
  }
}
