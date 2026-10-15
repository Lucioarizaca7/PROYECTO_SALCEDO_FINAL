/**
 * Servicio centralizado para todas las llamadas a la API del backend
 * Implementa deduplication de requests, timeouts y manejo de errores consistente
 */

export class ApiService {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.pendingRequests = new Map(); // Cache de peticiones en curso para deduplication
    this.defaultTimeout = 10000; // 10 segundos por defecto
  }

  /**
   * Genera headers de autenticación basado en el token almacenado
   * @param {Object} extraHeaders - Headers adicionales opcionales
   * @returns {Object} Headers para la petición
   */
  getAuthHeaders(extraHeaders = {}) {
    const token = localStorage.getItem('sisrec-token');
    return {
      ...extraHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  /**
   * Realiza una petición GET con deduplication, timeout y manejo de errores
   * @param {string} endpoint - Endpoint de la API (ej: '/dashboard')
   * @param {Object} options - Opciones adicionales de fetch
   * @returns {Promise<any>} Respuesta de la API
   */
  async get(endpoint, options = {}) {
    const cacheKey = `${endpoint}:${JSON.stringify(options)}`;

    // Si ya tenemos esta petición en curso, devolver la misma promesa (deduplication)
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    // Crear nueva petición con timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);

    const requestPromise = this._fetch(endpoint, {
      ...options,
      signal: controller.signal
    })
    .finally(() => {
      // Limpiar de pending después de completarse (éxito o error)
      this.pendingRequests.delete(cacheKey);
      clearTimeout(timeoutId);
    });

    // Guardar en pending para deduplication
    this.pendingRequests.set(cacheKey, requestPromise);

    return requestPromise;
  }

  /**
   * Implementación real de la petición fetch
   * @private
   */
  async _fetch(endpoint, options) {
    const apiEndpoint = endpoint.startsWith('/api/')
      ? endpoint.replace(/^\/api\//, '/api/v1/')
      : endpoint;
    const url = `${this.baseUrl}${apiEndpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
          ...(options.headers || {})
        }
      });

      // Manejo de errores HTTP
      if (!response.ok) {
        let errorMessage = `Error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          // Si no se puede parsear como JSON, usar el texto plano
          errorMessage = await response.text() || errorMessage;
        }

        throw new Error(errorMessage);
      }

      // Manejo de respuestas vacías
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return null;
      }

      return await response.json();
    } catch (error) {
      // Re-lanzar errores de abort (timeout) o propagar otros
      if (error.name === 'AbortError') {
        throw new Error('Timeout de conexión: el servidor tardó demasiado en responder');
      }
      throw error;
    }
  }

  // ==================== MÉTODOS ESPECÍFICOS PARA CONSULTAS RÁPIDAS ====================

  /** Health check del backend */
  async healthCheck() {
    return this.get('/api/health');
  }

  /** Estadísticas del dashboard principal */
  async getDashboard(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.get(`/api/dashboard${query ? `?${query}` : ''}`);
  }

  /** Lista de comerciantes con filtros y paginación */
  async getComerciantes(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.get(`/api/comerciantes${query ? `?${query}` : ''}`);
  }

  /** Obtener un comerciante específico por ID */
  async getComercianteById(id) {
    return this.get(`/api/comerciantes/${id}`);
  }

  /** Catálogo de tarifas y arbitrios */
  async getTarifas(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.get(`/api/tarifas${query ? `?${query}` : ''}`);
  }

  /** Catálogos de referencia (rubros, zonas) */
  async getCatalogos() {
    return this.get(`/api/catalogos`);
  }

  /** Historial de cobros y pagos */
  async getCobros(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.get(`/api/cobros${query ? `?${query}` : ''}`);
  }

  /** Lista de puestos de venta/espacios */
  async getPuertos(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.get(`/api/puestos${query ? `?${query}` : ''}`);
  }

  /** Información de zonas y calles */
  async getZonas() {
    return this.get(`/api/zonas`);
  }

  /** Reportes con filtros opcionales */
  async getReportes(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.get(`/api/reportes${query ? `?${query}` : ''}`);
  }

  /** Registro de auditoría */
  async getAuditoria(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.get(`/api/auditoria${query ? `?${query}` : ''}`);
  }

  /** Predicciones analíticas de recaudación */
  async getAnaliticaPrediccion(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.get(`/api/analitica/prediccion${query ? `?${query}` : ''}`);
  }

  /** Análisis de riesgo y scoring de morosidad */
  async getAnaliticaRiesgo(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.get(`/api/analitica/riesgo${query ? `?${query}` : ''}`);
  }

  /** Preferencias específicas de un comerciante (para sugerencias express) */
  async getPreferenciasComerciante(comercianteId) {
    return this.get(`/api/comerciantes/${comercianteId}/preferencias`);
  }

  /** Crear un nuevo comerciante */
  async crearComerciante(data) {
    return this.post(`/api/comerciantes`, data);
  }

  /** Actualizar un comerciante existente */
  async actualizarComerciante(id, data) {
    return this.put(`/api/comerciantes/${id}`, data);
  }

  /** Dar de baja un comerciante */
  async desactivarComerciante(id) {
    return this.delete(`/api/comerciantes/${id}`);
  }

  // ==================== MÉTODOS DE ESCRITURA (POST, PUT, DELETE) ====================

  /**
   * Petición POST genérica
   * @param {string} endpoint - Endpoint de la API
   * @param {Object} data - Datos a enviar
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<any>} Respuesta de la API
   */
  async post(endpoint, data, options = {}) {
    const cacheKey = `POST:${endpoint}:${JSON.stringify({...options, data})}`;

    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);

    const requestPromise = this._fetch(endpoint, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(data),
      signal: controller.signal
    })
    .finally(() => {
      this.pendingRequests.delete(cacheKey);
      clearTimeout(timeoutId);
    });

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Petición PUT genérica
   * @param {string} endpoint - Endpoint de la API
   * @param {Object} data - Datos a enviar
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<any>} Respuesta de la API
   */
  async put(endpoint, data, options = {}) {
    const cacheKey = `PUT:${endpoint}:${JSON.stringify({...options, data})}`;

    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);

    const requestPromise = this._fetch(endpoint, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(data),
      signal: controller.signal
    })
    .finally(() => {
      this.pendingRequests.delete(cacheKey);
      clearTimeout(timeoutId);
    });

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Petición DELETE genérica
   * @param {string} endpoint - Endpoint de la API
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<any>} Respuesta de la API
   */
  async delete(endpoint, options = {}) {
    const cacheKey = `DELETE:${endpoint}:${JSON.stringify(options)}`;

    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeout);

    const requestPromise = this._fetch(endpoint, {
      ...options,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    })
    .finally(() => {
      this.pendingRequests.delete(cacheKey);
      clearTimeout(timeoutId);
    });

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }
}

// Instancia única del servicio (singleton)
// VITE_API_URL es solo el origen del servidor (p. ej. https://sisrec.example.pe), sin /api;
// si alguien lo escribe con /api o /api/v1 se recorta para no duplicar la ruta.
const apiBaseUrl = String(
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:3003'
).replace(/\/+$/, '').replace(/\/api(?:\/v1)?$/, '');

export const apiService = new ApiService(apiBaseUrl);