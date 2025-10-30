/**
 * SegVol Client API
 * Frontend wrapper for communicating with SegVol backend service
 */

export interface SegVolPredictionRequest {
  reference_contour: number[][];
  reference_slice_data: number[];
  target_slice_data: number[];
  reference_slice_position: number;
  target_slice_position: number;
  image_shape: [number, number];
  spacing?: [number, number, number];
  volume_slices?: number[][];  // Optional: All available DICOM slices (N × H×W flattened)
  volume_positions?: number[];  // Optional: Z positions for each slice
}

export interface SegVolPredictionResult {
  predicted_contour: number[][];
  confidence: number;
  method: string;
  metadata?: {
    num_points: number;
    slice_distance: number;
    interpolated_slices: number;
  };
}

export interface SegVolHealthStatus {
  status: 'ok' | 'error';
  segvol_service?: {
    status: string;
    model_loaded: boolean;
    device: string;
  };
  segvol_available: boolean;
  service_url: string;
  error?: string;
}

/**
 * SegVol API Client
 */
export class SegVolClient {
  private baseUrl: string;
  private timeout: number;
  private isAvailable: boolean | null = null;

  constructor(baseUrl: string = '/api', timeout: number = 30000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Check if SegVol service is available and healthy
   */
  async checkHealth(): Promise<SegVolHealthStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second health check timeout

      const response = await fetch(`${this.baseUrl}/segvol/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      this.isAvailable = data.status === 'ok' && data.segvol_service?.model_loaded;

      return data;
    } catch (error: any) {
      console.warn('SegVol health check failed:', error);
      this.isAvailable = false;
      return {
        status: 'error',
        segvol_available: false,
        service_url: '',
        error: error.message,
      };
    }
  }

  /**
   * Predict contour on target slice using SegVol
   */
  async predictNextSlice(params: SegVolPredictionRequest): Promise<SegVolPredictionResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/segvol/predict`, {
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
      console.error('SegVol prediction failed:', error);

      if (error.name === 'AbortError') {
        throw new Error('SegVol prediction timed out. Try using geometric prediction instead.');
      }

      throw new Error(`SegVol prediction failed: ${error.message}`);
    }
  }

  /**
   * Batch prediction for multiple slices
   */
  async predictBatch(
    referenceContour: number[][],
    referenceSliceData: number[],
    referenceSlicePosition: number,
    imageShape: [number, number],
    targets: Array<{ slice_data: number[]; slice_position: number }>,
    spacing?: [number, number, number]
  ): Promise<{ predictions: Array<SegVolPredictionResult & { slice_position: number }> }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout * 2);

      const response = await fetch(`${this.baseUrl}/segvol/predict-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference_contour: referenceContour,
          reference_slice_data: referenceSliceData,
          reference_slice_position: referenceSlicePosition,
          image_shape: imageShape,
          spacing,
          targets,
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
      console.error('SegVol batch prediction failed:', error);

      if (error.name === 'AbortError') {
        throw new Error('SegVol batch prediction timed out');
      }

      throw new Error(`SegVol batch prediction failed: ${error.message}`);
    }
  }

  /**
   * Get SegVol model information
   */
  async getInfo(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/segvol/info`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('Failed to get SegVol info:', error);
      throw error;
    }
  }

  /**
   * Check if SegVol is currently available (cached result)
   */
  getAvailability(): boolean | null {
    return this.isAvailable;
  }
}

// Singleton instance
export const segvolClient = new SegVolClient();
