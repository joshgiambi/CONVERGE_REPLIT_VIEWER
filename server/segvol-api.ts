/**
 * SegVol API Integration
 * Express routes for communicating with SegVol Python service
 */

import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';

const router = Router();

// SegVol service configuration
const SEGVOL_SERVICE_URL = process.env.SEGVOL_SERVICE_URL || 'http://127.0.0.1:5002';
const SEGVOL_TIMEOUT = parseInt(process.env.SEGVOL_TIMEOUT || '30000'); // 30 seconds

interface SegVolPredictionRequest {
  reference_contour: number[][];
  reference_slice_data: number[];
  target_slice_data: number[];
  reference_slice_position: number;
  target_slice_position: number;
  image_shape: [number, number];
  spacing?: [number, number, number];
}

interface SegVolPredictionResponse {
  predicted_contour: number[][];
  confidence: number;
  method: string;
  metadata?: any;
}

/**
 * Health check for SegVol service
 */
router.get('/segvol/health', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${SEGVOL_SERVICE_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000), // 5 second timeout for health check
    });

    if (!response.ok) {
      throw new Error(`SegVol service returned ${response.status}`);
    }

    const data = await response.json();
    res.json({
      status: 'ok',
      segvol_service: data,
      service_url: SEGVOL_SERVICE_URL,
    });
  } catch (error: any) {
    console.error('SegVol health check failed:', error);
    res.status(503).json({
      status: 'error',
      error: error.message,
      segvol_available: false,
      service_url: SEGVOL_SERVICE_URL,
    });
  }
});

/**
 * Predict next slice using SegVol
 */
router.post('/segvol/predict', async (req: Request, res: Response) => {
  try {
    const requestData: SegVolPredictionRequest = req.body;

    // Validate required fields
    const requiredFields = [
      'reference_contour',
      'reference_slice_data',
      'target_slice_data',
      'reference_slice_position',
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

    // Forward request to SegVol service
    const response = await fetch(`${SEGVOL_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(SEGVOL_TIMEOUT),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `SegVol service returned ${response.status}`);
    }

    const predictionData: SegVolPredictionResponse = await response.json();

    res.json(predictionData);
  } catch (error: any) {
    console.error('SegVol prediction failed:', error);

    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return res.status(504).json({
        error: 'SegVol prediction timed out',
        timeout: SEGVOL_TIMEOUT,
      });
    }

    res.status(500).json({
      error: error.message || 'Prediction failed',
      fallback_available: true, // Client can fall back to geometric prediction
    });
  }
});

/**
 * Batch prediction for multiple slices
 */
router.post('/segvol/predict-batch', async (req: Request, res: Response) => {
  try {
    const { reference_contour, reference_slice_data, reference_slice_position, image_shape, spacing, targets } = req.body;

    if (!targets || !Array.isArray(targets)) {
      return res.status(400).json({
        error: 'Missing or invalid targets array',
      });
    }

    // Forward batch request to SegVol service
    const response = await fetch(`${SEGVOL_SERVICE_URL}/predict_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference_contour,
        reference_slice_data,
        reference_slice_position,
        image_shape,
        spacing,
        targets,
      }),
      signal: AbortSignal.timeout(SEGVOL_TIMEOUT * 2), // Longer timeout for batch
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `SegVol service returned ${response.status}`);
    }

    const predictionData = await response.json();

    res.json(predictionData);
  } catch (error: any) {
    console.error('SegVol batch prediction failed:', error);

    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return res.status(504).json({
        error: 'SegVol batch prediction timed out',
        timeout: SEGVOL_TIMEOUT * 2,
      });
    }

    res.status(500).json({
      error: error.message || 'Batch prediction failed',
    });
  }
});

/**
 * Get SegVol model info
 */
router.get('/segvol/info', async (req: Request, res: Response) => {
  res.json({
    model: 'SegVol',
    version: '1.0.0',
    description: 'Universal and Interactive Volumetric Medical Image Segmentation',
    parameters: '181M',
    capabilities: [
      'CT segmentation',
      'Point/box prompts',
      'Volumetric prediction',
      'Zoom-out-zoom-in mechanism',
    ],
    service_url: SEGVOL_SERVICE_URL,
    timeout: SEGVOL_TIMEOUT,
    paper: 'https://arxiv.org/abs/2311.13385',
    github: 'https://github.com/BAAI-DCAI/SegVol',
  });
});

export default router;
