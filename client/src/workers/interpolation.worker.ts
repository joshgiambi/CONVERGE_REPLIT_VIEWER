/**
 * Interpolation Web Worker
 * 
 * Handles contour interpolation off the main thread to prevent UI blocking.
 * Supports progressive updates for instant visual feedback.
 */

import { fastPolarInterpolateMulti } from '../lib/fast-polar-interpolation';
import { interpolateBetweenContoursSDTMulti } from '../lib/sdt-interpolation';

export interface InterpolationRequest {
  action: 'interpolate';
  structureId: number;
  gaps: Array<{
    zA: number;
    zB: number;
    contoursA: Array<{ points: number[] }>;
    contoursB: Array<{ points: number[] }>;
    targetZs: number[];
  }>;
  options?: {
    algorithm?: 'polar' | 'sdt';
    bins?: number;
    progressive?: boolean;
    batchSize?: number;
  };
}

export interface InterpolationProgressMessage {
  type: 'progress';
  structureId: number;
  completed: number;
  total: number;
  newContours: Array<{ slicePosition: number; points: number[]; numberOfPoints: number }>;
}

export interface InterpolationCompleteMessage {
  type: 'complete';
  structureId: number;
  totalInterpolated: number;
  allNewContours: Array<{ slicePosition: number; points: number[]; numberOfPoints: number }>;
}

export interface InterpolationErrorMessage {
  type: 'error';
  structureId: number;
  error: string;
}

type WorkerMessage = InterpolationProgressMessage | InterpolationCompleteMessage | InterpolationErrorMessage;

/**
 * Process a single gap between two slices
 */
function processGap(
  gap: InterpolationRequest['gaps'][0],
  algorithm: 'polar' | 'sdt',
  bins: number
): Array<{ slicePosition: number; points: number[]; numberOfPoints: number }> {
  const results: Array<{ slicePosition: number; points: number[]; numberOfPoints: number }> = [];
  
  for (const targetZ of gap.targetZs) {
    try {
      let points: number[] = [];
      
      if (algorithm === 'sdt') {
        // Use high-quality SDT interpolation
        try {
          points = interpolateBetweenContoursSDTMulti(
            gap.contoursA, gap.zA, 
            gap.contoursB, gap.zB, 
            targetZ,
            { 
              gridSpacingMm: 0.25, 
              paddingMm: 3, 
              adaptiveMinCells: 180, 
              pivotPiecewise: true, 
              pivotMode: 'euclidean', 
              closingMm: 0.3 
            }
          );
        } catch (sdtError) {
          // Fallback to polar if SDT fails
          console.warn(`SDT failed at z=${targetZ}, falling back to polar:`, sdtError);
          points = fastPolarInterpolateMulti(gap.contoursA, gap.zA, gap.contoursB, gap.zB, targetZ, bins);
        }
      } else {
        // Use fast polar interpolation (default)
        points = fastPolarInterpolateMulti(gap.contoursA, gap.zA, gap.contoursB, gap.zB, targetZ, bins);
      }
      
      if (points && points.length >= 9) {
        results.push({
          slicePosition: targetZ,
          points: points,
          numberOfPoints: points.length / 3
        });
      }
    } catch (error) {
      console.error(`Failed to interpolate at z=${targetZ}:`, error);
    }
  }
  
  return results;
}

/**
 * Main worker message handler
 */
self.onmessage = function(e: MessageEvent<InterpolationRequest>) {
  const request = e.data;
  
  if (request.action !== 'interpolate') {
    return;
  }
  
  const { structureId, gaps, options = {} } = request;
  const algorithm = options.algorithm || 'polar';
  const bins = options.bins || 128;
  const progressive = options.progressive !== false; // default true
  const batchSize = options.batchSize || 5;
  
  try {
    const allNewContours: Array<{ slicePosition: number; points: number[]; numberOfPoints: number }> = [];
    let totalSlices = 0;
    
    // Count total slices to interpolate
    for (const gap of gaps) {
      totalSlices += gap.targetZs.length;
    }
    
    let completed = 0;
    
    // Process gaps
    for (const gap of gaps) {
      const gapResults = processGap(gap, algorithm, bins);
      allNewContours.push(...gapResults);
      completed += gap.targetZs.length;
      
      // Send progressive update if enabled
      if (progressive && gapResults.length > 0) {
        const progressMessage: InterpolationProgressMessage = {
          type: 'progress',
          structureId,
          completed,
          total: totalSlices,
          newContours: gapResults
        };
        self.postMessage(progressMessage);
      }
    }
    
    // Send completion message
    const completeMessage: InterpolationCompleteMessage = {
      type: 'complete',
      structureId,
      totalInterpolated: allNewContours.length,
      allNewContours
    };
    self.postMessage(completeMessage);
    
  } catch (error: any) {
    const errorMessage: InterpolationErrorMessage = {
      type: 'error',
      structureId,
      error: error?.message || String(error)
    };
    self.postMessage(errorMessage);
  }
};

