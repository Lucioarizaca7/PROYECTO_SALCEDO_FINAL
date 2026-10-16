import { useSisrec } from '../app/SisrecContext';
import { SitesMap } from '../components/features/map/SitesMap';
import { useSitios } from '../hooks/useSitios';

export function MapaPage() {
  const { mapPuestos, catalogos } = useSisrec();
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
      <SitesMap
        sites={mapPuestos.filter((site) => site.estado !== 'inactivo')}
        zonas={catalogos.zonas}
        searchMerchants={sitios.searchMerchants}
        onCreate={sitios.createSite}
        onUpdate={sitios.updateSite}
        onDelete={sitios.deleteSite}
        onAssign={sitios.assignSite}
        onRelease={sitios.releaseSite}
        onCollect={sitios.collectFromSite}
      />
    </section>
  );
}
