/**
 * Mem3D Client API
 * Frontend wrapper for communicating with Mem3D backend service
 *
 * Mem3D: Memory-augmented Volumetric Network for Interactive Segmentation
 * Features: Slice memory, quality assessment, next-slice recommendation
 */

export interface Mem3DReferenceSlice {
  slice_data: number[];
  mask: number[];
  position: number;
  image_shape: [number, number];
}

export interface Mem3DPredictionRequest {
  reference_slices: Mem3DReferenceSlice[];
  target_slice_data: number[];
  target_slice_position: number;
  image_shape: [number, number];
  interaction_type?: 'contour' | 'scribble' | 'bbox' | 'clicks';
}

export interface Mem3DPredictionResult {
  predicted_mask: number[];
  confidence: number;
  quality_score: number;
  method: string;
  memory_size: number;
  metadata?: {
    used_slices: number[];
    distance_to_nearest: number;
  };
}

export interface Mem3DRecommendation {
  position: number;
  priority?: number;
  gap_size?: number;
  reason: string;
}

export interface Mem3DRecommendationResponse {
  recommended: Mem3DRecommendation[];
  memory_coverage: number;
  coverage_range: number[];
}

export interface Mem3DHealthStatus {
  status: 'ok' | 'error';
  mem3d_service?: {
    status: string;
    model_loaded: boolean;
    device: string;
    memory_size: number;
  };
  mem3d_available: boolean;
  service_url: string;
  error?: string;
}

/**
 * Mem3D API Client
 */
export class Mem3DClient {
  private baseUrl: string;
  private timeout: number;
  private isAvailable: boolean | null = null;

  constructor(baseUrl: string = '/api', timeout: number = 30000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Check if Mem3D service is available and healthy
   */
  async checkHealth(): Promise<Mem3DHealthStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/mem3d/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      this.isAvailable = data.status === 'ok' && data.mem3d_service?.model_loaded;

      return data;
    } catch (error: any) {
      console.warn('Mem3D health check failed:', error);
      this.isAvailable = false;
      return {
        status: 'error',
        mem3d_available: false,
        service_url: '',
        error: error.message,
      };
    }
  }

  /**
   * Predict with memory-augmented network
   */
  async predictWithMemory(params: Mem3DPredictionRequest): Promise<Mem3DPredictionResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/mem3d/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error: any) {
      console.error('Mem3D prediction failed:', error);

      if (error.name === 'AbortError') {
        throw new Error('Mem3D prediction timed out. Try using geometric prediction instead.');
      }

      throw new Error(`Mem3D prediction failed: ${error.message}`);
    }
  }

  /**
   * Get recommendation for next slice to annotate
   */
  async recommendNextSlice(
    currentPosition: number,
    direction: 'superior' | 'inferior' | 'both' = 'both'
  ): Promise<Mem3DRecommendationResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/mem3d/recommend-slice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_position: currentPosition,
          direction,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error: any) {
      console.error('Mem3D recommendation failed:', error);
      throw new Error(`Mem3D recommendation failed: ${error.message}`);
    }
  }

  /**
   * Clear memory (useful when switching structures)
   */
  async clearMemory(): Promise<{ status: string; message: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/mem3d/clear-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error: any) {
      console.error('Mem3D clear memory failed:', error);
      throw new Error(`Clear memory failed: ${error.message}`);
    }
  }

  /**
   * Get Mem3D model information
   */
  async getInfo(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/mem3d/info`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('Failed to get Mem3D info:', error);
      throw error;
    }
  }

  /**
   * Check if Mem3D is currently available (cached result)
   */
  getAvailability(): boolean | null {
    return this.isAvailable;
  }
}

// Singleton instance
export const mem3dClient = new Mem3DClient();
