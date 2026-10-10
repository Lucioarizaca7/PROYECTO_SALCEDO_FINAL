import { useState } from 'react';
import { useMerchantDirectory } from '../../hooks/useMerchantDirectory';
import { MerchantQrDialog } from './MerchantQrDialog';

export function MerchantDirectory({
  merchants,
  catalogos,
  loading,
  message,
  form,
  setForm,
  isFormOpen,
  setIsFormOpen,
  editingId,
  importPreview,
  importMessage,
  importLoading,
  onPreviewFile,
  onImport,
  onSubmit,
  onEdit,
  onDeactivate
}) {
  const directory = useMerchantDirectory(merchants);
  const [qrMerchant, setQrMerchant] = useState(null);

  return (
    <section className="page" aria-labelledby="merchant-heading">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GESTIÓN / COMERCIANTES</div>
          <h1 id="merchant-heading">Comerciantes</h1>
          <p>Listado del padrón municipal y estado operativo.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setIsFormOpen((open) => !open)}>
          {isFormOpen ? 'Cerrar formulario' : '＋ Nuevo registro'}
        </button>
      </div>

      <section className="panel padron-import-panel" aria-labelledby="padron-import-heading">
        <div className="panel-heading">
          <div>
            <div className="panel-title" id="padron-import-heading">Carga masiva del padrón</div>
            <div className="panel-subtitle">Excel .xlsx con hojas por bloque. La previsualización no modifica datos.</div>
          </div>
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
                </>
              )}
            </div>
            <div className="import-sheet-list" aria-label="Hojas detectadas">
              {importPreview.sheets.map((sheet) => <span className="status neutral" key={sheet.sheet}>{sheet.sheet}: {sheet.rows}{sheet.attendanceSheet ? ` titulares, ${sheet.attendanceMarks} marcas` : sheet.skipped ? ' (formato no reconocido)' : ' filas'}</span>)}
            </div>
            {importPreview.workbookType === 'attendance' && <div className="attendance-sheet-details">{importPreview.sheets.filter((sheet) => sheet.attendanceSheet).map((sheet) => <p key={sheet.sheet}><strong>{sheet.sheet}</strong>: marcas {Object.entries(sheet.marks || {}).map(([mark, count]) => `${mark.toUpperCase()} ${count}`).join(' · ') || 'ninguna'}{sheet.dates?.length ? ` · fechas: ${sheet.dates.join(', ')}` : ''}</p>)}</div>}
            {importPreview.errors.length > 0 && (
              <details className="import-errors">
                <summary>{importPreview.invalidRows} filas necesitan corrección</summary>
                <ul>{importPreview.errors.slice(0, 10).map((error, index) => <li key={`${error.sheet}-${error.row}-${index}`}>{error.sheet}, fila {error.row}: {error.message}</li>)}</ul>
                {importPreview.errors.length > 10 && <span>Se muestran los primeros 10 errores.</span>}
              </details>
            )}
            <p className="import-policy-note">Las filas “Ausente” se importan como puestos feriales disponibles para que la liquidación aplique no devengo. No se crean deudas ni cobros durante esta importación.</p>
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
              <input name="dni_ruc" required pattern="([0-9]{8}|(10|15|17|20)[0-9]{9})" title="DNI de 8 dígitos o RUC válido de 11 dígitos" placeholder="DNI / RUC" value={form.dni_ruc} onChange={(event) => setForm({ ...form, dni_ruc: event.target.value })} />
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
              <tr><th scope="col">Código</th><th scope="col">Nombre</th><th scope="col">Rubro</th><th scope="col">Documento</th><th scope="col">Zona</th><th scope="col">Estado</th><th scope="col">Fecha</th><th scope="col">Acciones</th></tr>
            </thead>
            <tbody>
              {directory.visibleMerchants.map((row) => {
                const [code, name, category, document, zone, state, date] = row;
                const statusClass = state === 'Pendiente' ? 'pending' : state === 'Inactivo' ? 'neutral' : 'paid';
                return (
                  <tr key={code}>
                    <td>CM-{String(code).padStart(3, '0')}</td>
                    <td>{name}</td>
                    <td>{category}</td>
                    <td>{document}</td>
                    <td>{zone}</td>
                    <td><span className={`status ${statusClass}`}>{state}</span></td>
                    <td>{date}</td>
                    <td>
                      <div className="table-actions">
                        <button className="table-action qr-table-action" type="button" aria-label={`Ver código QR de ${name}`} onClick={() => setQrMerchant({ id: code, codigo: `CM-${String(code).padStart(3, '0')}`, nombre: name, qr_code: `SISREC://comerciante/${code}` })}>Ver QR</button>
                        <button className="table-action" type="button" aria-label={`Editar ${name}`} onClick={() => onEdit(row)}>Editar</button>
                        <button className="table-action" type="button" aria-label={`Dar de baja a ${name}`} onClick={() => onDeactivate(code)}>Dar de baja</button>
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
        <span>{directory.filteredMerchants.length} registros encontrados</span>
        <div>
          <button type="button" className="secondary-button" disabled={directory.page <= 1} onClick={() => directory.setPage((page) => page - 1)} aria-label="Página anterior">Anterior</button>
          <span className="page-number" aria-live="polite">Página {directory.page} de {directory.totalPages}</span>
          <button type="button" className="secondary-button" disabled={directory.page >= directory.totalPages} onClick={() => directory.setPage((page) => page + 1)} aria-label="Página siguiente">Siguiente</button>
        </div>
      </div>
      {qrMerchant && <MerchantQrDialog merchant={qrMerchant} onClose={() => setQrMerchant(null)} />}
    </section>
  );
}
