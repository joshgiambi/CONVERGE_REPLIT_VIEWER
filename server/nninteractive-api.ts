/**
 * nnInteractive API Routes
 *
 * Express middleware for interactive 3D tumor segmentation.
 * Now proxies requests to SegVol service for medical-specific volumetric segmentation.
 */

import { Router, Request, Response } from 'express';
import axios, { AxiosError } from 'axios';

const router = Router();

// Configuration - Now using SegVol service on port 8001
const NNINTERACTIVE_SERVICE_URL = process.env.NNINTERACTIVE_SERVICE_URL || 'http://127.0.0.1:8001';
const REQUEST_TIMEOUT = parseInt(process.env.NNINTERACTIVE_TIMEOUT || '60000', 10);

// Axios instance with timeout
const nninteractiveClient = axios.create({
  baseURL: NNINTERACTIVE_SERVICE_URL,
  timeout: REQUEST_TIMEOUT,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Health check endpoint
 * GET /api/nninteractive/health
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const response = await nninteractiveClient.get('/health', { timeout: 5000 });

    // SegVol service returns: {status: "healthy", model_loaded: true, device: "cpu"}
    const isHealthy = response.data.status === 'healthy' && response.data.model_loaded === true;

    res.json({
      status: 'healthy',
      nninteractive_available: isHealthy,
      device: response.data.device || 'unknown',
      mock_mode: false,  // SegVol is real medical AI model
      service_url: NNINTERACTIVE_SERVICE_URL
    });
  } catch (error) {
    const axiosError = error as AxiosError;

    console.error('SegVol health check failed:', axiosError.message);

    res.status(503).json({
      status: 'unavailable',
      nninteractive_available: false,
      error: axiosError.message,
      service_url: NNINTERACTIVE_SERVICE_URL
    });
  }
});

/**
 * 3D Segmentation endpoint
 * POST /api/nninteractive/segment
 *
 * Body:
 * {
 *   volume: number[][][],           // 3D volume data (Z, Y, X)
 *   scribbles: Array<{              // User scribble annotations
 *     slice: number,
 *     points: number[][],           // [[x,y], ...]
 *     label: number                 // 1 for foreground, 0 for background
 *   }>,
 *   spacing: [number, number, number],  // Voxel spacing [z, y, x] in mm
 *   point_prompts?: Array<{         // Optional point prompts
 *     slice: number,
 *     point: [number, number],
 *     label: number
 *   }>,
 *   box_prompt?: {                  // Optional bounding box
 *     slice: number,
 *     box: [number, number, number, number]  // [x1, y1, x2, y2]
 *   }
 * }
 *
 * Response:
 * {
 *   mask: number[][][],             // 3D binary mask
 *   confidence: number,             // 0-1 confidence score
 *   recommended_slice: number | null // Next slice to annotate
 * }
 */
router.post('/segment', async (req: Request, res: Response) => {
  try {
    const {
      volume,
      scribbles,
      spacing,
      point_prompts,
      box_prompt
    } = req.body;

    // Validate required fields
    if (!volume || !Array.isArray(volume)) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'volume array is required'
      });
    }

    if (!scribbles || !Array.isArray(scribbles)) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'scribbles array is required'
      });
    }

    console.log(`SegVol tumor segmentation request: volume shape=[${volume.length},${volume[0]?.length},${volume[0]?.[0]?.length}], scribbles=${scribbles.length}`);

    // Forward to SegVol Python service
    const startTime = Date.now();
    const response = await nninteractiveClient.post('/segment', {
      volume,
      scribbles,
      spacing: spacing || [1.0, 1.0, 1.0],
      point_prompts,
      box_prompt
    });

    const elapsed = Date.now() - startTime;
    console.log(`SegVol tumor segmentation complete: ${elapsed}ms, confidence=${response.data.confidence}`);

    res.json({
      mask: response.data.mask,
      confidence: response.data.confidence,
      recommended_slice: response.data.recommended_slice,
      inference_time_ms: elapsed
    });

  } catch (error) {
    const axiosError = error as AxiosError;

    console.error('SegVol tumor segmentation failed:', axiosError.message);
    console.error('Response data:', axiosError.response?.data);

    res.status(500).json({
      error: 'Tumor segmentation failed',
      details: axiosError.response?.data || axiosError.message
    });
  }
});

/**
 * Single slice segmentation endpoint (faster for quick feedback)
 * POST /api/nninteractive/segment-slice
 *
 * Body:
 * {
 *   slice: number[][],              // 2D image data
 *   scribbles: Array<{
 *     points: number[][],
 *     label: number
 *   }>,
 *   spacing: [number, number]       // Pixel spacing [y, x] in mm
 * }
 *
 * Response:
 * {
 *   mask: number[][],               // 2D binary mask
 *   confidence: number
 * }
 */
router.post('/segment-slice', async (req: Request, res: Response) => {
  try {
    const { slice, scribbles, spacing } = req.body;

    if (!slice || !Array.isArray(slice)) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'slice array is required'
      });
    }

    if (!scribbles || !Array.isArray(scribbles)) {
      return res.status(400).json({
        error: 'Invalid request',
        details: 'scribbles array is required'
      });
    }

    console.log(`nnInteractive slice segmentation: slice shape=[${slice.length},${slice[0]?.length}], scribbles=${scribbles.length}`);

    const startTime = Date.now();
    const response = await nninteractiveClient.post('/segment-slice', {
      slice,
      scribbles,
      spacing: spacing || [1.0, 1.0]
    });

    const elapsed = Date.now() - startTime;
    console.log(`nnInteractive slice segmentation complete: ${elapsed}ms`);

    res.json({
      mask: response.data.mask,
      confidence: response.data.confidence,
      inference_time_ms: elapsed
    });

  } catch (error) {
    const axiosError = error as AxiosError;

    console.error('nnInteractive slice segmentation failed:', axiosError.message);

    res.status(500).json({
      error: 'Slice segmentation failed',
      details: axiosError.response?.data || axiosError.message
    });
  }
});

export default router;
