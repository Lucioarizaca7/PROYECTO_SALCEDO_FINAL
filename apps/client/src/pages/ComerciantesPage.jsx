import { useSisrec } from '../app/SisrecContext';
import { MerchantDirectory } from '../features/comerciantes/MerchantDirectory';
import { useComerciantes } from '../hooks/useComerciantes';

export function ComerciantesPage() {
  const { user, comerciantes, catalogos, loading } = useSisrec();
  const merchants = useComerciantes();

  return (
    <MerchantDirectory
      merchants={comerciantes}
      catalogos={catalogos}
      loading={loading}
      message={merchants.message}
      form={merchants.form}
      setForm={merchants.setForm}
      isFormOpen={merchants.showForm}
      onToggleForm={merchants.toggleForm}
      editingId={merchants.editingId}
      importPreview={merchants.padronPreview}
      importMessage={merchants.padronMessage}
      importLoading={merchants.padronLoading}
      onPreviewFile={merchants.previewPadron}
      onImport={merchants.importPadron}
      onDownloadTemplate={merchants.downloadPadronTemplate}
      onSubmit={merchants.submit}
      onEdit={merchants.edit}
      onDeactivate={merchants.deactivate}
      onGeneratePortalPin={merchants.generatePortalPin}
      // Solo super_admin emite carnets (decisión del 28/10/2026); el servidor vuelve a comprobarlo.
      onIssueCards={user?.rol === 'super_admin' ? merchants.emitirCarnets : null}
    />
  );
}
