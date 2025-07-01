import { useEffect, useRef, useState } from 'react';
import { 
  Point,
  MultiPolygon,
  BrushOperation,
  SlicingMode
} from '@shared/schema';
import { PolygonOperationsV2 } from '@/lib/polygon-operations-v2';
import { ContourV2 } from '@/lib/contour-v2';
import { BrushToolFactoryV2, SmartBrushToolV2 } from '@/lib/brush-tool-v2';

interface V2ProfessionalBrushProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedRTStructures: any) => void;
  onBrushSizeChange: (size: number) => void;
  zoom: number;
  panX: number;
  panY: number;
  currentImage: any;
  imageMetadata: any;
}

export function V2ProfessionalBrush({
  canvasRef,
  isActive,
  brushSize,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  onBrushSizeChange,
  zoom,
  panX,
  panY,
  currentImage,
  imageMetadata
}: V2ProfessionalBrushProps) {
  // V2 Professional state management
  const [brushTool, setBrushTool] = useState<SmartBrushToolV2 | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [currentContour, setCurrentContour] = useState<ContourV2 | null>(null);

  // Initialize V2 system
  useEffect(() => {
    async function initializeV2System() {
      if (isInitialized) return;

      try {
        await PolygonOperationsV2.initialize();
        const tool = BrushToolFactoryV2.createSmartBrush();
        setBrushTool(tool);
        setIsInitialized(true);
        console.log('V2 Professional Brush System initialized');
      } catch (error) {
        console.error('Failed to initialize V2 brush system:', error);
      }
    }

    initializeV2System();
  }, [isInitialized]);

  // Update brush size
  useEffect(() => {
    if (brushTool) {
      brushTool.setBrushSize(brushSize);
    }
  }, [brushSize, brushTool]);

  // Setup target contour when structure selection changes
  useEffect(() => {
    if (!brushTool || selectedStructure === null || !rtStructures) return;

    try {
      const structure = rtStructures.find((s: any) => s.roiNumber === selectedStructure);
      if (!structure) return;

      // Find or create contour for current slice
      const sliceKey = currentSlicePosition.toString();
      let existingContour = structure.contours?.[sliceKey];
      
      let contour: ContourV2;
      
      if (existingContour && existingContour.length > 0) {
        // Convert existing contour to V2 format
        const points = existingContour.map((p: any) => ({ x: p.x, y: p.y }));
        contour = new ContourV2(
          structure.name,
          currentSlicePosition,
          SlicingMode.K,
          points
        );
      } else {
        // Create new empty contour
        contour = new ContourV2(
          structure.name,
          currentSlicePosition,
          SlicingMode.K,
          []
        );
      }

      setCurrentContour(contour);
      brushTool.setTargetContour(contour);
    } catch (error) {
      console.error('Failed to setup target contour:', error);
    }
  }, [selectedStructure, rtStructures, currentSlicePosition, brushTool]);

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = (x: number, y: number): Point => {
    return {
      x: (x - panX) / zoom,
      y: (y - panY) / zoom
    };
  };

  // Convert world coordinates to canvas coordinates
  const worldToCanvas = (point: Point): Point => {
    return {
      x: point.x * zoom + panX,
      y: point.y * zoom + panY
    };
  };

  // Mouse event handlers
  const handleMouseDown = (event: MouseEvent) => {
    if (!isActive || !brushTool || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    
    // Create a synthetic mouse event with world coordinates
    const syntheticEvent = {
      ...event,
      offsetX: worldPoint.x,
      offsetY: worldPoint.y
    } as MouseEvent;

    brushTool.onMouseDown(syntheticEvent);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    setMousePosition(worldPoint);

    if (!isActive || !brushTool) return;

    // Create a synthetic mouse event with world coordinates
    const syntheticEvent = {
      ...event,
      offsetX: worldPoint.x,
      offsetY: worldPoint.y
    } as MouseEvent;

    brushTool.onMouseMove(syntheticEvent);
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (!isActive || !brushTool) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);

    // Create a synthetic mouse event with world coordinates
    const syntheticEvent = {
      ...event,
      offsetX: worldPoint.x,
      offsetY: worldPoint.y
    } as MouseEvent;

    brushTool.onMouseUp(syntheticEvent);

    // Update the original RT structures with new contour data
    updateRTStructures();
  };

  // Update RT structures with modified contour
  const updateRTStructures = () => {
    if (!currentContour || !rtStructures || selectedStructure === null) return;

    try {
      const updatedStructures = rtStructures.map((structure: any) => {
        if (structure.roiNumber === selectedStructure) {
          const sliceKey = currentSlicePosition.toString();
          const polygons = currentContour.getCurrent();
          
          // Convert V2 MultiPolygon back to legacy format
          const legacyContour: Point[] = [];
          for (const polygon of polygons) {
            for (const ring of polygon) {
              legacyContour.push(...ring);
            }
          }

          return {
            ...structure,
            contours: {
              ...structure.contours,
              [sliceKey]: legacyContour
            }
          };
        }
        return structure;
      });

      onContourUpdate(updatedStructures);
    } catch (error) {
      console.error('Failed to update RT structures:', error);
    }
  };

  // Setup event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isActive) return;

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isActive, brushTool, currentContour, zoom, panX, panY]);

  // Render brush cursor and feedback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isActive || !mousePosition) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Clear previous cursor (this is a simplified approach)
    // In production, you'd want to use a separate overlay canvas
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    
    // Draw brush cursor
    context.save();
    
    const canvasPos = worldToCanvas(mousePosition);
    const radiusInCanvas = (brushSize / 2) * zoom;

    // Draw brush circle
    context.strokeStyle = brushTool?.getOperation() === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    context.globalAlpha = 0.7;

    context.beginPath();
    context.arc(canvasPos.x, canvasPos.y, radiusInCanvas, 0, 2 * Math.PI);
    context.stroke();

    // Draw operation indicator
    const indicatorSize = 8;
    context.setLineDash([]);
    context.lineWidth = 3;
    context.globalAlpha = 1;

    context.beginPath();
    if (brushTool?.getOperation() === BrushOperation.ADDITIVE) {
      // Draw cross for additive
      context.moveTo(canvasPos.x - indicatorSize, canvasPos.y);
      context.lineTo(canvasPos.x + indicatorSize, canvasPos.y);
      context.moveTo(canvasPos.x, canvasPos.y - indicatorSize);
      context.lineTo(canvasPos.x, canvasPos.y + indicatorSize);
    } else {
      // Draw horizontal line for subtractive
      context.moveTo(canvasPos.x - indicatorSize, canvasPos.y);
      context.lineTo(canvasPos.x + indicatorSize, canvasPos.y);
    }
    context.stroke();

    context.restore();

    // Cleanup function would restore the image
    return () => {
      context.putImageData(imageData, 0, 0);
    };
  }, [mousePosition, isActive, brushSize, zoom, panX, panY, brushTool]);

  // Render method (called by brush tool)
  useEffect(() => {
    if (!brushTool || !canvasRef.current) return;

    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    // Let the brush tool handle its own rendering
    if (brushTool.isActive()) {
      brushTool.render(context);
    }
  }, [brushTool, mousePosition]);

  return null; // This component only handles interaction logic
}