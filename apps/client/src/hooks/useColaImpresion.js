import { useEffect } from 'react';

// Imprime los recibos que quedaron en cola mientras la app está abierta:
// al volver a la pestaña y cada 30 segundos, si la impresora Bluetooth responde.
export function useColaImpresion() {
  useEffect(() => {
    const processQueue = async () => {
      try {
        const { getOfflinePrintQueue } = await import('../utils/offlinePrintQueue');
        const queue = getOfflinePrintQueue();
        if (!(await queue.hasPendingJobs())) return;

        const { getBluetoothPrinter } = await import('../utils/bluetoothPrint');
        const printer = getBluetoothPrinter();
        if (await printer.initialize()) {
          await queue.processQueue((queuedReceipt) => printer.printReceipt(queuedReceipt));
        }
      } catch (error) {
        console.error('Error processing offline print queue:', error);
      }
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) processQueue();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = setInterval(processQueue, 30000);
    processQueue();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, []);
}
