import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ClipperLib, ClipType, JoinType, EndType, PolyFillType } from "js-angusj-clipper/web";
import clamp from "lodash/clamp";

interface Point {
  x: number;
  y: number;
}

enum BrushOperation {
  ADDITIVE = 'ADDITIVE',
  SUBTRACTIVE = 'SUBTRACTIVE'
}

interface SimpleBrushProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedStructures: any) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  currentImage?: any;
  imageMetadata?: any;
  onBrushSizeChange?: (size: number) => void;
}

const SCALING_FACTOR = 1000;

export function SimpleBrushTool({
  canvasRef,
  isActive,
  brushSize,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  zoom = 1,
  panX = 0,
  panY = 0,
  currentImage,
  imageMetadata,
  onBrushSizeChange
}: SimpleBrushProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [operationLocked, setOperationLocked] = useState(false);
  const [lastWorldPosition, setLastWorldPosition] = useState<Point | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentBrushSize, setCurrentBrushSize] = useState(brushSize);
  const [strokePoints, setStrokePoints] = useState<Point[]>([]);

  // Update brush size when prop changes
  useEffect(() => {
    setCurrentBrushSize(brushSize);
  }, [brushSize]);

  // Create separate cursor canvas for better performance with stable sizing
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;

    if (!cursorCanvasRef.current) {
      const cursorCanvas = document.createElement('canvas');
      cursorCanvas.className = 'brush-cursor';
      cursorCanvas.style.position = 'absolute';
      cursorCanvas.style.top = '0';
      cursorCanvas.style.left = '0';
      cursorCanvas.style.pointerEvents = 'none';
      cursorCanvas.style.zIndex = '1000';
      mainCanvas.parentElement?.appendChild(cursorCanvas);
      cursorCanvasRef.current = cursorCanvas;
    }

    const cursorCanvas = cursorCanvasRef.current;

    // Get the computed styles to avoid flashing issues
    const computedStyle = window.getComputedStyle(mainCanvas);
    const rect = mainCanvas.getBoundingClientRect();

    // Set canvas dimensions to match main canvas exactly
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = computedStyle.width;
    cursorCanvas.style.height = computedStyle.height;
    cursorCanvas.style.left = `${rect.left - mainCanvas.parentElement!.getBoundingClientRect().left}px`;
    cursorCanvas.style.top = `${rect.top - mainCanvas.parentElement!.getBoundingClientRect().top}px`;

    return () => {
      if (cursorCanvasRef.current) {
        cursorCanvasRef.current.remove();
        cursorCanvasRef.current = null;
      }
    };
  }, [isActive]);

  // Update cursor canvas positioning when zoom/pan changes
  useEffect(() => {
    if (!cursorCanvasRef.current || !canvasRef.current || !isActive) return;

    const mainCanvas = canvasRef.current;
    const cursorCanvas = cursorCanvasRef.current;
    const computedStyle = window.getComputedStyle(mainCanvas);
    const rect = mainCanvas.getBoundingClientRect();

    // Update positioning to match main canvas
    cursorCanvas.style.width = computedStyle.width;
    cursorCanvas.style.height = computedStyle.height;
    cursorCanvas.style.left = `${rect.left - mainCanvas.parentElement!.getBoundingClientRect().left}px`;
    cursorCanvas.style.top = `${rect.top - mainCanvas.parentElement!.getBoundingClientRect().top}px`;
  }, [zoom, panX, panY, isActive]);

  // Professional DICOM coordinate transformation with medical scaling
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !canvasRef.current) return null;

    try {
      const canvas = canvasRef.current;
      const imageWidth = currentImage.width || 512;
      const imageHeight = currentImage.height || 512;

      // Calculate image display parameters
      const baseScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
      const totalScale = baseScale * zoom;
      const scaledWidth = imageWidth * totalScale;
      const scaledHeight = imageHeight * totalScale;

      // Image position on canvas (centered)
      const imageX = (canvas.width - scaledWidth) / 2 + panX;
      const imageY = (canvas.height - scaledHeight) / 2 + panY;

      // Convert canvas to image pixel coordinates
      const pixelX = (canvasX - imageX) / totalScale;
      const pixelY = (canvasY - imageY) / totalScale;

      // Bounds check
      if (pixelX < 0 || pixelX >= imageWidth || pixelY < 0 || pixelY >= imageHeight) {
        return null;
      }

      // Professional DICOM transformation
      if (imageMetadata?.imagePosition && imageMetadata?.pixelSpacing && imageMetadata?.imageOrientation) {
        const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
        const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
        const imageOrientation = imageMetadata.imageOrientation.split('\\').map(Number);

        // Build transformation matrix
        const rowCosines = imageOrientation.slice(0, 3);
        const colCosines = imageOrientation.slice(3, 6);

        // Apply DICOM transformation
        const worldX = imagePosition[0] + 
                       (pixelX * rowCosines[0] * pixelSpacing[0]) + 
                       (pixelY * colCosines[0] * pixelSpacing[1]);

        const worldY = imagePosition[1] + 
                       (pixelX * rowCosines[1] * pixelSpacing[0]) + 
                       (pixelY * colCosines[1] * pixelSpacing[1]);

        return { x: worldX, y: worldY };
      }

      // Fallback transformation
      const scale = 0.8;
      const centerX = imageWidth / 2;
      const centerY = imageHeight / 2;
      return {
        x: (pixelX - centerX) / scale,
        y: (pixelY - centerY) / scale
      };

    } catch (error) {
      console.error('Error in coordinate transformation:', error);
      return null;
    }
  }, [currentImage, imageMetadata, zoom, panX, panY]);

  // Professional polygon union/difference operations with ClipperLib
  const performPolygonOperation = useCallback((existingPoints: number[], brushPoints: Point[]): number[] => {
    if (!ClipperLib) {
      console.warn('ClipperLib not available, using fallback');
      return existingPoints;
    }

    try {
      // Convert existing points to ClipperLib format
      const existingPolygons: Point[][] = [];
      if (existingPoints.length >= 6) {
        const polygon: Point[] = [];
        for (let i = 0; i < existingPoints.length; i += 3) {
          polygon.push({
            x: Math.round(existingPoints[i] * SCALING_FACTOR),
            y: Math.round(existingPoints[i + 1] * SCALING_FACTOR)
          });
        }
        existingPolygons.push(polygon);
      }

      // Convert brush points to ClipperLib format
      const brushPolygons: Point[][] = [];
      if (brushPoints.length > 0) {
        const polygon: Point[] = [];
        for (const point of brushPoints) {
          polygon.push({
            x: Math.round(point.x * SCALING_FACTOR),
            y: Math.round(point.y * SCALING_FACTOR)
          });
        }
        brushPolygons.push(polygon);
      }

      // If no existing polygons and additive operation, just return brush polygon
      if (existingPolygons.length === 0 && operation === BrushOperation.ADDITIVE) {
        const resultPoints: number[] = [];
        for (const point of brushPoints) {
          resultPoints.push(point.x, point.y, currentSlicePosition);
        }
        return resultPoints;
      }

      // If no existing polygons and subtractive operation, return empty
      if (existingPolygons.length === 0 && operation === BrushOperation.SUBTRACTIVE) {
        return [];
      }

      // Perform boolean operation
      const clipType = operation === BrushOperation.ADDITIVE ? ClipType.Union : ClipType.Difference;
      const result = ClipperLib.clipToPolyTree({
        clipType,
        subjectInputs: existingPolygons.map(polygon => ({ data: polygon, closed: true })),
        clipInputs: brushPolygons.map(polygon => ({ data: polygon, closed: true })),
        subjectFillType: PolyFillType.NonZero,
      });

      // Convert result back to DICOM format
      const resultPaths = ClipperLib.polyTreeToPaths(result);
      const resultPoints: number[] = [];

      for (const path of resultPaths) {
        for (const point of path) {
          resultPoints.push(
            point.x / SCALING_FACTOR,
            point.y / SCALING_FACTOR,
            currentSlicePosition
          );
        }
      }

      return resultPoints;
    } catch (error) {
      console.error('ClipperLib operation failed:', error);
      return existingPoints;
    }
  }, [operation, currentSlicePosition]);

  // Professional brush stroke generation with ClipperLib offset
  const createBrushStroke = useCallback((startPoint: Point, endPoint: Point, radius: number): Point[] => {
    if (!ClipperLib) {
      console.warn('ClipperLib not available, using fallback circle');
      // Fallback to simple circle
      const points: Point[] = [];
      const numPoints = 32;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        points.push({
          x: endPoint.x + Math.cos(angle) * radius,
          y: endPoint.y + Math.sin(angle) * radius
        });
      }
      return points;
    }

    try {
      // Create line segment
      const lineSegment = [
        { x: Math.round(startPoint.x * SCALING_FACTOR), y: Math.round(startPoint.y * SCALING_FACTOR) },
        { x: Math.round(endPoint.x * SCALING_FACTOR), y: Math.round(endPoint.y * SCALING_FACTOR) }
      ];

      // Create offset path (brush stroke)
      const offsetPath = ClipperLib.offsetToPolyTree({
        delta: Math.round(radius * SCALING_FACTOR),
        offsetInputs: [{
          joinType: JoinType.Round,
          endType: EndType.OpenRound,
          data: [lineSegment],
        }],
      });

      if (!offsetPath) return [];

      // Convert to points
      const paths = ClipperLib.polyTreeToPaths(offsetPath);
      const points: Point[] = [];

      for (const path of paths) {
        for (const point of path) {
          points.push({
            x: point.x / SCALING_FACTOR,
            y: point.y / SCALING_FACTOR
          });
        }
      }

      return points;
    } catch (error) {
      console.error('Error creating brush stroke:', error);
      return [];
    }
  }, []);

  // Create brush polygon for static brush (when not moving)
  const createBrushPolygon = useCallback((centerPoint: Point, radius: number): Point[] => {
    const points: Point[] = [];
    const numPoints = 32;

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      points.push({
        x: centerPoint.x + Math.cos(angle) * radius,
        y: centerPoint.y + Math.sin(angle) * radius
      });
    }

    return points;
  }, []);

  // Check if point is inside existing contour for smart operation detection
  const isInsideContour = useCallback((worldPoint: Point): boolean => {
    if (!selectedStructure || !rtStructures) return false;

    try {
      // Handle different RT structure formats
      let structure;
      if (rtStructures.structures) {
        structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
      } else if (rtStructures.roiContourSequence) {
        structure = rtStructures.roiContourSequence.find((s: any) => s.roiNumber === selectedStructure);
      } else {
        structure = rtStructures.find((s: any) => s.roiNumber === selectedStructure);
      }

      if (!structure || !structure.contourSequence) return false;

      // Find contour for current slice
      const existingContour = structure.contourSequence.find((contour: any) => 
        contour.slicePosition === currentSlicePosition
      );

      if (!existingContour || !existingContour.contourData || existingContour.contourData.length < 6) {
        return false;
      }

      // Convert contour to ClipperLib format for point-in-polygon test
      if (ClipperLib) {
        try {
          const polygon: Point[] = [];
          for (let i = 0; i < existingContour.contourData.length; i += 3) {
            polygon.push({
              x: Math.round(existingContour.contourData[i] * SCALING_FACTOR),
              y: Math.round(existingContour.contourData[i + 1] * SCALING_FACTOR)
            });
          }

          const testPoint = {
            x: Math.round(worldPoint.x * SCALING_FACTOR),
            y: Math.round(worldPoint.y * SCALING_FACTOR)
          };

          const result = ClipperLib.pointInPolygon(testPoint, polygon);
          return result !== 0; // 0 = outside, 1 = inside, -1 = on boundary
        } catch (error) {
          console.error('Error in point-in-polygon test:', error);
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking if point is inside contour:', error);
      return false;
    }
  }, [selectedStructure, rtStructures, currentSlicePosition]);

  // Professional operation detection with locking
  const updateBrushOperation = useCallback((worldPoint: Point) => {
    if (operationLocked) return; // Don't change operation during stroke

    const inside = isInsideContour(worldPoint);

    if (shiftPressed) {
      setOperation(inside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
    } else {
      setOperation(inside ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE);
    }
  }, [isInsideContour, shiftPressed, operationLocked]);

  // Helper functions for data structure handling
  const getStructure = useCallback((rtStructures: any, selectedStructure: number) => {
    if (rtStructures.structures) {
      return rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    } else if (rtStructures.roiContourSequence) {
      return rtStructures.roiContourSequence.find((s: any) => s.roiNumber === selectedStructure);
    } else if (Array.isArray(rtStructures)) {
      return rtStructures.find((s: any) => s.roiNumber === selectedStructure);
    }
    return null;
  }, []);

  const getContour = useCallback((structure: any, slicePosition: number) => {
    if (structure.contourSequence) {
      return structure.contourSequence.find((contour: any) => 
        contour.slicePosition === slicePosition
      );
    } else if (structure.contours) {
      return structure.contours.find((contour: any) => 
        Math.abs(contour.slicePosition - slicePosition) <= 2.0
      );
    }
    return null;
  }, []);

  // Apply brush stroke to RT structure data
  const applyBrushStroke = useCallback((worldPoints: Point[]) => {
    console.log('applyBrushStroke called with:', {
      pointsCount: worldPoints.length,
      selectedStructure,
      hasRTStructures: !!rtStructures
    });

    if (worldPoints.length === 0 || !selectedStructure || !rtStructures) {
      console.log('Early return due to missing data');
      return;
    }

    try {
      const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
      const structure = getStructure(updatedRTStructures, selectedStructure);

      if (!structure) {
        console.log('No structure found for selected structure:', selectedStructure);
        return;
      }

      // Initialize contour sequence if needed
      if (!structure.contourSequence) {
        structure.contourSequence = [];
      }

      // Find exact slice match (DICOM standard)
      let existingContour = getContour(structure, currentSlicePosition);

      // Create brush stroke path from accumulated points
      let brushPolygon: Point[] = [];
      if (worldPoints.length === 1) {
        // Single point - create circle
        brushPolygon = createBrushPolygon(worldPoints[0], currentBrushSize / (2 * zoom));
      } else {
        // Multiple points - create stroke path
        for (let i = 0; i < worldPoints.length - 1; i++) {
          const strokeSegment = createBrushStroke(worldPoints[i], worldPoints[i + 1], currentBrushSize / (2 * zoom));
          brushPolygon = brushPolygon.concat(strokeSegment);
        }
      }

      if (existingContour) {
        // Apply professional polygon operation
        const resultPoints = performPolygonOperation(existingContour.contourData, brushPolygon);
        existingContour.contourData = resultPoints;
        existingContour.numberOfContourPoints = resultPoints.length / 3;
      } else if (operation === BrushOperation.ADDITIVE) {
        // Create new contour
        const contourData: number[] = [];
        for (const point of brushPolygon) {
          contourData.push(point.x, point.y, currentSlicePosition);
        }

        structure.contourSequence.push({
          slicePosition: currentSlicePosition,
          contourData: contourData,
          numberOfContourPoints: contourData.length / 3,
          contourGeometricType: 'CLOSED_PLANAR'
        });
      }

      onContourUpdate(updatedRTStructures);
    } catch (error) {
      console.error('Error applying brush stroke:', error);
    }
  }, [selectedStructure, rtStructures, currentSlicePosition, onContourUpdate, currentBrushSize, operation, zoom, createBrushPolygon, performPolygonOperation, createBrushStroke, getStructure, getContour]);

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftPressed(true);
      if (event.key === 'Control' || event.key === 'Meta') setCtrlPressed(true);

      // Brush size adjustment
      if (ctrlPressed && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        const newSize = clamp(currentBrushSize + 2, 1, 100);
        setCurrentBrushSize(newSize);
        onBrushSizeChange?.(newSize);
      }
      if (ctrlPressed && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        const newSize = clamp(currentBrushSize - 2, 1, 100);
        setCurrentBrushSize(newSize);
        onBrushSizeChange?.(newSize);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftPressed(false);
      if (event.key === 'Control' || event.key === 'Meta') setCtrlPressed(false);
    };

    if (isActive) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive, ctrlPressed, currentBrushSize, onBrushSizeChange]);

  // Mouse event handlers with proper useCallback
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isActive) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasPos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPos);

    const worldPos = canvasToWorld(canvasPos.x, canvasPos.y);
    if (worldPos) {
      updateBrushOperation(worldPos);

      if (isDrawing && lastWorldPosition) {
        // Add point to stroke
        setStrokePoints(prev => [...prev, worldPos]);
        setLastWorldPosition(worldPos);
      }
    }
  }, [canvasToWorld, updateBrushOperation, isDrawing, lastWorldPosition, isActive]);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isActive || event.button !== 0) return; // Only left mouse button when active

    event.preventDefault();
    event.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasPos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    const worldPos = canvasToWorld(canvasPos.x, canvasPos.y);
    if (worldPos) {
      console.log('Starting brush stroke at:', worldPos);
      setIsDrawing(true);
      setOperationLocked(true);
      setLastWorldPosition(worldPos);
      setStrokePoints([worldPos]);
    }
  }, [canvasToWorld, isActive]);

  const handleMouseUp = useCallback(() => {
    if (!isActive) return;

    if (isDrawing && strokePoints.length > 0) {
      console.log('Applying brush stroke with', strokePoints.length, 'points');
      // Apply complete stroke
      applyBrushStroke(strokePoints);
    }

    setIsDrawing(false);
    setOperationLocked(false);
    setLastWorldPosition(null);
    setStrokePoints([]);
  }, [isDrawing, strokePoints, applyBrushStroke, isActive]);

  // Wheel event handler for brush size adjustment
  const handleWheel = useCallback((event: WheelEvent) => {
    if (!isActive || !ctrlPressed) return;

    event.preventDefault();
    event.stopPropagation();

    const delta = event.deltaY > 0 ? -2 : 2;
    const newSize = clamp(currentBrushSize + delta, 1, 100);

    setCurrentBrushSize(newSize);
    if (onBrushSizeChange) {
      onBrushSizeChange(newSize);
    }
  }, [isActive, ctrlPressed, currentBrushSize, onBrushSizeChange]);

  // Mouse event handlers with wheel support
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const canvas = canvasRef.current;

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [isActive, handleMouseMove, handleMouseDown, handleMouseUp, handleWheel]);

  // Render brush cursor on separate canvas (eliminates flashing)
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition || !isActive) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    // Clear previous cursor
    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);

    // Draw brush cursor as proper circle
    ctx.save();

    // Main brush circle outline
    ctx.strokeStyle = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([]); // Solid line, not dashed
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, currentBrushSize / 2, 0, 2 * Math.PI);
    ctx.stroke();

    // Inner semi-transparent fill to show brush area
    ctx.fillStyle = operation === BrushOperation.ADDITIVE ? '#00ff0015' : '#ff000015';
    ctx.fill();

    // Draw operation indicator (crosshair) - smaller and centered
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';

    const size = 8;
    ctx.beginPath();
    if (operation === BrushOperation.ADDITIVE) {
      // Draw cross for additive
      ctx.moveTo(mousePosition.x - size, mousePosition.y);
      ctx.lineTo(mousePosition.x + size, mousePosition.y);
      ctx.moveTo(mousePosition.x, mousePosition.y - size);
      ctx.lineTo(mousePosition.x, mousePosition.y + size);
    } else {
      // Draw horizontal line for subtractive
      ctx.moveTo(mousePosition.x - size, mousePosition.y);
      ctx.lineTo(mousePosition.x + size, mousePosition.y);
    }
    ctx.stroke();

    // Center dot for precise positioning
    ctx.fillStyle = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, 2, 0, 2 * Math.PI);
    ctx.fill();

    ctx.restore();
  }, [mousePosition, currentBrushSize, operation, isActive]);

  return null; // This component renders directly to the canvas
}