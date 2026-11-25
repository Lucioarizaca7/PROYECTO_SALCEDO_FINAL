import { useState } from 'react';
import { marcasEje } from '../../lib/graficos';
import './graficos.css';

// Gráficos del panel (24/11/2026), sin librerías: marcas finas, una sola serie por gráfico (sin leyenda, el título
// la nombra) salvo la barra apilada, que lleva leyenda con nombre y cantidad. Cada marca muestra su detalle al pasar
// el mouse o al enfocarla con el teclado, y cada gráfico tiene su tabla en «Ver datos».

function Tooltip({ punto }) {
  if (!punto) return null;
  return (
    <div className="grafico-tooltip" role="status" style={{ left: `${punto.x}%`, top: `${punto.y}%` }}>
      <strong>{punto.titulo}</strong>
      {punto.lineas.map((linea) => <span key={linea}>{linea}</span>)}
    </div>
  );
}

function TablaDatos({ columnas, filas }) {
  return (
    <details className="grafico-tabla">
      <summary>Ver datos</summary>
      <table>
        <thead><tr>{columnas.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{filas.map((fila) => <tr key={fila[0]}>{fila.map((celda, i) => <td key={i}>{celda}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

const ANCHO = 640;
const ALTO = 220;
const MARGEN = { arriba: 18, derecha: 8, abajo: 26, izquierda: 46 };

// Columna anclada a la base con la punta redondeada (4 px).
function columna(x0, base, alto, grosor) {
  const r = Math.min(4, alto, grosor / 2);
  return `M${x0},${base} V${base - alto + r} Q${x0},${base - alto} ${x0 + r},${base - alto} H${x0 + grosor - r} Q${x0 + grosor},${base - alto} ${x0 + grosor},${base - alto + r} V${base} Z`;
}

/** Columnas: lo recaudado cada día del mes. dias: [{ dia, numero, valor, pagos }] (diasDelPeriodo). */
export function ColumnasPorDia({ dias, formato, titulo }) {
  const [activo, setActivo] = useState(null);
  const maximo = Math.max(0, ...dias.map((d) => d.valor));
  const marcas = marcasEje(maximo);
  const tope = marcas[marcas.length - 1];
  const anchoUtil = ANCHO - MARGEN.izquierda - MARGEN.derecha;
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo;
  const banda = anchoUtil / Math.max(dias.length, 1);
  const grosor = Math.min(24, banda * 0.62);
  const y = (valor) => MARGEN.arriba + altoUtil * (1 - valor / tope);
  const base = y(0);
  const mayor = dias.reduce((m, d) => (d.valor > (m?.valor ?? 0) ? d : m), null);
  const etiquetaX = (n) => n === 1 || n % 5 === 0 || n === dias.length;
  const punto = activo === null ? null : (() => {
    const d = dias[activo];
    return {
      x: ((MARGEN.izquierda + banda * (activo + 0.5)) / ANCHO) * 100,
      y: (y(d.valor) / ALTO) * 100,
      titulo: `Día ${d.numero}`,
      lineas: [formato(d.valor), `${d.pagos} ${d.pagos === 1 ? 'pago' : 'pagos'}`]
    };
  })();

  return (
    <div className="grafico">
      <div className="grafico-lienzo">
        <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={titulo}>
          {marcas.map((m) => (
            <g key={m}>
              <line className="grafico-grilla" x1={MARGEN.izquierda} x2={ANCHO - MARGEN.derecha} y1={y(m)} y2={y(m)} />
              <text className="grafico-eje" x={MARGEN.izquierda - 8} y={y(m) + 4} textAnchor="end">{m}</text>
            </g>
          ))}
          {dias.map((d, i) => {
            const cx = MARGEN.izquierda + banda * (i + 0.5);
            const alto = Math.max(base - y(d.valor), 0);
            const x0 = cx - grosor / 2;
            return (
              <g key={d.dia}>
                {alto > 0 && (
                  <path className={`grafico-columna${activo === i ? ' activa' : ''}`} d={columna(x0, base, alto, grosor)} />
                )}
                {etiquetaX(d.numero) && <text className="grafico-eje" x={cx} y={ALTO - 8} textAnchor="middle">{d.numero}</text>}
                {/* Zona de toque de toda la banda: más grande que la columna. */}
                <rect
                  className="grafico-toque" x={MARGEN.izquierda + banda * i} y={MARGEN.arriba} width={banda} height={altoUtil}
                  tabIndex={0} aria-label={`Día ${d.numero}: ${formato(d.valor)}`}
                  onMouseEnter={() => setActivo(i)} onMouseLeave={() => setActivo(null)}
                  onFocus={() => setActivo(i)} onBlur={() => setActivo(null)}
                />
              </g>
            );
          })}
          {mayor && mayor.valor > 0 && (
            <text className="grafico-valor" x={MARGEN.izquierda + banda * (mayor.numero - 0.5)} y={y(mayor.valor) - 6} textAnchor="middle">
              {formato(mayor.valor)}
            </text>
          )}
          <line className="grafico-base" x1={MARGEN.izquierda} x2={ANCHO - MARGEN.derecha} y1={base} y2={base} />
        </svg>
        <Tooltip punto={punto} />
      </div>
      <TablaDatos columnas={['Día', 'Recaudado', 'Pagos']} filas={dias.filter((d) => d.valor > 0).map((d) => [d.dia, formato(d.valor), d.pagos])} />
    </div>
  );
}

/**
 * Meses cobrados y proyectados (Analítica). meses: mesesDeProyeccion(). Lo cobrado va en columnas llenas; lo
 * proyectado, en columnas claras con borde punteado y su margen de error (±MAPE) como bigote. En el mes en
 * curso, lo cobrado hasta hoy se ve dentro de la columna proyectada.
 */
export function ColumnasMensuales({ meses, formato, titulo }) {
  const [activo, setActivo] = useState(null);
  if (!meses.length) return <div className="empty-state">Aún no hay cobros para proyectar.</div>;
  const alto0 = 240;
  const margen = { ...MARGEN, arriba: 28 };
  // Lo más alto del mes (columna, margen o lo cobrado hasta hoy): fija la escala y ahí van la etiqueta y el detalle.
  const cima = (m) => Math.max(m.valor, m.maximo || 0, m.enCurso || 0);
  const maximo = Math.max(0, ...meses.map(cima));
  const marcas = marcasEje(maximo);
  const tope = marcas[marcas.length - 1];
  const anchoUtil = ANCHO - margen.izquierda - margen.derecha;
  const altoUtil = alto0 - margen.arriba - margen.abajo;
  const banda = anchoUtil / meses.length;
  const grosor = Math.min(34, banda * 0.56);
  const y = (valor) => margen.arriba + altoUtil * (1 - valor / tope);
  const base = y(0);
  const centro = (i) => margen.izquierda + banda * (i + 0.5);
  const primerProyectado = meses.findIndex((m) => m.tipo === 'proyectado');
  const conMargen = (m) => m.minimo !== null && m.minimo !== undefined;
  // Etiqueta directa solo en dos marcas: el último mes cobrado y el primero proyectado.
  const rotulados = new Set([primerProyectado - 1, primerProyectado].filter((i) => i >= 0));
  const lineas = (m) => [
    `${m.tipo === 'cobrado' ? 'Cobrado' : 'Proyectado'}: ${formato(m.valor)}`,
    ...(conMargen(m) ? [`Entre ${formato(m.minimo)} y ${formato(m.maximo)}`] : []),
    ...(m.enCurso !== null && m.enCurso !== undefined ? [`Cobrado hasta hoy: ${formato(m.enCurso)}`] : [])
  ];
  const punto = activo === null ? null : {
    x: (centro(activo) / ANCHO) * 100,
    y: (y(cima(meses[activo])) / alto0) * 100,
    titulo: meses[activo].etiqueta,
    lineas: lineas(meses[activo])
  };

  return (
    <div className="grafico">
      <ul className="grafico-leyenda grafico-leyenda-fila">
        <li><i className="muestra-cobrado" aria-hidden="true" /><span>Cobrado</span></li>
        {primerProyectado >= 0 && <li><i className="muestra-proyectado" aria-hidden="true" /><span>Proyectado</span></li>}
        {meses.some(conMargen) && <li><i className="muestra-margen" aria-hidden="true" /><span>Margen de error del modelo</span></li>}
      </ul>
      <div className="grafico-lienzo">
        <svg viewBox={`0 0 ${ANCHO} ${alto0}`} role="img" aria-label={titulo}>
          {marcas.map((m) => (
            <g key={m}>
              <line className="grafico-grilla" x1={margen.izquierda} x2={ANCHO - margen.derecha} y1={y(m)} y2={y(m)} />
              <text className="grafico-eje" x={margen.izquierda - 8} y={y(m) + 4} textAnchor="end">{m}</text>
            </g>
          ))}
          {primerProyectado > 0 && (
            <g>
              <line className="grafico-corte" x1={margen.izquierda + banda * primerProyectado} x2={margen.izquierda + banda * primerProyectado} y1={margen.arriba - 16} y2={base} />
              <text className="grafico-eje" x={margen.izquierda + banda * primerProyectado + 6} y={margen.arriba - 8}>Proyección</text>
            </g>
          )}
          {meses.map((m, i) => {
            const cx = centro(i);
            const alto = Math.max(base - y(m.valor), 0);
            const clase = m.tipo === 'cobrado' ? 'grafico-columna' : 'grafico-columna-proyectada';
            return (
              <g key={m.periodo}>
                {alto > 0 && <path className={`${clase}${activo === i ? ' activa' : ''}`} d={columna(cx - grosor / 2, base, alto, grosor)} />}
                {m.enCurso > 0 && <path className="grafico-columna" d={columna(cx - grosor / 4, base, Math.max(base - y(m.enCurso), 0), grosor / 2)} />}
                {conMargen(m) && m.maximo > 0 && (
                  <g className="grafico-bigote">
                    <line x1={cx} x2={cx} y1={y(m.maximo)} y2={y(m.minimo)} />
                    <line x1={cx - 5} x2={cx + 5} y1={y(m.maximo)} y2={y(m.maximo)} />
                    <line x1={cx - 5} x2={cx + 5} y1={y(m.minimo)} y2={y(m.minimo)} />
                  </g>
                )}
                {rotulados.has(i) && m.valor > 0 && (
                  <text className="grafico-valor" x={cx} y={y(cima(m)) - 7} textAnchor="middle">
                    {m.enCurso > 0 ? `${formato(m.enCurso)} de ${formato(m.valor)}` : formato(m.valor)}
                  </text>
                )}
                <text className="grafico-eje" x={cx} y={alto0 - 8} textAnchor="middle">{m.etiqueta}</text>
                <rect
                  className="grafico-toque" x={margen.izquierda + banda * i} y={margen.arriba} width={banda} height={altoUtil}
                  tabIndex={0} aria-label={`${m.etiqueta}. ${lineas(m).join('. ')}`}
                  onMouseEnter={() => setActivo(i)} onMouseLeave={() => setActivo(null)}
                  onFocus={() => setActivo(i)} onBlur={() => setActivo(null)}
                />
              </g>
            );
          })}
          <line className="grafico-base" x1={margen.izquierda} x2={ANCHO - margen.derecha} y1={base} y2={base} />
        </svg>
        <Tooltip punto={punto} />
      </div>
      <TablaDatos
        columnas={['Mes', 'Tipo', 'Monto', 'Margen']}
        filas={meses.map((m) => [m.etiqueta, m.tipo === 'cobrado' ? 'Cobrado' : 'Proyectado', formato(m.valor),
          conMargen(m) ? `${formato(m.minimo)} – ${formato(m.maximo)}` : '—'])}
      />
    </div>
  );
}

/** Barras horizontales de una serie. filas: [{ clave, etiqueta, valor, detalle: [texto], color? }]. */
export function BarrasHorizontales({ filas, formato, vacio, columnas, maximo: escala }) {
  const [activo, setActivo] = useState(null);
  if (!filas.length) return <div className="empty-state">{vacio}</div>;
  // Con `maximo` fijo (un puntaje de 0 a 100) la barra mide contra esa escala y no contra la fila mayor.
  const maximo = escala || Math.max(...filas.map((f) => f.valor), 0) || 1;
  return (
    <div className="grafico">
      <ul className="grafico-barras">
        {filas.map((fila) => (
          <li
            key={fila.clave} className={activo === fila.clave ? 'activa' : ''} tabIndex={0}
            aria-label={`${fila.etiqueta}: ${formato(fila.valor)}. ${(fila.detalle || []).join('. ')}`}
            onMouseEnter={() => setActivo(fila.clave)} onMouseLeave={() => setActivo(null)}
            onFocus={() => setActivo(fila.clave)} onBlur={() => setActivo(null)}
          >
            <span className="grafico-barra-etiqueta">{fila.etiqueta}</span>
            <span className="grafico-barra-pista">
              <span className="grafico-barra" style={{ width: `${(fila.valor / maximo) * 100}%`, ...(fila.color ? { background: fila.color } : {}) }} />
            </span>
            <strong className="grafico-barra-valor">{formato(fila.valor)}</strong>
            {activo === fila.clave && fila.detalle?.length > 0 && (
              <span className="grafico-tooltip grafico-tooltip-fila" role="status">
                <strong>{fila.etiqueta}</strong>
                {fila.detalle.map((linea) => <span key={linea}>{linea}</span>)}
              </span>
            )}
          </li>
        ))}
      </ul>
      <TablaDatos columnas={columnas} filas={filas.map((f) => [f.etiqueta, formato(f.valor), ...(f.detalle || [])])} />
    </div>
  );
}

/** Barra apilada al 100 % con leyenda. segmentos: [{ clave, etiqueta, valor, color }]. */
export function BarraApilada({ segmentos, unidad, vacio }) {
  const [activo, setActivo] = useState(null);
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  if (!total) return <div className="empty-state">{vacio}</div>;
  const pct = (v) => (v > 0 && v / total < 0.005 ? '< 1 %' : `${Math.round((v / total) * 100)} %`);
  const visibles = segmentos.filter((s) => s.valor > 0);
  return (
    <div className="grafico">
      <div className="grafico-apilada" role="img" aria-label={visibles.map((s) => `${s.etiqueta}: ${s.valor} ${unidad}`).join(', ')}>
        {visibles.map((s) => (
          <span
            key={s.clave} className={`grafico-segmento${activo === s.clave ? ' activo' : ''}`}
            style={{ flexGrow: s.valor, background: s.color }}
            onMouseEnter={() => setActivo(s.clave)} onMouseLeave={() => setActivo(null)}
          />
        ))}
      </div>
      <ul className="grafico-leyenda">
        {segmentos.map((s) => (
          <li
            key={s.clave} className={activo === s.clave ? 'activa' : ''} tabIndex={0}
            onMouseEnter={() => setActivo(s.clave)} onMouseLeave={() => setActivo(null)}
            onFocus={() => setActivo(s.clave)} onBlur={() => setActivo(null)}
          >
            <i style={{ background: s.color }} aria-hidden="true" />
            <span>{s.etiqueta}</span>
            <strong>{s.valor}</strong>
            <small>{pct(s.valor)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
