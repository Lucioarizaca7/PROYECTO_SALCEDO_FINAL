import { useSisrec } from '../app/SisrecContext';
import { useZonas } from '../hooks/useZonas';

const TIPO_VIA_TEXTO = { asfaltada: 'Asfaltada', sin_asfaltar: 'Sin asfaltar' };

export function ZonasPage() {
  const { catalogos } = useSisrec();
  const zonas = useZonas();
  const { zoneForm, setZoneForm, calleForm, setCalleForm } = zonas;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GESTIÓN / ZONAS Y CALLES</div>
          <h1>Zonas y calles</h1>
          <p>Administra la distribución territorial y la ubicación de cada comercio autorizado.</p>
        </div>
      </div>

      {zonas.message && <div className="form-message">{zonas.message}</div>}

      <div className="page-grid two-grid">
        <div className="panel detail-card">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Crear o editar zona</div>
              <div className="panel-subtitle">Cada zona agrupa varias calles y puestos.</div>
            </div>
          </div>

          <form className="merchant-form" onSubmit={zonas.submitZone}>
            <div className="merchant-form-grid">
              <input required placeholder="Nombre de la zona" value={zoneForm.nombre} onChange={(event) => setZoneForm({ ...zoneForm, nombre: event.target.value })} />
              <input placeholder="Descripción" value={zoneForm.descripcion} onChange={(event) => setZoneForm({ ...zoneForm, descripcion: event.target.value })} />
              <select aria-label="Tipo de vía" value={zoneForm.tipo_via} onChange={(event) => setZoneForm({ ...zoneForm, tipo_via: event.target.value })}>
                <option value="">Tipo de vía: sin dato</option>
                <option value="asfaltada">Vía asfaltada</option>
                <option value="sin_asfaltar">Vía sin asfaltar</option>
              </select>
              <button className="primary-button" type="submit">{zonas.editingZoneId ? 'Actualizar zona' : 'Guardar zona'}</button>
              {zonas.editingZoneId && <button type="button" className="secondary-button" onClick={zonas.cancelZone}>Cancelar</button>}
            </div>
          </form>

          <div className="table-card" style={{ marginTop: '16px' }}>
            <table>
              <thead>
                <tr><th>Zona</th><th>Descripción</th><th>Tipo de vía</th><th>Calles</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {zonas.zoneRecords.map((zona) => (
                  <tr key={zona.id}>
                    <td>{zona.nombre}</td>
                    <td>{zona.descripcion || 'Sin descripción'}</td>
                    <td>{TIPO_VIA_TEXTO[zona.tipo_via] || 'Sin dato'}</td>
                    <td>{Number(zona.calles_count || 0)}</td>
                    <td>
                      <button className="table-action" type="button" onClick={() => zonas.editZone(zona)}>Editar</button>
                      <button className="table-action" type="button" onClick={() => zonas.deleteZone(zona.id)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel detail-card">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Crear o editar calle</div>
              <div className="panel-subtitle">Asocia cada vía a la zona correcta y mantén el estado visible.</div>
            </div>
          </div>

          <form className="merchant-form" onSubmit={zonas.submitCalle}>
            <div className="merchant-form-grid">
              <select value={calleForm.zona_id} onChange={(event) => setCalleForm({ ...calleForm, zona_id: event.target.value })}>
                <option value="">Selecciona zona</option>
                {(catalogos.zonas || []).map((item) => (
                  <option key={item.id} value={item.id}>{item.nombre}</option>
                ))}
              </select>
              <input required placeholder="Nombre de la calle" value={calleForm.nombre} onChange={(event) => setCalleForm({ ...calleForm, nombre: event.target.value })} />
              <input placeholder="Descripción" value={calleForm.descripcion} onChange={(event) => setCalleForm({ ...calleForm, descripcion: event.target.value })} />
              <select value={calleForm.estado} onChange={(event) => setCalleForm({ ...calleForm, estado: event.target.value })}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
              <button className="primary-button" type="submit">{zonas.editingCalleId ? 'Actualizar calle' : 'Guardar calle'}</button>
              {zonas.editingCalleId && <button type="button" className="secondary-button" onClick={zonas.cancelCalle}>Cancelar</button>}
            </div>
          </form>

          <div className="table-card" style={{ marginTop: '16px' }}>
            <table>
              <thead>
                <tr><th>Zona</th><th>Calle</th><th>Estado</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {zonas.calleRecords.map((calle) => (
                  <tr key={calle.id}>
                    <td>{calle.zona || 'Sin zona'}</td>
                    <td>{calle.nombre}</td>
                    <td><span className={`status ${calle.estado === 'activo' ? 'paid' : 'pending'}`}>{calle.estado === 'activo' ? 'Activo' : 'Inactivo'}</span></td>
                    <td>
                      <button className="table-action" type="button" onClick={() => zonas.editCalle(calle)}>Editar</button>
                      <button className="table-action" type="button" onClick={() => zonas.deleteCalle(calle.id)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
