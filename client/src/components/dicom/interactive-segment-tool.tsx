/**
 * Interactive Segment Tool
 *
 * Self-contained tool for 3D tumor segmentation using nnInteractive.
 * User draws simple brush strokes on key slices, AI generates full 3D volume.
 *
 * Features:
 * - Scribble-based annotation
 * - 3D volumetric prediction
 * - Active learning (recommends next slice to annotate)
 * - Preview/Accept/Reject workflow
 * - Minimal integration with working-viewer
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Sparkles,
  Check,
  X,
  RefreshCw,
  Trash2,
  Lightbulb,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { nninteractiveClient, Scribble } from '@/lib/nninteractive-client';

interface InteractiveSegmentToolProps {
  // Canvas context for drawing
  canvasRef: React.RefObject<HTMLCanvasElement>;

  // Current slice info
  currentSliceIndex: number;
  totalSlices: number;

  // Image data for segmentation
  imageVolume?: number[][][];  // Full 3D volume (Z, Y, X)
  voxelSpacing?: [number, number, number];  // mm

  // Selected structure
  selectedStructureId?: number;
  selectedStructureName?: string;
  selectedStructureColor?: string;

  // Callbacks
  onContourGenerated?: (contour: number[][][], structureId: number) => void;
  onClose?: () => void;

  // Visibility
  isActive: boolean;
}

interface ScribbleStroke {
  slice: number;
  points: number[][];
  label: number;  // 1 = foreground, 0 = background
  timestamp: number;
}

type ToolMode = 'draw' | 'erase';
type WorkflowState = 'annotating' | 'processing' | 'preview' | 'error';

export const InteractiveSegmentTool: React.FC<InteractiveSegmentToolProps> = ({
  canvasRef,
  currentSliceIndex,
  totalSlices,
  imageVolume,
  voxelSpacing = [1.0, 1.0, 1.0],
  selectedStructureId,
  selectedStructureName = 'Tumor',
  selectedStructureColor = '#ff0000',
  onContourGenerated,
  onClose,
  isActive
}) => {
  // State
  const [toolMode, setToolMode] = useState<ToolMode>('draw');
  const [workflowState, setWorkflowState] = useState<WorkflowState>('annotating');
  const [scribbles, setScribbles] = useState<ScribbleStroke[]>([]);
  const [predictedMask, setPredictedMask] = useState<number[][][] | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [recommendedSlice, setRecommendedSlice] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<number[][]>([]);
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);

  // Refs
  const canvasOverlayRef = useRef<HTMLCanvasElement>(null);
  const rafIdRef = useRef<number>(0);

  // Check service availability
  useEffect(() => {
    if (isActive) {
      nninteractiveClient.checkHealth().then(health => {
        setServiceAvailable(health.nninteractive_available);
      });
    }
  }, [isActive]);

  // Get annotated slices
  const annotatedSlices = useMemo(() => {
    return Array.from(new Set(scribbles.map(s => s.slice))).sort((a, b) => a - b);
  }, [scribbles]);

  // Statistics
  const stats = useMemo(() => {
    const totalAnnotated = annotatedSlices.length;
    const coverage = totalSlices > 0 ? (totalAnnotated / totalSlices) * 100 : 0;

    return {
      totalAnnotated,
      coverage: Math.round(coverage)
    };
  }, [annotatedSlices, totalSlices]);

  // Drawing handlers
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setIsDrawing(true);
    setCurrentStroke([[x, y]]);
  }, [isActive, canvasRef]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDrawing || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setCurrentStroke(prev => [...prev, [x, y]]);

    // Render stroke preview
    renderStrokePreview();
  }, [isDrawing, canvasRef]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || currentStroke.length === 0) return;

    // Save scribble
    const newScribble: ScribbleStroke = {
      slice: currentSliceIndex,
      points: currentStroke,
      label: toolMode === 'draw' ? 1 : 0,
      timestamp: Date.now()
    };

    setScribbles(prev => [...prev, newScribble]);
    setIsDrawing(false);
    setCurrentStroke([]);

    // Clear preview
    if (canvasOverlayRef.current) {
      const ctx = canvasOverlayRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasOverlayRef.current.width, canvasOverlayRef.current.height);
      }
    }
  }, [isDrawing, currentStroke, currentSliceIndex, toolMode]);

  // Attach mouse listeners
  useEffect(() => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp, canvasRef]);

  // Render stroke preview
  const renderStrokePreview = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      const overlay = canvasOverlayRef.current;
      if (!overlay || !currentStroke || currentStroke.length < 2) return;

      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // Draw stroke
      ctx.strokeStyle = toolMode === 'draw' ? selectedStructureColor : '#ffffff';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(currentStroke[0][0], currentStroke[0][1]);

      for (let i = 1; i < currentStroke.length; i++) {
        ctx.lineTo(currentStroke[i][0], currentStroke[i][1]);
      }

      ctx.stroke();
    });
  }, [currentStroke, toolMode, selectedStructureColor]);

  // Render existing scribbles
  const renderScribbles = useCallback(() => {
    const overlay = canvasOverlayRef.current;
    if (!overlay) return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Draw scribbles on current slice
    const currentSliceScribbles = scribbles.filter(s => s.slice === currentSliceIndex);

    currentSliceScribbles.forEach(scribble => {
      ctx.strokeStyle = scribble.label === 1 ? selectedStructureColor : '#ffffff';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (scribble.points.length < 2) return;

      ctx.beginPath();
      ctx.moveTo(scribble.points[0][0], scribble.points[0][1]);

      for (let i = 1; i < scribble.points.length; i++) {
        ctx.lineTo(scribble.points[i][0], scribble.points[i][1]);
      }

      ctx.stroke();
    });
  }, [scribbles, currentSliceIndex, selectedStructureColor]);

  // Re-render scribbles when slice changes
  useEffect(() => {
    renderScribbles();
  }, [currentSliceIndex, scribbles, renderScribbles]);

  // Run segmentation
  const handleSegment = async () => {
    if (!imageVolume || scribbles.length === 0) {
      setErrorMessage('Please draw scribbles on at least one slice');
      setWorkflowState('error');
      return;
    }

    setWorkflowState('processing');
    setErrorMessage('');

    try {
      // Convert scribbles to API format
      const apiScribbles: Scribble[] = scribbles.map(s => ({
        slice: s.slice,
        points: s.points,
        label: s.label
      }));

      // Call API
      const result = await nninteractiveClient.segment({
        volume: imageVolume,
        scribbles: apiScribbles,
        spacing: voxelSpacing
      });

      // Update state
      setPredictedMask(result.mask);
      setConfidence(result.confidence);
      setRecommendedSlice(result.recommended_slice);
      setWorkflowState('preview');

    } catch (error) {
      console.error('Segmentation failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Segmentation failed');
      setWorkflowState('error');
    }
  };

  // Accept prediction
  const handleAccept = () => {
    if (!predictedMask || !selectedStructureId) return;

    // Convert mask to contours and pass to parent
    onContourGenerated?.(predictedMask, selectedStructureId);

    // Reset tool
    handleReset();
    onClose?.();
  };

  // Reject prediction
  const handleReject = () => {
    setPredictedMask(null);
    setConfidence(0);
    setRecommendedSlice(null);
    setWorkflowState('annotating');
  };

  // Clear all scribbles
  const handleClearAll = () => {
    setScribbles([]);
    setPredictedMask(null);
    setConfidence(0);
    setRecommendedSlice(null);
    setWorkflowState('annotating');

    if (canvasOverlayRef.current) {
      const ctx = canvasOverlayRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasOverlayRef.current.width, canvasOverlayRef.current.height);
    }
  };

  // Reset tool
  const handleReset = () => {
    handleClearAll();
    setToolMode('draw');
    setErrorMessage('');
  };

  // Jump to recommended slice
  const handleJumpToRecommended = () => {
    if (recommendedSlice !== null) {
      // Parent needs to handle slice navigation
      // For now, just show message
      console.log('Jump to slice:', recommendedSlice);
    }
  };

  // Render overlay canvas
  useEffect(() => {
    const mainCanvas = canvasRef.current;
    const overlay = canvasOverlayRef.current;

    if (!mainCanvas || !overlay) return;

    // Match overlay size to main canvas
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;
    overlay.style.width = mainCanvas.style.width;
    overlay.style.height = mainCanvas.style.height;
  }, [canvasRef]);

  if (!isActive) return null;

  return (
    <>
      {/* Overlay canvas for scribbles */}
      <canvas
        ref={canvasOverlayRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: workflowState === 'annotating' ? 'auto' : 'none',
          cursor: toolMode === 'draw' ? 'crosshair' : 'cell',
          zIndex: 1000
        }}
      />

      {/* Floating control panel */}
      <Card
        className="absolute top-4 right-4 z-[1001] w-80 p-4 bg-black/90 border-purple-500/50"
        style={{ pointerEvents: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Interactive Tumor Segment</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Service status */}
        {serviceAvailable === false && (
          <div className="flex items-center gap-2 mb-4 p-2 bg-red-500/20 border border-red-500/50 rounded text-xs">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-red-300">nnInteractive service offline</span>
          </div>
        )}

        {/* Structure info */}
        <div className="mb-4 p-2 bg-white/5 rounded">
          <div className="text-xs text-gray-400">Segmenting:</div>
          <div className="text-sm font-medium text-white">{selectedStructureName}</div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="p-2 bg-white/5 rounded">
            <div className="text-xs text-gray-400">Annotated Slices</div>
            <div className="text-lg font-bold text-white">{stats.totalAnnotated}</div>
          </div>
          <div className="p-2 bg-white/5 rounded">
            <div className="text-xs text-gray-400">Coverage</div>
            <div className="text-lg font-bold text-white">{stats.coverage}%</div>
          </div>
        </div>

        {/* Workflow states */}
        {workflowState === 'annotating' && (
          <>
            {/* Tool mode selector */}
            <div className="flex gap-2 mb-4">
              <Button
                variant={toolMode === 'draw' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setToolMode('draw')}
                className="flex-1"
              >
                Draw Tumor
              </Button>
              <Button
                variant={toolMode === 'erase' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setToolMode('erase')}
                className="flex-1"
              >
                Erase
              </Button>
            </div>

            {/* Instructions */}
            <div className="text-xs text-gray-400 mb-4 p-2 bg-white/5 rounded">
              <ol className="list-decimal list-inside space-y-1">
                <li>Draw scribbles on tumor in 3-5 key slices</li>
                <li>Click "Generate 3D Segmentation"</li>
                <li>Review and refine if needed</li>
              </ol>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleSegment}
                disabled={scribbles.length === 0 || serviceAvailable === false}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generate 3D
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                disabled={scribbles.length === 0}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}

        {workflowState === 'processing' && (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-purple-400" />
            <div className="text-sm text-white mb-2">Generating 3D segmentation...</div>
            <div className="text-xs text-gray-400">This may take 30-60 seconds</div>
          </div>
        )}

        {workflowState === 'preview' && predictedMask && (
          <>
            {/* Confidence score */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">Confidence</span>
                <span className="text-sm font-bold text-white">
                  {Math.round(confidence * 100)}%
                </span>
              </div>
              <Progress value={confidence * 100} className="h-2" />
            </div>

            {/* Recommended slice */}
            {recommendedSlice !== null && (
              <div className="mb-4 p-2 bg-blue-500/20 border border-blue-500/50 rounded">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-blue-400" />
                  <div className="flex-1">
                    <div className="text-xs text-blue-300">Recommended next slice</div>
                    <div className="text-sm font-bold text-white">Slice {recommendedSlice}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleJumpToRecommended}
                    className="text-xs"
                  >
                    Jump
                  </Button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={handleAccept}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                <Check className="w-4 h-4 mr-2" />
                Accept
              </Button>
              <Button
                onClick={handleReject}
                variant="outline"
                className="flex-1"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refine
              </Button>
            </div>
          </>
        )}

        {workflowState === 'error' && (
          <>
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-red-300 mb-1">Error</div>
                  <div className="text-xs text-red-200">{errorMessage}</div>
                </div>
              </div>
            </div>

            <Button
              onClick={() => setWorkflowState('annotating')}
              className="w-full"
              variant="outline"
            >
              Try Again
            </Button>
          </>
        )}

        {/* Current slice indicator */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-xs text-gray-400">
            Current Slice: {currentSliceIndex + 1} / {totalSlices}
            {annotatedSlices.includes(currentSliceIndex) && (
              <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 h-4">
                Annotated
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </>
  );
};
