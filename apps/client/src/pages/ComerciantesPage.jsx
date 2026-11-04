import { useSisrec } from '../app/SisrecContext';
import { MerchantDirectory } from '../features/comerciantes/MerchantDirectory';
import { useComerciantes } from '../hooks/useComerciantes';

export function ComerciantesPage() {
  const { user, comerciantes, catalogos, loading } = useSisrec();
  const merchants = useComerciantes();
  // El auditor solo consulta el padrón (decisión del 04/11/2026); el servidor vuelve a comprobarlo.
  const puedeEditar = user?.rol === 'super_admin';

  return (
    <MerchantDirectory
      merchants={comerciantes}
      catalogos={catalogos}
      loading={loading}
      message={merchants.message}
      form={merchants.form}
      setForm={merchants.setForm}
      isFormOpen={merchants.showForm}
      onToggleForm={puedeEditar ? merchants.toggleForm : null}
      editingId={merchants.editingId}
      importPreview={merchants.padronPreview}
      importMessage={merchants.padronMessage}
      importLoading={merchants.padronLoading}
      onPreviewFile={puedeEditar ? merchants.previewPadron : null}
      onImport={puedeEditar ? merchants.importPadron : null}
      onDownloadTemplate={merchants.downloadPadronTemplate}
      onSubmit={puedeEditar ? merchants.submit : null}
      onEdit={puedeEditar ? merchants.edit : null}
      onDeactivate={puedeEditar ? merchants.deactivate : null}
      // Solo super_admin emite carnets (decisión del 28/10/2026); el servidor vuelve a comprobarlo.
      onIssueCards={puedeEditar ? merchants.emitirCarnets : null}
    />
  );
}
