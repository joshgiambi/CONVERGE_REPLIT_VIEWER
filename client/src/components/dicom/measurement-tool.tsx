import React, { useEffect, useRef, useState } from 'react';

interface Point {
  x: number;
  y: number;
}

interface MeasurementToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  imageMetadata: any;
  ctTransform: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }> | null;
  currentSlicePosition: number;
  onMeasurementComplete?: (distance: number, unit: string) => void;
}

export function MeasurementTool({
  canvasRef,
  isActive,
  imageMetadata,
  ctTransform,
  currentSlicePosition,
  onMeasurementComplete
}: MeasurementToolProps) {
  const [firstPoint, setFirstPoint] = useState<Point | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const measurementsRef = useRef<Array<{ start: Point; end: Point; distance: number }>>([]);

  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      // Clean up overlay when not active
      if (overlayCanvasRef.current && overlayCanvasRef.current.parentElement) {
        overlayCanvasRef.current.parentElement.removeChild(overlayCanvasRef.current);
        overlayCanvasRef.current = null;
      }
      setFirstPoint(null);
      setCurrentMousePos(null);
      // Clear all measurements when tool is deactivated
      measurementsRef.current = [];
      return;
    }

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    if (!parent) return;

    // Create overlay canvas for measurement visualization
    if (!overlayCanvasRef.current) {
      const overlay = document.createElement('canvas');
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      overlay.style.position = 'absolute';
      overlay.style.left = canvas.offsetLeft + 'px';
      overlay.style.top = canvas.offsetTop + 'px';
      overlay.style.width = canvas.style.width;
      overlay.style.height = canvas.style.height;
      overlay.style.pointerEvents = 'none';
      overlay.style.cursor = 'crosshair';
      overlay.style.zIndex = '10';
      parent.appendChild(overlay);
      overlayCanvasRef.current = overlay;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Scale to canvas coordinates
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      setCurrentMousePos({
        x: x * scaleX,
        y: y * scaleY
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left click

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Scale to canvas coordinates
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      const canvasX = x * scaleX;
      const canvasY = y * scaleY;

      if (!firstPoint) {
        setFirstPoint({ x: canvasX, y: canvasY });
      } else {
        // Calculate distance
        const distance = calculateRealWorldDistance(
          firstPoint,
          { x: canvasX, y: canvasY },
          imageMetadata,
          ctTransform
        );
        
        // Store measurement
        measurementsRef.current.push({
          start: firstPoint,
          end: { x: canvasX, y: canvasY },
          distance
        });

        console.log(`Measurement: ${distance.toFixed(1)} mm (${(distance / 10).toFixed(2)} cm)`);
        
        if (onMeasurementComplete) {
          onMeasurementComplete(distance, 'mm');
        }

        // Reset for next measurement
        setFirstPoint(null);
        setCurrentMousePos(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFirstPoint(null);
        setCurrentMousePos(null);
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    canvas.style.cursor = 'crosshair';

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.style.cursor = 'default';
    };
  }, [isActive, firstPoint, canvasRef, imageMetadata, ctTransform, onMeasurementComplete]);

  // Draw measurement lines
  useEffect(() => {
    if (!overlayCanvasRef.current) return;

    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

    // Draw completed measurements
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.font = '14px Arial';
    ctx.fillStyle = '#00ff00';

    measurementsRef.current.forEach(measurement => {
      drawMeasurementLine(ctx, measurement.start, measurement.end, measurement.distance);
    });

    // Draw current measurement being drawn
    if (firstPoint && currentMousePos) {
      ctx.strokeStyle = '#ffff00';
      ctx.setLineDash([5, 5]);
      
      const distance = calculateRealWorldDistance(
        firstPoint,
        currentMousePos,
        imageMetadata,
        ctTransform
      );
      
      drawMeasurementLine(ctx, firstPoint, currentMousePos, distance);
      ctx.setLineDash([]);
    }
  }, [firstPoint, currentMousePos, imageMetadata, ctTransform]);

  const calculateRealWorldDistance = (
    point1: Point,
    point2: Point,
    metadata: any,
    transform: any
  ): number => {
    if (!metadata || !metadata.pixelSpacing) return 0;

    // Get transform values
    const ctTrans = transform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Convert canvas coordinates to pixel coordinates
    const pixel1X = (point1.x - ctTrans.offsetX) / ctTrans.scale;
    const pixel1Y = (point1.y - ctTrans.offsetY) / ctTrans.scale;
    const pixel2X = (point2.x - ctTrans.offsetX) / ctTrans.scale;
    const pixel2Y = (point2.y - ctTrans.offsetY) / ctTrans.scale;

    // Get pixel spacing
    const pixelSpacing = metadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;

    // Calculate distance in pixels
    const pixelDistX = pixel2X - pixel1X;
    const pixelDistY = pixel2Y - pixel1Y;

    // Convert to real-world distance (mm)
    const realDistX = pixelDistX * colSpacing;
    const realDistY = pixelDistY * rowSpacing;

    // Calculate Euclidean distance
    const distance = Math.sqrt(realDistX * realDistX + realDistY * realDistY);

    return distance;
  };

  const drawMeasurementLine = (
    ctx: CanvasRenderingContext2D,
    start: Point,
    end: Point,
    distance: number
  ) => {
    // Draw line
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    // Draw endpoints
    ctx.fillRect(start.x - 3, start.y - 3, 6, 6);
    ctx.fillRect(end.x - 3, end.y - 3, 6, 6);

    // Draw distance label
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    
    const text = `${distance.toFixed(1)} mm (${(distance / 10).toFixed(2)} cm)`;
    const textWidth = ctx.measureText(text).width;
    
    // Background for text
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(midX - textWidth / 2 - 4, midY - 10, textWidth + 8, 20);
    
    // Text
    ctx.fillStyle = '#00ff00';
    ctx.fillText(text, midX - textWidth / 2, midY + 4);
  };

  return null; // This component only handles canvas overlay
}