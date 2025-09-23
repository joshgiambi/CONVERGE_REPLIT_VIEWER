import { log } from './log';

/**
 * Memory optimization utilities for handling large medical image datasets
 */

interface MemoryStats {
  used: number;
  total: number;
  limit: number;
}

interface CacheEntry<T> {
  data: T;
  size: number;
  lastAccessed: number;
  priority: number;
}

export class MemoryOptimizedCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private currentSize = 0;

  constructor(maxSizeMB: number = 500) {
    this.maxSize = maxSizeMB * 1024 * 1024; // Convert MB to bytes
    this.startMemoryMonitoring();
  }

  set(key: string, data: T, size: number, priority: number = 0): void {
    // Check if we need to evict items
    if (this.currentSize + size > this.maxSize) {
      this.evictToMakeRoom(size);
    }

    // Remove existing entry if present
    const existing = this.cache.get(key);
    if (existing) {
      this.currentSize -= existing.size;
    }

    // Add new entry
    const entry: CacheEntry<T> = {
      data,
      size,
      lastAccessed: Date.now(),
      priority,
    };

    this.cache.set(key, entry);
    this.currentSize += size;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.data;
    }
    return null;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  getStats(): { entries: number; size: number; maxSize: number } {
    return {
      entries: this.cache.size,
      size: this.currentSize,
      maxSize: this.maxSize,
    };
  }

  private evictToMakeRoom(requiredSize: number): void {
    // Sort entries by priority (lower priority first) and last accessed time
    const entries = Array.from(this.cache.entries()).sort((a, b) => {
      const [, entryA] = a;
      const [, entryB] = b;

      // Higher priority items are kept longer
      if (entryA.priority !== entryB.priority) {
        return entryA.priority - entryB.priority;
      }

      // Then by last accessed (older first)
      return entryA.lastAccessed - entryB.lastAccessed;
    });

    let freedSize = 0;
    const keysToRemove: string[] = [];

    for (const [key, entry] of entries) {
      if (freedSize >= requiredSize) break;
      keysToRemove.push(key);
      freedSize += entry.size;
    }

    keysToRemove.forEach(key => this.delete(key));

    log.debug(`Evicted ${keysToRemove.length} cache entries, freed ${freedSize} bytes`, 'MemoryOptimizedCache');
  }

  private startMemoryMonitoring(): void {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      setInterval(() => {
        const memInfo = (performance as any).memory;
        const stats: MemoryStats = {
          used: memInfo.usedJSHeapSize,
          total: memInfo.totalJSHeapSize,
          limit: memInfo.jsHeapSizeLimit,
        };

        // Warn if we're approaching memory limits
        const usageRatio = stats.used / stats.limit;
        if (usageRatio > 0.8) {
          log.warn(`High memory usage: ${(usageRatio * 100).toFixed(1)}%`, 'MemoryOptimizedCache', stats);
        }
      }, 10000); // Check every 10 seconds
    }
  }
}

/**
 * Utility to estimate memory usage of different data types
 */
export function estimateMemoryUsage(data: any): number {
  if (!data) return 0;

  let size = 0;

  if (typeof data === 'string') {
    size = data.length * 2; // UTF-16 characters
  } else if (typeof data === 'number') {
    size = 8; // 64-bit float
  } else if (typeof data === 'boolean') {
    size = 4; // Boolean stored as 32-bit
  } else if (data instanceof ArrayBuffer) {
    size = data.byteLength;
  } else if (Array.isArray(data)) {
    size = data.length * 8; // Array overhead
    for (const item of data) {
      size += estimateMemoryUsage(item);
    }
  } else if (typeof data === 'object') {
    // Object overhead
    size = 32;
    for (const [key, value] of Object.entries(data)) {
      size += (key.length * 2) + 8; // Key string + property overhead
      size += estimateMemoryUsage(value);
    }
  } else if (data instanceof Float32Array || data instanceof Float64Array ||
             data instanceof Int32Array || data instanceof Uint8Array) {
    size = data.byteLength + 16; // Array buffer + typed array overhead
  }

  return size;
}

/**
 * Optimized image data processor that reuses buffers and minimizes allocations
 */
export class OptimizedImageProcessor {
  private static instance: OptimizedImageProcessor;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private bufferPool: Map<number, ImageData[]> = new Map();

  static getInstance(): OptimizedImageProcessor {
    if (!OptimizedImageProcessor.instance) {
      OptimizedImageProcessor.instance = new OptimizedImageProcessor();
    }
    return OptimizedImageProcessor.instance;
  }

  private constructor() {
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d');
    }
  }

  /**
   * Get or create an ImageData object, reusing from pool when possible
   */
  getImageData(width: number, height: number): ImageData {
    const key = width * height;
    const pool = this.bufferPool.get(key) || [];

    if (pool.length > 0) {
      return pool.pop()!;
    }

    // Create new ImageData
    if (this.context) {
      this.canvas!.width = width;
      this.canvas!.height = height;
      return this.context.createImageData(width, height);
    }

    // Fallback for environments without canvas
    return new ImageData(width, height);
  }

  /**
   * Return ImageData to pool for reuse
   */
  returnImageData(imageData: ImageData): void {
    const key = imageData.width * imageData.height;
    const pool = this.bufferPool.get(key) || [];

    if (pool.length < 10) { // Limit pool size to prevent memory bloat
      pool.push(imageData);
      this.bufferPool.set(key, pool);
    }
  }

  /**
   * Process image data with optimized memory usage
   */
  processImageData(
    sourceData: Float32Array | Uint8Array,
    width: number,
    height: number,
    options: {
      windowLevel?: { window: number; level: number };
      modality?: string;
      normalize?: boolean;
    } = {}
  ): ImageData {
    const imageData = this.getImageData(width, height);
    const { windowLevel, modality, normalize = true } = options;

    // Determine data range
    let min = Infinity;
    let max = -Infinity;

    if (normalize && sourceData.length > 0) {
      for (let i = 0; i < sourceData.length; i++) {
        const value = sourceData[i];
        if (Number.isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
    } else {
      min = windowLevel?.level ? windowLevel.level - windowLevel.window / 2 : 0;
      max = windowLevel?.level ? windowLevel.level + windowLevel.window / 2 : 255;
    }

    const range = Math.max(1e-6, max - min);
    const buffer = imageData.data;

    // Process data in chunks to avoid blocking the main thread
    const chunkSize = 10000;
    let hasSignal = false;

    for (let chunkStart = 0; chunkStart < sourceData.length; chunkStart += chunkSize) {
      const chunkEnd = Math.min(chunkStart + chunkSize, sourceData.length);

      // Process chunk
      for (let i = chunkStart; i < chunkEnd; i++) {
        let normalized = (sourceData[i] - min) / range;
        if (!Number.isFinite(normalized)) normalized = 0;
        normalized = Math.max(0, Math.min(1, normalized));

        const pixelIndex = i * 4;
        const value = Math.round(normalized * 255);

        buffer[pixelIndex] = value;
        buffer[pixelIndex + 1] = value;
        buffer[pixelIndex + 2] = value;
        buffer[pixelIndex + 3] = 255; // Full opacity

        if (!hasSignal && value > 10) {
          hasSignal = true;
        }
      }

      // Yield to main thread periodically
      if (chunkStart % 100000 === 0) {
        setTimeout(() => {}, 0);
      }
    }

    return imageData;
  }
}

/**
 * Debounced function execution to prevent excessive CPU usage
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  immediate?: boolean
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };

    const callNow = immediate && !timeout;

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func(...args);
  };
}

/**
 * Throttle function execution to prevent excessive CPU usage
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}