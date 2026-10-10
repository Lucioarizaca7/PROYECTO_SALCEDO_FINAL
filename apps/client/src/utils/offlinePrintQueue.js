/**
 * Offline print queue using IndexedDB
 * Stores print jobs when printer is not available and processes them when connection is restored
 */

const DATABASE_NAME = 'PrintQueueDB';
const STORE_NAME = 'printJobs';
const DATABASE_VERSION = 1;

class OfflinePrintQueue {
  constructor() {
    this.db = null;
    this.isProcessing = false;
  }

  /**
   * Initialize the IndexedDB database
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  /**
   * Add a print job to the queue
   * @param {Object} receipt - The receipt data to print
   * @returns {Promise<number>} - The ID of the queued job
   */
  async addPrintJob(receipt) {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const job = {
        receipt: receipt,
        timestamp: new Date().toISOString(),
        attempts: 0
      };

      const request = store.add(job);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  /**
   * Get all pending print jobs
   * @returns {Promise<Array>} - Array of print jobs
   */
  async getPendingJobs() {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  /**
   * Remove a print job from the queue
   * @param {number} jobId - The ID of the job to remove
   * @returns {Promise<void>}
   */
  async removeJob(jobId) {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(jobId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * Clear all print jobs from the queue
   * @returns {Promise<void>}
   */
  async clearQueue() {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * Process the print queue - attempt to print all pending jobs
   * @param {Function} printFunction - Function to call for printing (e.g., printThermalReceipt)
   * @returns {Promise<void>}
   */
  async processQueue(printFunction) {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      const jobs = await this.getPendingJobs();

      for (const job of jobs) {
        try {
          await printFunction(job.receipt);
          // If successful, remove from queue
          await this.removeJob(job.id);
        } catch (error) {
          // If failed, increment attempts and keep in queue for retry
          console.warn(`Print job ${job.id} failed, attempt ${job.attempts + 1}:`, error);

          // Update job with incremented attempts
          const updatedJob = {
            ...job,
            attempts: job.attempts + 1,
            lastAttempt: new Date().toISOString()
          };

          // Update the job in the database
          const transaction = this.db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          store.put(updatedJob, job.id);

          // Stop processing if we've had too many failed attempts
          if (job.attempts >= 3) {
            console.error(`Print job ${job.id} failed too many times, removing from queue`);
            await this.removeJob(job.id);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check if we have any pending print jobs
   * @returns {Promise<boolean>}
   */
  async hasPendingJobs() {
    const jobs = await this.getPendingJobs();
    return jobs.length > 0;
  }
}

// Export a singleton instance
let offlinePrintQueueInstance = null;

export function getOfflinePrintQueue() {
  if (!offlinePrintQueueInstance) {
    offlinePrintQueueInstance = new OfflinePrintQueue();
  }
  return offlinePrintQueueInstance;
}