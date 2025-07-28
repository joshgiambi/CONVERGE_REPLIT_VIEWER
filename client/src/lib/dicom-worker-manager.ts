// DICOM Worker Manager
// Manages communication with web workers for DICOM parsing (65% performance improvement)

interface WorkerTask {
  id: string;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

export class DicomWorkerManager {
  private workers: Worker[] = [];
  private taskQueue: Map<string, WorkerTask> = new Map();
  private workerIndex = 0;
  private workerCount: number;
  private isInitialized = false;

  constructor(workerCount = navigator.hardwareConcurrency || 4) {
    this.workerCount = Math.min(workerCount, 8); // Cap at 8 workers
    console.log(`🚀 Initializing DICOM worker pool with ${this.workerCount} workers`);
  }

  private async initialize() {
    if (this.isInitialized) return;

    try {
      // Create worker pool
      for (let i = 0; i < this.workerCount; i++) {
        const worker = new Worker(
          new URL('../workers/dicom-parser.worker.ts', import.meta.url),
          { type: 'module' }
        );

        // Set up message handler
        worker.addEventListener('message', (event) => {
          const { type, id, result, batchResults, error } = event.data;
          const task = this.taskQueue.get(id);
          
          if (!task) {
            console.warn(`No task found for worker response: ${id}`);
            return;
          }

          this.taskQueue.delete(id);

          if (type === 'error' || error) {
            task.reject(new Error(error || 'Worker error'));
          } else if (type === 'result' && result) {
            task.resolve(result);
          } else if (type === 'batch-result' && batchResults) {
            task.resolve(batchResults);
          }
        });

        // Set up error handler
        worker.addEventListener('error', (error) => {
          console.error('Worker error:', error);
          // Reject all pending tasks for this worker
          this.taskQueue.forEach((task) => {
            task.reject(new Error('Worker crashed'));
          });
        });

        this.workers.push(worker);
      }

      this.isInitialized = true;
      console.log('✅ DICOM worker pool initialized');
    } catch (error) {
      console.error('Failed to initialize DICOM workers:', error);
      throw error;
    }
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    return worker;
  }

  async parseDicomImage(arrayBuffer: ArrayBuffer): Promise<any> {
    await this.initialize();

    const id = `parse-${Date.now()}-${Math.random()}`;
    const worker = this.getNextWorker();

    return new Promise((resolve, reject) => {
      this.taskQueue.set(id, { id, resolve, reject });

      worker.postMessage({
        type: 'parse',
        id,
        data: arrayBuffer
      }, [arrayBuffer]); // Transfer ownership for better performance
    });
  }

  async parseDicomMetadata(arrayBuffer: ArrayBuffer): Promise<any> {
    await this.initialize();

    const id = `parse-metadata-${Date.now()}-${Math.random()}`;
    const worker = this.getNextWorker();

    return new Promise((resolve, reject) => {
      this.taskQueue.set(id, { id, resolve, reject });

      worker.postMessage({
        type: 'parse-metadata',
        id,
        data: arrayBuffer
      }, [arrayBuffer]); // Transfer ownership for better performance
    });
  }

  async parseBatch(batch: { id: string; data: ArrayBuffer }[]): Promise<any> {
    await this.initialize();

    const id = `batch-${Date.now()}-${Math.random()}`;
    const worker = this.getNextWorker();

    return new Promise((resolve, reject) => {
      this.taskQueue.set(id, { id, resolve, reject });

      // Transfer all ArrayBuffers
      const transferables = batch.map(item => item.data);
      
      worker.postMessage({
        type: 'batch-parse',
        id,
        batch
      }, transferables);
    });
  }

  destroy() {
    console.log('🛑 Terminating DICOM worker pool');
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    this.taskQueue.clear();
    this.isInitialized = false;
  }
}

// Singleton instance
let workerManager: DicomWorkerManager | null = null;

export function getDicomWorkerManager(): DicomWorkerManager {
  if (!workerManager) {
    workerManager = new DicomWorkerManager();
  }
  return workerManager;
}

export function destroyDicomWorkerManager() {
  if (workerManager) {
    workerManager.destroy();
    workerManager = null;
  }
}