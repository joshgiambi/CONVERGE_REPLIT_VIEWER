/**
 * MEM3D Fast Shape-Aware Propagation Client
 * Connects to the fast_propagation_service running on port 5002
 */

export interface Mem3dReferenceSlice {
  slice_data: number[];
  mask: number[];
  position: number;
}

export interface Mem3dPredictionRequest {
  reference_slices: Mem3dReferenceSlice[];
  target_slice_data: number[];
  target_slice_position: number;
  image_shape: [number, number];
}

export interface Mem3dPredictionResponse {
  predicted_mask: number[];
  confidence: number;
  quality_score: number;
  method: string;
  mask_sum: number;
}

class Mem3dClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = '/api/mem3d';
  }

  async predict(request: Mem3dPredictionRequest): Promise<Mem3dPredictionResponse> {
    const response = await fetch(`${this.baseUrl}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `MEM3D prediction failed: ${response.status}`);
    }

    return await response.json();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const mem3dClient = new Mem3dClient();
