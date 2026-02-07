/**
 * Deformable Fusion Integration
 *
 * Bridges the WebGPU block-matching pipeline with the existing fusion system.
 * Provides a high-level API for computing and caching deformable registrations
 * between pairs of 2D slices (fixed + moving).
 *
 * Usage:
 *   const manager = new DeformableFusionManager();
 *   const warped = await manager.warpSlice(fixedPixels, movingPixels, width, height);
 */

import {
  computeBlockMatchingDisplacement,
  applyDisplacementField,
  displacementFieldStats,
  isWebGPUAvailable,
  releaseGPUResources,
  type BlockMatchingParams,
  type BlockMatchingResult,
  type DisplacementField,
} from './webgpu-block-matching';

export interface DeformableWarpResult {
  /** Warped moving image pixels (same dimensions as input) */
  warpedPixels: Float32Array;
  /** Width of the output */
  width: number;
  /** Height of the output */
  height: number;
  /** Displacement field used for the warp */
  displacementField: DisplacementField;
  /** Pipeline timing info */
  timing: BlockMatchingResult['timing'];
  /** Displacement statistics */
  stats: {
    meanMagnitude: number;
    maxMagnitude: number;
    medianMagnitude: number;
    percentile95: number;
  };
}

export interface DeformableFusionConfig {
  /** Enable/disable deformable registration (default: true if WebGPU available) */
  enabled?: boolean;
  /** Block matching parameters */
  blockMatchingParams?: BlockMatchingParams;
  /** Maximum cache entries for displacement fields */
  maxCacheSize?: number;
  /** Minimum displacement magnitude to apply deformable warp (below this, skip) */
  minDisplacementThreshold?: number;
}

const DEFAULT_CONFIG: Required<DeformableFusionConfig> = {
  enabled: true,
  blockMatchingParams: {
    blockSize: 16,
    searchRadius: 32,
    alpha: 50.0,
    refinementIterations: 40,
  },
  maxCacheSize: 50,
  minDisplacementThreshold: 0.5,
};

/**
 * Manages deformable registration for fusion overlays.
 *
 * Caches displacement fields keyed by slice identity so repeated
 * requests for the same slice pair don't re-run the GPU pipeline.
 */
export class DeformableFusionManager {
  private config: Required<DeformableFusionConfig>;
  private cache = new Map<string, { field: DisplacementField; timestamp: number }>();
  private webgpuAvailable: boolean;

  constructor(config?: DeformableFusionConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.blockMatchingParams) {
      this.config.blockMatchingParams = {
        ...DEFAULT_CONFIG.blockMatchingParams,
        ...config.blockMatchingParams,
      };
    }
    this.webgpuAvailable = isWebGPUAvailable();
  }

  /**
   * Whether deformable registration is available and enabled.
   */
  get isAvailable(): boolean {
    return this.webgpuAvailable && this.config.enabled;
  }

  /**
   * Compute deformable registration and warp the moving slice to match the fixed slice.
   *
   * @param fixedPixels  - Float32Array of the fixed (primary) slice in row-major order
   * @param movingPixels - Float32Array of the moving (secondary) slice in row-major order
   * @param width        - Image width
   * @param height       - Image height
   * @param cacheKey     - Optional key for caching (e.g., `${primarySOP}:${secondarySOP}`)
   * @param params       - Override block matching params for this call
   */
  async warpSlice(
    fixedPixels: Float32Array,
    movingPixels: Float32Array,
    width: number,
    height: number,
    cacheKey?: string,
    params?: BlockMatchingParams,
  ): Promise<DeformableWarpResult> {
    if (!this.isAvailable) {
      throw new Error('Deformable registration unavailable: WebGPU not supported or disabled');
    }

    // Check cache
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const warpedPixels = applyDisplacementField(movingPixels, cached.field);
        const stats = displacementFieldStats(cached.field);
        return {
          warpedPixels,
          width,
          height,
          displacementField: cached.field,
          timing: { blockMatching: 0, interpolation: 0, refinement: 0, readback: 0, total: 0 },
          stats,
        };
      }
    }

    // Run GPU pipeline
    const matchParams = params ?? this.config.blockMatchingParams;
    const result = await computeBlockMatchingDisplacement(
      fixedPixels,
      movingPixels,
      width,
      height,
      matchParams,
    );

    const stats = displacementFieldStats(result.displacementField);

    // Cache the displacement field
    if (cacheKey) {
      this.cache.set(cacheKey, {
        field: result.displacementField,
        timestamp: Date.now(),
      });
      this.evictCache();
    }

    // If displacement is negligible, return moving image as-is
    if (stats.medianMagnitude < this.config.minDisplacementThreshold) {
      console.log(
        `[deformable-fusion] Median displacement ${stats.medianMagnitude.toFixed(2)}px below threshold ` +
        `(${this.config.minDisplacementThreshold}px), skipping warp`,
      );
      return {
        warpedPixels: movingPixels,
        width,
        height,
        displacementField: result.displacementField,
        timing: result.timing,
        stats,
      };
    }

    // Apply displacement field (CPU — could be moved to GPU warp shader for perf)
    const warpedPixels = applyDisplacementField(movingPixels, result.displacementField);

    console.log(
      `[deformable-fusion] Warp complete: ` +
      `median=${stats.medianMagnitude.toFixed(1)}px, max=${stats.maxMagnitude.toFixed(1)}px, ` +
      `p95=${stats.percentile95.toFixed(1)}px | ` +
      `GPU: match=${result.timing.blockMatching.toFixed(0)}ms, ` +
      `interp=${result.timing.interpolation.toFixed(0)}ms, ` +
      `refine=${result.timing.refinement.toFixed(0)}ms, ` +
      `total=${result.timing.total.toFixed(0)}ms`,
    );

    return {
      warpedPixels,
      width,
      height,
      displacementField: result.displacementField,
      timing: result.timing,
      stats,
    };
  }

  /**
   * Get a cached displacement field (if available) without re-running the pipeline.
   */
  getCachedField(cacheKey: string): DisplacementField | null {
    return this.cache.get(cacheKey)?.field ?? null;
  }

  /**
   * Clear all cached displacement fields.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Update configuration. Clears cache if block matching params change.
   */
  updateConfig(config: Partial<DeformableFusionConfig>): void {
    const paramsChanged = config.blockMatchingParams !== undefined;
    Object.assign(this.config, config);
    if (config.blockMatchingParams) {
      this.config.blockMatchingParams = {
        ...DEFAULT_CONFIG.blockMatchingParams,
        ...config.blockMatchingParams,
      };
    }
    if (paramsChanged) {
      this.clearCache();
    }
  }

  /**
   * Release all GPU and cache resources.
   */
  destroy(): void {
    this.clearCache();
    releaseGPUResources();
  }

  private evictCache(): void {
    if (this.cache.size <= this.config.maxCacheSize) return;
    // Evict oldest entries
    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.length - this.config.maxCacheSize;
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
  }
}

/**
 * Singleton instance for global use within the fusion system.
 */
let globalManager: DeformableFusionManager | null = null;

export function getDeformableFusionManager(config?: DeformableFusionConfig): DeformableFusionManager {
  if (!globalManager) {
    globalManager = new DeformableFusionManager(config);
  }
  return globalManager;
}

export function destroyDeformableFusionManager(): void {
  globalManager?.destroy();
  globalManager = null;
}
