import { useState } from 'react';

import { MOTIVOS_OBSERVACION, textoMotivo } from '../../services/asistenciaOffline';
import { useAsistenciaFerial } from './useAsistenciaFerial';

const SIN_NOTA = { motivo: 'no_salio', observacion: '', asistio: false };

/**
 * Panel del cobrador: asistencia del día de quienes cobran por día cobrado (feriales y permanentes con
 * tarifa por día). Se paga solo el día cobrado. El cobrador puede dejar una observación: "no salió" no
 * genera deuda; "no vendió" sí. Funciona sin señal sobre el padrón descargado.
 */
export function AsistenciaFerialPanel({ isOnline, jornada }) {
  const asistencia = useAsistenciaFerial({ isOnline, jornadaMeta: jornada.meta });
  const { feriales, estado } = asistencia;
  const [observando, setObservando] = useState(null);
  const [nota, setNota] = useState(SIN_NOTA);
  if (!jornada.meta) return null;

  const abrirObservacion = (puestoId, marca) => {
    setObservando(puestoId);
    setNota(marca?.motivo ? { motivo: marca.motivo, observacion: marca.observacion || '', asistio: marca.asistio } : SIN_NOTA);
  };
  const motivoElegido = MOTIVOS_OBSERVACION.find((item) => item.value === nota.motivo);
  const guardarObservacion = async (event) => {
    event.preventDefault();
    const asistio = motivoElegido?.asistio ?? nota.asistio;
    await asistencia.marcar(observando, asistio, { motivo: nota.motivo, observacion: nota.observacion });
    setObservando(null);
  };

  return (
    <div className="panel field-panel">
      <div className="field-panel-row">
        <div>
          <div className="panel-title">Asistencia de hoy (cobro por día)</div>
          <div className="panel-subtitle">
            {feriales.length
              ? `${Object.keys(estado.marcas).length} de ${feriales.length} marcados · ${asistencia.pendientes} por subir`
              : 'El padrón descargado no tiene comerciantes que cobren por día con puesto.'}
          </div>
        </div>
        {asistencia.pendientes > 0 && (
          <button type="button" className="secondary-button compact" disabled={!isOnline || asistencia.enviando} onClick={asistencia.enviar}>
            {asistencia.enviando ? 'Subiendo…' : 'Subir'}
          </button>
        )}
      </div>
      {asistencia.mensaje && <div className="form-message">{asistencia.mensaje}</div>}
      <ul className="field-queue" aria-label="Asistencia del día">
        {feriales.map((ferial) => {
          const marca = estado.marcas[String(ferial.puestoFerialId)];
          return (
            <li key={ferial.id} className="field-queue-item">
              <div>
                <strong>{ferial.nombresRazonSocial}</strong>
                <span>{ferial.codigoPuesto || 'Puesto conservado'} · {ferial.zona || 'Sin zona'}{marca && !marca.enviado ? ' · sin subir' : ''}</span>
                {marca?.motivo && <span>Observación: {textoMotivo(marca.motivo)}{marca.observacion ? ` — ${marca.observacion}` : ''}</span>}
              </div>
              <div className="field-queue-actions">
                <button type="button" className={marca?.asistio === true ? 'primary-button compact' : 'secondary-button compact'} aria-pressed={marca?.asistio === true} onClick={() => asistencia.marcar(ferial.puestoFerialId, true)}>Asistió</button>
                <button type="button" className={marca?.asistio === false ? 'primary-button compact' : 'secondary-button compact'} aria-pressed={marca?.asistio === false} onClick={() => asistencia.marcar(ferial.puestoFerialId, false)}>Faltó</button>
                <button type="button" className="secondary-button compact" aria-expanded={observando === ferial.puestoFerialId} onClick={() => (observando === ferial.puestoFerialId ? setObservando(null) : abrirObservacion(ferial.puestoFerialId, marca))}>Observación</button>
              </div>
              {observando === ferial.puestoFerialId && (
                <form className="merchant-form-grid" onSubmit={guardarObservacion} aria-label={`Observación de ${ferial.nombresRazonSocial}`}>
                  <select aria-label="Motivo" value={nota.motivo} onChange={(event) => setNota({ ...nota, motivo: event.target.value })}>
                    {MOTIVOS_OBSERVACION.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  {motivoElegido?.asistio === null && (
                    <select aria-label="Marca" value={nota.asistio ? 'si' : 'no'} onChange={(event) => setNota({ ...nota, asistio: event.target.value === 'si' })}>
                      <option value="si">Asistió</option>
                      <option value="no">Faltó</option>
                    </select>
                  )}
                  <input aria-label="Detalle" maxLength={300} placeholder="Detalle (opcional)" value={nota.observacion} onChange={(event) => setNota({ ...nota, observacion: event.target.value })} />
                  <span className="panel-subtitle">{motivoElegido?.asistio === false ? 'No se le cobra el día.' : motivoElegido?.asistio === true ? 'Estuvo: el día se le cobra igual.' : ''}</span>
                  <button className="primary-button compact" type="submit">Guardar observación</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
