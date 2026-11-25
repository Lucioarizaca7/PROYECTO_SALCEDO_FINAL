import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSisrec } from '../../app/SisrecContext';
import { fechaHoraEnLima, formatPEN } from '../../lib/formato';
import { textoTicket } from '../../services/ticketsOffline';
import './vista-impresion.css';

// Vista previa de impresión (24/11/2026): antes «Imprimir / PDF» abría el diálogo del navegador con la pantalla
// entera (filtros, botones, tabla ancha) y no se veía cómo iba a salir. Ahora se ve la hoja A4 tal como se imprime;
// «Imprimir» imprime solo esa hoja (o la guarda como PDF desde el mismo diálogo).
// Ancho de una hoja A4 en px de CSS (210 mm a 96 ppp). La hoja se dibuja siempre con ese ancho, como en papel, y en
// una ventana más angosta se reduce a escala: antes se encogía y la tabla se reacomodaba distinto a lo impreso.
const ANCHO_A4 = 794;
const MARGEN_LATERAL = 32;

export function VistaImpresion({ titulo, subtitulo, onCerrar, children }) {
  const { user } = useSisrec();
  const cerrarRef = useRef(null);
  const [escala, setEscala] = useState(1);

  useLayoutEffect(() => {
    const ajustar = () => setEscala(Math.min(1, (window.innerWidth - MARGEN_LATERAL) / ANCHO_A4));
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, []);

  useEffect(() => {
    document.body.classList.add('con-vista-impresion');
    cerrarRef.current?.focus();
    const alTeclear = (event) => { if (event.key === 'Escape') onCerrar(); };
    const alTerminar = () => document.body.classList.remove('imprimiendo-hoja');
    document.addEventListener('keydown', alTeclear);
    window.addEventListener('afterprint', alTerminar);
    return () => {
      document.body.classList.remove('con-vista-impresion', 'imprimiendo-hoja');
      document.removeEventListener('keydown', alTeclear);
      window.removeEventListener('afterprint', alTerminar);
    };
  }, [onCerrar]);

  const imprimir = () => {
    document.body.classList.add('imprimiendo-hoja');
    window.print();
  };

  return createPortal(
    <div className="vista-impresion" role="dialog" aria-modal="true" aria-label={`Vista previa: ${titulo}`}>
      <div className="vista-impresion-barra">
        <div>
          <strong>Vista previa de impresión</strong>
          <span>Así sale en papel A4. En el diálogo de impresión también puede elegir «Guardar como PDF».</span>
        </div>
        <div className="vista-impresion-acciones">
          <button type="button" className="secondary-button" ref={cerrarRef} onClick={onCerrar}>Cerrar</button>
          <button type="button" className="primary-button" onClick={imprimir}>Imprimir</button>
        </div>
      </div>
      <article className="hoja-impresion" style={{ '--escala-hoja': escala }}>
        <header className="hoja-encabezado">
          <div className="hoja-marca">
            <span className="hoja-logo" aria-hidden="true">S</span>
            <div>
              <strong>Municipalidad del Centro Poblado de Salcedo</strong>
              <span>Área de Rentas y Recaudación · Puno, Perú</span>
            </div>
          </div>
          <div className="hoja-emision">
            <span>Emitido: {fechaHoraEnLima(new Date().toISOString())}</span>
            <span>Por: {user?.nombre || 'Usuario'}</span>
          </div>
        </header>
        <h1 className="hoja-titulo">{titulo}</h1>
        {subtitulo && <p className="hoja-subtitulo">{subtitulo}</p>}
        {children}
        <footer className="hoja-pie">SISREC Salcedo · Documento generado por el sistema</footer>
      </article>
    </div>,
    document.body
  );
}

/** Cifras de resumen de la hoja: [{ etiqueta, valor, detalle? }]. */
export function ResumenHoja({ cifras }) {
  return (
    <dl className="hoja-resumen">
      {cifras.map((cifra) => (
        <div key={cifra.etiqueta}>
          <dt>{cifra.etiqueta}</dt>
          <dd>{cifra.valor}</dd>
          {cifra.detalle && <small>{cifra.detalle}</small>}
        </div>
      ))}
    </dl>
  );
}

const hora = (fecha) => String(fecha || '').slice(11, 16);
// 'AAAA-MM-DD HH:MM:SS' (hora de Lima) → '23/11/2026'.
const diaCorto = (fecha) => {
  const [anio, mes, dia] = String(fecha || '').slice(0, 10).split('-');
  return dia ? `${dia}/${mes}/${anio}` : '';
};

// Anchos fijos de las columnas (table-layout: fixed): antes el navegador los repartía según el contenido, la fecha
// se partía a mitad («2026-10- / 20») y cada reporte salía con otras columnas. Suman 100 %. Medidos a 10,5 px: la
// fecha, el recibo, «confirmado» y «S/ 1,234.00» caben en una línea con el 10 %; un ticket (S3-000123), con el 11 %.
const ANCHOS = {
  conFecha: ['10%', '21%', '12%', '16%', '10%', '11%', '10%', '10%'],
  conHora: ['7%', '24%', '12%', '16%', '10%', '11%', '10%', '10%']
};

/** Tabla de cobros para la hoja: confirmados, anulados y observados, con el total de los confirmados. */
export function TablaCobrosHoja({ filas, conFecha = true }) {
  const confirmadas = filas.filter((item) => item.estado === 'confirmado');
  const total = confirmadas.reduce((suma, item) => suma + Number(item.monto || 0), 0);
  if (!filas.length) return <p className="hoja-vacio">No hay cobros con estos filtros.</p>;
  return (
    <table className="hoja-tabla">
      <colgroup>{ANCHOS[conFecha ? 'conFecha' : 'conHora'].map((ancho, i) => <col key={i} style={{ width: ancho }} />)}</colgroup>
      <thead>
        <tr>
          <th>{conFecha ? 'Fecha' : 'Hora'}</th><th>Comerciante</th><th>Zona</th><th>Cobrador</th>
          <th>Recibo</th><th>Tickets</th><th>Estado</th><th className="num">Monto</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((item) => (
          <tr key={item.id} className={item.estado !== 'confirmado' ? 'hoja-fila-fuera' : undefined}>
            <td className="nowrap">{conFecha ? <>{diaCorto(item.fecha)}<small className="hoja-hora">{hora(item.fecha)}</small></> : hora(item.fecha)}</td>
            <td>{item.comerciante}</td><td>{item.zona || '—'}</td><td>{item.cobrador || '—'}</td>
            <td className="nowrap">{item.comprobante || '—'}</td>
            <td>
              {(item.tickets || []).length
                // La coma va fuera del ticket: ahí puede saltar de línea, nunca a mitad de «S3-000123».
                ? item.tickets.map((t, i) => <span key={`${t.serie}-${t.numero}`}>{i ? ', ' : ''}<span className="nowrap">{textoTicket(t.serie, t.numero)}</span></span>)
                : '—'}
            </td>
            <td>{item.estado}</td>
            <td className="num">{formatPEN(item.monto)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr><td colSpan={7}>Total cobrado ({confirmadas.length} {confirmadas.length === 1 ? 'cobro confirmado' : 'cobros confirmados'})</td><td className="num">{formatPEN(total)}</td></tr>
      </tfoot>
    </table>
  );
}

/** Líneas de firma al pie de la hoja. */
export function FirmasHoja({ firmas }) {
  return (
    <div className="hoja-firmas">
      {firmas.map((firma) => <div key={firma}><span />{firma}</div>)}
    </div>
  );
}
