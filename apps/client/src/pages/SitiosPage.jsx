import { useSisrec } from '../app/SisrecContext';
import { CambiosRechazadosMapa } from '../components/features/map/CambiosRechazadosMapa';
import { paymentStatusText, SERVER_PAYMENT_STATUS } from '../components/features/map/sitesGeo';
import { useSitios } from '../hooks/useSitios';
import { formatPEN } from '../lib/formato';

// null = zona confirmada; '' o texto = el padrón la trajo vacía o no registrada (migrations/0018).
const zonaPorRegularizar = (site) => site.zona_por_regularizar !== null && site.zona_por_regularizar !== undefined;

export function SitiosPage() {
  const { user, mapPuestos, catalogos } = useSisrec();
  const { message, filters, setFilters, sitesWithInactive, toggleInactive, collectFromSite, regularizarZona, updateSite } = useSitios();
  // La calle ubica el puesto dentro de su zona (13/11/2026); la cambia el super administrador.
  const callesDe = (zonaId) => (catalogos.calles || []).filter((calle) => Number(calle.zona_id) === Number(zonaId));
  const puedeRegularizar = user?.rol === 'super_admin';
  // "Cobrar" lleva a Pagos y cobros, que el auditor no usa: él solo consulta.
  const puedeCobrar = ['super_admin', 'cobrador'].includes(user?.rol);

  const source = filters.bajas && sitesWithInactive ? sitesWithInactive : mapPuestos;
  const rows = source.filter((site) => (
    (filters.estado === 'todos' || site.estado_pago === filters.estado)
    && (filters.zona === 'todas' || String(site.zona_id) === filters.zona)
    && (!filters.porRegularizar || zonaPorRegularizar(site))
  ));
  const pendientesDeZona = source.filter(zonaPorRegularizar).length;
  const totalSaldo = rows.reduce((sum, site) => sum + Number(site.saldo_pendiente || 0), 0);

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GESTIÓN / SITIOS</div>
          <h1>Sitios de venta</h1>
          <p>Puestos, titulares y lo que deben por sus días cobrados del mes. La deuda es la misma que calcula Pagos.</p>
        </div>
      </div>
      {message && <div className="form-message">{message}</div>}
      <CambiosRechazadosMapa />
      <div className="map-toolbar">
        <div>
          <strong>{rows.length} puestos</strong>
          <span>Saldo de días cobrados del mes: {formatPEN(totalSaldo)}</span>
        </div>
        <div className="map-filters" aria-label="Filtros de sitios">
          <select value={filters.estado} onChange={(event) => setFilters((current) => ({ ...current, estado: event.target.value }))} aria-label="Filtrar por estado de pago">
            <option value="todos">Todos los estados</option>
            {Object.entries(SERVER_PAYMENT_STATUS).filter(([key]) => key !== 'inactivo' || filters.bajas).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
          </select>
          <select value={filters.zona} onChange={(event) => setFilters((current) => ({ ...current, zona: event.target.value }))} aria-label="Filtrar por zona">
            <option value="todas">Todas las zonas</option>
            {catalogos.zonas.map((zona) => <option key={zona.id} value={String(zona.id)}>{zona.nombre}</option>)}
          </select>
          {pendientesDeZona > 0 && (
            <label className="checkbox-inline">
              <input type="checkbox" checked={Boolean(filters.porRegularizar)} onChange={(event) => setFilters((current) => ({ ...current, porRegularizar: event.target.checked }))} /> Solo zona por regularizar ({pendientesDeZona})
            </label>
          )}
          <label className="checkbox-inline">
            <input type="checkbox" checked={filters.bajas} onChange={(event) => toggleInactive(event.target.checked)} /> Mostrar dados de baja
          </label>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Dirección</th>
              <th>Zona</th>
              <th>Calle</th>
              <th>Titular</th>
              <th>Días cobrados</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Estado de pago</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {rows.map((site) => {
              const status = SERVER_PAYMENT_STATUS[site.estado_pago] || { label: site.estado || 'Sin estado', tone: 'neutral' };
              const conMontos = site.monto_total > 0 || site.monto_pagado > 0;
              return (
                <tr key={site.id}>
                  <td>{site.codigo || `P-${site.id}`}</td>
                  <td>{site.direccion || 'Sin dirección registrada'}</td>
                  <td>
                    {site.zona || 'Sin zona'}
                    {zonaPorRegularizar(site) && (
                      <div className="zona-por-regularizar">
                        <span className="status pending" title={site.zona_por_regularizar ? `El padrón traía la zona "${site.zona_por_regularizar}", que no está registrada` : 'El padrón no traía zona'}>Zona por regularizar</span>
                        {puedeRegularizar && (
                          <select value="" aria-label={`Asignar zona al puesto ${site.codigo}`} onChange={(event) => {
                            const zona = catalogos.zonas.find((item) => String(item.id) === event.target.value);
                            if (zona) regularizarZona(site, zona.id, zona.nombre);
                          }}>
                            <option value="">Asignar zona…</option>
                            {catalogos.zonas.map((zona) => <option key={zona.id} value={String(zona.id)}>{zona.nombre}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {puedeRegularizar && callesDe(site.zona_id).length ? (
                      <select value={site.calle_id ? String(site.calle_id) : ''} aria-label={`Calle del puesto ${site.codigo}`}
                        onChange={(event) => updateSite(site.id, { calle_id: event.target.value ? Number(event.target.value) : null }).catch(() => null)}>
                        <option value="">Sin calle</option>
                        {callesDe(site.zona_id).map((calle) => <option key={calle.id} value={String(calle.id)}>{calle.nombre}</option>)}
                      </select>
                    ) : (site.calle || '—')}
                  </td>
                  <td>{site.comerciante || 'Libre'}</td>
                  <td>{conMontos ? formatPEN(site.monto_total) : '—'}</td>
                  <td>{conMontos ? formatPEN(site.monto_pagado) : '—'}</td>
                  <td>{conMontos ? formatPEN(site.saldo_pendiente) : '—'}</td>
                  <td><span className={`status ${status.tone}`} title={paymentStatusText(site)}>{status.label}</span></td>
                  <td>{puedeCobrar && site.estado_pago === 'pendiente' && <button type="button" className="table-action" onClick={() => collectFromSite(site)}>Cobrar</button>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan="10">{source.length ? 'Ningún puesto coincide con los filtros.' : 'No hay puestos registrados todavía.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
