import { useSisrec } from '../app/SisrecContext';
import { CambiosRechazadosMapa } from '../components/features/map/CambiosRechazadosMapa';
import { SitesMap } from '../components/features/map/SitesMap';
import { useSitios } from '../hooks/useSitios';

export function MapaPage() {
  const { mapPuestos, catalogos, user } = useSisrec();
  // Titular, liberar y baja: solo el super administrador (decisión del usuario, 11/11/2026).
  const esAdmin = user?.rol === 'super_admin';
  const sitios = useSitios();

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAPA / DISTRIBUCIÓN</div>
          <h1>Mapa de sitios</h1>
          <p>Distribución por zona y estado de pago.</p>
        </div>
      </div>
      {sitios.message && <div className="form-message">{sitios.message}</div>}
      <CambiosRechazadosMapa />
      <SitesMap
        sites={mapPuestos.filter((site) => site.estado !== 'inactivo')}
        zonas={catalogos.zonas}
        searchMerchants={sitios.searchMerchants}
        onCreate={sitios.createSite}
        onUpdate={sitios.updateSite}
        onDelete={esAdmin ? sitios.deleteSite : undefined}
        onAssign={esAdmin ? sitios.assignSite : undefined}
        onRelease={esAdmin ? sitios.releaseSite : undefined}
        soloZonaDelTitular={!esAdmin}
        onCollect={sitios.collectFromSite}
      />
    </section>
  );
}
