/**
 * Mem3D API Integration
 * Express routes for communicating with Mem3D Python service
 *
 * Mem3D: Memory-augmented volumetric network for interactive segmentation
 * Features: Slice memory, quality assessment, next-slice recommendation
 */

import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Mem3D service configuration
const MEM3D_SERVICE_URL = process.env.MEM3D_SERVICE_URL || 'http://127.0.0.1:5002';
const MEM3D_TIMEOUT = parseInt(process.env.MEM3D_TIMEOUT || '30000'); // 30 seconds

interface Mem3DReferenceSlice {
  slice_data: number[];
  mask: number[];
  position: number;
  image_shape: [number, number];
}

interface Mem3DPredictionRequest {
  reference_slices: Mem3DReferenceSlice[];
  target_slice_data: number[];
  target_slice_position: number;
  image_shape: [number, number];
  interaction_type?: 'contour' | 'scribble' | 'bbox' | 'clicks';
}

interface Mem3DPredictionResponse {
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

interface Mem3DRecommendationRequest {
  current_position: number;
  direction?: 'superior' | 'inferior' | 'both';
}

interface Mem3DRecommendation {
  position: number;
  priority?: number;
  gap_size?: number;
  reason: string;
}

interface Mem3DRecommendationResponse {
  recommended: Mem3DRecommendation[];
  memory_coverage: number;
  coverage_range: number[];
}

/**
 * Health check for Mem3D service
 */
router.get('/mem3d/health', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${MEM3D_SERVICE_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(`Mem3D service returned ${response.status}`);
    }

    const data = await response.json();
    res.json({
      status: 'ok',
      mem3d_service: data,
      service_url: MEM3D_SERVICE_URL,
    });
  } catch (error: any) {
    console.error('Mem3D health check failed:', error);
    res.status(503).json({
      status: 'error',
      error: error.message,
      mem3d_available: false,
      service_url: MEM3D_SERVICE_URL,
    });
  }
});

/**
 * Predict with memory
 */
router.post('/mem3d/predict', async (req: Request, res: Response) => {
  try {
    const requestData: Mem3DPredictionRequest = req.body;

    // Validate required fields
    const requiredFields = [
      'reference_slices',
      'target_slice_data',
      'target_slice_position',
      'image_shape',
    ];

    for (const field of requiredFields) {
      if (!(field in requestData)) {
        return res.status(400).json({
          error: `Missing required field: ${field}`,
        });
      }
    }

    // Validate reference_slices is array
    if (!Array.isArray(requestData.reference_slices)) {
      return res.status(400).json({
        error: 'reference_slices must be an array',
      });
    }

    // Forward request to Mem3D service
    const response = await fetch(`${MEM3D_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(MEM3D_TIMEOUT),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Mem3D service returned ${response.status}`);
    }

    const predictionData: Mem3DPredictionResponse = await response.json();

    res.json(predictionData);
  } catch (error: any) {
    console.error('Mem3D prediction failed:', error);

    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return res.status(504).json({
        error: 'Mem3D prediction timed out',
        timeout: MEM3D_TIMEOUT,
      });
    }

    res.status(500).json({
      error: error.message || 'Prediction failed',
      fallback_available: true,
    });
  }
});

/**
 * Get next slice recommendation
 */
router.post('/mem3d/recommend-slice', async (req: Request, res: Response) => {
  try {
    const requestData: Mem3DRecommendationRequest = req.body;

    if (typeof requestData.current_position !== 'number') {
      return res.status(400).json({
        error: 'current_position is required and must be a number',
      });
    }

    // Forward request to Mem3D service
    const response = await fetch(`${MEM3D_SERVICE_URL}/recommend_slice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(5000), // Quick timeout for recommendations
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Mem3D service returned ${response.status}`);
    }

    const recommendations: Mem3DRecommendationResponse = await response.json();

    res.json(recommendations);
  } catch (error: any) {
    console.error('Mem3D recommendation failed:', error);

    res.status(500).json({
      error: error.message || 'Recommendation failed',
    });
  }
});

/**
 * Clear memory
 */
router.post('/mem3d/clear-memory', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${MEM3D_SERVICE_URL}/clear_memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Mem3D service returned ${response.status}`);
    }

    const result = await response.json();

    res.json(result);
  } catch (error: any) {
    console.error('Mem3D clear memory failed:', error);

    res.status(500).json({
      error: error.message || 'Clear memory failed',
    });
  }
});

/**
 * Get Mem3D model info
 */
router.get('/mem3d/info', async (req: Request, res: Response) => {
  res.json({
    model: 'Mem3D',
    version: '1.0.0',
    description: 'Volumetric Memory Network for Interactive Medical Image Segmentation',
    award: 'MedIA Best Paper Award 2022',
    capabilities: [
      'Memory-augmented prediction',
      'Quality assessment',
      'Next-slice recommendation',
      'Bidirectional propagation',
      'Multiple interaction types (contour/scribble/bbox/clicks)',
    ],
    service_url: MEM3D_SERVICE_URL,
    timeout: MEM3D_TIMEOUT,
    paper: 'https://www.sciencedirect.com/science/article/pii/S1361841522002316',
    github: 'https://github.com/0liliulei/Mem3D',
  });
});

export default router;
