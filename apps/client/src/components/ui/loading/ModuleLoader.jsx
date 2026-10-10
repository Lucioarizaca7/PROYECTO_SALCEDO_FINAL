import { useQuery } from '@tanstack/react-query';
import { Spinner } from './Spinner'; // Asumimos que tienes un componente spinner

/**
 * Componente genérico para mostrar loading states basado en React Query
 * @param {Object} props - Props del componente
 * @param {string} props.queryKey - Clave de la query de React Query
 * @param {Function} props.queryFn - Función que ejecuta la query
 * @param {React.ComponentType} props.Component - Componente a renderizar cuando hay datos
 * @param {Object} props.queryOptions - Opciones adicionales para la query
 * @param {React.ComponentType} props.LoadingComponent - Componente a mostrar mientras carga (opcional)
 * @param {React.ComponentType} props.ErrorComponent - Componente a mostrar si hay error (opcional)
 */
export function ModuleLoader({
  queryKey,
  queryFn,
  Component,
  queryOptions = {},
  LoadingComponent = Spinner,
  ErrorComponent = null,
  ...componentProps
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn,
    ...queryOptions
  });

  if (isLoading) {
    return LoadingComponent ? <LoadingComponent /> : <div className="animate-pulse">Cargando...</div>;
  }

  if (isError) {
    if (ErrorComponent) {
      return <ErrorComponent error={error} />;
    }
    return (
      <div className="p-4 text-center text-red-500">
        Error al cargar los datos: {error?.message || 'Error desconocido'}
        <button
          className="mt-2 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
          onClick={() => window.location.reload()}
        >
          Recargar
        </button>
      </div>
    );
  }

  // Si llegamos aquí, tenemos datos
  return <Component data={data} {...componentProps} />;
}

/**
 * Hook personalizado para facilitar el uso de ModuleLoader
 * @param {string} queryKey - Clave de la query
 * @param {Function} queryFn - Función que ejecuta la query
 * @param {Object} options - Opciones de la query
 * @returns {Object} Resultado de la query (data, isLoading, isError, error)
 */
export function useModuleData(queryKey, queryFn, options = {}) {
  return useQuery({
    queryKey,
    queryFn,
    ...options
  });
}