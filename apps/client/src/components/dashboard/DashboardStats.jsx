import { useModuleData } from '../ui/loading/ModuleLoader';
import { apiService } from '../../services/apiService';

/**
 * Componente optimizado para mostrar estadísticas del dashboard
 * Usa React Query para caching automático y manejo de estados
 */
export function DashboardStats() {
  const { data, isLoading, isError, error } = useModuleData(
    ['dashboard-stats'],
    () => apiService.getDashboard({ periodo: new Date().toISOString().slice(0, 7) }),
    {
      staleTime: 3 * 60 * 1000, // 3 minutos
      refetchOnWindowFocus: false
    }
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-50 p-4 rounded-lg animate-pulse">
            <div className="text-sm text-gray-500">Cargando...</div>
            <div className="text-2xl font-bold">--</div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 bg-red-50 rounded-lg border border-red-200">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L10 9.586l1.293-1.293a1 1 0 00-1.414-1.414L10 9.586z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error al cargar estadísticas</h3>
            <div className="mt-1 text-sm text-red-600">{error?.message || 'Error desconocido'}</div>
            <button
              className="mt-2 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
              onClick={() => window.location.reload()}
            >
              Intentar nuevamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Si llegamos aquí, tenemos los datos
  const stats = data?.stats || {};

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Recaudación */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Recaudación Mensual</p>
            <p className="text-2xl font-bold text-gray-900">
              S/ {(stats.recaudacion || 0).toLocaleString()}
            </p>
          </div>
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </div>

      {/* Número de Pagos */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Total de Pagos</p>
            <p className="text-2xl font-bold text-gray-900">
              {stats.pagos || 0}
            </p>
          </div>
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 5.043 7.3a1 1 0 001.414 1.414L10 11.542l3.293 3.293a1 1 0 001.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </div>

      /* Porcentaje de Ocupación */
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Ocupación de Sitios</p>
            <p className="text-2xl font-bold text-gray-900">
              {stats.sitios?.split(' / ')[0] || '0'} / 100
            </p>
            <p className="text-xs text-gray-500">
              {((parseInt(stats.sitios?.split(' / ')[0] || '0') / 100) * 100).toFixed(1)}%
            </p>
          </div>
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.956 1.653h1.224a1 1 0 00.956-1.653l1.519-4.674c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 001.504 2.247l1.414-1.414a1 1 0 00-1.504-2.247L12 9.049l1.288 4.152a1 1 0 00.541 1.683l1.519-4.674a1 1 0 00-.541-1.683l-1.519 4.674a1 1 0 00-1.504 2.247L8.262 14.122a1 1 0 00-.665.941l-1.414-1.414a1 1 0 00-.665-.941l-1.519-4.674a1 1 0 00-1.504-2.247z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </div>

      /* Morosidad */
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div class="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Índice de Morosidad</p>
            <p className="text-2xl font-bold text-gray-900">
              {stats.morosidad || '0'}%
            </p>
            <p className="text-xs text-gray-500">
              {parseFloat(stats.morosidad || 0) > 15 ? 'Alto' : parseFloat(stats.morosidad || 0) > 8 ? 'Medio' : 'Bajo'}
            </p>
          </div>
          <div className="flex-shrink-0">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              {/* El color cambia según el nivel de morosidad */}
              <path
                fillRule="evenodd"
                d="M8.949 1.051a1 1 0 001.414 0l4.042 4.042a1 1 0 001.414-1.414l-3.03-3.03a1 1 0 00-1.414 0l-.707.707-2.121-2.121.707-.707z"
                clipRule="evenodd"
                style={{
                  fill: parseFloat(stats.morosidad || 0) > 15
                    ? '#ef4444' // rojo para alto
                    : parseFloat(stats.morosidad || 0) > 8
                      ? '#f59e0b' // amarillo para medio
                      : '#10b981' // verde para bajo
                }}
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}