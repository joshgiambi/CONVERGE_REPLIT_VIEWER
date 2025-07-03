import React, { useState, useCallback, useRef, useEffect } from 'react';

export enum BrushOperation {
  ADDITIVE = 'additive',
  SUBTRACTIVE = 'subtractive'
}

interface Point {
  x: number;
  y: number;
}

interface PixelBrushToolProps {
  isActive: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  brushSize: number;
  selectedStructure: any;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedStructures: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata: any;
  smoothingEnabled?: boolean;
  enableSmartMode?: boolean;
  onBrushModeChange?: (mode: string) => void;
}

export const PixelBrushTool: React.FC<PixelBrushToolProps> = ({
  isActive,
  canvasRef,
  brushSize,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  zoom,
  panX,
  panY,
  imageMetadata,
  smoothingEnabled = true,
  enableSmartMode = false,
  onBrushModeChange
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [lastPosition, setLastPosition] = useState<Point | null>(null);

  // Canvas for storing the painted mask
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Convert canvas pixel size to world units
  const brushSizePixels = Math.max(1, Math.round(brushSize * zoom * 0.85));

  // Get structure color
  const structureColor = selectedStructure && rtStructures?.structures 
    ? rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure)?.color || [255, 255, 0]
    : [255, 255, 0];

  // Convert canvas coordinates to world coordinates using CT coordinate system
  const canvasToWorld = useCallback((point: Point): [number, number, number] => {
    if (!canvasRef.current || !imageMetadata) return [0, 0, 0];
    
    const canvas = canvasRef.current;
    const sliceLocation = imageMetadata.sliceLocation ? parseFloat(imageMetadata.sliceLocation) : 0;
    
    // DICOM Patient Coordinate System parameters
    const imagePositionPatient: [number, number, number] = [-300, -300, 35];
    const pixelSpacing: [number, number] = [1.171875, 1.171875];
    const dicomImageWidth = 512;
    const dicomImageHeight = 512;
    
    // Convert canvas coordinates to DICOM pixel coordinates (accounting for zoom/pan)
    const pixelX = (point.x / canvas.width) * dicomImageWidth;
    const pixelY = (point.y / canvas.height) * dicomImageHeight;
    
    // Convert DICOM pixel coordinates to world coordinates
    const worldX = imagePositionPatient[0] + pixelX * pixelSpacing[0];
    const worldY = imagePositionPatient[1] + pixelY * pixelSpacing[1];
    const worldZ = sliceLocation;
    
    return [worldX, worldY, worldZ];
  }, [imageMetadata]);

  // Update RT structure with new brush strokes
  const updateStructure = useCallback((worldPoints: number[][]) => {
    if (!rtStructures || !onContourUpdate || !selectedStructure) return;

    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    // Find existing contour for this slice
    let existingContour = structure.contours.find((c: any) => 
      Math.abs(c.slicePosition - currentSlicePosition) < 0.5
    );
    
    if (!existingContour) {
      // Create new contour
      structure.contours.push({
        slicePosition: currentSlicePosition,
        points: worldPoints.flat()
      });
    } else {
      // Merge with existing contour
      const existingPoints: number[][] = [];
      for (let i = 0; i < existingContour.points.length; i += 3) {
        existingPoints.push([existingContour.points[i], existingContour.points[i + 1], existingContour.points[i + 2]]);
      }
      
      const combinedPoints = [...existingPoints, ...worldPoints];
      existingContour.points = combinedPoints.flat();
    }
    
    onContourUpdate(updatedRTStructures);
  }, [rtStructures, onContourUpdate, selectedStructure, currentSlicePosition]);

  // Paint at canvas position
  const paintPixels = useCallback((canvasPoint: Point) => {
    if (!maskCanvasRef.current || !selectedStructure) return;

    // Paint visual feedback
    const ctx = maskCanvasRef.current.getContext('2d');
    if (ctx) {
      const radius = brushSizePixels / 2;
      const color = structureColor;
      
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // Convert to world coordinates and update structure
    const [worldX, worldY, worldZ] = canvasToWorld(canvasPoint);
    const pixelSpacing = 1.171875;
    const worldBrushRadius = brushSizePixels * pixelSpacing * 0.5;
    const worldPoints: number[][] = [];
    
    // Create circular brush in world coordinates
    const segments = 8;
    for (let i = 0; i < segments; i++) {
      const angle = (i * 2 * Math.PI) / segments;
      const x = worldX + worldBrushRadius * Math.cos(angle);
      const y = worldY + worldBrushRadius * Math.sin(angle);
      worldPoints.push([x, y, worldZ]);
    }
    
    updateStructure(worldPoints);
  }, [brushSizePixels, structureColor, selectedStructure, canvasToWorld, updateStructure]);

  // Draw brush preview
  const drawBrushPreview = useCallback((canvasPoint: Point) => {
    if (!previewCanvasRef.current) return;
    
    const ctx = previewCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
    
    const radius = brushSizePixels / 2;
    const color = structureColor;
    
    ctx.save();
    ctx.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }, [brushSizePixels, structureColor]);

  // Mouse event handlers
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isActive || !selectedStructure || event.button !== 0) return;

    event.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setIsDrawing(true);
    setLastPosition(canvasPoint);
    paintPixels(canvasPoint);
  }, [isActive, selectedStructure, paintPixels]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);
    drawBrushPreview(canvasPoint);

    if (isDrawing) {
      paintPixels(canvasPoint);
      setLastPosition(canvasPoint);
    }
  }, [isDrawing, drawBrushPreview, paintPixels]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      setLastPosition(null);
    }
  }, [isDrawing]);

  // Create overlay canvases
  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      if (maskCanvasRef.current) {
        maskCanvasRef.current.remove();
        maskCanvasRef.current = null;
      }
      if (previewCanvasRef.current) {
        previewCanvasRef.current.remove();
        previewCanvasRef.current = null;
      }
      return;
    }

    const mainCanvas = canvasRef.current;
    const canvasContainer = mainCanvas.parentElement;
    if (!canvasContainer) return;
    
    // Create mask canvas
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mainCanvas.width;
    maskCanvas.height = mainCanvas.height;
    maskCanvas.style.position = 'absolute';
    maskCanvas.style.top = '0';
    maskCanvas.style.left = '0';
    maskCanvas.style.pointerEvents = 'none';
    maskCanvas.style.zIndex = '5';
    maskCanvas.style.opacity = '0.3';
    
    // Create preview canvas
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = mainCanvas.width;
    previewCanvas.height = mainCanvas.height;
    previewCanvas.style.position = 'absolute';
    previewCanvas.style.top = '0';
    previewCanvas.style.left = '0';
    previewCanvas.style.pointerEvents = 'none';
    previewCanvas.style.zIndex = '6';
    
    canvasContainer.appendChild(maskCanvas);
    canvasContainer.appendChild(previewCanvas);
    
    maskCanvasRef.current = maskCanvas;
    previewCanvasRef.current = previewCanvas;

    return () => {
      if (maskCanvas.parentElement) maskCanvas.remove();
      if (previewCanvas.parentElement) previewCanvas.remove();
    };
  }, [isActive]);

  // Add event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp]);

  return null;
};