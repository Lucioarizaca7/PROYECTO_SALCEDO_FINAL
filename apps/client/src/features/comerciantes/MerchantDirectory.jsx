import { useState } from 'react';
import { useMerchantDirectory } from '../../hooks/useMerchantDirectory';
import { MerchantCardDialog } from './MerchantCardDialog';
import { MerchantQrDialog } from './MerchantQrDialog';
import './comerciantes.css';

export function MerchantDirectory({
  merchants,
  catalogos,
  loading,
  message,
  form,
  setForm,
  isFormOpen,
  onToggleForm,
  editingId,
  importPreview,
  importMessage,
  importLoading,
  onPreviewFile,
  onImport,
  onDownloadTemplate,
  onSubmit,
  onEdit,
  onDeactivate,
  onIssueCards
}) {
  const directory = useMerchantDirectory(merchants);
  const [qrMerchant, setQrMerchant] = useState(null);
  // Carnets: comerciantes marcados para emitir en lote y los que muestra el diálogo.
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [carnetPara, setCarnetPara] = useState(null);
  const aCarnet = (row) => ({ id: row[0], nombre: row[1], codigo: row[8], carnet_emitido_en: row[10] });
  const alternar = (id) => setSeleccion((actual) => {
    const nueva = new Set(actual);
    if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
    return nueva;
  });
  const deBaja = (row) => String(row[5]).toLowerCase() === 'inactivo';
  const seleccionables = directory.visibleMerchants.filter((row) => !deBaja(row));
  const todosMarcados = seleccionables.length > 0 && seleccionables.every((row) => seleccion.has(row[0]));
  const marcarTodos = () => setSeleccion(todosMarcados ? new Set() : new Set(seleccionables.map((row) => row[0])));
  const emitirSeleccion = () => setCarnetPara(merchants.filter((row) => seleccion.has(row[0])).map(aCarnet));

  return (
    <section className="page" aria-labelledby="merchant-heading">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GESTIÓN / COMERCIANTES</div>
          <h1 id="merchant-heading">Comerciantes</h1>
          <p>Listado del padrón municipal y estado operativo.</p>
        </div>
        <button className="primary-button" type="button" onClick={onToggleForm}>
          {isFormOpen ? 'Cerrar formulario' : '＋ Nuevo registro'}
        </button>
      </div>

      <section className="panel padron-import-panel" aria-labelledby="padron-import-heading">
        <div className="panel-heading">
          <div>
            <div className="panel-title" id="padron-import-heading">Carga masiva del padrón</div>
            <div className="panel-subtitle">Excel .xlsx con hojas por bloque. La previsualización no modifica datos.</div>
          </div>
          <button className="secondary-button" type="button" onClick={onDownloadTemplate}>Descargar plantilla oficial</button>
        </div>
        <div className="padron-import-controls">
          <label className="padron-file-control">
            <span>Seleccionar archivo Excel</span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={importLoading} onChange={(event) => onPreviewFile(event.target.files?.[0] || null)} />
          </label>
          {importLoading && <span className="import-progress" role="status">Procesando libro...</span>}
        </div>
        {importMessage && <div className="form-message" role="status" aria-live="polite">{importMessage}</div>}
        {importPreview && (
          <div className="padron-import-preview">
            {importPreview.workbookType === 'attendance' && (
              <div className="import-format-warning" role="note">
                <strong>Este archivo es un control de asistencia, no un padrón fiscal importable.</strong>
                <span>Detecté {importPreview.attendanceRecords} titulares y {importPreview.attendanceMarks} marcas. No aparecen DNI/RUC ni metrajes; por eso no es seguro crear o vincular comerciantes/puestos automáticamente. No se modificará la base con este archivo.</span>
              </div>
            )}
            <div className="import-summary-grid">
              <div><strong>{importPreview.sheets.length}</strong><span>hojas leídas</span></div>
              {importPreview.workbookType === 'attendance' ? (
                <>
                  <div><strong>{importPreview.attendanceRecords}</strong><span>titulares listados</span></div>
                  <div><strong>{importPreview.attendanceMarks}</strong><span>marcas encontradas</span></div>
                  <div><strong>{importPreview.sheets.filter((sheet) => sheet.dates?.length).length}</strong><span>hojas con fechas</span></div>
                  <div><strong>0</strong><span>filas fiscales importables</span></div>
                </>
              ) : (
                <>
                  <div><strong>{importPreview.validRows}</strong><span>filas válidas</span></div>
                  <div><strong>{importPreview.newMerchants}</strong><span>comerciantes nuevos</span></div>
                  <div><strong>{importPreview.newPosts}</strong><span>puestos nuevos</span></div>
                  <div><strong>{importPreview.existingMerchants}</strong><span>comerciantes existentes</span></div>
                  <div><strong>{importPreview.absentRows}</strong><span>ausentes, sin devengo</span></div>
                  <div><strong>{importPreview.pendingMerchants ?? 0}</strong><span>sin DNI, pendientes de regularizar</span></div>
                  <div><strong>{importPreview.zonePendingPosts ?? 0}</strong><span>puestos con zona por regularizar</span></div>
                  <div><strong>{importPreview.merchantsWithSeveralPosts ?? 0}</strong><span>titulares con varios puestos</span></div>
                </>
              )}
            </div>
            <div className="import-sheet-list" aria-label="Hojas detectadas">
              {importPreview.sheets.map((sheet) => <span className="status neutral" key={sheet.sheet}>{sheet.sheet}: {sheet.rows}{sheet.attendanceSheet ? ` titulares, ${sheet.attendanceMarks} marcas` : sheet.skipped ? ' (formato no reconocido)' : ' filas'}</span>)}
            </div>
            {importPreview.workbookType === 'attendance' && <div className="attendance-sheet-details">{importPreview.sheets.filter((sheet) => sheet.attendanceSheet).map((sheet) => <p key={sheet.sheet}><strong>{sheet.sheet}</strong>: marcas {Object.entries(sheet.marks || {}).map(([mark, count]) => `${mark.toUpperCase()} ${count}`).join(' · ') || 'ninguna'}{sheet.dates?.length ? ` · fechas: ${sheet.dates.join(', ')}` : ''}</p>)}</div>}
            {importPreview.reactivatedMerchants?.length > 0 && (
              <details className="import-notices">
                <summary>{importPreview.reactivatedMerchants.length} comerciantes dados de baja se reactivarán</summary>
                <ul>{importPreview.reactivatedMerchants.slice(0, 10).map((item) => <li key={`r-${item.sheet}-${item.row}`}>{item.sheet}, fila {item.row}: {item.name}</li>)}</ul>
              </details>
            )}
            {importPreview.regularizedMerchants?.length > 0 && (
              <details className="import-notices">
                <summary>{importPreview.regularizedMerchants.length} titulares sin DNI quedarán regularizados con su DNI</summary>
                <ul>{importPreview.regularizedMerchants.slice(0, 10).map((item) => <li key={`g-${item.sheet}-${item.row}`}>{item.sheet}, fila {item.row}: {item.name}</li>)}</ul>
              </details>
            )}
            {importPreview.warnings?.length > 0 && (
              <details className="import-notices">
                <summary>{importPreview.warnings.length} advertencias para revisar (no impiden importar)</summary>
                <ul>{importPreview.warnings.slice(0, 10).map((item, index) => <li key={`w-${item.sheet}-${item.row}-${index}`}>{item.sheet}, fila {item.row}: {item.message}</li>)}</ul>
              </details>
            )}
            {importPreview.result?.rowErrors?.length > 0 && (
              <details className="import-errors" open>
                <summary>{importPreview.result.rowErrors.length} filas no se pudieron guardar</summary>
                <ul>{importPreview.result.rowErrors.slice(0, 10).map((item, index) => <li key={`e-${item.sheet}-${item.row}-${index}`}>{item.sheet}, fila {item.row}: {item.message}</li>)}</ul>
              </details>
            )}
            {importPreview.errors.length > 0 && (
              <details className="import-errors">
                <summary>{importPreview.invalidRows} filas necesitan corrección</summary>
                <ul>{importPreview.errors.slice(0, 10).map((error, index) => <li key={`${error.sheet}-${error.row}-${index}`}>{error.sheet}, fila {error.row}: {error.message}</li>)}</ul>
                {importPreview.errors.length > 10 && <span>Se muestran los primeros 10 errores.</span>}
              </details>
            )}
            <p className="import-policy-note">Las filas “Ausente” se importan como puestos feriales disponibles para que la liquidación aplique no devengo. Sin DNI, el titular entra como pendiente de regularización y paga igual. El metraje es opcional en zonas con tipo de vía. Una fila con error se omite y no detiene a las demás. No se crean deudas ni cobros durante esta importación.</p>
            <button className="primary-button" type="button" disabled={importLoading || importPreview.validRows === 0 || importPreview.workbookType === 'attendance'} onClick={onImport}>Confirmar importación de {importPreview.validRows} filas</button>
          </div>
        )}
      </section>

      {message && <div className="form-message" role="status" aria-live="polite">{message}</div>}

      {isFormOpen && (
        <form className="panel merchant-form" onSubmit={onSubmit} aria-labelledby="merchant-form-heading">
          <div className="panel-heading">
            <div>
              <div className="panel-title" id="merchant-form-heading">{editingId ? 'Editar comerciante' : 'Registrar comerciante'}</div>
              <div className="panel-subtitle">Completa los datos obligatorios del padrón.</div>
            </div>
          </div>
          <div className="merchant-form-grid">
            <label>
              <span>DNI / RUC</span>
              <input name="dni_ruc" required pattern="([0-9]{8}|(10|15|17|20)[0-9]{9}|TEMP_[A-Z0-9_]+)" title="DNI de 8 dígitos o RUC válido de 11 dígitos (un titular sin DNI conserva su documento provisional hasta registrar el real)" placeholder="DNI / RUC" value={form.dni_ruc} onChange={(event) => setForm({ ...form, dni_ruc: event.target.value })} />
            </label>
            <label>
              <span>Nombre completo</span>
              <input name="nombre" required placeholder="Nombre completo" value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} />
            </label>
            <label>
              <span>Rubro</span>
              <select name="rubro_id" value={form.rubro_id} onChange={(event) => setForm({ ...form, rubro_id: event.target.value })}>
                {catalogos.rubros.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
              </select>
            </label>
            <label>
              <span>Zona</span>
              <select name="zona_id" value={form.zona_id} onChange={(event) => setForm({ ...form, zona_id: event.target.value })}>
                {catalogos.zonas.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
              </select>
            </label>
            <label>
              <span>Tipo de comerciante</span>
              <select name="tipo_comerciante" value={form.tipo_comerciante} onChange={(event) => setForm({ ...form, tipo_comerciante: event.target.value, categoria: event.target.value })}>
                <option value="permanente">Permanente</option>
                <option value="eventual">Eventual</option>
                <option value="ferial">Ferial</option>
              </select>
            </label>
            <button className="primary-button" type="submit">{editingId ? 'Guardar cambios' : 'Guardar comerciante'}</button>
          </div>
        </form>
      )}

      <div className="merchant-filters panel" role="search" aria-label="Filtros del padrón">
        <label className="sr-only" htmlFor="merchant-search">Buscar comerciantes</label>
        <input id="merchant-search" type="search" placeholder="Buscar por nombre, DNI o código" value={directory.search} onChange={(event) => directory.changeSearch(event.target.value)} />
        <label className="sr-only" htmlFor="merchant-category">Filtrar por rubro</label>
        <select id="merchant-category" value={directory.rubro} onChange={(event) => directory.changeRubro(event.target.value)}>
          <option value="">Todos los rubros</option>
          {catalogos.rubros.map((item) => <option key={item.id} value={item.nombre}>{item.nombre}</option>)}
        </select>
        <label className="sr-only" htmlFor="merchant-zone">Filtrar por zona</label>
        <select id="merchant-zone" value={directory.zona} onChange={(event) => directory.changeZona(event.target.value)}>
          <option value="">Todas las zonas</option>
          {catalogos.zonas.map((item) => <option key={item.id} value={item.nombre}>{item.nombre}</option>)}
        </select>
      </div>

      {onIssueCards && seleccion.size > 0 && (
        <div className="barra-seleccion" role="status">
          <strong>{seleccion.size} {seleccion.size === 1 ? 'seleccionado' : 'seleccionados'}</strong>
          <span>Se emitirá un carnet nuevo para cada uno; los anteriores dejan de funcionar.</span>
          <button type="button" className="link-button" onClick={() => setSeleccion(new Set())}>Quitar selección</button>
          <button type="button" className="boton-acento" onClick={emitirSeleccion}>
            Emitir {seleccion.size} {seleccion.size === 1 ? 'carnet' : 'carnets'}
          </button>
        </div>
      )}

      <div className="table-card" aria-busy={loading}>
        {loading ? (
          <div className="merchant-list-skeleton" role="status" aria-label="Cargando comerciantes">
            {[1, 2, 3, 4].map((row) => <span className="skeleton-line" key={row} />)}
          </div>
        ) : directory.visibleMerchants.length === 0 ? (
          <div className="empty-state" role="status">No se encontraron comerciantes con esos filtros.</div>
        ) : (
          <table>
            <caption className="sr-only">Padrón de comerciantes filtrado</caption>
            <thead>
              <tr>
                {onIssueCards && (
                  <th scope="col" className="columna-seleccion">
                    <input type="checkbox" aria-label="Seleccionar todos los de esta página" checked={todosMarcados} onChange={marcarTodos} />
                  </th>
                )}
                <th scope="col">Código</th><th scope="col">Nombre</th><th scope="col">Rubro</th><th scope="col">Documento</th><th scope="col">Zona</th><th scope="col">Estado</th><th scope="col">Carnet</th><th scope="col">Fecha</th><th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {directory.visibleMerchants.map((row) => {
                // code es el id interno (para editar y dar de baja); businessCode es el código que ve la gente.
                const [code, name, category, document, zone, state, date, , businessCode, , carnet] = row;
                const statusClass = state === 'Pendiente' ? 'pending' : state === 'Inactivo' ? 'neutral' : 'paid';
                return (
                  <tr key={code} className={seleccion.has(code) ? 'fila-seleccionada' : undefined}>
                    {onIssueCards && (
                      <td className="columna-seleccion">
                        <input type="checkbox" aria-label={`Seleccionar a ${name}`} disabled={deBaja(row)} checked={seleccion.has(code)} onChange={() => alternar(code)} />
                      </td>
                    )}
                    <td className="merchant-code">{businessCode}</td>
                    <td>{name}</td>
                    <td>{category}</td>
                    <td>{document}</td>
                    <td>{zone}</td>
                    <td><span className={`status ${statusClass}`}>{state}</span></td>
                    <td>{carnet
                      ? <span className="status con-carnet">Emitido {carnet.slice(8, 10)}/{carnet.slice(5, 7)}</span>
                      : <span className="status neutral">Sin carnet</span>}</td>
                    <td>{date}</td>
                    <td>
                      <div className="table-actions">
                        {onIssueCards && !deBaja(row) && (
                          <button className="table-action" type="button" aria-label={`${carnet ? 'Emitir carnet nuevo' : 'Emitir carnet'} para ${name}`} onClick={() => setCarnetPara([aCarnet(row)])}>
                            {carnet ? 'Nuevo carnet' : 'Emitir carnet'}
                          </button>
                        )}
                        <button className="table-action qr-table-action" type="button" aria-label={`Ver código QR de ${name}`} onClick={() => setQrMerchant({ id: code, codigo: businessCode, nombre: name, qr_code: `SISREC://comerciante/${businessCode}` })}>Ver QR</button>
                        <button className="table-action" type="button" aria-label={`Editar ${name}`} onClick={() => onEdit(row)}>Editar</button>
                        <button className="table-action peligro" type="button" aria-label={`Dar de baja a ${name}`} onClick={() => onDeactivate(code)}>Dar de baja</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="pagination-row" aria-label="Paginación del padrón">
        <span>{directory.filteredMerchants.length} {directory.filteredMerchants.length === 1 ? 'registro encontrado' : 'registros encontrados'}</span>
        <div>
          <button type="button" className="secondary-button" disabled={directory.page <= 1} onClick={() => directory.setPage((page) => page - 1)} aria-label="Página anterior">Anterior</button>
          <span className="page-number" aria-live="polite">Página {directory.page} de {directory.totalPages}</span>
          <button type="button" className="secondary-button" disabled={directory.page >= directory.totalPages} onClick={() => directory.setPage((page) => page + 1)} aria-label="Página siguiente">Siguiente</button>
        </div>
      </div>
      {qrMerchant && <MerchantQrDialog merchant={qrMerchant} onClose={() => setQrMerchant(null)} />}
      {carnetPara && (
        <MerchantCardDialog
          merchants={carnetPara}
          onIssue={async (ids) => {
            const emitidos = await onIssueCards(ids);
            setSeleccion(new Set());
            return emitidos;
          }}
          onClose={() => setCarnetPara(null)}
        />
      )}
    </section>
  );
}
