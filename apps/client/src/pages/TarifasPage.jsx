import { hoyEnLima } from '../services/jornadaOffline';
import { useSisrec } from '../app/SisrecContext';
import { useTarifas } from '../hooks/useTarifas';

const VIAS = { asfaltada: 'Asfaltada', sin_asfaltar: 'Sin asfaltar' };
const soles = (monto) => `S/ ${Number(monto).toFixed(2)}`;

// Precios por día de cada zona (decisión del usuario, 13/11/2026): se cobra solo el día que el cobrador sale a
// cobrar, con el precio de la zona donde vende ese día. Lo fija el super_admin; el rubro y los metros no cuentan.
export function TarifasPage() {
  const { catalogos, tariffRecords } = useSisrec();
  const tarifas = useTarifas();
  const { form, setForm } = tarifas;
  const zonaDelFormulario = catalogos.zonas.find((zona) => String(zona.id) === String(form.zona_id));
  // Historial de precios por día; las tarifas del cobro anterior (por rubro, mensuales) quedaron sin uso.
  const historial = tariffRecords.filter((item) => item.unidad_medida === 'dia');
  const sinPrecio = catalogos.zonas.filter((zona) => zona.precio_dia == null).length;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONFIGURACIÓN / TARIFAS</div>
          <h1>Precios por zona</h1>
          <p>Se cobra solo el día que se sale a cobrar: cada puesto paga el precio por día de la zona donde vende ese día, igual para todos los rubros.</p>
        </div>
      </div>
      {tarifas.message && <div className="form-error">{tarifas.message}</div>}
      {sinPrecio > 0 && (
        <div className="form-error" role="status">
          {sinPrecio === 1 ? 'Una zona no tiene' : `${sinPrecio} zonas no tienen`} precio por día: sus días cobrados no se pueden liquidar hasta que se lo ponga.
        </div>
      )}

      {tarifas.showForm && tarifas.puedeEditar && (
        <form className="panel merchant-form" onSubmit={tarifas.submit}>
          <div className="panel-heading">
            <div>
              <div className="panel-title">{tarifas.editingId ? 'Editar precio' : zonaDelFormulario?.precio_dia != null ? `Cambiar precio de ${zonaDelFormulario.nombre}` : 'Poner precio'}</div>
              <div className="panel-subtitle">
                {tarifas.yaRige
                  ? `Rige desde el ${form.vigencia_inicio}: solo se puede cerrar. Para otro monto, ponga un precio nuevo; este se cierra solo.`
                  : 'Rige desde el día que elija (hoy o después). Los días anteriores se siguen cobrando con el precio que tenían.'}
              </div>
            </div>
          </div>
          <div className="merchant-form-grid">
            <label>
              <span>Zona</span>
              <select required disabled={Boolean(tarifas.editingId)} value={form.zona_id} onChange={(event) => setForm({ ...form, zona_id: event.target.value })}>
                <option value="">Elija la zona</option>
                {catalogos.zonas.map((zona) => <option key={zona.id} value={zona.id}>{zona.nombre}{zona.tipo_via ? ` (${VIAS[zona.tipo_via].toLowerCase()})` : ''}</option>)}
              </select>
            </label>
            <label>
              <span>Precio por día (S/)</span>
              <input disabled={tarifas.yaRige} required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.monto_fijo} onChange={(event) => setForm({ ...form, monto_fijo: event.target.value })} />
            </label>
            {/* Un precio no empieza antes de hoy: cambiaría lo ya cobrado (el servidor también lo valida). */}
            <label>
              <span>Desde</span>
              <input disabled={tarifas.yaRige} required type="date" min={tarifas.yaRige ? undefined : hoyEnLima()} value={form.vigencia_inicio} onChange={(event) => setForm({ ...form, vigencia_inicio: event.target.value })} />
            </label>
            {tarifas.editingId && (
              <label>
                <span>Hasta (opcional)</span>
                <input type="date" min={tarifas.yaRige ? hoyEnLima() : undefined} value={form.vigencia_fin} onChange={(event) => setForm({ ...form, vigencia_fin: event.target.value })} />
              </label>
            )}
            <button className="primary-button" type="submit">Guardar precio</button>
            <button className="secondary-button" type="button" onClick={tarifas.cerrarFormulario}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="table-card">
        <table>
          <thead><tr><th>Zona</th><th>Tipo de vía</th><th>Precio por día</th><th>Desde</th>{tarifas.puedeEditar && <th>Acción</th>}</tr></thead>
          <tbody>
            {catalogos.zonas.map((zona) => (
              <tr key={zona.id}>
                <td>{zona.nombre}</td>
                <td>{VIAS[zona.tipo_via] || 'Sin dato'}</td>
                <td>{zona.precio_dia == null ? <span className="status pending">Sin precio</span> : soles(zona.precio_dia)}</td>
                <td>{zona.precio_desde || '—'}</td>
                {tarifas.puedeEditar && (
                  <td><button className="table-action" type="button" onClick={() => tarifas.cambiarPrecio(zona)}>{zona.precio_dia == null ? 'Poner precio' : 'Cambiar precio'}</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="panel merchant-form" onSubmit={tarifas.guardarInicioCobro}>
        <div className="merchant-form-grid">
          <label>
            <span>Deuda acumulada desde (inicio de cobro)</span>
            <input type="month" required value={tarifas.inicioCobro} disabled={!tarifas.puedeEditar} onChange={(event) => tarifas.setInicioCobro(event.target.value)} />
          </label>
          {tarifas.puedeEditar && <button className="secondary-button" type="submit">Guardar inicio de cobro</button>}
        </div>
      </form>

      <div className="table-card">
        <div className="panel-heading"><div><div className="panel-title">Historial de precios</div><div className="panel-subtitle">Cada cambio de precio cierra el anterior el día previo.</div></div></div>
        <table>
          <thead><tr><th>Zona</th><th>Precio por día</th><th>Vigencia</th><th>Estado</th>{tarifas.puedeEditar && <th>Acción</th>}</tr></thead>
          <tbody>
            {historial.map((item) => (
              <tr key={item.id}>
                <td>{item.zona || `Zona ${item.zona_id}`}</td>
                <td>{soles(item.monto_fijo)}</td>
                <td>{item.vigencia_inicio}{item.vigencia_fin ? ` a ${item.vigencia_fin}` : ' en adelante'}</td>
                <td><span className={`status ${item.estado ? 'paid' : 'neutral'}`}>{item.estado ? 'Activo' : 'Inactivo'}</span></td>
                {tarifas.puedeEditar && <td>{item.estado ? <button className="table-action" type="button" onClick={() => tarifas.edit(item)}>Editar</button> : null}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
