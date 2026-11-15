import { useSisrec } from '../app/SisrecContext';
import { precioSugerido } from '../hooks/useTarifas';
import { useZonas } from '../hooks/useZonas';

const TIPO_VIA_TEXTO = { asfaltada: 'Asfaltada', sin_asfaltar: 'Sin asfaltar' };

// Zonas: una zona es un área con un solo precio por día, que fija el super_admin en Tarifas (14/11/2026).
// No hay calles: el comerciante se mueve dentro de la feria y lo que cambia el cobro es la zona del día.
export function ZonasPage() {
  const { user } = useSisrec();
  // El auditor solo consulta las zonas (decisión del 04/11/2026); el servidor vuelve a comprobarlo.
  const puedeEditar = user?.rol === 'super_admin';
  const zonas = useZonas();
  const { zoneForm, setZoneForm } = zonas;
  // Al crear, elegir el tipo de vía sugiere el precio (S/ 3 asfaltada, S/ 2 sin asfaltar) si aún no se escribió
  // otro: solo sugiere, el super_admin puede cambiarlo antes de guardar.
  const alElegirVia = (tipoVia) => {
    const sugeridoAntes = precioSugerido({ tipo_via: zoneForm.tipo_via });
    const seguirSugerencia = !zonas.editingZoneId && (zoneForm.precio_dia === '' || zoneForm.precio_dia === sugeridoAntes);
    setZoneForm({ ...zoneForm, tipo_via: tipoVia, ...(seguirSugerencia ? { precio_dia: precioSugerido({ tipo_via: tipoVia }) } : {}) });
  };

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONFIGURACIÓN / ZONAS</div>
          <h1>Zonas</h1>
          <p>Una zona es un área donde todos pagan el mismo precio por día.</p>
        </div>
      </div>

      <div className="panel zonas-ayuda">
        <strong>Cómo armar las zonas</strong>
        <ul>
          <li>Si una feria tiene una parte asfaltada y otra sin asfaltar, regístrela como <b>dos zonas</b>: por ejemplo «Feria sábado – asfaltada» y «Feria sábado – sin asfaltar».</li>
          <li>Si un comerciante se cambia de sitio dentro de la misma zona, no hay que registrar nada: paga lo mismo.</li>
          <li>Si un día vende en otra zona, el cobrador elige esa zona al cobrar («Zona de hoy») y ese día paga el precio de esa zona.</li>
          <li>Al crear la zona se le pone su precio por día: al elegir el tipo de vía se sugiere S/ 3 (asfaltada) o S/ 2 (sin asfaltar). Para cambiarlo después, vaya a <b>Tarifas</b>.</li>
        </ul>
      </div>

      {zonas.message && <div className="form-message">{zonas.message}</div>}

      <div className="panel detail-card">
        <div className="panel-heading">
          <div>
            <div className="panel-title">{puedeEditar ? 'Crear o editar zona' : 'Zonas'}</div>
            <div className="panel-subtitle">Cada zona tiene un solo tipo de vía y un solo precio por día.</div>
          </div>
        </div>

        {puedeEditar && (
        <form className="merchant-form" onSubmit={zonas.submitZone}>
          <div className="merchant-form-grid">
            <input required placeholder="Nombre de la zona" aria-label="Nombre de la zona" value={zoneForm.nombre} onChange={(event) => setZoneForm({ ...zoneForm, nombre: event.target.value })} />
            <input placeholder="Descripción" aria-label="Descripción" value={zoneForm.descripcion} onChange={(event) => setZoneForm({ ...zoneForm, descripcion: event.target.value })} />
            <select aria-label="Tipo de vía" value={zoneForm.tipo_via} onChange={(event) => alElegirVia(event.target.value)}>
              <option value="">Tipo de vía: sin dato</option>
              <option value="asfaltada">Vía asfaltada</option>
              <option value="sin_asfaltar">Vía sin asfaltar</option>
            </select>
            {!zonas.editingZoneId && (
              <input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Precio por día (S/)" aria-label="Precio por día en soles" value={zoneForm.precio_dia} onChange={(event) => setZoneForm({ ...zoneForm, precio_dia: event.target.value })} />
            )}
            <button className="primary-button" type="submit">{zonas.editingZoneId ? 'Actualizar zona' : 'Guardar zona'}</button>
            {zonas.editingZoneId && <button type="button" className="secondary-button" onClick={zonas.cancelZone}>Cancelar</button>}
          </div>
        </form>
        )}

        <div className="table-card" style={{ marginTop: '16px' }}>
          <table>
            <thead>
              <tr><th>Zona</th><th>Descripción</th><th>Tipo de vía</th><th>Precio por día</th><th>Puestos</th>{puedeEditar && <th>Acciones</th>}</tr>
            </thead>
            <tbody>
              {zonas.zoneRecords.map((zona) => (
                <tr key={zona.id}>
                  <td>{zona.nombre}</td>
                  <td>{zona.descripcion || 'Sin descripción'}</td>
                  <td>{TIPO_VIA_TEXTO[zona.tipo_via] || 'Sin dato'}</td>
                  <td>{zona.precio_dia == null ? <span className="status pending">Sin precio</span> : `S/ ${Number(zona.precio_dia).toFixed(2)}`}</td>
                  <td>{Number(zona.total_puestos || 0)}</td>
                  {puedeEditar && (
                    <td>
                      <button className="table-action" type="button" onClick={() => zonas.editZone(zona)}>Editar</button>
                      <button className="table-action peligro" type="button" onClick={() => zonas.deleteZone(zona.id)}>Eliminar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
