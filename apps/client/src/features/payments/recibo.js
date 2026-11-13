// Recibo del cobro: huella corta, PDF con la impresión del navegador y envío por WhatsApp.
import { fechaHoraEnLima, textoMetodo } from '../../lib/formato.js';
import { textoTicket } from '../../services/ticketsOffline.js';

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
  copia.querySelector('.receipt-actions')?.remove(); // los botones no se imprimen ni cuentan en el alto
  contenedor.appendChild(copia);
  document.body.appendChild(contenedor);
  document.body.classList.add('print-recibo');
  // Papel de la ticketera: 80 mm de ancho y el alto justo del recibo (Chrome no acepta "auto" en @page).
  // Se mide con el ancho de impresión (≈ 74 mm útiles = 280 px) y se pasa a milímetros (96 px = 25,4 mm).
  const MM_POR_PX = 25.4 / 96;
  copia.style.width = '280px';
  contenedor.style.display = 'block';
  const altoMm = Math.ceil(copia.getBoundingClientRect().height * MM_POR_PX) + 12;
  contenedor.style.display = '';
  copia.style.width = '';
  const papel = document.createElement('style');
  papel.textContent = `@page { size: 80mm ${Math.max(altoMm, 60)}mm; margin: 3mm; }`;
  document.head.appendChild(papel);
  const limpiar = () => {
    document.body.classList.remove('print-recibo');
    contenedor.remove();
    papel.remove();
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  window.print();
  // Algunos navegadores del celular no disparan afterprint: se limpia igual al rato.
  setTimeout(() => { if (document.body.contains(contenedor)) limpiar(); }, 60000);
}

// Recibo por WhatsApp (decisión del usuario, 12/11/2026): no se usa la impresora térmica. El recibo se comparte
// como imagen con ancho de celular; si el celular no puede compartir imágenes, va el texto completo por wa.me.
// El recibo no lleva el DNI (Ley 29733), igual que el de la pantalla.

/** Encabezado, filas (etiqueta, valor) y total del recibo: lo mismo que muestra la pantalla. */
export function lineasRecibo(receipt) {
  const filas = [
    ['Comerciante', receipt.comerciante || 'Comerciante'],
    ['Fecha', fechaHoraEnLima(receipt.fecha_cobro || receipt.fecha) || fechaHoraEnLima(new Date())],
    ['Concepto', receipt.concepto || 'Liquidación de deuda'],
    ...(receipt.periodo_aplicado ? [['Mes pagado', receipt.periodo_aplicado]] : []),
    ['Método', textoMetodo(receipt.metodo_pago)],
    ['Cobrador', receipt.cobrador || 'Cobrador'],
    // En efectivo no hay número de operación: el servidor guarda un código interno que no se muestra.
    ['Operación', receipt.metodo_pago !== 'efectivo' && receipt.codigo_operacion ? receipt.codigo_operacion : 'No aplica'],
    ...(receipt.tickets?.length ? [['Tickets', receipt.tickets.map((ticket) => ticket.texto || textoTicket(ticket.serie, ticket.numero)).join(', ')]] : []),
    ...(receipt.observaciones ? [['Nota', receipt.observaciones]] : []),
    // Huella interna del cobro, si la hay; la verificación pública es el QR y el enlace.
    ...(receipt.hash_idempotencia ? [['Huella', receipt.hash_idempotencia]] : [])
  ];
  return {
    titulo: 'SISREC SALCEDO',
    subtitulo: 'RECIBO DE PAGO',
    numero: receipt.comprobante,
    aviso: receipt.estado === 'anulado'
      ? `RECIBO ANULADO${receipt.motivo_anulacion ? `: ${receipt.motivo_anulacion}` : ''}`
      : receipt.provisional ? 'Recibo provisional: el número oficial se asigna al sincronizar.' : null,
    filas,
    total: `S/ ${Number(receipt.monto || 0).toFixed(2)}`,
    // Enlace y QR de verificación (12/11/2026): cualquiera comprueba número, monto y estado (y si se anuló). El
    // provisional sin señal no los tiene: el número oficial existe recién al sincronizar.
    verificacion: !receipt.provisional && receipt.url_verificacion ? receipt.url_verificacion : null,
    qr: !receipt.provisional && receipt.qr_verificacion ? receipt.qr_verificacion : null
  };
}

/** El recibo en texto para WhatsApp (negritas con *). */
export function textoRecibo(receipt) {
  const recibo = lineasRecibo(receipt);
  return [
    `*${recibo.titulo}*`,
    `${recibo.subtitulo} *${recibo.numero}*`,
    ...(recibo.aviso ? [`_${recibo.aviso}_`] : []),
    '',
    ...recibo.filas.map(([etiqueta, valor]) => `${etiqueta}: ${valor}`),
    '',
    `*Total pagado: ${recibo.total}*`,
    ...(recibo.verificacion ? ['', `Verifique este recibo: ${recibo.verificacion}`] : [])
  ].join('\n');
}

// Parte un texto en renglones que caben en el ancho (medido con el contexto del canvas).
function renglones(contexto, texto, ancho) {
  const palabras = String(texto).split(/\s+/);
  const salida = [];
  let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (contexto.measureText(prueba).width <= ancho || !actual) actual = prueba;
    else { salida.push(actual); actual = palabra; }
  }
  if (actual) salida.push(actual);
  return salida;
}

/**
 * Imagen PNG del recibo con ancho de celular: 360 px de pantalla, dibujada al doble para que se lea nítida en
 * WhatsApp. Sin librerías: un canvas con el mismo contenido que lineasRecibo.
 */
export async function reciboComoImagen(receipt, { ancho = 360, escala = 2 } = {}) {
  const recibo = lineasRecibo(receipt);
  const margen = 20;
  const util = ancho - margen * 2;
  const lienzo = document.createElement('canvas');
  const contexto = lienzo.getContext('2d');
  const fuente = (peso, tamano) => `${peso} ${tamano}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  // Primero se mide (para el alto), luego se dibuja.
  contexto.font = fuente(400, 15);
  const filas = recibo.filas.map(([etiqueta, valor]) => ({ etiqueta, valor: renglones(contexto, valor, util * 0.6) }));
  const aviso = recibo.aviso ? renglones(contexto, recibo.aviso, util) : [];
  // El QR de verificación, si lo hay, se carga antes de medir.
  const qr = recibo.qr ? await new Promise((resolve) => {
    const imagen = new Image();
    imagen.onload = () => resolve(imagen);
    imagen.onerror = () => resolve(null);
    imagen.src = recibo.qr;
  }) : null;
  const LADO_QR = 120;
  // Encabezado (120) + aviso + cada fila (20 de separación + 20 por renglón) + recuadro del total (10 + 46 + 24)
  // + el QR con su leyenda.
  const alto = 120 + aviso.length * 20 + filas.reduce((total, fila) => total + 20 + Math.max(fila.valor.length, 1) * 20, 0) + 80
    + (qr ? LADO_QR + 40 : 0);

  lienzo.width = ancho * escala;
  lienzo.height = alto * escala;
  contexto.scale(escala, escala);
  contexto.fillStyle = '#ffffff';
  contexto.fillRect(0, 0, ancho, alto);
  contexto.fillStyle = '#0f3d2e';
  contexto.fillRect(0, 0, ancho, 6);

  let y = 40;
  contexto.textAlign = 'center';
  contexto.fillStyle = '#0f3d2e';
  contexto.font = fuente(700, 20);
  contexto.fillText(recibo.titulo, ancho / 2, y);
  y += 24;
  contexto.fillStyle = '#4b5563';
  contexto.font = fuente(600, 13);
  contexto.fillText(recibo.subtitulo, ancho / 2, y);
  y += 34;
  contexto.fillStyle = '#111827';
  contexto.font = fuente(700, 24);
  contexto.fillText(recibo.numero || '', ancho / 2, y);
  y += 22;
  contexto.font = fuente(400, 13);
  contexto.fillStyle = '#b45309';
  for (const renglon of aviso) { contexto.fillText(renglon, ancho / 2, y); y += 20; }

  contexto.textAlign = 'left';
  for (const fila of filas) {
    contexto.strokeStyle = '#e5e7eb';
    contexto.beginPath(); contexto.moveTo(margen, y); contexto.lineTo(ancho - margen, y); contexto.stroke();
    y += 20;
    contexto.fillStyle = '#6b7280';
    contexto.font = fuente(400, 14);
    contexto.fillText(fila.etiqueta, margen, y);
    contexto.fillStyle = '#111827';
    contexto.font = fuente(600, 15);
    contexto.textAlign = 'right';
    fila.valor.forEach((renglon, indice) => contexto.fillText(renglon, ancho - margen, y + indice * 20));
    contexto.textAlign = 'left';
    y += Math.max(fila.valor.length, 1) * 20;
  }

  y += 10;
  contexto.fillStyle = '#ecfdf5';
  contexto.fillRect(margen, y, util, 46);
  contexto.fillStyle = '#0f3d2e';
  contexto.font = fuente(700, 16);
  contexto.fillText('Total pagado', margen + 12, y + 29);
  contexto.textAlign = 'right';
  contexto.font = fuente(800, 20);
  contexto.fillText(recibo.total, ancho - margen - 12, y + 30);

  if (qr) {
    const yQr = y + 46 + 20;
    // Sin suavizado: los módulos del QR quedan nítidos y la cámara lo lee mejor.
    contexto.imageSmoothingEnabled = false;
    contexto.drawImage(qr, (ancho - LADO_QR) / 2, yQr, LADO_QR, LADO_QR);
    contexto.textAlign = 'center';
    contexto.fillStyle = '#4b5563';
    contexto.font = fuente(400, 12);
    contexto.fillText('Escanee para verificar el recibo', ancho / 2, yQr + LADO_QR + 18);
  }

  return new Promise((resolve, reject) => lienzo.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen del recibo'))), 'image/png'));
}

/**
 * Comparte el recibo: como imagen si el celular puede compartir archivos (WhatsApp lo recibe como foto), y si no,
 * el texto completo por wa.me. Cancelar la hoja de compartir no abre nada más.
 */
export async function shareViaWhatsApp(receipt) {
  if (!receipt) return 'nada';
  const abrirTexto = () => { window.open(`https://wa.me/?text=${encodeURIComponent(textoRecibo(receipt))}`, '_blank'); return 'texto'; };
  try {
    const blob = await reciboComoImagen(receipt);
    const archivo = new File([blob], `recibo-${receipt.comprobante || 'sisrec'}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: `Recibo ${receipt.comprobante}`, text: `Recibo ${receipt.comprobante} · S/ ${Number(receipt.monto || 0).toFixed(2)}` });
      return 'imagen';
    }
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelado';
  }
  return abrirTexto();
}
