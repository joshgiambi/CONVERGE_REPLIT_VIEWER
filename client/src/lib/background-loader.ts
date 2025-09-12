/**
 * Background Image Loading Service
 * Implements OHIF-style background prefetching with priority queuing
 */

interface LoadingTask {
  id: string;
  sopInstanceUID: string;
  priority: 'high' | 'medium' | 'low';
  seriesId: number;
  onProgress?: (progress: number) => void;
  onComplete?: (result: any) => void;
  onError?: (error: Error) => void;
  abortController: AbortController;
}

interface LoadingState {
  seriesId: number;
  progress: number;
  isLoading: boolean;
  completedCount: number;
  totalCount: number;
  errors: string[];
}

export class BackgroundImageLoader {
  private static instance: BackgroundImageLoader;
  
  private loadingQueue: LoadingTask[] = [];
  private activeLoads = new Map<string, LoadingTask>();
  private maxConcurrentLoads = 4;
  private loadingStates = new Map<number, LoadingState>();
  private cache = new Map<string, any>();
  
  static getInstance(): BackgroundImageLoader {
    if (!BackgroundImageLoader.instance) {
      BackgroundImageLoader.instance = new BackgroundImageLoader();
    }
    return BackgroundImageLoader.instance;
  }

  /**
   * Start background loading of a secondary series with real-time progress
   */
  async loadSecondarySeriesBackground(
    seriesId: number,
    imageList: any[],
    onProgress: (state: LoadingState) => void,
    priority: 'high' | 'medium' | 'low' = 'high'
  ): Promise<Map<string, any>> {
    
    console.log(`🚀 Starting background load for series ${seriesId} with ${imageList.length} images`);
    
    // Initialize loading state
    const loadingState: LoadingState = {
      seriesId,
      progress: 0,
      isLoading: true,
      completedCount: 0,
      totalCount: imageList.length,
      errors: []
    };
    
    this.loadingStates.set(seriesId, loadingState);
    onProgress(loadingState);

    // Create loading tasks
    const tasks: LoadingTask[] = imageList.map((img, index) => {
      const task: LoadingTask = {
        id: `${seriesId}-${img.sopInstanceUID}`,
        sopInstanceUID: img.sopInstanceUID,
        priority,
        seriesId,
        abortController: new AbortController(),
        onProgress: (itemProgress) => {
          // Update overall progress
          const state = this.loadingStates.get(seriesId);
          if (state) {
            state.progress = ((state.completedCount + itemProgress) / state.totalCount) * 100;
            onProgress(state);
          }
        },
        onComplete: (result) => {
          if (result) {
            this.cache.set(img.sopInstanceUID, result);
          }
          
          const state = this.loadingStates.get(seriesId);
          if (state) {
            state.completedCount++;
            state.progress = (state.completedCount / state.totalCount) * 100;
            
            // Mark as complete when all images loaded
            if (state.completedCount >= state.totalCount) {
              state.isLoading = false;
              console.log(`✅ Background loading complete for series ${seriesId}`);
            }
            
            onProgress(state);
          }
        },
        onError: (error) => {
          console.error(`❌ Failed to load image ${img.sopInstanceUID}:`, error);
          const state = this.loadingStates.get(seriesId);
          if (state) {
            state.errors.push(`${img.sopInstanceUID}: ${error.message}`);
            state.completedCount++; // Count errors as "complete" to continue progress
            state.progress = (state.completedCount / state.totalCount) * 100;
            onProgress(state);
          }
        }
      };
      return task;
    });

    // Add tasks to queue with priority sorting
    this.loadingQueue.push(...tasks);
    this.sortQueueByPriority();
    
    // Start processing queue
    this.processQueue();
    
    // Return promise that resolves when all images are loaded or failed
    return new Promise((resolve) => {
      const checkComplete = () => {
        const state = this.loadingStates.get(seriesId);
        if (state && !state.isLoading) {
          resolve(this.cache);
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      checkComplete();
    });
  }

  /**
   * Cancel loading for a specific series
   */
  cancelSeriesLoading(seriesId: number) {
    console.log(`⏹️ Cancelling background loading for series ${seriesId}`);
    
    // Cancel active loads
    for (const [taskId, task] of this.activeLoads) {
      if (task.seriesId === seriesId) {
        task.abortController.abort();
        this.activeLoads.delete(taskId);
      }
    }
    
    // Remove queued tasks
    this.loadingQueue = this.loadingQueue.filter(task => {
      if (task.seriesId === seriesId) {
        task.abortController.abort();
        return false;
      }
      return true;
    });
    
    // Update state
    const state = this.loadingStates.get(seriesId);
    if (state) {
      state.isLoading = false;
      this.loadingStates.delete(seriesId);
    }
  }

  /**
   * Get cached image data
   */
  getCachedImage(sopInstanceUID: string): any {
    return this.cache.get(sopInstanceUID);
  }

  /**
   * Get loading state for a series
   */
  getLoadingState(seriesId: number): LoadingState | undefined {
    return this.loadingStates.get(seriesId);
  }

  private sortQueueByPriority() {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    this.loadingQueue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  private async processQueue() {
    while (this.loadingQueue.length > 0 && this.activeLoads.size < this.maxConcurrentLoads) {
      const task = this.loadingQueue.shift();
      if (!task) break;

      this.activeLoads.set(task.id, task);
      
      // Start loading in background
      this.loadImageTask(task).finally(() => {
        this.activeLoads.delete(task.id);
        // Continue processing queue
        if (this.loadingQueue.length > 0) {
          this.processQueue();
        }
      });
    }
  }

  private async loadImageTask(task: LoadingTask): Promise<void> {
    try {
      const response = await fetch(`/api/images/${task.sopInstanceUID}`, {
        signal: task.abortController.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      
      // Use worker for parsing
      const workerManager = (await import('./dicom-worker-manager')).getDicomWorkerManager();
      const result = await workerManager.parseDicomImage(arrayBuffer);
      
      task.onComplete?.(result);
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        task.onError?.(error);
      }
    }
  }

  /**
   * Clear all caches and cancel all loading
   */
  cleanup() {
    // Cancel all active loads
    for (const task of this.activeLoads.values()) {
      task.abortController.abort();
    }
    
    // Cancel queued tasks
    for (const task of this.loadingQueue) {
      task.abortController.abort();
    }
    
    // Clear everything
    this.activeLoads.clear();
    this.loadingQueue = [];
    this.loadingStates.clear();
    this.cache.clear();
    
    console.log('🧹 Background loader cleaned up');
  }
}

// Export singleton instance
export const backgroundLoader = BackgroundImageLoader.getInstance();
