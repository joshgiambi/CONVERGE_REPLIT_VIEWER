/**
 * nnInteractive Client
 *
 * TypeScript client for interactive 3D tumor segmentation using nnInteractive.
 * Provides clean API for scribble-based volumetric segmentation.
 */

export interface Scribble {
  slice: number;
  points: number[][];  // [[x, y], ...]
  label: number;       // 1 = foreground, 0 = background
}

export interface PointPrompt {
  slice: number;
  point: [number, number];
  label: number;
}

export interface BoxPrompt {
  slice: number;
  box: [number, number, number, number];  // [x1, y1, x2, y2]
}

export interface SegmentationRequest {
  volume: number[][][];           // 3D volume (Z, Y, X)
  scribbles: Scribble[];
  spacing: [number, number, number];  // Voxel spacing [z, y, x] in mm
  point_prompts?: PointPrompt[];
  box_prompt?: BoxPrompt;
}

export interface SegmentationResponse {
  mask: number[][][];             // 3D binary mask
  confidence: number;             // 0-1 confidence score
  recommended_slice: number | null;  // Next slice to annotate
  inference_time_ms?: number;
}

export interface SliceSegmentationRequest {
  slice: number[][];              // 2D image
  scribbles: Array<{
    points: number[][];
    label: number;
  }>;
  spacing: [number, number];      // Pixel spacing [y, x]
}

export interface SliceSegmentationResponse {
  mask: number[][];
  confidence: number;
  inference_time_ms?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'unavailable';
  nninteractive_available: boolean;
  device?: string;
  mock_mode?: boolean;
  service_url?: string;
  error?: string;
}

/**
 * nnInteractive API Client
 */
export class NNInteractiveClient {
  private baseUrl: string;
  private availabilityCache: {
    available: boolean | null;
    lastCheck: number;
  } = {
    available: null,
    lastCheck: 0
  };

  // Cache TTL: 30 seconds
  private readonly CACHE_TTL = 30000;

  constructor(baseUrl: string = '/api/nninteractive') {
    this.baseUrl = baseUrl;
  }

  /**
   * Check service health and availability
   */
  async checkHealth(): Promise<HealthStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return {
          status: 'unavailable',
          nninteractive_available: false,
          error: `HTTP ${response.status}`
        };
      }

      const data = await response.json();

      // Update cache
      this.availabilityCache = {
        available: data.nninteractive_available,
        lastCheck: Date.now()
      };

      return data;

    } catch (error) {
      console.error('nnInteractive health check failed:', error);

      return {
        status: 'unavailable',
        nninteractive_available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check if service is available (with caching)
   */
  async isAvailable(): Promise<boolean> {
    // Return cached value if still valid
    const now = Date.now();
    if (this.availabilityCache.available !== null &&
        now - this.availabilityCache.lastCheck < this.CACHE_TTL) {
      return this.availabilityCache.available;
    }

    // Check health
    const health = await this.checkHealth();
    return health.nninteractive_available;
  }

  /**
   * Perform 3D segmentation from scribbles
   *
   * @param request Segmentation request with volume and prompts
   * @returns Segmentation result with 3D mask
   */
  async segment(request: SegmentationRequest): Promise<SegmentationResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/segment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Segmentation failed: ${errorData.error || response.statusText}`
        );
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error('nnInteractive segmentation failed:', error);
      throw error;
    }
  }

  /**
   * Perform single-slice segmentation (faster for quick feedback)
   *
   * @param request Slice segmentation request
   * @returns 2D mask
   */
  async segmentSlice(
    request: SliceSegmentationRequest
  ): Promise<SliceSegmentationResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/segment-slice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Slice segmentation failed: ${errorData.error || response.statusText}`
        );
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error('nnInteractive slice segmentation failed:', error);
      throw error;
    }
  }

  /**
   * Invalidate availability cache (force fresh check on next call)
   */
  invalidateCache(): void {
    this.availabilityCache = {
      available: null,
      lastCheck: 0
    };
  }
}

// Singleton instance
export const nninteractiveClient = new NNInteractiveClient();
