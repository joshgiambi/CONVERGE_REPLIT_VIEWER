/**
 * Prediction Overlay Component
 * 
 * Displays ghost contours for predicted slices with confidence-based color coding
 */

import { useEffect, useRef } from 'react';
import type { PredictionResult } from '@/lib/contour-prediction';

interface PredictionOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  predictions: Map<number, PredictionResult>;
  currentSlicePosition: number;
  selectedStructureColor: number[];
  ctTransform: { scale: number; offsetX: number; offsetY: number };
  worldToCanvas: (x: number, y: number, z: number) => [number, number];
  imageMetadata?: any;
  onAcceptPrediction?: (slicePosition: number) => void;
  onRejectPrediction?: (slicePosition: number) => void;
  showLabels?: boolean;
  hasContourOnCurrentSlice?: boolean;
}

export function PredictionOverlay({
  canvasRef,
  predictions,
  currentSlicePosition,
  selectedStructureColor,
  ctTransform,
  worldToCanvas,
  imageMetadata,
  showLabels = true,
  hasContourOnCurrentSlice = false
}: PredictionOverlayProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const parentCanvas = canvasRef.current;
    
    if (!canvas || !parentCanvas) return;

    // Match parent canvas size
    canvas.width = parentCanvas.width;
    canvas.height = parentCanvas.height;
    canvas.style.width = parentCanvas.style.width;
    canvas.style.height = parentCanvas.style.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Animation loop for flowing dashes
    const animate = () => {

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only show prediction for current blank slice
    if (hasContourOnCurrentSlice) return;
    
    // Calculate adaptive tolerance based on slice spacing
    let sliceSpacing = 2.5; // Default
    if (imageMetadata?.spacingBetweenSlices) {
      sliceSpacing = parseFloat(imageMetadata.spacingBetweenSlices);
    } else if (imageMetadata?.sliceThickness) {
      sliceSpacing = parseFloat(imageMetadata.sliceThickness);
    }
    const SLICE_TOLERANCE = sliceSpacing * 0.4; // Adaptive: 40% of slice spacing
    
    // Find prediction for current slice using tolerance-based matching
    let predictionForCurrentSlice = null;
    let matchedSlicePosition = currentSlicePosition;
    
    // Try exact match first
    predictionForCurrentSlice = predictions.get(currentSlicePosition);
    
    // If no exact match, search with adaptive tolerance
    if (!predictionForCurrentSlice) {
      for (const [slicePos, prediction] of predictions.entries()) {
        if (Math.abs(slicePos - currentSlicePosition) <= SLICE_TOLERANCE) {
          predictionForCurrentSlice = prediction;
          matchedSlicePosition = slicePos;
          break;
        }
      }
    }
    
    if (!predictionForCurrentSlice || !predictionForCurrentSlice.predictedContour || predictionForCurrentSlice.predictedContour.length < 9) {
      return;
    }
    
      // Draw the prediction using the current slice position for rendering
      drawPredictionContour(
        ctx,
        predictionForCurrentSlice,
        currentSlicePosition,
        selectedStructureColor,
        worldToCanvas,
        ctTransform,
        showLabels
      );
      
      // Continue animation if we have predictions
      if (predictions.size > 0 && !hasContourOnCurrentSlice) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };
    
    // Start animation
    animate();
    
    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [predictions, currentSlicePosition, selectedStructureColor, ctTransform, worldToCanvas, canvasRef, showLabels, hasContourOnCurrentSlice]);

  return (
    <canvas
      ref={overlayCanvasRef}
      className="pointer-events-none absolute max-w-full max-h-full object-contain"
      style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 3,
        mixBlendMode: 'normal'
      }}
    />
  );
}

/**
 * Draw a single prediction contour
 */
function drawPredictionContour(
  ctx: CanvasRenderingContext2D,
  prediction: PredictionResult,
  slicePosition: number,
  baseColor: number[],
  worldToCanvas: (x: number, y: number, z: number) => [number, number],
  ctTransform: { scale: number; offsetX: number; offsetY: number },
  showLabel: boolean
) {
  const contour = prediction.predictedContour;
  const confidence = prediction.confidence;

  // Convert contour to canvas coordinates
  // IMPORTANT: Use the slice position parameter (where the prediction is FOR)
  // not the Z coordinate in the contour points (which is also slicePosition)
  const canvasPoints: [number, number][] = [];
  for (let i = 0; i < contour.length; i += 3) {
    const worldX = contour[i];
    const worldY = contour[i + 1];
    // Use slicePosition parameter to ensure correct slice
    const [canvasX, canvasY] = worldToCanvas(worldX, worldY, slicePosition);
    canvasPoints.push([canvasX, canvasY]);
  }

  if (canvasPoints.length < 3) return;

  const color = getConfidenceColor(confidence, baseColor);
  
  // Animated offset for "flowing" dashes and subtle pulse
  const time = Date.now() / 1000;
  const dashOffset = (time * 8) % 20; // Flows at 8px/second
  const pulseOpacity = 0.05 + Math.sin(time * 2) * 0.05; // Subtle pulse ±0.05

  // Draw soft shadow/glow effect underneath
  ctx.save();
  ctx.globalAlpha = 0.08 + pulseOpacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(canvasPoints[0][0], canvasPoints[0][1]);
  for (let i = 1; i < canvasPoints.length; i++) {
    ctx.lineTo(canvasPoints[i][0], canvasPoints[i][1]);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Draw very subtle filled polygon with pulse
  ctx.save();
  ctx.globalAlpha = 0.08 + pulseOpacity;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(canvasPoints[0][0], canvasPoints[0][1]);
  for (let i = 1; i < canvasPoints.length; i++) {
    ctx.lineTo(canvasPoints[i][0], canvasPoints[i][1]);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Draw main contour outline - very thin and elegant with animated dashes
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5; // Very thin, elegant line
  ctx.setLineDash([8, 4]); // Refined dashed pattern
  ctx.lineDashOffset = -dashOffset; // Animated flow
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.moveTo(canvasPoints[0][0], canvasPoints[0][1]);
  for (let i = 1; i < canvasPoints.length; i++) {
    ctx.lineTo(canvasPoints[i][0], canvasPoints[i][1]);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  
  // Draw tiny dots at vertices with subtle glow
  ctx.save();
  ctx.globalAlpha = 0.85 + pulseOpacity * 2;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  canvasPoints.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2); // Very small dots
    ctx.fill();
  });
  ctx.restore();

  // Draw simple confidence label above contour (to avoid obscuring it)
  if (showLabel && canvasPoints.length > 0) {
    // Find the topmost point (minimum Y)
    let minY = Infinity;
    let minYX = 0;
    canvasPoints.forEach(([x, y]) => {
      if (y < minY) {
        minY = y;
        minYX = x;
      }
    });

    // Position label above the contour
    const labelX = minYX;
    const labelY = minY - 25; // Position above the top edge

    // Pulse animation for label
    const time = Date.now() / 1000;
    const labelPulse = 0.85 + Math.sin(time * 2) * 0.1; // Gentle pulse 0.75-0.95

    ctx.save();
    ctx.globalAlpha = labelPulse;
    
    // Elegant modern label design
    const labelText = `${(confidence * 100).toFixed(0)}%`;
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const metrics = ctx.measureText(labelText);
    const padding = 4;
    const bgWidth = metrics.width + padding * 2;
    const bgHeight = 16;
    
    // Soft glow behind
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(
      labelX - bgWidth / 2,
      labelY - bgHeight / 2,
      bgWidth,
      bgHeight
    );
    
    // Subtle gradient border
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 3;
    ctx.strokeRect(
      labelX - bgWidth / 2,
      labelY - bgHeight / 2,
      bgWidth,
      bgHeight
    );
    
    // Text with soft glow
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.fillText(labelText, labelX, labelY);
    ctx.restore();
  }
}

/**
 * Get color based on confidence level
 * High confidence: Green, Medium: Yellow/Orange, Low: Red
 */
function getConfidenceColor(confidence: number, baseColor: number[]): string {
  if (confidence >= 0.7) {
    // High confidence: Green tint
    return `rgb(${Math.min(baseColor[0] + 50, 255)}, ${Math.min(baseColor[1] + 100, 255)}, ${baseColor[2]})`;
  } else if (confidence >= 0.5) {
    // Medium confidence: Yellow tint
    return `rgb(${Math.min(baseColor[0] + 100, 255)}, ${Math.min(baseColor[1] + 100, 255)}, ${baseColor[2]})`;
  } else if (confidence >= 0.3) {
    // Lower confidence: Orange tint
    return `rgb(${Math.min(baseColor[0] + 100, 255)}, ${Math.min(baseColor[1] + 50, 255)}, ${baseColor[2]})`;
  } else {
    // Low confidence: Red tint
    return `rgb(${Math.min(baseColor[0] + 100, 255)}, ${baseColor[2]}, ${baseColor[2]})`;
  }
}

/**
 * Simple badge component for showing prediction info
 */
export function PredictionBadge({ 
  predictions, 
  currentSlice 
}: { 
  predictions: Map<number, PredictionResult>; 
  currentSlice: number;
}) {
  const prediction = predictions.get(currentSlice);
  
  if (!prediction) return null;
  
  const imageRefinement = prediction.metadata?.imageRefinement;

  return (
    <div className="absolute top-2 right-2 bg-purple-900/90 text-white px-4 py-2 rounded-lg text-sm font-semibold z-50 border-2 border-purple-400 shadow-lg">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-purple-300 animate-pulse" />
          <span className="text-purple-100">
            {(prediction.confidence * 100).toFixed(0)}% Confidence
          </span>
          {imageRefinement?.applied && <span title="Image-aware refinement applied">🧠</span>}
        </div>
        {imageRefinement?.applied && (
          <div className="text-xs text-blue-200 ml-5">
            {imageRefinement.edgeSnapped && '✓ Edge-snapped'}
            {imageRefinement.validated && imageRefinement.similarity && (
              <span> • {Math.round(imageRefinement.similarity * 100)}% similar</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

