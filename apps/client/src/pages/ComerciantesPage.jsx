import { useSisrec } from '../app/SisrecContext';
import { MerchantDirectory } from '../features/comerciantes/MerchantDirectory';
import { useComerciantes } from '../hooks/useComerciantes';

export function ComerciantesPage() {
  const { comerciantes, catalogos, loading } = useSisrec();
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
    />
  );
}
