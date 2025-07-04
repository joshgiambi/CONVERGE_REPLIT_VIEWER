import React, { useRef, useEffect, useState } from "react";
import { canvasToWorld } from "@/lib/dicom-coordinates";

interface SimpleBrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedStructures: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata?: any;
  smoothingEnabled?: boolean;
  enableSmartMode?: boolean;
  onBrushModeChange?: (mode: any) => void;
}

export function SimpleBrushTool({
  canvasRef,
  isActive,
  brushSize,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  zoom,
  panX,
  panY,
  imageMetadata,
}: SimpleBrushToolProps) {
  console.log('SimpleBrushTool render:', { isActive, selectedStructure, hasCanvas: !!canvasRef.current });
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const animationFrameRef = useRef<number | null>(null);

  // Create overlay canvas for cursor and brush strokes
  useEffect(() => {
    if (!canvasRef.current || !isActive) {
      // Clean up overlay canvas when not active
      if (overlayCanvasRef.current && overlayCanvasRef.current.parentElement) {
        overlayCanvasRef.current.parentElement.removeChild(
          overlayCanvasRef.current,
        );
        overlayCanvasRef.current = null;
      }
      return;
    }

    const mainCanvas = canvasRef.current;

    // Create overlay canvas if it doesn't exist
    if (!overlayCanvasRef.current) {
      console.log('Creating overlay canvas');
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.style.position = "absolute";
      overlayCanvas.style.top = "0";
      overlayCanvas.style.left = "0";
      overlayCanvas.style.pointerEvents = "none"; // Allow events to pass through for scrolling
      overlayCanvas.style.zIndex = "10";
      overlayCanvas.width = mainCanvas.width;
      overlayCanvas.height = mainCanvas.height;

      // Match canvas styling
      const computedStyle = window.getComputedStyle(mainCanvas);
      overlayCanvas.style.width = computedStyle.width;
      overlayCanvas.style.height = computedStyle.height;
      overlayCanvas.style.imageRendering = "auto";

      mainCanvas.parentElement?.appendChild(overlayCanvas);
      overlayCanvasRef.current = overlayCanvas;
    }

    // Update overlay canvas size if main canvas size changes
    if (
      overlayCanvasRef.current.width !== mainCanvas.width ||
      overlayCanvasRef.current.height !== mainCanvas.height
    ) {
      overlayCanvasRef.current.width = mainCanvas.width;
      overlayCanvasRef.current.height = mainCanvas.height;
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, canvasRef]);

  // Get structure color
  const getStructureColor = () => {
    if (!selectedStructure || !rtStructures?.structures) return "#00ff00";
    const structure = rtStructures.structures.find(
      (s: any) => s.roiNumber === selectedStructure,
    );
    if (!structure?.color) return "#00ff00";
    return `rgb(${structure.color.join(",")})`;
  };

  // Draw cursor and brush strokes
  const drawOverlay = () => {
    if (!overlayCanvasRef.current || !isActive) return;

    const ctx = overlayCanvasRef.current.getContext("2d");
    if (!ctx) return;
    
    // Add debug info
    if (!cursorPosition) {
      console.log('No cursor position set');
    }

    // Clear canvas
    ctx.clearRect(
      0,
      0,
      overlayCanvasRef.current.width,
      overlayCanvasRef.current.height,
    );

    const structureColor = getStructureColor();

    // Draw brush cursor
    if (cursorPosition && !isDrawing) {
      ctx.beginPath();
      ctx.arc(cursorPosition.x, cursorPosition.y, brushSize, 0, 2 * Math.PI);
      ctx.strokeStyle = structureColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw center dot
      ctx.beginPath();
      ctx.arc(cursorPosition.x, cursorPosition.y, 2, 0, 2 * Math.PI);
      ctx.fillStyle = structureColor;
      ctx.fill();
    }

    // Draw current brush stroke
    if (brushPointsRef.current.length > 0) {
      ctx.strokeStyle = structureColor;
      ctx.lineWidth = brushSize * 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.7;

      ctx.beginPath();
      brushPointsRef.current.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
  };

  // Use requestAnimationFrame for smooth drawing
  useEffect(() => {
    const animate = () => {
      drawOverlay();
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    if (isActive) {
      animate();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    cursorPosition,
    isActive,
    brushSize,
    selectedStructure,
    rtStructures,
    isDrawing,
  ]);

  // Handle mouse events
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const canvas = canvasRef.current; // Use the main canvas for events

    const getCanvasCoords = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      return { x, y };
    };

    const handleMouseMove = (e: MouseEvent) => {
      const coords = getCanvasCoords(e);
      setCursorPosition(coords);
      console.log('Mouse move:', coords, 'isActive:', isActive);

      if (isDrawing && selectedStructure) {
        e.preventDefault();
        e.stopPropagation();
        // Add points with some distance threshold to avoid too many points
        const lastPoint =
          brushPointsRef.current[brushPointsRef.current.length - 1];
        if (
          !lastPoint ||
          Math.hypot(coords.x - lastPoint.x, coords.y - lastPoint.y) > 2
        ) {
          brushPointsRef.current.push(coords);
          addBrushPoint(coords.x, coords.y);
        }
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && selectedStructure) {
        // Left click and structure selected
        e.preventDefault();
        e.stopPropagation();
        setIsDrawing(true);
        const coords = getCanvasCoords(e);
        brushPointsRef.current = [coords];
        addBrushPoint(coords.x, coords.y);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDrawing) {
        finalizeBrushStroke();
      }
      setIsDrawing(false);
    };

    const handleMouseLeave = () => {
      setCursorPosition(null);
      if (isDrawing) {
        finalizeBrushStroke();
      }
      setIsDrawing(false);
    };

    // Prevent context menu on right click
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Handle wheel events - don't prevent them so scrolling works
    const handleWheel = (e: WheelEvent) => {
      // Don't prevent default or stop propagation - let it bubble to parent
      // This allows the parent canvas to handle slice navigation
    };
    
    // Add wheel listener to explicitly allow scrolling
    canvas.addEventListener("wheel", handleWheel, { passive: true });

    // Add event listeners to the main canvas
    canvas.addEventListener("mousemove", handleMouseMove, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown, { passive: false });
    canvas.addEventListener("mouseup", handleMouseUp, { passive: false });
    canvas.addEventListener("mouseleave", handleMouseLeave, { passive: false });
    canvas.addEventListener("contextmenu", handleContextMenu, { passive: false });
    // Also listen for mouseup on window to catch when mouse is released outside canvas
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("wheel", handleWheel);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isActive, isDrawing, brushSize, selectedStructure]);

  const addBrushPoint = (x: number, y: number) => {
    if (!selectedStructure || !rtStructures?.structures || !imageMetadata) return;

    // Convert canvas coordinates to world coordinates using actual DICOM metadata
    const canvasWidth = canvasRef.current?.width || 1024;
    const canvasHeight = canvasRef.current?.height || 1024;

    // NO TRANSFORMATION NEEDED - mouse coordinates are already in canvas space
    // The image is displayed at 2x scale to fill the canvas, so canvas coordinates
    // directly map to the displayed image
    
    // Use the shared coordinate transformation function with raw canvas coordinates
    const [worldX, worldY, worldZ] = canvasToWorld(
      x, 
      y, 
      canvasWidth, 
      canvasHeight, 
      imageMetadata,
      currentSlicePosition
    );

    console.log(
      `Brush point: Canvas(${x.toFixed(1)}, ${y.toFixed(1)}) -> World(${worldX.toFixed(1)}, ${worldY.toFixed(1)}, ${worldZ})`,
    );
  };

  const finalizeBrushStroke = () => {
    try {
      if (
        !selectedStructure ||
        !rtStructures?.structures ||
        brushPointsRef.current.length === 0
      ) {
        console.log("Finalizing brush stroke: No data to process");
        brushPointsRef.current = [];
        return;
      }

      console.log(
        `Finalizing brush stroke with ${brushPointsRef.current.length} points`,
      );

      // Convert all brush points to world coordinates using actual image metadata
      const canvasWidth = canvasRef.current?.width || 1024;
      const canvasHeight = canvasRef.current?.height || 1024;

      // NO TRANSFORMATION NEEDED - mouse coordinates are already in canvas space
      const worldPoints = brushPointsRef.current.map((point) => {
        // Use the shared coordinate transformation function with raw canvas coordinates
        const [worldX, worldY, worldZ] = canvasToWorld(
          point.x,
          point.y,
          canvasWidth,
          canvasHeight,
          imageMetadata,
          currentSlicePosition
        );
        
        console.log(`Brush point: Canvas(${point.x.toFixed(1)}, ${point.y.toFixed(1)}) -> World(${worldX.toFixed(1)}, ${worldY.toFixed(1)}, ${worldZ.toFixed(1)})`);
        
        return [worldX, worldY, worldZ];
      });

      // Create a simplified polygon from the brush stroke
      // For now, just log the data
      console.log(
        `Brush stroke completed: ${worldPoints.length} points added to structure ${selectedStructure} at slice ${currentSlicePosition}mm`,
      );
      console.log("First 3 world points:", worldPoints.slice(0, 3));

      // Notify parent component with the brush stroke data
      if (onContourUpdate) {
        onContourUpdate({
          action: "brush_stroke",
          structureId: selectedStructure,
          slicePosition: currentSlicePosition,
          pointCount: worldPoints.length,
          points: worldPoints,
          brushSize: brushSize,
        });
      }
    } catch (error) {
      console.error("Error in finalizeBrushStroke:", error);
    } finally {
      // Always clear brush points
      brushPointsRef.current = [];
    }
  };

  return null; // This component only handles interactions, no visual rendering
}
