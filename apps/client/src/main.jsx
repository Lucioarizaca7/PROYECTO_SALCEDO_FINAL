import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';

// Importaciones para React Query
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Crear una instancia de QueryClient con configuración personalizada
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Hacer que las queries sean más resistentes a fallos de red
      retry: 1,
      // No refetch automático al enfocar ventana para reducir llamadas innecesarias
      refetchOnWindowFocus: false,
      // Tiempo de stale por defecto (puede ser sobrescrito por query específica)
      staleTime: 5 * 60 * 1000, // 5 minutos
      // Tiempo antes de que se considere para garbage collection
      gcTime: 10 * 60 * 1000, // 10 minutos
    }
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('No se pudo registrar el service worker:', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
