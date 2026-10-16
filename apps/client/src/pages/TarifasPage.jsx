import { useSisrec } from '../app/SisrecContext';
import { useTarifas } from '../hooks/useTarifas';

export function TarifasPage() {
  const { catalogos, tariffRecords } = useSisrec();
  const tarifas = useTarifas();
  const { form, setForm } = tarifas;

  return (
    <section className="page">
      <div className="page-heading">
        <div><div className="eyebrow">CONFIGURACIÓN / TARIFAS</div><h1>Tarifas y categorías</h1><p>Administra montos, unidad de cobro y vigencias del tarifario.</p></div>
        <button className="primary-button" type="button" onClick={tarifas.toggleNew}>＋ Nueva tarifa</button>
      </div>
      {tarifas.message && <div className="form-error">{tarifas.message}</div>}
      {tarifas.showForm && (
        <form className="panel merchant-form" onSubmit={tarifas.submit}>
          <div className="panel-heading"><div><div className="panel-title">{tarifas.editingId ? 'Editar tarifa' : 'Nueva tarifa'}</div><div className="panel-subtitle">Los cambios aplican según la vigencia configurada.</div></div></div>
          <div className="merchant-form-grid">
            <select value={form.rubro_id} onChange={(event) => setForm({ ...form, rubro_id: event.target.value })}>{catalogos.rubros.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select>
            <select value={form.tipo_tarifa} onChange={(event) => setForm({ ...form, tipo_tarifa: event.target.value })}><option value="fija">Fija</option><option value="variable">Variable</option><option value="mixta">Mixta</option></select>
            <select value={form.unidad_medida} onChange={(event) => setForm({ ...form, unidad_medida: event.target.value })}><option value="diaria">Diaria</option><option value="semanal">Semanal</option><option value="mensual">Mensual</option><option value="metro_cuadrado">Por metro cuadrado</option></select>
            <input required min="0" step="0.01" type="number" placeholder="Monto fijo" value={form.monto_fijo} onChange={(event) => setForm({ ...form, monto_fijo: event.target.value })} />
            <input min="0" step="0.01" type="number" placeholder="Monto variable" value={form.monto_variable} onChange={(event) => setForm({ ...form, monto_variable: event.target.value })} />
            <input required type="date" value={form.vigencia_inicio} onChange={(event) => setForm({ ...form, vigencia_inicio: event.target.value })} />
            <input type="date" value={form.vigencia_fin} onChange={(event) => setForm({ ...form, vigencia_fin: event.target.value })} />
            <button className="primary-button" type="submit">Guardar tarifa</button>
          </div>
        </form>
      )}
      <div className="table-card">
        <table>
          <thead><tr><th>Rubro</th><th>Tipo</th><th>Montos</th><th>Unidad</th><th>Vigencia</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            {tariffRecords.map((item) => (
              <tr key={item.id}>
                <td>{item.rubro}</td>
                <td>{item.tipo_tarifa}</td>
                <td>S/ {item.monto_fijo} + S/ {item.monto_variable}</td>
                <td>{item.unidad_medida}</td>
                <td>{item.vigencia_inicio}{item.vigencia_fin ? ` a ${item.vigencia_fin}` : ' en adelante'}</td>
                <td><span className="status paid">Activo</span></td>
                <td><button className="table-action" type="button" onClick={() => tarifas.edit(item)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
