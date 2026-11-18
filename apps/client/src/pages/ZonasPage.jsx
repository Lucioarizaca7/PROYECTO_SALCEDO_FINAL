import { useEffect, useRef, useState } from 'react';
import { useSisrec } from '../app/SisrecContext';
import { precioSugerido, useTarifas } from '../hooks/useTarifas';
import { useZonas } from '../hooks/useZonas';
import { formatPEN } from '../lib/formato';
import { estadoDeTarifa } from '../lib/tarifasPorZona';
import { hoyEnLima } from '../services/jornadaOffline';
import './ZonasPage.css';

const TIPOS_VIA = { asfaltada: 'Asfaltada', sin_asfaltar: 'Sin asfaltar' };
const TONOS = { Vigente: 'paid', Programada: 'pending', Finalizada: 'neutral', Inactiva: 'neutral' };

function Aviso({ message, success }) {
  return message ? <p className={success ? 'form-message' : 'form-error'} role={success ? 'status' : 'alert'}>{message}</p> : null;
}

function FormularioZona({ zonas, zonaEditada, tituloRef, onSave, onCancel, onDelete }) {
  const { zoneForm: form, setZoneForm: setForm, saving } = zonas;
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const alElegirVia = (tipoVia) => {
    const sugeridoAntes = precioSugerido({ tipo_via: form.tipo_via });
    const seguirSugerencia = !zonaEditada && (form.precio_dia === '' || form.precio_dia === sugeridoAntes);
    setForm({ ...form, tipo_via: tipoVia, ...(seguirSugerencia ? { precio_dia: precioSugerido({ tipo_via: tipoVia }) } : {}) });
  };

  return (
    <form className="panel merchant-form" aria-labelledby="zona-form-titulo" onSubmit={onSave}>
      <div className="panel-heading">
        <div>
          <h2 className="panel-title" id="zona-form-titulo" ref={tituloRef} tabIndex={-1}>{zonaEditada ? `Editar zona · ${zonaEditada.nombre}` : 'Nueva zona'}</h2>
          {!zonaEditada && <p className="panel-subtitle">Si registras un precio inicial, se aplica desde hoy.</p>}
        </div>
      </div>
      <fieldset className="merchant-form-grid" disabled={saving}>
        <label>Nombre de la zona
          <input required value={form.nombre} onChange={(event) => setField('nombre', event.target.value)} />
        </label>
        <label>Descripción
          <input value={form.descripcion} onChange={(event) => setField('descripcion', event.target.value)} />
        </label>
        <label>Tipo de vía
          <select value={form.tipo_via} onChange={(event) => alElegirVia(event.target.value)}>
            <option value="">Sin dato</option>
            <option value="asfaltada">Asfaltada</option>
            <option value="sin_asfaltar">Sin asfaltar</option>
          </select>
        </label>
        {!zonaEditada && (
          <label>Precio inicial por día (S/) · opcional
            <input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.precio_dia} onChange={(event) => setField('precio_dia', event.target.value)} />
          </label>
        )}
        {!zonaEditada && form.precio_dia !== '' && (
          <label>Ordenanza o resolución
            <input required minLength={3} maxLength={120} value={form.norma} onChange={(event) => setField('norma', event.target.value)} />
          </label>
        )}
      </fieldset>
      <div className="zonas-acciones">
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar zona'}</button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Cancelar</button>
        {zonaEditada && <button className="table-action peligro" type="button" onClick={onDelete} disabled={saving}>Eliminar zona</button>}
      </div>
    </form>
  );
}

function FormularioPrecio({ tarifas, zona, hoy, tituloRef, onSave, onCancel }) {
  const { form, setForm, saving } = tarifas;
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const accion = tarifas.editingId ? 'Editar precio' : zona?.precio_dia == null ? 'Poner precio' : 'Cambiar precio';

  return (
    <form className="panel merchant-form" aria-labelledby="precio-form-titulo" onSubmit={onSave}>
      <div className="panel-heading">
        <div>
          <h2 className="panel-title" id="precio-form-titulo" ref={tituloRef} tabIndex={-1}>{accion} · {zona?.nombre}</h2>
          <p className="panel-subtitle">
            {tarifas.yaFinalizo ? 'Puedes actualizar la norma de este precio.' : tarifas.yaRige
              ? 'Puedes actualizar la norma o indicar cuándo termina. Para cambiar el monto, registra un precio nuevo.'
              : 'El precio se aplica desde la fecha elegida. Si reemplaza al anterior, ese precio termina el día previo.'}
          </p>
        </div>
      </div>
      <fieldset className="merchant-form-grid" disabled={saving}>
        <label>Precio por día (S/)
          <input disabled={tarifas.yaRige} required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.monto_fijo} onChange={(event) => setField('monto_fijo', event.target.value)} />
        </label>
        <label>Vigente desde
          <input disabled={tarifas.yaRige} required type="date" min={hoy} value={form.vigencia_inicio} onChange={(event) => setField('vigencia_inicio', event.target.value)} />
        </label>
        <label>Ordenanza o resolución
          <input required={tarifas.normaRequerida} minLength={3} maxLength={120} value={form.norma} onChange={(event) => setField('norma', event.target.value)} />
        </label>
        {tarifas.editingId && (
          <label>Vigente hasta · opcional
            <input type="date" disabled={tarifas.yaFinalizo} min={tarifas.yaRige ? hoy : form.vigencia_inicio} value={form.vigencia_fin} onChange={(event) => setField('vigencia_fin', event.target.value)} />
          </label>
        )}
      </fieldset>
      <div className="zonas-acciones">
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar precio'}</button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
    </form>
  );
}

function HistorialPrecios({ records, zona, hoy, tituloRef, puedeEditar, busy, onEdit, onClose }) {
  return (
    <section className="table-card" id="historial-precios" aria-labelledby="historial-precios-titulo">
      <div className="panel-heading zonas-encabezado">
        <h2 className="panel-title" id="historial-precios-titulo" ref={tituloRef} tabIndex={-1}>{zona ? `Historial de precios · ${zona.nombre}` : 'Historial general de precios'}</h2>
        <button className="secondary-button compact" type="button" onClick={onClose}>Cerrar historial</button>
      </div>
      {records.length ? (
        <div className="zonas-tabla-scroll" role="region" aria-label="Tabla del historial" tabIndex={0}>
          <table>
            <thead><tr>{!zona && <th scope="col">Zona</th>}<th scope="col">Precio por día</th><th scope="col">Vigencia</th><th scope="col">Norma</th><th scope="col">Estado</th>{puedeEditar && <th scope="col">Acción</th>}</tr></thead>
            <tbody>
              {records.map((item) => {
                const estado = estadoDeTarifa(item, hoy);
                return (
                  <tr key={item.id}>
                    {!zona && <th scope="row">{item.zona || `Zona ${item.zona_id}`}</th>}
                    <td>{formatPEN(item.monto_fijo)}</td>
                    <td>{item.vigencia_inicio}{item.vigencia_fin ? ` a ${item.vigencia_fin}` : ' en adelante'}</td>
                    <td>{item.norma || 'Sin norma'}</td>
                    <td><span className={`status ${TONOS[estado]}`}>{estado}</span></td>
                    {puedeEditar && <td>{item.estado ? <button className="table-action" type="button" disabled={busy} aria-label={`Editar precio de ${item.zona || zona?.nombre}, vigente desde ${item.vigencia_inicio}`} onClick={(event) => onEdit(item, event.currentTarget)}>Editar precio</button> : null}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="zonas-vacio">Todavía no hay precios registrados.</p>}
    </section>
  );
}

export function ZonasPage() {
  const { tariffRecords, loading, apiConnected } = useSisrec();
  const zonas = useZonas();
  const tarifas = useTarifas();
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [historial, setHistorial] = useState(null);
  const editorTitle = useRef(null);
  const historialTitle = useRef(null);
  const editorTrigger = useRef(null);
  const historialTrigger = useRef(null);
  const newZoneButton = useRef(null);
  const hoy = hoyEnLima();
  const zoneRecords = zonas.zoneRecords;
  const findZona = (id) => zoneRecords.find((zona) => String(zona.id) === String(id));
  const zonaEditada = zonas.editingZoneId ? findZona(zonas.editingZoneId) : null;
  const zonaDelPrecio = findZona(tarifas.form.zona_id);
  const zonaDelHistorial = historial === 'todas' ? null : findZona(historial);
  const busy = zonas.saving || tarifas.saving;
  const sinPrecio = zoneRecords.filter((zona) => zona.precio_dia == null).length;

  useEffect(() => {
    if (showZoneForm || tarifas.showForm) editorTitle.current?.focus();
  }, [showZoneForm, tarifas.showForm, zonas.editingZoneId, tarifas.editingId, tarifas.form.zona_id]);

  useEffect(() => {
    if (historial !== null) historialTitle.current?.focus();
  }, [historial]);

  const openZoneForm = (zona, trigger) => {
    editorTrigger.current = trigger;
    tarifas.cerrarFormulario();
    if (zona) zonas.editZone(zona);
    else zonas.cancelZone();
    setShowZoneForm(true);
  };

  const openPriceForm = (opener, item, trigger) => {
    editorTrigger.current = trigger;
    setShowZoneForm(false);
    opener(item);
  };

  const returnEditorFocus = () => {
    const trigger = editorTrigger.current;
    requestAnimationFrame(() => (trigger?.isConnected ? trigger : newZoneButton.current)?.focus());
  };

  const closeZoneForm = () => {
    setShowZoneForm(false);
    zonas.cancelZone();
    returnEditorFocus();
  };

  const closePriceForm = () => {
    tarifas.cerrarFormulario();
    returnEditorFocus();
  };

  const openHistory = (id, trigger) => {
    historialTrigger.current = trigger;
    if (id === historial) historialTitle.current?.focus();
    else setHistorial(id);
  };

  const closeHistory = () => {
    setHistorial(null);
    historialTrigger.current?.focus();
  };

  return (
    <section className="page zonas-tarifas">
      <div className="page-heading zonas-encabezado">
        <div>
          <div className="eyebrow">CONFIGURACIÓN</div>
          <h1>Zonas y tarifas</h1>
          <p>Cada puesto paga el precio vigente de la zona donde vende ese día.</p>
        </div>
        <div className="zonas-acciones">
          <button className="secondary-button" type="button" onClick={(event) => openHistory('todas', event.currentTarget)} aria-expanded={historial === 'todas'}>Historial general</button>
          {tarifas.puedeEditar && <button className="primary-button" type="button" ref={newZoneButton} disabled={busy} onClick={(event) => openZoneForm(null, event.currentTarget)}>Nueva zona</button>}
        </div>
      </div>

      <Aviso message={zonas.message} success={zonas.success} />
      <Aviso message={tarifas.message} success={tarifas.success} />

      {showZoneForm && tarifas.puedeEditar && (
        <FormularioZona zonas={zonas} zonaEditada={zonaEditada} tituloRef={editorTitle} onCancel={closeZoneForm}
          onSave={async (event) => { if (await zonas.submitZone(event)) closeZoneForm(); }}
          onDelete={async () => {
            if (!window.confirm(`¿Eliminar la zona «${zonaEditada.nombre}»?`)) return;
            if (await zonas.deleteZone(zonaEditada.id)) {
              if (historial === String(zonaEditada.id)) setHistorial(null);
              closeZoneForm();
            }
          }} />
      )}
      {tarifas.showForm && tarifas.puedeEditar && (
        <FormularioPrecio tarifas={tarifas} zona={zonaDelPrecio} hoy={hoy} tituloRef={editorTitle} onCancel={closePriceForm}
          onSave={async (event) => { if (await tarifas.submit(event)) returnEditorFocus(); }} />
      )}

      {sinPrecio > 0 && (
        <p className="zonas-sin-precio" role="status">
          {sinPrecio === 1 ? 'Una zona está sin precio vigente.' : `${sinPrecio} zonas están sin precio vigente.`} Sus días cobrados requieren un precio aplicable para liquidarse.
        </p>
      )}
      <div className="table-card">
        <div className="zonas-tabla-scroll" role="region" aria-label="Tabla de zonas y tarifas" tabIndex={0}>
          <table>
            <thead>
              <tr><th scope="col">Zona</th><th scope="col">Tipo de vía</th><th scope="col">Puestos asociados</th><th scope="col">Precio diario vigente</th><th scope="col">Desde</th><th scope="col">Acciones</th></tr>
            </thead>
            <tbody>
              {zoneRecords.map((zona) => {
                const accionPrecio = zona.precio_dia == null ? 'Poner precio' : 'Cambiar precio';
                return (
                  <tr key={zona.id}>
                    <th scope="row">{zona.nombre}{zona.descripcion && <small className="zonas-descripcion">{zona.descripcion}</small>}</th>
                    <td>{TIPOS_VIA[zona.tipo_via] || 'Sin dato'}</td>
                    <td>{Number(zona.total_puestos || 0)}</td>
                    <td>{zona.precio_dia == null ? <span className="status pending">Sin precio vigente</span> : formatPEN(zona.precio_dia)}</td>
                    <td>{zona.precio_desde ? <time dateTime={zona.precio_desde}>{zona.precio_desde}</time> : '—'}</td>
                    <td>
                      <div className="zonas-acciones zonas-acciones-tabla">
                        {tarifas.puedeEditar && <>
                          <button className="table-action" type="button" disabled={busy} aria-label={`Editar zona ${zona.nombre}`} onClick={(event) => openZoneForm(zona, event.currentTarget)}>Editar zona</button>
                          <button className="table-action" type="button" disabled={busy} aria-label={`${accionPrecio} de ${zona.nombre}`} onClick={(event) => openPriceForm(tarifas.cambiarPrecio, zona, event.currentTarget)}>{accionPrecio}</button>
                        </>}
                        <button className="table-action" type="button" aria-label={`Ver historial de ${zona.nombre}`} aria-expanded={historial === String(zona.id)} onClick={(event) => openHistory(String(zona.id), event.currentTarget)}>Ver historial</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!zoneRecords.length && (
                <tr><td colSpan={6}>{loading ? 'Cargando zonas…' : apiConnected ? 'Todavía no hay zonas registradas.' : 'No se pudieron cargar las zonas.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historial !== null && (
        <HistorialPrecios
          records={tariffRecords.filter((item) => item.unidad_medida === 'dia' && (historial === 'todas' || String(item.zona_id) === historial))}
          zona={zonaDelHistorial} hoy={hoy} tituloRef={historialTitle} puedeEditar={tarifas.puedeEditar} busy={busy} onClose={closeHistory}
          onEdit={(item, trigger) => openPriceForm(tarifas.edit, item, trigger)}
        />
      )}

      <section className="panel merchant-form" aria-labelledby="inicio-cobro-titulo">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title" id="inicio-cobro-titulo">Inicio de cobro general</h2>
            <p className="panel-subtitle">Mes desde el que se calcula la deuda acumulada del padrón.</p>
          </div>
        </div>
        <form className="merchant-form-grid" onSubmit={tarifas.guardarInicioCobro}>
          <label>Deuda acumulada desde (inicio de cobro)
            <input type="month" required max={hoy.slice(0, 7)} value={tarifas.inicioCobro} disabled={!tarifas.puedeEditar || tarifas.cargandoInicio || tarifas.savingInicio} onChange={(event) => tarifas.setInicioCobro(event.target.value)} />
          </label>
          {tarifas.puedeEditar && <button type="submit" className="secondary-button" disabled={tarifas.cargandoInicio || tarifas.savingInicio}>{tarifas.savingInicio ? 'Guardando…' : 'Guardar inicio de cobro'}</button>}
        </form>
        {tarifas.cargandoInicio && <p role="status">Cargando inicio de cobro…</p>}
        {tarifas.inicioFeedback && <Aviso {...tarifas.inicioFeedback} />}
      </section>
    </section>
  );
}
