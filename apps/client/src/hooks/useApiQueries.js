/**
 * Hooks personalizados usando React Query para manejar consultas a la API
 * Proporcionan caching automático, deduplication, actualizaciones en fondo y manejo de estados
 */

import { useQuery, useQueries, useInfiniteQuery } from '@tanstack/react-query';
import { apiService } from '../services/apiService';

/**
 * Hook para obtener estadísticas del dashboard
 * @param {Object} params - Parámetros de filtrado (ej: { periodo: '2026-08' })
 */
export function useDashboardQuery(params = {}) {
  return useQuery({
    queryKey: ['dashboard', params],
    queryFn: () => apiService.getDashboard(params),
    staleTime: 5 * 60 * 1000, // 5 minutos
    garbageCollectionTime: 10 * 60 * 1000, // 10 minutos
    refetchOnWindowFocus: false, // No refetch al enfocar ventana (evita llamadas innecesarias)
    retry: 1, // Solo un reintento en caso de fallo
    meta: {
      module: 'dashboard',
      priority: 'high' // Para posible priorización futura
    }
  });
}

/**
 * Hook para obtener lista de comerciantes con paginación y filtros
 * @param {Object} filters - Filtros de búsqueda y paginación
 */
export function useComerciantesQuery(filters = {}) {
  return useQuery({
    queryKey: ['comerciantes', filters],
    queryFn: () => apiService.getComerciantes(filters),
    staleTime: 2 * 60 * 1000, // 2 minutos (datos que cambian con frecuencia)
    garbageCollectionTime: 5 * 60 * 1000, // 5 minutos
    refetchOnWindowFocus: true, // Refetch al enfocar ventana (datos pueden haber cambiado)
    retry: 2, // Dos reintentos para datos críticos
    meta: {
      module: 'comerciantes',
      priority: 'high'
    }
  });
}

/**
 * Hook para obtener un comerciante específico por ID
 * @param {string|number} id - ID del comerciante
 */
export function useComercianteQuery(id) {
  return useQuery({
    queryKey: ['comerciante', id],
    queryFn: () => apiService.getComercianteById(id),
    enabled: !!id, // Solo ejecutar si hay un ID válido
    staleTime: 1 * 60 * 1000, // 1 minuto
    garbageCollectionTime: 3 * 60 * 1000, // 3 minutos
    retry: 1,
    meta: {
      module: 'comerciante',
      priority: 'medium'
    }
  });
}

/**
 * Hook para obtener catálogos de referencia (rubros, zonas)
 * Estos datos cambian raramente, así que tienen un tiempo de stale más largo
 */
export function useCatalogosQuery() {
  return useQuery({
    queryKey: ['catalogos'],
    queryFn: () => apiService.getCatalogos(),
    staleTime: 30 * 60 * 1000, // 30 minutos (datos quasi-estáticos)
    garbageCollectionTime: 60 * 60 * 1000, // 1 hora
    retry: 1,
    meta: {
      module: 'catalogos',
      priority: 'low'
    }
  });
}

/**
 * Hook para obtener tarifas
 * @param {Object} filters - Filtros opcionales (ej: { rubro_id: 1 })
 */
export function useTarifasQuery(filters = {}) {
  return useQuery({
    queryKey: ['tarifas', filters],
    queryFn: () => apiService.getTarifas(filters),
    staleTime: 15 * 60 * 1000, // 15 minutos
    garbageCollectionTime: 30 * 60 * 1000, // 30 minutos
    refetchOnWindowFocus: false,
    retry: 1,
    meta: {
      module: 'tarifas',
      priority: 'medium'
    }
  });
}

/**
 * Hook para obtener historial de cobros
 * @param {Object} filters - Filtros de fechas, comerciante, etc.
 */
export function useCobrosQuery(filters = {}) {
  return useQuery({
    queryKey: ['cobros', filters],
    queryFn: () => apiService.getCobros(filters),
    staleTime: 1 * 60 * 1000, // 1 minuto (datos muy volátiles)
    garbageCollectionTime: 3 * 60 * 1000, // 3 minutos
    refetchOnWindowFocus: true,
    retry: 2, // Más reintentos por ser datos operacionales críticos
    meta: {
      module: 'cobros',
      priority: 'high'
    }
  });
}

/**
 * Hook para obtener puestos de venta/espacios
 */
export function usePuertosQuery(filters = {}) {
  return useQuery({
    queryKey: ['puertos', filters],
    queryFn: () => apiService.getPuertos(filters),
    staleTime: 5 * 60 * 1000, // 5 minutos
    garbageCollectionTime: 10 * 60 * 1000, // 10 minutos
    retry: 1,
    meta: {
      module: 'puertos',
      priority: 'medium'
    }
  });
}

/**
 * Hook para obtener zonas y sus calles asociadas
 */
export function useZonasQuery() {
  return useQuery({
    queryKey: ['zonas'],
    queryFn: () => apiService.getZonas(),
    staleTime: 15 * 60 * 1000, // 15 minutos
    garbageCollectionTime: 30 * 60 * 1000, // 30 minutos
    retry: 1,
    meta: {
      module: 'zonas',
      priority: 'medium'
    }
  });
}

/**
 * Hook para obtener reportes
 * @param {Object} filters - Filtros de reporte (periodo, zona, rubro, etc.)
 */
export function useReportesQuery(filters = {}) {
  return useQuery({
    queryKey: ['reportes', filters],
    queryFn: () => apiService.getReportes(filters),
    staleTime: 10 * 60 * 1000, // 10 minutos
    garbageCollectionTime: 20 * 60 * 1000, // 20 minutos
    retry: 1,
    meta: {
      module: 'reportes',
      priority: 'medium'
    }
  });
}

/**
 * Hook para obtener registro de auditoría
 * @param {Object} filters - Filtros de auditoría (entidad, usuario, fechas)
 */
export function useAuditoriaQuery(filters = {}) {
  return useQuery({
    queryKey: ['auditoria', filters],
    queryFn: () => apiService.getAuditoria(filters),
    staleTime: 5 * 60 * 1000, // 5 minutos
    garbageCollectionTime: 10 * 60 * 1000, // 10 minutos
    retry: 1,
    meta: {
      module: 'auditoria',
      priority: 'low'
    }
  });
}

/**
 * Hook para obtener predicciones analíticas de recaudación
 * @param {Object} params - Parámetros (periodo, horizonte_dias)
 */
export function useAnaliticaPrediccionQuery(params = {}) {
  return useQuery({
    queryKey: ['analitica', 'prediccion', params],
    queryFn: () => apiService.getAnaliticaPrediccion(params),
    staleTime: 30 * 60 * 1000, // 30 minutos (predicciones no cambian mucho en corto plazo)
    garbageCollectionTime: 60 * 60 * 1000, // 1 hora
    retry: 1,
    meta: {
      module: 'analitica',
      priority: 'medium'
    }
  });
}

/**
 * Hook para obtener análisis de riesgo y scoring de morosidad
 * @param {Object} params - Parámetros (limit, zona_id, etc.)
 */
export function useAnaliticaRiesgoQuery(params = {}) {
  return useQuery({
    queryKey: ['analitica', 'riesgo', params],
    queryFn: () => apiService.getAnaliticaRiesgo(params),
    staleTime: 10 * 60 * 1000, // 10 minutos
    garbageCollectionTime: 20 * 60 * 1000, // 20 minutos
    retry: 1,
    meta: {
      module: 'analitica_riesgo',
      priority: 'medium'
    }
  });
}

/**
 * Hook para obtener preferencias de un comerciante específico
 * @param {string|number} comercianteId - ID del comerciante
 */
export function usePreferenciasComercianteQuery(comercianteId) {
  return useQuery({
    queryKey: ['preferencias', comercianteId],
    queryFn: () => apiService.getPreferenciasComerciante(comercianteId),
    enabled: !!comercianteId,
    staleTime: 2 * 60 * 1000, // 2 minutos
    garbageCollectionTime: 5 * 60 * 1000, // 5 minutos
    retry: 1,
    meta: {
      module: 'preferencias',
      priority: 'high' // Importante para sugerencias express
    }
  });
}

/**
 * Hook para health check del backend
 * Se usa para monitorear conectividad
 */
export function useHealthCheckQuery() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiService.healthCheck(),
    staleTime: 30 * 1000, // 30 segundos (muy frecuente para monitoreo)
    garbageCollectionTime: 60 * 1000, // 1 minuto
    refetchInterval: 45 * 1000, // Refetch cada 45 segundos
    refetchOnWindowFocus: true,
    retry: 3, // Más reintentos para health check
    meta: {
      module: 'health',
      priority: 'critical' // Máxima prioridad
    }
  });
}

/**
 * Hook especializado para cargar todos los datos iniciales de la aplicación
 * Reemplaza el fetchData() original del App.jsx
 * @param {Object} user - Usuario autenticado (para habilitar/deshabilitar queries)
 */
export function useInitialAppData(user) {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM-DD

  return useQueries({
    queries: [
      {
        queryKey: ['dashboard', { periodo: period }],
        queryFn: () => apiService.getDashboard({ periodo: period }),
        staleTime: 5 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['comerciantes'],
        queryFn: () => apiService.getComerciantes(),
        staleTime: 2 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['tarifas'],
        queryFn: () => apiService.getTarifas(),
        staleTime: 15 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['catalogos'],
        queryFn: () => apiService.getCatalogos(),
        staleTime: 30 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['cobros'],
        queryFn: () => apiService.getCobros(),
        staleTime: 1 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['puertos'],
        queryFn: () => apiService.getPuertos(),
        staleTime: 5 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['analitica', 'prediccion', { periodo: period, horizonte_dias: 90 }],
        queryFn: () => apiService.getAnaliticaPrediccion({ periodo: period, horizonte_dias: 90 }),
        staleTime: 30 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['analitica', 'riesgo', { limit: 5 }],
        queryFn: () => apiService.getAnaliticaRiesgo({ limit: 5 }),
        staleTime: 10 * 60 * 1000,
        enabled: !!user
      },
      {
        queryKey: ['zonas'],
        queryFn: () => apiService.getZonas(),
        staleTime: 15 * 60 * 1000,
        enabled: !!user
      }
    ]
  });
}

/**
 * Hook para consultas infinitas/paginadas (útil para listas grandes)
 * Ejemplo: uso en el directorio de comerciantes con scroll infinito
 */
export function useInfiniteComerciantesQuery(filters = {}) {
  return useInfiniteQuery({
    queryKey: ['comerciantes-infinite', filters],
    queryFn: async ({ pageParam = 1 }) => {
      const paginatedFilters = {
        ...filters,
        page: pageParam,
        limit: 20 // 20 items por página
      };
      return apiService.getComerciantes(paginatedFilters);
    },
    getNextPageParam: (lastPage, allPages) => {
      // Asumimos que la API regresa total y page info
      const currentPage = allPages.length + 1;
      const itemsPerPage = 20;
      const totalItems = lastPage?.total || 0;

      if (totalItems <= (currentPage * itemsPerPage)) {
        return undefined; // No hay más páginas
      }
      return currentPage;
    },
    staleTime: 2 * 60 * 1000,
    garbageCollectionTime: 5 * 60 * 1000,
    retry: 1
  });
}