/**
 * FusionOverlayManager - Clean fusion implementation following OHIF/Cornerstone3D patterns
 * 
 * Principles:
 * - Fusion is non-blocking - primary CT always renders
 * - Simple cache: Map<primarySOP, overlayCanvas>
 * - Failed lookups just skip the overlay for that slice
 * - Registration resolved once when secondary is activated
 */

import { getFusedSlice, getFusedSliceSmart, fuseboxSliceToImageData, type FuseboxSlice } from './fusion-utils';

export interface OverlayCanvas {
  canvas: HTMLCanvasElement;
  hasSignal: boolean;
  timestamp: number;
  registrationId: string | null;
  transformSource: string | null;
}

export class FusionOverlayManager {
  private cache = new Map<string, OverlayCanvas>();
  private primarySeriesId: number;
  private secondarySeriesId: number | null = null;
  private secondaryModality: string = 'PT';
  private maxCacheSize = 100;

  constructor(primarySeriesId: number) {
    this.primarySeriesId = primarySeriesId;
  }

  /**
   * Activate fusion with a secondary series
   */
  setSecondary(secondarySeriesId: number | null, modality?: string) {
    if (secondarySeriesId !== this.secondarySeriesId) {
      this.cache.clear(); // Clear cache when switching secondaries
      this.secondarySeriesId = secondarySeriesId;
      if (modality) this.secondaryModality = modality;
    }
  }

  /**
   * Get fusion overlay for a primary image
   * Returns null if fusion is disabled or fails
   * Non-blocking - caller should handle null gracefully
   */
  async getOverlay(
    primarySopUID: string,
    primaryIndex: number,
    primaryInstanceNumber: number | null,
    primaryPosition: number[] | null
  ): Promise<OverlayCanvas | null> {
    if (!this.secondarySeriesId) return null;

    const cacheKey = `${primarySopUID}:${this.secondarySeriesId}`;
    
    // Return cached overlay if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // Try exact SOP match first
      let slice: FuseboxSlice;
      try {
        slice = await getFusedSlice(
          this.primarySeriesId,
          this.secondarySeriesId,
          primarySopUID
        );
      } catch (e) {
        // Fallback to smart matching by position/instance number
        slice = await getFusedSliceSmart(
          this.primarySeriesId,
          this.secondarySeriesId,
          primarySopUID,
          primaryInstanceNumber,
          primaryIndex,
          primaryPosition && primaryPosition.length >= 3 ? [primaryPosition[0], primaryPosition[1], primaryPosition[2]] : null
        );
      }

      // Convert to canvas
      const overlayData = fuseboxSliceToImageData(slice, this.secondaryModality);
      if (!overlayData) return null;

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = overlayData.imageData.width;
      overlayCanvas.height = overlayData.imageData.height;
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return null;

      ctx.putImageData(overlayData.imageData, 0, 0);

      const result: OverlayCanvas = {
        canvas: overlayCanvas,
        hasSignal: overlayData.hasSignal ?? false,
        timestamp: Date.now(),
        registrationId: slice.registrationId ?? null,
        transformSource: slice.transformSource ?? null,
      };

      // Cache it
      this.cache.set(cacheKey, result);
      
      // Limit cache size
      if (this.cache.size > this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return result;
    } catch (error) {
      // Fusion failed for this slice - that's OK, just return null
      console.warn(`Fusion overlay unavailable for ${primarySopUID.slice(-10)}:`, error);
      return null;
    }
  }

  /**
   * Clear all cached overlays
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get current secondary series ID
   */
  getSecondaryId(): number | null {
    return this.secondarySeriesId;
  }
}
