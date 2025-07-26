import React, { useRef, useEffect, useState, useCallback } from 'react';

interface PenToolV2Props {
  isActive: boolean;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  imageMetadata: any;
  onContourUpdate: (payload: any) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  ctTransform: React.RefObject<any>;
}

interface Point {
  x: number;
  y: number;
}

// Pen Tool V2 - Complete rewrite with proper Eclipse-style functionality
export default function PenToolV2({
  isActive,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  imageMetadata,
  onContourUpdate,
  canvasRef,
  ctTransform
}: PenToolV2Props) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Tool state
  const [isDrawing, setIsDrawing] = useState(false);
  const [vertices, setVertices] = useState<Point[]>([]);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  // Initialize overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const mainCanvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    
    if (!overlay) {
      // Create overlay canvas
      const newOverlay = document.createElement('canvas');
      newOverlay.style.position = 'absolute';
      newOverlay.style.top = '0';
      newOverlay.style.left = '0';
      newOverlay.style.pointerEvents = 'none';
      newOverlay.style.zIndex = '10';
      newOverlay.width = mainCanvas.width;
      newOverlay.height = mainCanvas.height;
      
      mainCanvas.parentElement?.appendChild(newOverlay);
      overlayCanvasRef.current = newOverlay;
    } else {
      overlay.width = mainCanvas.width;
      overlay.height = mainCanvas.height;
    }

    return () => {
      if (overlayCanvasRef.current && overlayCanvasRef.current.parentElement) {
        overlayCanvasRef.current.parentElement.removeChild(overlayCanvasRef.current);
        overlayCanvasRef.current = null;
      }
    };
  }, [isActive, canvasRef]);

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = useCallback((canvasX: number, canvasY: number) => {
    if (!imageMetadata) return { x: 0, y: 0, z: currentSlicePosition };
    
    const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Convert canvas to pixel coordinates (undo zoom/pan)
    const pixelX = (canvasX - transform.offsetX) / transform.scale;
    const pixelY = (canvasY - transform.offsetY) / transform.scale;
    
    // Parse DICOM metadata
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;
    
    // Convert to world coordinates
    const worldX = imagePosition[0] + (pixelX * colSpacing);
    const worldY = imagePosition[1] + (pixelY * rowSpacing);
    
    return { x: worldX, y: worldY, z: currentSlicePosition };
  }, [imageMetadata, currentSlicePosition, ctTransform]);

  // Convert world coordinates to canvas coordinates  
  const worldToCanvas = useCallback((worldX: number, worldY: number) => {
    if (!imageMetadata) return { x: 0, y: 0 };
    
    const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Parse DICOM metadata
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;
    
    // Convert world to pixel coordinates
    const pixelX = (worldX - imagePosition[0]) / colSpacing;
    const pixelY = (worldY - imagePosition[1]) / rowSpacing;
    
    // Apply zoom/pan transform
    const canvasX = transform.offsetX + (pixelX * transform.scale);
    const canvasY = transform.offsetY + (pixelY * transform.scale);
    
    return { x: canvasX, y: canvasY };
  }, [imageMetadata, ctTransform]);

  // Check if point is near first vertex (for closing polygon)
  const isNearFirstVertex = useCallback((point: Point): boolean => {
    if (vertices.length < 3) return false;
    
    const firstVertex = vertices[0];
    const distance = Math.sqrt(
      Math.pow(point.x - firstVertex.x, 2) + Math.pow(point.y - firstVertex.y, 2)
    );
    
    return distance < 8; // 8 pixel tolerance
  }, [vertices]);

  // Get structure color
  const getStructureColor = useCallback(() => {
    if (!selectedStructure || !rtStructures?.structures) return '#00ff00';
    
    const structure = rtStructures.structures.find(
      (s: any) => s.roiNumber === selectedStructure
    );
    
    if (structure?.color) {
      const [r, g, b] = structure.color;
      return `rgb(${r}, ${g}, ${b})`;
    }
    
    return '#00ff00';
  }, [selectedStructure, rtStructures]);

  // Handle mouse events
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isActive || !selectedStructure || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    if (event.button === 0) { // Left click
      if (isComplete) {
        // Reset if completed
        setVertices([]);
        setIsComplete(false);
        setIsDrawing(true);
      }
      
      if (isNearFirstVertex(point) && vertices.length >= 3) {
        // Close polygon
        completePolygon();
      } else {
        // Add vertex
        setVertices(prev => [...prev, point]);
        if (!isDrawing) {
          setIsDrawing(true);
        }
      }
    } else if (event.button === 2) { // Right click
      event.preventDefault();
      if (vertices.length >= 3) {
        completePolygon();
      }
    }
  }, [isActive, selectedStructure, vertices, isDrawing, isComplete, isNearFirstVertex]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    setMousePosition({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  }, [isActive]);

  const handleContextMenu = useCallback((event: Event) => {
    if (isActive) {
      event.preventDefault();
    }
  }, [isActive]);

  // Complete polygon and send to parent
  const completePolygon = useCallback(() => {
    if (vertices.length < 3 || !selectedStructure) return;
    
    console.log(`PenToolV2: Completing polygon with ${vertices.length} vertices`);
    
    // Convert vertices to world coordinates
    const worldPoints: number[] = [];
    vertices.forEach(vertex => {
      const world = canvasToWorld(vertex.x, vertex.y);
      worldPoints.push(world.x, world.y, world.z);
    });
    
    console.log('PenToolV2: First 3 world points:', worldPoints.slice(0, 9));
    
    // Send to parent component
    if (onContourUpdate) {
      onContourUpdate({
        action: "add_pen_stroke",
        structureId: selectedStructure,
        slicePosition: currentSlicePosition,
        points: worldPoints,
        pointCount: vertices.length
      });
    }
    
    // Reset state
    setVertices([]);
    setIsDrawing(false);
    setIsComplete(true);
  }, [vertices, selectedStructure, currentSlicePosition, canvasToWorld, onContourUpdate]);

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleContextMenu]);

  // Draw overlay
  const drawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay || !isActive) return;
    
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    
    const structureColor = getStructureColor();
    
    // Draw completed vertices
    if (vertices.length > 0) {
      ctx.strokeStyle = structureColor;
      ctx.fillStyle = structureColor;
      ctx.lineWidth = 2;
      
      // Draw polygon edges
      ctx.beginPath();
      vertices.forEach((vertex, index) => {
        if (index === 0) {
          ctx.moveTo(vertex.x, vertex.y);
        } else {
          ctx.lineTo(vertex.x, vertex.y);
        }
      });
      
      // Draw preview line to mouse
      if (isDrawing && mousePosition && vertices.length > 0) {
        ctx.lineTo(mousePosition.x, mousePosition.y);
      }
      
      ctx.stroke();
      
      // Draw vertices as circles
      vertices.forEach((vertex, index) => {
        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, 4, 0, 2 * Math.PI);
        
        if (index === 0 && vertices.length >= 3) {
          // First vertex - highlight in purple for close indication
          ctx.fillStyle = '#8b5cf6';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = structureColor;
          ctx.fill();
        }
      });
    }
    
    // Draw cursor
    if (mousePosition && isDrawing) {
      ctx.strokeStyle = structureColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mousePosition.x, mousePosition.y, 3, 0, 2 * Math.PI);
      ctx.stroke();
      
      // Show close indicator if near first vertex
      if (isNearFirstVertex(mousePosition)) {
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(vertices[0].x, vertices[0].y, 8, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }, [isActive, vertices, mousePosition, isDrawing, getStructureColor, isNearFirstVertex]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      drawOverlay();
      animationFrameRef.current = requestAnimationFrame(animate) as number;
    };

    if (isActive) {
      animate();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, drawOverlay]);

  // Reset when switching structures or becoming inactive
  useEffect(() => {
    if (!isActive) {
      setVertices([]);
      setIsDrawing(false);
      setIsComplete(false);
      setMousePosition(null);
    }
  }, [isActive, selectedStructure]);

  return null; // This component only handles interactions
}