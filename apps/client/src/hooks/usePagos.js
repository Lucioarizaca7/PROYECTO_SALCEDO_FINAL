import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSisrec } from '../app/SisrecContext';
import { formatPEN } from '../lib/formato';
import { createReceiptHash } from '../features/payments/recibo';
import { enviarReciboOficial } from '../features/payments/reciboOficial';
import { buildExpressSuggestion } from '../features/payments/sugerenciaExpress';
import { aComercianteDePantalla, aSaldoDePantalla, hoyEnLima, montoDiaEnZona, periodoEnLima } from '../services/jornadaOffline';
import { CLAVE_ASISTENCIAS, estadoDelDia } from '../services/asistenciaOffline';
import { crearHashCobro } from '../services/offlineQueue';
import { storeFor } from '../services/offlineStore';
import { montoDeRequeridos, proximosTickets, requeridosEnZona, requeridosPorDefecto, serieDeTipoVia, seriesConMarcaDeHoy, textoTicket } from '../services/ticketsOffline';
import { useTicketsCobrador } from '../features/offline/useTicketsCobrador';
import { apiBase, authFetch } from '../services/session';

const NO_SUGGESTION = { suggestedAmount: 0, preferredMethod: 'efectivo', lastLabel: 'Sin historial previo', lastPayment: null };

const sameMerchant = (merchant) => (item) => (
  Number(item.comerciante_id ?? item.comercianteId ?? 0) === Number(merchant.id)
  || String(item.comerciante || '').toLowerCase() === String(merchant.nombre || '').toLowerCase()
);

// Página Pagos: localizar al comerciante (en línea o en el padrón del celular), revisar su deuda,
// registrar el cobro (o guardarlo en la cola sin señal) y emitir el recibo.
export function usePagos() {
  const { user, cobros, jornada, offlineQueue, refresh, isOnline, catalogos, tariffRecords } = useSisrec();
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ search: '', comercianteId: '', periodo: periodoEnLima(), monto: '', metodo_pago: 'efectivo', codigo_operacion: '', observaciones: '' });
  const [merchant, setMerchant] = useState(null);
  const [balance, setBalance] = useState(null);
  const [suggestion, setSuggestion] = useState(NO_SUGGESTION);
  const [message, setMessage] = useState('');
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [receipt, setReceipt] = useState(null);
  // Hora en que se empezó a atender al comerciante (búsqueda, QR o llegada desde el mapa).
  const inicioAtencion = useRef(null);
  const empezarAtencion = () => { inicioAtencion.current = new Date().toISOString(); };

  // Tickets preimpresos: un ticket por puesto y día cobrado, de las series del comerciante. Por omisión,
  // uno por puesto; el cobrador suma tickets si paga días adeudados. El monto es lo que valen los tickets.
  const tickets = useTicketsCobrador({ isOnline, jornadaMeta: jornada.meta });
  const [requeridos, setRequeridos] = useState([]);

  // Zona del día (decisión del usuario, 12/11/2026): si hoy vende en otra zona porque faltaron otros, el cobrador
  // la elige y el día se cobra con su tarifa (asfaltada S/ 3, sin asfaltar S/ 2). '' = la zona de su puesto.
  // Las zonas y tarifas salen del paquete de la jornada (sirven sin señal) o, si no hay, de los catálogos.
  const [zonaDia, setZonaDia] = useState('');
  const [datosJornada, setDatosJornada] = useState({ zonas: [], tarifas: [] });
  useEffect(() => {
    storeFor('jornada').get('tarifas').then((guardado) => {
      if (guardado) setDatosJornada({ zonas: guardado.zonas || [], tarifas: guardado.tarifas || [] });
    }).catch(() => null);
  }, [jornada.meta?.descargadoEn]);
  const zonas = datosJornada.zonas.length ? datosJornada.zonas : (catalogos?.zonas || []);
  const tarifasDia = datosJornada.tarifas.length ? datosJornada.tarifas : (tariffRecords || []);
  const zonaElegida = zonas.find((zona) => String(zona.id) === String(zonaDia)) || null;
  // Solo quien paga por día cobrado y en el mes en curso: la zona del día es la de hoy.
  const cobraPorDia = Boolean(balance && (balance.series_cobro?.length || balance.dias_asistidos !== undefined
    || ['ferial_sin_asistencia', 'sin_asistencia'].includes(balance.motivo)));
  const muestraZonaDia = cobraPorDia && (form.periodo || periodoEnLima()) === periodoEnLima();
  // Cada comerciante empieza en la zona de su puesto, o en la de su marca de hoy si se cobra sin señal. La marca se lee
  // del celular después de mostrarlo: va atada al id, así nunca se aplica a otro comerciante.
  const [zonaMarcada, setZonaMarcada] = useState({ id: null, zona: '' });
  useEffect(() => { setZonaDia(''); }, [merchant?.id]);
  useEffect(() => {
    if (zonaMarcada.id !== null && String(zonaMarcada.id) === String(merchant?.id)) setZonaDia(zonaMarcada.zona);
  }, [zonaMarcada, merchant?.id]);

  useEffect(() => {
    const serieZona = zonaElegida ? serieDeTipoVia(tickets.estado, zonaElegida.tipo_via) : null;
    setRequeridos(serieZona ? requeridosEnZona(balance?.series_cobro, serieZona) : requeridosPorDefecto(balance?.series_cobro));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance?.series_cobro, zonaDia]);
  const usaTickets = requeridos.length > 0 && requeridos.some((item) => tickets.estado.series[item.serie]);
  const entrega = usaTickets ? proximosTickets(tickets.estado, requeridos.filter((item) => item.cantidad > 0)) : null;
  const montoTickets = usaTickets ? montoDeRequeridos(requeridos) : null;
  // Cada vez que cambia el comerciante, su saldo (después de un cobro) o la cantidad de tickets; no solo el
  // monto: el comerciante anterior pudo tener el mismo.
  useEffect(() => {
    if (montoTickets !== null) setForm((current) => ({ ...current, monto: montoTickets > 0 ? String(montoTickets) : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requeridos, usaTickets, balance]);
  // Sin tickets, la zona del día cambia el monto del día: el de la tarifa de su tipo de vía por cada puesto de hoy.
  useEffect(() => {
    if (!zonaElegida || usaTickets) return;
    const montoDia = montoDiaEnZona(tarifasDia, zonaElegida.tipo_via);
    const puestosHoy = (balance?.series_cobro || []).reduce((total, item) => total + Number(item.puestos_hoy ?? item.puestos ?? 0), 0) || 1;
    if (montoDia !== null) setForm((current) => ({ ...current, monto: String(Number((montoDia * puestosHoy).toFixed(2))) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonaDia, usaTickets]);
  const cambiarTickets = (serie, delta) => setRequeridos((current) => current.map((item) => (
    item.serie === serie ? { ...item, cantidad: Math.max(0, Math.min(60, item.cantidad + delta)) } : item
  )));
  const anularTicket = async ({ serie, numero }) => {
    const motivo = window.prompt(`Motivo para anular el ticket ${textoTicket(serie, numero)} (dañado, mal cortado…):`);
    if (motivo === null) return;
    try {
      await tickets.anular(serie, numero, motivo);
      setMessage(`Ticket ${textoTicket(serie, numero)} anulado. Entrega el siguiente.`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const saveMerchantPreferences = async (merchantId, payload) => {
    if (!merchantId) return null;
    try {
      const response = await authFetch(`${apiBase}/comerciantes/${merchantId}/preferencias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo guardar la preferencia');
      const preferences = Array.isArray(data.data)
        ? Object.fromEntries(data.data.map((item) => [item.clave, item.valor]))
        : (data.data || {});
      const lastDate = preferences.ultimo_cobro_fecha;
      const lastAmount = Number(preferences.ultimo_monto || 0);
      const lastMethod = String(preferences.ultimo_metodo_pago || 'efectivo');
      setSuggestion({
        suggestedAmount: Number(preferences.monto_sugerido || lastAmount),
        preferredMethod: String(preferences.metodo_pago_preferido || lastMethod),
        lastLabel: lastDate ? `Último cobro: ${formatPEN(lastAmount)} con ${lastMethod.toUpperCase()} (${new Date(lastDate).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })})` : 'Sin historial previo',
        lastPayment: { monto: lastAmount, metodo_pago: lastMethod, fecha_cobro: lastDate }
      });
      return preferences;
    } catch (error) {
      console.warn('No se pudo guardar preferencias del comerciante.', error);
      return null;
    }
  };

  // Saldo del mes y sugerencia express de un comerciante ya encontrado en el servidor.
  // Si debe meses anteriores, se cobra primero el más antiguo (el cobrador puede elegir otro).
  const loadMerchant = async (found, periodoPedido = null) => {
    let periodo = periodoPedido || periodoEnLima();
    let balanceResponse = await authFetch(`${apiBase}/comerciantes/${found.id}/saldo?periodo=${periodo}`);
    let balanceData = await balanceResponse.json();
    if (!balanceResponse.ok) return setMessage(balanceData.message || 'No se pudo calcular el saldo.');
    const masAntiguo = balanceData.data.deuda_acumulada?.periodo_mas_antiguo;
    if (!periodoPedido && masAntiguo && masAntiguo !== periodo) {
      periodo = masAntiguo;
      balanceResponse = await authFetch(`${apiBase}/comerciantes/${found.id}/saldo?periodo=${periodo}`);
      balanceData = await balanceResponse.json();
      if (!balanceResponse.ok) return setMessage(balanceData.message || 'No se pudo calcular el saldo.');
    }

    // Historial de ESTE comerciante (por id, no por nombre: dos homónimos se mezclaban), de todos los meses.
    const historyResponse = await authFetch(`${apiBase}/reportes?comerciante_id=${found.id}`);
    const historyData = await historyResponse.json().catch(() => ({}));
    const history = historyResponse.ok ? (historyData.data || []) : [];
    const next = buildExpressSuggestion(found, balanceData.data, history.length ? history : cobros.filter(sameMerchant(found)));

    setMerchant(found);
    setBalance(balanceData.data);
    setSuggestion(next);
    // El código de operación y la nota son de cada cobro: no se heredan del comerciante anterior.
    setForm((current) => ({ ...current, comercianteId: String(found.id), periodo, monto: String(Math.min(next.suggestedAmount || balanceData.data.saldo, balanceData.data.saldo) || ''), metodo_pago: next.preferredMethod || current.metodo_pago, codigo_operacion: '', observaciones: '' }));
  };

  // El cobrador elige a qué mes impago aplicar el cobro.
  const elegirPeriodo = async (periodo) => {
    if (!merchant) return;
    setMessage('');
    if (merchant.offline || !navigator.onLine) {
      // Sin señal: el saldo de ese mes sale del padrón del celular.
      const registro = await jornada.porId(merchant.id);
      if (!registro) return;
      const saldoMes = aSaldoDePantalla(registro, periodo);
      setBalance(saldoMes);
      setForm((current) => ({ ...current, periodo: saldoMes.periodo, monto: saldoMes.saldo > 0 ? String(saldoMes.saldo) : '' }));
      return;
    }
    await loadMerchant(merchant, periodo).catch((error) => setMessage(error.message));
  };

  // Comerciante del padrón del celular en la pantalla (búsqueda o llegada desde Sitios/Mapa sin señal).
  const mostrarDelPadron = (localMerchant) => {
    const offlineMerchant = aComercianteDePantalla(localMerchant);
    // Sin periodo: se aplica primero el mes impago más antiguo, igual que en línea.
    const offlineBalance = aSaldoDePantalla(localMerchant);
    setMerchant(offlineMerchant);
    setBalance(offlineBalance);
    setSuggestion(buildExpressSuggestion(offlineMerchant, offlineBalance, []));
    setForm((current) => ({ ...current, comercianteId: String(offlineMerchant.id), periodo: offlineBalance.periodo || current.periodo, monto: offlineBalance.saldo > 0 ? String(offlineBalance.saldo) : '', codigo_operacion: '', observaciones: '' }));
    aplicarMarcaDeHoy(localMerchant);
    return offlineBalance;
  };

  // Sin señal, la marca de hoy del celular manda sobre el padrón (12/11/2026): "faltó" no sugiere ticket y la zona
  // marcada en el panel de asistencia queda como zona del día (sus tickets y el zona_dia del cobro). Antes se
  // sugería S3 a quien estaba marcado en una zona sin asfaltar, y el cobro quedaba observado al sincronizar.
  const aplicarMarcaDeHoy = async (registro) => {
    if (!registro?.puestoFerialId) return;
    const guardado = await storeFor('jornada').get(CLAVE_ASISTENCIAS).catch(() => null);
    const marca = estadoDelDia(guardado, hoyEnLima()).marcas[String(registro.puestoFerialId)];
    if (!marca) return;
    setBalance((actual) => (actual && actual.series_cobro ? { ...actual, series_cobro: seriesConMarcaDeHoy(actual.series_cobro, marca) } : actual));
    if (marca.asistio && marca.zonaId) setZonaMarcada({ id: registro.id, zona: String(marca.zonaId) });
  };

  const findMerchant = async (queryOverride) => {
    setMessage('');
    const query = String(typeof queryOverride === 'string' ? queryOverride : form.search).trim();
    if (!query) return setMessage('Ingresa DNI, RUC, nombre, puesto o código.');
    empezarAtencion();

    // Sin señal se busca en el padrón descargado al iniciar la jornada.
    const searchOffline = async (reason) => {
      const [localMerchant] = await jornada.search(query).catch(() => []);
      if (!localMerchant) {
        return setMessage(jornada.meta
          ? `${reason} no se encontró el comerciante en el padrón guardado en el celular.`
          : `${reason} no hay padrón descargado. Descárgalo al iniciar la jornada, con señal.`);
      }
      mostrarDelPadron(localMerchant);
      setMessage(`${reason} saldo según el padrón guardado el ${new Date(localMerchant.actualizadoEn).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}`);
    };
    if (!navigator.onLine) return searchOffline('Sin señal:');

    try {
      let found = null;
      // Código de comerciante (COM-0004-…, CM-004 o un código anterior): el servidor lo resuelve.
      if (/^(?:COM|CM)-/i.test(query)) {
        const merchantResponse = await authFetch(`${apiBase}/comerciantes/${encodeURIComponent(query)}`);
        const merchantData = await merchantResponse.json();
        if (merchantResponse.ok) found = merchantData.data;
      }
      if (!found) {
        const response = await authFetch(`${apiBase}/comerciantes?search=${encodeURIComponent(query)}&limit=10`);
        const data = await response.json();
        found = data.data?.[0] || null;
      }
      if (!found) {
        const puestosResponse = await authFetch(`${apiBase}/puestos`);
        const puestosData = await puestosResponse.json();
        const puesto = puestosData.data?.find((item) => String(item.codigo || item.codigo_puesto || '').trim().toLowerCase() === query.toLowerCase());
        if (puesto && !puesto.comerciante_id) return setMessage(`El puesto ${puesto.codigo} está libre: no tiene titular a quien cobrar.`);
        if (puesto) {
          const merchantResponse = await authFetch(`${apiBase}/comerciantes/${puesto.comerciante_id}`);
          const merchantData = await merchantResponse.json();
          if (merchantResponse.ok) found = { ...merchantData.data, codigo_puesto: puesto.codigo };
        }
      }
      if (!found) return setMessage('No se encontró un comerciante con ese dato.');
      await loadMerchant(found);
    } catch (searchError) {
      // Hay "señal" pero el servidor no responde (Wi-Fi sin internet, API caída): se usa el padrón local.
      if (searchError instanceof TypeError) return searchOffline('Sin conexión con el servidor:');
      setMessage(searchError.message || 'No se pudo buscar el comerciante.');
    }
  };

  // Llegada desde "Cobrar" en Sitios o en el Mapa: el titular del puesto con su saldo del mes.
  const cobrarPuesto = location.state?.cobrarPuesto;
  const handledArrival = useRef(null);
  useEffect(() => {
    // StrictMode repite el efecto en desarrollo: la misma llegada se atiende una sola vez.
    if (!cobrarPuesto || handledArrival.current === cobrarPuesto) return;
    handledArrival.current = cobrarPuesto;
    empezarAtencion();
    navigate(location.pathname, { replace: true, state: null });
    setMerchant(cobrarPuesto);
    setBalance(null);
    setForm((current) => ({ ...current, search: cobrarPuesto.nombre || '', comercianteId: String(cobrarPuesto.id), monto: String(cobrarPuesto.saldo || ''), codigo_operacion: '', observaciones: '' }));
    if (!navigator.onLine) {
      // Sin señal el saldo sale del padrón del celular; antes quedaba vacío y no se podía confirmar el cobro.
      jornada.porId(cobrarPuesto.id).then((registro) => {
        if (registro) mostrarDelPadron(registro);
        else setMessage('Sin señal: este comerciante no está en el padrón guardado en el celular. Descárgalo con señal.');
      });
      return;
    }
    (async () => {
      const response = await authFetch(`${apiBase}/comerciantes/${cobrarPuesto.id}`);
      const data = await response.json();
      await loadMerchant(response.ok ? { ...cobrarPuesto, ...data.data } : cobrarPuesto);
    })().catch((error) => setMessage(error.message || 'No se pudo cargar el saldo del comerciante.'));
  }, [cobrarPuesto]);

  const scanQr = async (rawValue) => {
    const scannedValue = String(rawValue || '').trim();
    // QR nuevo: SISREC://comerciante/COM-0004-…; QR antiguo: SISREC://comerciante/4 (= CM-004).
    const merchantMatch = scannedValue.match(/^SISREC:\/\/comerciante\/(.+)$/i);
    const scannedCode = merchantMatch ? merchantMatch[1] : scannedValue;
    const query = /^\d+$/.test(scannedCode) ? `CM-${scannedCode.padStart(3, '0')}` : scannedCode;

    setShowQrScanner(false);
    setForm((current) => ({ ...current, search: query }));
    await findMerchant(query);
  };

  const applySuggestion = () => setForm((current) => ({
    ...current,
    // Con tickets el monto es lo que valen los tickets a entregar.
    monto: usaTickets ? String(montoTickets) : String(suggestion.suggestedAmount || balance?.saldo || 0),
    metodo_pago: suggestion.preferredMethod || current.metodo_pago
  }));

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    if (usaTickets && entrega.faltan.length) {
      return setMessage(`No te quedan tickets suficientes: faltan ${entrega.faltan.map((item) => `${item.faltan} de la serie ${item.serie}`).join(' y ')}. Pide un lote a la oficina.`);
    }
    if (usaTickets && !entrega.tickets.length) return setMessage('Indica cuántos tickets entregas.');
    const ticketsEntregados = usaTickets ? entrega.tickets : [];

    const fechaCobro = new Date().toISOString();
    const payload = {
      ...form,
      // El número de operación existe solo en Yape, Plin o POS. En efectivo no se envía aunque quede escrito.
      codigo_operacion: form.metodo_pago === 'efectivo' ? undefined : String(form.codigo_operacion || '').trim(),
      observaciones: String(form.observaciones || '').trim() || undefined,
      comerciante_id: form.comercianteId,
      cobrador_id: user?.id || 2,
      metodo_pago: form.metodo_pago,
      fecha_cobro: fechaCobro,
      periodo: form.periodo || periodoEnLima(),
      inicio_atencion: inicioAtencion.current || undefined,
      tickets: ticketsEntregados.length ? ticketsEntregados : undefined,
      // La zona del día: la marca de asistencia del cobro va en esa zona (o corrige la de hoy).
      zona_dia: muestraZonaDia && zonaDia ? Number(zonaDia) : undefined,
      // El mismo hash viaja en línea y, si la red falla, en la cola: el servidor nunca lo registra dos veces.
      hash_transaccion: await crearHashCobro({ cobradorId: user?.id, comercianteId: form.comercianteId, monto: form.monto, fechaCobro, salt: `${Date.now()}-${Math.random()}` })
    };

    const saveOfflinePayment = async (reason) => {
      const item = await offlineQueue.enqueue({ ...payload, comerciante: merchant?.nombre });
      if (ticketsEntregados.length) await tickets.consumirTickets(ticketsEntregados);
      const local = await jornada.applyLocalPayment(payload.comerciante_id, payload.monto, payload.periodo).catch(() => null);
      // Con el padrón actualizado se vuelve a mostrar el saldo (del mes cobrado y la deuda atrasada que queda).
      setBalance((current) => local ? aSaldoDePantalla(local, payload.periodo) : current ? {
        ...current,
        saldo: Math.max(Number(current.saldo || 0) - Number(payload.monto || 0), 0),
        monto_pagado: Number(current.monto_pagado || 0) + Number(payload.monto || 0)
      } : current);
      setReceipt({
        comprobante: `PROV-${item.hashTransaccion.slice(0, 8).toUpperCase()}`,
        provisional: true,
        monto: Number(payload.monto),
        metodo_pago: payload.metodo_pago,
        codigo_operacion: payload.codigo_operacion,
        comerciante: merchant?.nombre || 'Comerciante',
        concepto: 'Liquidación de deuda',
        cobrador: user?.nombre || 'Cobrador',
        hash_idempotencia: item.hashTransaccion.slice(0, 16).toUpperCase(),
        fecha: item.fechaCobro,
        observaciones: payload.observaciones,
        periodo_aplicado: payload.periodo,
        tickets: ticketsEntregados.map((ticket) => ({ ...ticket, texto: textoTicket(ticket.serie, ticket.numero) }))
      });
      setForm((current) => ({ ...current, monto: '', codigo_operacion: '', observaciones: '' }));
      empezarAtencion();
      setMessage(`${reason} el cobro quedó guardado en el celular y se enviará al volver la señal. ${ticketsEntregados.length ? `Entrega ${ticketsEntregados.map((ticket) => textoTicket(ticket.serie, ticket.numero)).join(', ')}.` : 'Entrega el recibo provisional.'}`);
    };

    try {
      if (!navigator.onLine) {
        await saveOfflinePayment('Sin señal:');
        return;
      }

      let response;
      try {
        response = await authFetch(`${apiBase}/cobros`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (networkError) {
        if (networkError instanceof TypeError) {
          await saveOfflinePayment('Sin conexión con el servidor:');
          return;
        }
        throw networkError;
      }
      const data = await response.json();
      if (!response.ok) {
        // Un ticket que el servidor no acepta (usado en otro celular, reasignado): se actualiza la numeración.
        if (ticketsEntregados.length) await tickets.refrescar();
        throw new Error(data.message || 'No se pudo registrar el cobro');
      }
      if (ticketsEntregados.length) {
        await tickets.consumirTickets(ticketsEntregados);
        await tickets.refrescar();
      }

      await saveMerchantPreferences(String(form.comercianteId), {
        monto_sugerido: Number(form.monto || 0),
        metodo_pago_preferido: form.metodo_pago,
        ultimo_monto: Number(form.monto || 0),
        ultimo_metodo_pago: form.metodo_pago,
        ultimo_cobro_fecha: new Date().toISOString(),
        total_cobros: (cobros.filter((item) => Number(item.comerciante_id ?? item.comercianteId ?? 0) === Number(form.comercianteId)).length || 0) + 1
      });

      const textoEntrega = data.data.tickets?.length ? ` Entrega ${data.data.tickets.length === 1 ? 'el ticket' : 'los tickets'} ${data.data.tickets.map((ticket) => ticket.texto).join(', ')}.` : '';
      setMessage(`${data.message}. Comprobante ${data.data.comprobante}. Saldo restante: S/ ${Number(data.data.saldo_restante || 0).toFixed(2)}.${textoEntrega}`);
      const hashIdempotencia = await createReceiptHash({
        cobradorId: user?.id || 2,
        comercianteId: form.comercianteId,
        puestoId: merchant?.codigo || 'offline',
        fechaCobro: new Date().toISOString(),
        monto: Number(data.data.monto || 0),
        codigoComprobante: data.data.comprobante,
        salt: data.data.hash_transaccion || data.data.codigo_operacion || Date.now()
      });
      setReceipt({
        ...data.data,
        comerciante: merchant?.nombre || merchant?.comerciante || 'Comerciante',
        concepto: 'Liquidación de deuda',
        cobrador: user?.nombre || 'Cobrador',
        hash_idempotencia: hashIdempotencia
      });
      setBalance((current) => current ? { ...current, saldo: data.data.saldo_restante } : current);
      setForm((current) => ({ ...current, monto: '', codigo_operacion: '', observaciones: '' }));
      empezarAtencion();
      await refresh();
    } catch (paymentError) {
      setMessage(paymentError.message);
    }
  };

  // Solo el administrador; el servidor lo vuelve a comprobar y pide un motivo de al menos 5 caracteres.
  const anularCobro = async (cobro) => {
    const motivo = window.prompt(`Motivo para anular ${cobro.comprobante || `el cobro #${cobro.id}`} (S/ ${Number(cobro.monto || 0).toFixed(2)}):`);
    if (motivo === null) return;
    try {
      const response = await authFetch(`${apiBase}/cobros/${cobro.id}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No se pudo anular el cobro');
      setMessage(data.message);
      await refresh();
    } catch (error) {
      setMessage(error.message);
    }
  };

  // Reenvía el recibo oficial (con QR) de un cobro ya registrado.
  const enviarRecibo = async (comprobante) => {
    try {
      await enviarReciboOficial(comprobante);
    } catch (error) {
      setMessage(error.message);
    }
  };

  return {
    anularCobro, enviarRecibo, puedeAnular: user?.rol === 'super_admin',
    form, setForm, merchant, balance, suggestion, message, showQrScanner, setShowQrScanner, receipt,
    findMerchant, scanQr, applySuggestion, submit, elegirPeriodo,
    tickets, usaTickets, requeridos, entrega, cambiarTickets, anularTicket,
    zonas, zonaDia, setZonaDia, muestraZonaDia,
    // Quien paga por día cobrado se puede cobrar en el mes en curso aunque el día no esté marcado: el cobro lo
    // marca y el servidor valida el monto (12/11/2026). Antes "Confirmar" quedaba deshabilitado con saldo 0.
    cobraHoy: muestraZonaDia
  };
}
