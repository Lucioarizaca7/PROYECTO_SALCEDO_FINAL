import { useState, useEffect, useRef } from 'react';
import { getOfflinePrintQueue } from './offlinePrintQueue';

// ESC/POS command constants for optimization
const ESC_POS_COMMANDS = {
  INIT: '\x1B\x40',                    // Initialize printer
  CENTER: '\x1B\x61\x01',              // Center alignment
  LEFT: '\x1B\x61\x00',                // Left alignment
  FEED_CUT: '\x1D\x56\x00',            // Feed and cut paper
  LINE_SPACING: '\x1B\x33\x24',        // Set line spacing (24 dots)
};

class BluetoothPrinter {
  constructor() {
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnecting = false;
    this.deviceId = null;

    // Service UUIDs to try (ordered by likelihood of success)
    this.serviceUuids = [
      '0000ffe0-0000-1000-8000-00805f9b34fb',  // Most common for thermal printers
      '000018f0-0000-1000-8000-00805f9b34fb',
      '00001200-0000-1000-8000-00805f9b34fb'
    ];
  }

  /**
   * Get cached device ID from localStorage
   */
  getCachedDeviceId() {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('bluetoothPrinterDeviceId');
    }
    return null;
  }

  /**
   * Cache device ID to localStorage
   */
  cacheDeviceId(deviceId) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bluetoothPrinterDeviceId', deviceId);
    }
  }

  /**
   * Clear cached device ID
   */
  clearCachedDeviceId() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('bluetoothPrinterDeviceId');
    }
  }

  /**
   * Initialize Bluetooth printer with cached device
   */
  async initialize() {
    try {
      // Try to use cached device first
      const cachedDeviceId = this.getCachedDeviceId();
      if (cachedDeviceId) {
        try {
          const device = await navigator.bluetooth.getDevices()
            .then(devices => devices.find(d => d.id === cachedDeviceId));

          if (device && !device.gatt.connected) {
            await this.connectToDevice(device);
            return true;
          }
        } catch (error) {
          console.warn('Cached Bluetooth device not available:', error);
          this.clearCachedDeviceId();
        }
      }

      return false;
    } catch (error) {
      console.warn('Failed to initialize Bluetooth printer:', error);
      return false;
    }
  }

  /**
   * Connect to a Bluetooth device
   */
  async connectToDevice(device) {
    if (this.isConnecting) {
      throw new Error('Already connecting to device');
    }

    this.isConnecting = true;
    try {
      this.device = device;

      // Connect to GATT server
      this.server = await device.gatt.connect();

      // Find the write characteristic
      this.characteristic = await this.findWriteCharacteristic();

      if (!this.characteristic) {
        throw new Error('No writeable characteristic found');
      }

      // Cache the device ID for future use
      this.cacheDeviceId(device.id);
      this.deviceId = device.id;

      return true;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Find writeable characteristic from available services
   */
  async findWriteCharacteristic() {
    for (const serviceUuid of this.serviceUuids) {
      try {
        const service = await this.server.getPrimaryService(serviceUuid);
        const characteristics = await service.getCharacteristics();

        // Look for characteristic that supports writing
        const writeChar = characteristics.find(
          char => char.properties.write || char.properties.writeWithoutResponse
        );

        if (writeChar) {
          return writeChar;
        }
      } catch (error) {
        // Service not available, try next one
        continue;
      }
    }

    return null;
  }

  /**
   * Print receipt using optimized ESC/POS commands with offline queuing
   */
  async printReceiptWithQueue(receipt) {
    if (!receipt) {
      throw new Error('No receipt data provided');
    }

    try {
      // Try to print normally first
      return await this.printReceipt(receipt);
    } catch (error) {
      // If printing fails, queue the job for later
      console.warn('Printing failed, queuing for offline processing:', error);
      const offlineQueue = getOfflinePrintQueue();
      await offlineQueue.addPrintJob(receipt);
      throw error; // Still throw the error so the UI can show fallback options
    }
  }

  /**
   * Reconnect to the printer
   */
  async reconnect() {
    await this.disconnect();

    if (this.deviceId) {
      try {
        const device = await navigator.bluetooth.getDevices()
          .then(devices => devices.find(d => d.id === this.deviceId));

        if (device) {
          await this.connectToDevice(device);
          return;
        }
      } catch (error) {
        console.warn('Could not reconnect to cached device:', error);
      }
    }

    // If reconnection fails, we'll need to request device again
    throw new Error('Printer disconnected and reconnection failed');
  }

  /**
   * Disconnect from printer
   */
  async disconnect() {
    try {
      if (this.server && this.server.connected) {
        await this.server.disconnect();
      }
    } catch (error) {
      console.warn('Error during disconnect:', error);
    } finally {
      this.server = null;
      this.characteristic = null;
      // Keep device reference for potential reconnection
    }
  }

  /**
   * Build optimized ESC/POS receipt with minimal commands
   */
  buildOptimizedEscPosReceipt(receipt) {
    const fecha = new Date(receipt.fecha || Date.now())
      .toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });

    // Build minimal receipt content
    const lines = [
      ESC_POS_COMMANDS.INIT,
      ESC_POS_COMMANDS.CENTER,
      'MUNI SALCEDO\n',
      ESC_POS_COMMANDS.LEFT,
      'RECIBO DE PAGO\n',
      `Nro: ${receipt.comprobante || 'N/A'}\n`,
      `Fecha: ${fecha}\n`,
      `Comerciante: ${(receipt.comerciante || '-').slice(0, 20)}\n`, // Limit length
      `Concepto: ${(receipt.concepto || 'Liquidación').slice(0, 20)}\n`,
      `Método: ${receipt.metodo_pago || 'efectivo'}\n`,
      `Monto: S/ ${Number(receipt.monto || 0).toFixed(2)}\n`,
      `Hash: ${receipt.hash_idempotencia || 'N/A'}\n`,
      '----------------\n',
      'Gracias\n',
      ESC_POS_COMMANDS.FEED_CUT
    ];

    return lines.join('');
  }

  /**
   * Request Bluetooth device permission (fallback when no cache)
   */
  async requestDevice() {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: this.serviceUuids }],
        optionalServices: this.serviceUuids
      });

      await this.connectToDevice(device);
      return true;
    } catch (error) {
      console.error('Bluetooth device request failed:', error);
      throw error;
    }
  }
  
  /**
   * Print receipt using optimized ESC/POS commands
   */
  async printReceipt(receipt) {
    if (!receipt) {
      throw new Error("No receipt data provided");
    }

    if (!this.characteristic) {
      throw new Error("Printer not connected");
    }

    // Build optimized ESC/POS receipt
    const receiptData = this.buildOptimizedEscPosReceipt(receipt);
    
    // Convert string to bytes
    const encoder = new TextEncoder();
    const data = encoder.encode(receiptData);
    
    // Write to printer
    await this.characteristic.writeValue(data);
    
    return true;
  }
}

// Singleton instance
let printerInstance = null;

export function getBluetoothPrinter() {
  if (!printerInstance) {
    printerInstance = new BluetoothPrinter();
  }
  return printerInstance;
}

// React hook for Bluetooth printing
export function useBluetoothPrint() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const printerRef = useRef(null);

  // Initialize printer on mount
  useEffect(() => {
    const initPrinter = async () => {
      try {
        printerRef.current = getBluetoothPrinter();
        const initialized = await printerRef.current.initialize();
        setIsInitialized(initialized);
      } catch (err) {
        setError(err.message);
        console.warn('Bluetooth printer initialization failed:', err);
      }
    };

    initPrinter();

    // Cleanup on unmount
    return () => {
      if (printerRef.current) {
        printerRef.current.disconnect().catch(console.error);
      }
    };
  }, []);

  const printReceipt = async (receipt) => {
    if (!printerRef.current) {
      throw new Error('Bluetooth printer not initialized');
    }

    try {
      return await printerRef.current.printReceipt(receipt);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    printReceipt,
    isInitialized,
    error,
    resetError: () => setError(null)
  };
}