import { useState } from 'react';
import { useDeuda } from '../hooks/useDeuda';
import { DIAS_PARA_RECLAMAR, ESTADOS_RECLAMO, TIPOS_RECLAMO, numeroAviso, primerDiaReclamable, puedeResolverAnulacion, textoAviso } from '../lib/deuda';
import { formatPEN, textoMetodo } from '../lib/formato';
import { hoyEnLima } from '../services/jornadaOffline';

const CLASE_RECLAMO = { pendiente: 'pending', procedente: 'paid', no_procedente: 'danger' };

// Busca a un comerciante por código, correlativo o DNI. Muestra a quién encontró antes de dejar escribir sobre él.
function BuscadorComerciante({ deuda, elegido, onElegir }) {
  const [texto, setTexto] = useState('');
  const buscar = async () => onElegir(await deuda.buscarComerciante(texto));
  return (
    <div className="merchant-form-grid">
      <input placeholder="Código, correlativo o DNI del comerciante" aria-label="Código, correlativo o DNI del comerciante" value={texto}
        onChange={(event) => setTexto(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); buscar(); } }} />
      <button className="secondary-button" type="button" onClick={buscar}>Buscar</button>
      {elegido && <span className="panel-subtitle">{elegido.nombre} ({elegido.codigo}) · debe {formatPEN(elegido.deuda?.deuda_total)}</span>}
    </div>
  );
}

// RN-38: la anulación de un cobro de otro día, o de una caja ya cerrada, la aprueba el otro super administrador.
function Anulaciones({ deuda }) {
  const resolver = (solicitud, decision) => {
    const texto = decision === 'aprobar'
      ? `¿Aprobar la anulación de ${solicitud.comprobante || `el cobro #${solicitud.transaccion_id}`} por ${formatPEN(solicitud.monto)}? Habrá que devolver el dinero si corresponde. Puede escribir una nota:`
      : `Motivo para rechazar la anulación de ${solicitud.comprobante || `el cobro #${solicitud.transaccion_id}`}:`;
    const nota = window.prompt(texto, '');
    if (nota === null) return;
    deuda.resolverAnulacion(solicitud, decision, nota);
  };
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Anulaciones por aprobar</div>
          <div className="panel-subtitle">Un cobro de otro día, o de una caja ya cerrada, no lo anula una sola persona: uno la pide y el otro super administrador la aprueba o la rechaza. Si no hay otro super administrador activo, la anula quien la pide y queda para la revisión mensual.</div>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>Cobro</th><th>Fecha</th><th>Comerciante</th><th>Cobrador</th><th>Monto</th><th>Motivo</th><th>La pidió</th>{deuda.puedeEscribir && <th>Acciones</th>}</tr></thead>
          <tbody>
            {deuda.anulaciones.map((solicitud) => (
              <tr key={solicitud.id}>
                <td>{solicitud.comprobante || `#${solicitud.transaccion_id}`}</td>
                <td>{solicitud.fecha_cobro}</td>
                <td>{solicitud.comerciante}</td>
                <td>{solicitud.cobrador || '—'}</td>
                <td>{formatPEN(solicitud.monto)} · {textoMetodo(solicitud.metodo_pago)}</td>
                <td>{solicitud.motivo}</td>
                <td>{solicitud.solicitado_por}<br /><small>{solicitud.solicitado_en}</small></td>
                {deuda.puedeEscribir && (
                  <td>
                    {puedeResolverAnulacion(solicitud, deuda.usuarioId) ? (
                      <>
                        <button type="button" className="table-action" disabled={deuda.ocupado} onClick={() => resolver(solicitud, 'aprobar')}>Aprobar</button>
                        <button type="button" className="table-action" disabled={deuda.ocupado} onClick={() => resolver(solicitud, 'rechazar')}>Rechazar</button>
                      </>
                    ) : <small>La pidió usted: la resuelve el otro super administrador.</small>}
                  </td>
                )}
              </tr>
            ))}
            {!deuda.anulaciones.length && <tr><td colSpan={deuda.puedeEscribir ? 8 : 7} className="empty-state">No hay anulaciones esperando aprobación.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// RN-53: aviso formal a quien debe un día cobrado desde hace 30 días o más.
// Anulaciones que hizo un único super administrador activo, sin segunda aprobación (decisión del 18/11/2026).
// Quedan señaladas hasta que otro super administrador las revise en la revisión mensual (RN-61).
function AnulacionesSinSegunda({ deuda }) {
  if (!deuda.sinSegunda.length) return null;
  const porRevisar = deuda.sinSegunda.filter((item) => !item.revisada_por).length;
  const revisar = (solicitud) => {
    const nota = window.prompt(`Revisión de la anulación de ${solicitud.comprobante || `el cobro #${solicitud.transaccion_id}`}. Puede escribir una nota:`, '');
    if (nota === null) return;
    deuda.revisarAnulacion(solicitud, nota);
  };
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Anuladas sin segunda aprobación · {porRevisar} por revisar</div>
          <div className="panel-subtitle">No había otro super administrador activo: las anuló una sola persona. Las revisa otro super administrador en la revisión mensual.</div>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>Cobro</th><th>Fecha</th><th>Comerciante</th><th>Monto</th><th>Motivo</th><th>La anuló</th><th>Revisión</th></tr></thead>
          <tbody>
            {deuda.sinSegunda.map((solicitud) => (
              <tr key={solicitud.id}>
                <td>{solicitud.comprobante || `#${solicitud.transaccion_id}`}</td>
                <td>{solicitud.fecha_cobro}</td>
                <td>{solicitud.comerciante}</td>
                <td>{formatPEN(solicitud.monto)}</td>
                <td>{solicitud.motivo}</td>
                <td>{solicitud.solicitado_por}<br /><small>{solicitud.resuelto_en}</small></td>
                <td>
                  {solicitud.revisada_por
                    ? <>{solicitud.revisada_por}<br /><small>{solicitud.revisada_en}{solicitud.revision ? ` · ${solicitud.revision}` : ''}</small></>
                    : deuda.puedeEscribir && puedeResolverAnulacion(solicitud, deuda.usuarioId)
                      ? <button type="button" className="table-action" disabled={deuda.ocupado} onClick={() => revisar(solicitud)}>Marcar revisada</button>
                      : <span className="status pending">Por revisar</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Avisos({ deuda }) {
  const { por_emitir: porEmitir, emitidos, dias_para_aviso: dias } = deuda.avisos;
  const emitir = (fila) => {
    const nota = window.prompt(`Registrar el aviso de deuda de ${fila.comerciante} por ${formatPEN(fila.deuda_total)}. Observaciones (cómo se entregó):`, '');
    if (nota === null) return;
    deuda.emitirAviso(fila.comerciante_id, nota);
  };
  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Avisos de deuda</div>
          <div className="panel-subtitle">Entra quien debe un día cobrado desde hace {dias} días o más. El sistema registra el aviso; la suspensión del puesto la decide la municipalidad.</div>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>Comerciante</th><th>Puesto</th><th>Debe</th><th>Impago desde</th><th>Días de atraso</th>{deuda.puedeEscribir && <th>Acciones</th>}</tr></thead>
          <tbody>
            {porEmitir.map((fila) => (
              <tr key={fila.comerciante_id}>
                <td>{fila.comerciante}<br /><small>{fila.comerciante_codigo}</small></td>
                <td>{fila.puesto || '—'}</td>
                <td>{formatPEN(fila.deuda_total)}</td>
                <td>{fila.dia_impago}</td>
                <td>{fila.dias_de_atraso}</td>
                {deuda.puedeEscribir && <td><button type="button" className="table-action" disabled={deuda.ocupado} onClick={() => emitir(fila)}>Registrar aviso</button></td>}
              </tr>
            ))}
            {!porEmitir.length && <tr><td colSpan={deuda.puedeEscribir ? 6 : 5} className="empty-state">{deuda.cargando ? 'Cargando…' : 'No hay avisos por emitir.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {emitidos.length > 0 && (
        <>
          <div className="panel-title" style={{ marginTop: '16px' }}>Avisos emitidos</div>
          {emitidos.map((aviso) => (
            <div className="form-message" key={aviso.id}>
              {textoAviso(aviso)} <small>Registró {aviso.emitido_por}{aviso.observaciones ? ` · ${aviso.observaciones}` : ''}</small>
              <button type="button" className="table-action" onClick={() => navigator.clipboard?.writeText(textoAviso(aviso))} aria-label={`Copiar el aviso ${numeroAviso(aviso.id)}`}>Copiar</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// RN-54: baja de deuda de meses pasados, solo con el número de la resolución.
function Bajas({ deuda }) {
  const [comerciante, setComerciante] = useState(null);
  const [formulario, setFormulario] = useState({ hasta_periodo: '', resolucion: '', motivo: '' });
  const vencidos = (comerciante?.deuda?.periodos || []).filter((item) => item.vencida);
  const hasta = formulario.hasta_periodo || vencidos[vencidos.length - 1]?.periodo || '';
  const total = vencidos.filter((item) => item.periodo <= hasta).reduce((suma, item) => suma + item.saldo, 0);
  const campo = (nombre) => (event) => setFormulario({ ...formulario, [nombre]: event.target.value });

  const enviar = async (event) => {
    event.preventDefault();
    if (!window.confirm(`¿Dar de baja ${formatPEN(total)} de deuda de ${comerciante.nombre}, hasta ${hasta}? No se puede deshacer.`)) return;
    if (await deuda.darDeBaja({ comerciante_id: comerciante.id, hasta_periodo: hasta, resolucion: formulario.resolucion, motivo: formulario.motivo })) {
      setComerciante(null);
      setFormulario({ hasta_periodo: '', resolucion: '', motivo: '' });
    }
  };

  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Baja de deuda antigua</div>
          <div className="panel-subtitle">Solo deuda de meses ya pasados y con el número de la resolución. Los días cobrados no se borran: la deuda queda en cero y la baja, registrada.</div>
        </div>
      </div>
      {deuda.puedeEscribir && (
        <form className="merchant-form" onSubmit={enviar}>
          <BuscadorComerciante deuda={deuda} elegido={comerciante} onElegir={setComerciante} />
          {comerciante && !vencidos.length && <p className="panel-subtitle">{comerciante.nombre} no tiene deuda de meses pasados.</p>}
          {comerciante && vencidos.length > 0 && (
            <div className="merchant-form-grid">
              <label>
                <span>Dar de baja hasta el mes</span>
                <select aria-label="Dar de baja hasta el mes" value={hasta} onChange={campo('hasta_periodo')}>
                  {vencidos.map((item) => <option key={item.periodo} value={item.periodo}>{item.periodo} · debe {formatPEN(item.saldo)}</option>)}
                </select>
              </label>
              <input required minLength={3} maxLength={80} placeholder="Número de la resolución" aria-label="Número de la resolución" value={formulario.resolucion} onChange={campo('resolucion')} />
              <input required minLength={5} maxLength={500} placeholder="Motivo de la baja" aria-label="Motivo de la baja" value={formulario.motivo} onChange={campo('motivo')} />
              <button className="primary-button" type="submit" disabled={deuda.ocupado}>Dar de baja {formatPEN(total)}</button>
            </div>
          )}
        </form>
      )}
      <div className="table-card">
        <table>
          <thead><tr><th>Comerciante</th><th>Mes</th><th>Monto</th><th>Resolución</th><th>Motivo</th><th>Registró</th></tr></thead>
          <tbody>
            {deuda.bajas.map((baja) => (
              <tr key={baja.id}>
                <td>{baja.comerciante}<br /><small>{baja.comerciante_codigo}</small></td>
                <td>{baja.periodo}</td>
                <td>{formatPEN(baja.monto)}</td>
                <td>{baja.resolucion}</td>
                <td>{baja.motivo}</td>
                <td>{baja.registrado_por}<br /><small>{baja.registrado_en}</small></td>
              </tr>
            ))}
            {!deuda.bajas.length && <tr><td colSpan="6" className="empty-state">No hay deuda dada de baja.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// RN-27: el comerciante reclama un día marcado hasta 7 días después; lo registra y resuelve el super administrador.
function Reclamos({ deuda }) {
  const hoy = hoyEnLima();
  const vacio = { fecha: hoy, tipo: 'no_asistio', detalle: '' };
  const [comerciante, setComerciante] = useState(null);
  const [formulario, setFormulario] = useState(vacio);
  const campo = (nombre) => (event) => setFormulario({ ...formulario, [nombre]: event.target.value });

  const enviar = async (event) => {
    event.preventDefault();
    if (await deuda.registrarReclamo({ comerciante_id: comerciante.id, ...formulario })) {
      setComerciante(null);
      setFormulario(vacio);
    }
  };
  const resolver = (reclamo, decision) => {
    const nota = window.prompt(`Reclamo de ${reclamo.comerciante} por el ${reclamo.fecha}: explique por qué es ${decision === 'procedente' ? 'procedente' : 'no procedente'}.`, '');
    if (nota === null) return;
    deuda.resolverReclamo(reclamo, decision, nota);
  };

  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Reclamos de un día marcado</div>
          <div className="panel-subtitle">El comerciante reclama hasta {DIAS_PARA_RECLAMAR} días después. Si procede un «no asistió», ese día deja de deberse; si ese día tiene un cobro, primero se anula el cobro.</div>
        </div>
      </div>
      {deuda.puedeEscribir && (
        <form className="merchant-form" onSubmit={enviar}>
          <BuscadorComerciante deuda={deuda} elegido={comerciante} onElegir={setComerciante} />
          {comerciante && (
            <div className="merchant-form-grid">
              <label>
                <span>Día reclamado</span>
                <input type="date" required min={primerDiaReclamable(hoy)} max={hoy} aria-label="Día reclamado" value={formulario.fecha} onChange={campo('fecha')} />
              </label>
              <select aria-label="Qué reclama" value={formulario.tipo} onChange={campo('tipo')}>
                {Object.entries(TIPOS_RECLAMO).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
              </select>
              <input required minLength={5} maxLength={500} placeholder="Lo que dice el comerciante" aria-label="Lo que dice el comerciante" value={formulario.detalle} onChange={campo('detalle')} />
              <button className="primary-button" type="submit" disabled={deuda.ocupado}>Registrar reclamo</button>
            </div>
          )}
        </form>
      )}
      <div className="table-card">
        <table>
          <thead><tr><th>Comerciante</th><th>Día</th><th>Reclama</th><th>Detalle</th><th>Estado</th><th>Respuesta</th>{deuda.puedeEscribir && <th>Acciones</th>}</tr></thead>
          <tbody>
            {deuda.reclamos.map((reclamo) => (
              <tr key={reclamo.id}>
                <td>{reclamo.comerciante}<br /><small>{reclamo.comerciante_codigo}</small></td>
                <td>{reclamo.fecha}</td>
                <td>{TIPOS_RECLAMO[reclamo.tipo]}</td>
                <td>{reclamo.detalle}<br /><small>Registró {reclamo.registrado_por}</small></td>
                <td><span className={`status ${CLASE_RECLAMO[reclamo.estado]}`}>{ESTADOS_RECLAMO[reclamo.estado]}</span></td>
                <td>{reclamo.resolucion ? <>{reclamo.resolucion}<br /><small>{reclamo.resuelto_por}</small></> : '—'}</td>
                {deuda.puedeEscribir && (
                  <td>
                    {reclamo.estado === 'pendiente' && (
                      <>
                        <button type="button" className="table-action" disabled={deuda.ocupado} onClick={() => resolver(reclamo, 'procedente')}>Procedente</button>
                        <button type="button" className="table-action" disabled={deuda.ocupado} onClick={() => resolver(reclamo, 'no_procedente')}>No procedente</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!deuda.reclamos.length && <tr><td colSpan={deuda.puedeEscribir ? 7 : 6} className="empty-state">No hay reclamos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DeudaPage() {
  const deuda = useDeuda();
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONTROL / DEUDA Y RECLAMOS</div>
          <h1>Deuda y reclamos</h1>
          <p>Anulaciones que esperan una segunda aprobación, avisos de deuda, baja de deuda con resolución y reclamos de los comerciantes. Todo queda en la auditoría.</p>
        </div>
      </div>
      {deuda.message && <div className="form-message">{deuda.message}</div>}
      {deuda.error && <div className="form-error" role="alert">{deuda.error}</div>}
      <Anulaciones deuda={deuda} />
      <AnulacionesSinSegunda deuda={deuda} />
      <Avisos deuda={deuda} />
      <Bajas deuda={deuda} />
      <Reclamos deuda={deuda} />
    </section>
  );
}
