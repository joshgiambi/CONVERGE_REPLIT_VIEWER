import React, { useState, useCallback, useRef, useEffect } from 'react';

interface Point {
  x: number;
  y: number;
}

interface BrushToolProps {
  isActive: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedStructures: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata: any;
  smoothingEnabled: boolean;
  enableSmartMode: boolean;
  onBrushModeChange: (mode: any) => void;
}

export const BrushTool: React.FC<BrushToolProps> = ({
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
  smoothingEnabled,
  enableSmartMode,
  onBrushModeChange
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const strokePoints = useRef<Point[]>([]);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Get structure color
  const getStructureColor = (): [number, number, number] => {
    if (!selectedStructure || !rtStructures?.structures) return [255, 255, 0];
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    return structure?.color || [255, 255, 0];
  };

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): [number, number, number] => {
    if (!canvasRef.current || !imageMetadata) return [0, 0, 0];

    // DICOM coordinate system constants
    const imagePositionPatient = [-300, -300, 35]; // From HN-ATLAS dataset
    const pixelSpacing = [1.171875, 1.171875];
    const imageWidth = 512;
    const imageHeight = 512;

    // Convert canvas coordinates to DICOM pixel coordinates
    const canvas = canvasRef.current;
    const pixelX = (canvasX / canvas.width) * imageWidth;
    const pixelY = (canvasY / canvas.height) * imageHeight;

    // Convert to world coordinates
    const worldX = imagePositionPatient[0] + pixelX * pixelSpacing[0];
    const worldY = imagePositionPatient[1] + pixelY * pixelSpacing[1];
    const worldZ = currentSlicePosition;

    return [worldX, worldY, worldZ];
  }, [imageMetadata, currentSlicePosition]);

  // Create brush stroke and update RT structure
  const addBrushStroke = useCallback((canvasPoint: Point) => {
    if (!selectedStructure || !rtStructures) return;

    const [worldX, worldY, worldZ] = canvasToWorld(canvasPoint.x, canvasPoint.y);
    
    // Create circular brush points in world coordinates
    const worldBrushRadius = brushSize * 0.5; // Convert to world units
    const segments = 8;
    const brushPoints: number[] = [];

    for (let i = 0; i < segments; i++) {
      const angle = (i * 2 * Math.PI) / segments;
      const x = worldX + worldBrushRadius * Math.cos(angle);
      const y = worldY + worldBrushRadius * Math.sin(angle);
      brushPoints.push(x, y, worldZ);
    }

    // Update RT structure
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    // Find or create contour for current slice
    let contour = structure.contours.find((c: any) => 
      Math.abs(c.slicePosition - currentSlicePosition) < 0.5
    );

    if (!contour) {
      contour = {
        slicePosition: currentSlicePosition,
        points: brushPoints
      };
      structure.contours.push(contour);
    } else {
      // Merge with existing contour
      const existingPoints = contour.points;
      contour.points = [...existingPoints, ...brushPoints];
    }

    onContourUpdate(updatedRTStructures);
  }, [selectedStructure, rtStructures, brushSize, currentSlicePosition, canvasToWorld, onContourUpdate]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!isActive || !selectedStructure || e.button !== 0) return;

    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    setIsDrawing(true);
    strokePoints.current = [canvasPoint];
    addBrushStroke(canvasPoint);
  }, [isActive, selectedStructure, addBrushStroke]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    setMousePosition(canvasPoint);

    if (isDrawing && selectedStructure) {
      strokePoints.current.push(canvasPoint);
      addBrushStroke(canvasPoint);
    }
  }, [isDrawing, selectedStructure, addBrushStroke]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      strokePoints.current = [];
    }
  }, [isDrawing]);

  // Set up event listeners
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

  // Create cursor overlay
  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      if (cursorCanvasRef.current) {
        cursorCanvasRef.current.remove();
        cursorCanvasRef.current = null;
      }
      return;
    }

    const mainCanvas = canvasRef.current;
    const canvasContainer = mainCanvas.parentElement;
    if (!canvasContainer) return;

    const cursorCanvas = document.createElement('canvas');
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.position = 'absolute';
    cursorCanvas.style.top = '0';
    cursorCanvas.style.left = '0';
    cursorCanvas.style.pointerEvents = 'none';
    cursorCanvas.style.zIndex = '999';

    canvasContainer.appendChild(cursorCanvas);
    cursorCanvasRef.current = cursorCanvas;

    return () => {
      if (cursorCanvas.parentElement) {
        cursorCanvas.remove();
      }
    };
  }, [isActive]);

  // Draw cursor
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition || !isActive) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);

    const [r, g, b] = getStructureColor();
    const radius = brushSize / 2;

    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = ctx.strokeStyle;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, 2, 0, 2 * Math.PI);
    ctx.fill();
  }, [mousePosition, brushSize, isActive, getStructureColor]);

  return null;
};