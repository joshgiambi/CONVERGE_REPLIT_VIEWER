import React, { useRef, useEffect, useState, useCallback } from "react";
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
  predictionEnabled?: boolean;
  onBrushSizeChange?: (size: number) => void;
  ctTransform: React.RefObject<{ scale: number; offsetX: number; offsetY: number }>;
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
  predictionEnabled = false,
  onBrushSizeChange,
  ctTransform,
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
  
  // Right-click diameter adjustment state
  const [isAdjustingSize, setIsAdjustingSize] = useState(false);
  const [sizeAdjustStart, setSizeAdjustStart] = useState<{ x: number; y: number; size: number } | null>(null);
  const [adjustedBrushSize, setAdjustedBrushSize] = useState(brushSize);
  const sliderOverlayRef = useRef<HTMLDivElement | null>(null);
  
  // Performance optimization: throttle mouse move events
  const lastUpdateTime = useRef(0);
  const updateThrottle = 16; // ~60fps

  // Update adjusted brush size when prop changes
  useEffect(() => {
    setAdjustedBrushSize(brushSize);
  }, [brushSize]);

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
      // Clean up slider overlay
      if (sliderOverlayRef.current && sliderOverlayRef.current.parentElement) {
        sliderOverlayRef.current.parentElement.removeChild(
          sliderOverlayRef.current,
        );
        sliderOverlayRef.current = null;
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

    // Draw brush cursor - match actual stroke visual size
    if (cursorPosition && !isDrawing) {
      ctx.beginPath();
      // The stroke has lineWidth = brushSize * 2, which creates a visual radius of brushSize
      // So cursor should show the same visual size
      const currentBrushSize = isAdjustingSize ? adjustedBrushSize : brushSize;
      ctx.arc(cursorPosition.x, cursorPosition.y, currentBrushSize, 0, 2 * Math.PI);
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
      const currentBrushSize = isAdjustingSize ? adjustedBrushSize : brushSize;
      ctx.lineWidth = currentBrushSize * 2; // This makes the visible stroke diameter = brushSize * 2
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
    isAdjustingSize,
    adjustedBrushSize,
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
      // Performance optimization: throttle mouse move events
      const now = Date.now();
      if (now - lastUpdateTime.current < updateThrottle && !isAdjustingSize && !isDrawing) {
        return;
      }
      lastUpdateTime.current = now;

      // Handle right-click diameter adjustment
      if (isAdjustingSize && sizeAdjustStart) {
        e.preventDefault();
        e.stopPropagation();
        
        // Calculate new size based on horizontal mouse movement
        const deltaX = e.clientX - sizeAdjustStart.x;
        const pixelSpacing = imageMetadata?.pixelSpacing?.[0] || 1.171875;
        const sizeChangePixels = deltaX * 0.5; // Sensitivity factor
        const newSizePixels = Math.max(1, Math.min(100, sizeAdjustStart.size + sizeChangePixels));  // Clamp between 1 and 100
        
        setAdjustedBrushSize(Math.round(newSizePixels));
        
        // Update slider overlay but keep position fixed at start position
        try {
          // Keep the same offset as initial creation
          const brushDiameter = sizeAdjustStart.size * 2;
          const offsetY = Math.max(40, brushDiameter / 2);
          updateSliderOverlay(sizeAdjustStart.x, sizeAdjustStart.y - offsetY, newSizePixels, pixelSpacing);
        } catch (error) {
          console.error('Error updating slider overlay:', error);
        }
        return;
      }

      const coords = getCanvasCoords(e);
      setCursorPosition(coords);

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
      if (e.button === 0 && selectedStructure && !isAdjustingSize) {
        // Left click and structure selected
        e.preventDefault();
        e.stopPropagation();
        setIsDrawing(true);
        const coords = getCanvasCoords(e);
        brushPointsRef.current = [coords];
        addBrushPoint(coords.x, coords.y);
      } else if (e.button === 2) {
        // Right click - start diameter adjustment
        e.preventDefault();
        e.stopPropagation();
        console.log('Right-click detected, starting diameter adjustment');
        setIsAdjustingSize(true);
        setSizeAdjustStart({ x: e.clientX, y: e.clientY, size: brushSize });
        setAdjustedBrushSize(brushSize);
        
        // Create slider overlay - add offset to ensure it's above cursor
        try {
          // Get brush cursor size to add appropriate offset
          const brushDiameter = brushSize * 2; // Canvas scale factor
          const offsetY = Math.max(40, brushDiameter / 2); // At least 40px offset, or half brush diameter
          createSliderOverlay(e.clientX, e.clientY - offsetY);
        } catch (error) {
          console.error('Error creating slider overlay:', error);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDrawing) {
        finalizeBrushStroke();
        setIsDrawing(false);
      }
      
      if (isAdjustingSize) {
        // Apply the new brush size
        if (onBrushSizeChange && adjustedBrushSize !== brushSize) {
          onBrushSizeChange(adjustedBrushSize);
        }
        setIsAdjustingSize(false);
        setSizeAdjustStart(null);
        
        // Remove slider overlay
        if (sliderOverlayRef.current && sliderOverlayRef.current.parentElement) {
          sliderOverlayRef.current.parentElement.removeChild(sliderOverlayRef.current);
          sliderOverlayRef.current = null;
        }
      }
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
    // Also listen for mousemove on window for size adjustment
    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("wheel", handleWheel);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isActive, isDrawing, brushSize, selectedStructure, isAdjustingSize, adjustedBrushSize, onBrushSizeChange, imageMetadata, sizeAdjustStart]);

  const addBrushPoint = (x: number, y: number) => {
    if (!selectedStructure || !rtStructures?.structures || !imageMetadata) return;

    // Get current zoom/pan transform
    const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Convert canvas coordinates to pixel coordinates by inverting the zoom/pan transform
    const pixelX = (x - transform.offsetX) / transform.scale;
    const pixelY = (y - transform.offsetY) / transform.scale;

    // Parse DICOM metadata
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;
    
    // Convert pixel coordinates to world coordinates
    const worldX = imagePosition[0] + (pixelX * colSpacing);
    const worldY = imagePosition[1] + (pixelY * rowSpacing);
    const worldZ = currentSlicePosition;

    console.log(
      `Brush point: Canvas(${x.toFixed(1)}, ${y.toFixed(1)}) -> Pixel(${pixelX.toFixed(1)}, ${pixelY.toFixed(1)}) -> World(${worldX.toFixed(1)}, ${worldY.toFixed(1)}, ${worldZ})`,
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

      // Get current zoom/pan transform
      const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
      
      // Parse DICOM metadata once
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
      const [rowSpacing, colSpacing] = pixelSpacing;

      // Convert all brush points to world coordinates accounting for zoom/pan
      const worldPoints = brushPointsRef.current.map((point) => {
        // Convert canvas coordinates to pixel coordinates by inverting the zoom/pan transform
        const pixelX = (point.x - transform.offsetX) / transform.scale;
        const pixelY = (point.y - transform.offsetY) / transform.scale;
        
        // Convert pixel coordinates to world coordinates
        const worldX = imagePosition[0] + (pixelX * colSpacing);
        const worldY = imagePosition[1] + (pixelY * rowSpacing);
        const worldZ = currentSlicePosition;
        
        console.log(`Brush point: Canvas(${point.x.toFixed(1)}, ${point.y.toFixed(1)}) -> Pixel(${pixelX.toFixed(1)}, ${pixelY.toFixed(1)}) -> World(${worldX.toFixed(1)}, ${worldY.toFixed(1)}, ${worldZ.toFixed(1)})`);
        
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
          predictionEnabled: predictionEnabled,
        });
      }
    } catch (error) {
      console.error("Error in finalizeBrushStroke:", error);
    } finally {
      // Always clear brush points
      brushPointsRef.current = [];
    }
  };

  // Create slider overlay for diameter adjustment
  const createSliderOverlay = (x: number, y: number) => {
    if (!canvasRef.current) {
      console.error('Canvas ref not available for slider overlay');
      return;
    }
    
    // Remove any existing overlay first
    if (sliderOverlayRef.current && sliderOverlayRef.current.parentElement) {
      sliderOverlayRef.current.parentElement.removeChild(sliderOverlayRef.current);
      sliderOverlayRef.current = null;
    }
    
    const mainCanvas = canvasRef.current;
    const pixelSpacing = imageMetadata?.pixelSpacing?.[0] || 1.171875;
    
    // Create overlay div
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";  // Use fixed positioning for viewport-relative placement
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y - 120}px`;  // Position well above cursor (120px offset)
    overlay.style.width = "300px";
    overlay.style.height = "80px";  // Make taller for better visibility
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "10000";  // Higher z-index
    overlay.style.transform = "translateX(-150px)";
    
    // Create inner content
    const content = document.createElement("div");
    content.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
    content.style.color = "white";
    content.style.padding = "10px 16px";
    content.style.borderRadius = "6px";
    content.style.fontSize = "14px";
    content.style.fontFamily = "Arial, sans-serif";
    content.style.textAlign = "center";
    content.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    content.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5)";
    
    // Size text - show both cm and px like settings panel
    const sizeText = document.createElement("div");
    const sizeCm = (brushSize * pixelSpacing) / 10; // Convert pixels to cm
    sizeText.innerHTML = `
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 2px; color: #fbbf24;">Brush Thickness</div>
      <div style="font-size: 20px; font-weight: bold; margin-bottom: 2px;">${sizeCm.toFixed(2)} cm</div>
      <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">(${brushSize} px)</div>
    `;
    sizeText.style.marginBottom = "8px";
    sizeText.style.userSelect = "none";
    content.appendChild(sizeText);
    
    // Slider bar
    const sliderBar = document.createElement("div");
    sliderBar.style.width = "100%";
    sliderBar.style.height = "6px"; // Slightly thicker to match settings
    sliderBar.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
    sliderBar.style.borderRadius = "3px";
    sliderBar.style.position = "relative";
    sliderBar.style.overflow = "hidden";
    
    const sliderFill = document.createElement("div");
    sliderFill.style.height = "100%";
    sliderFill.style.width = "50%";
    sliderFill.style.backgroundColor = "#fbbf24"; // Yellow/amber to match settings panel
    sliderFill.style.borderRadius = "2px";
    sliderBar.appendChild(sliderFill);
    
    content.appendChild(sliderBar);
    overlay.appendChild(content);
    
    // Store references
    overlay.dataset.sizeText = "";
    overlay.dataset.sliderFill = "";
    sizeText.id = "brush-size-text";
    sliderFill.id = "brush-slider-fill";
    
    document.body.appendChild(overlay);
    sliderOverlayRef.current = overlay;
    console.log('Slider overlay created successfully');
  };
  
  // Update slider overlay
  const updateSliderOverlay = (x: number, y: number, sizePixels: number, pixelSpacing: number) => {
    if (!sliderOverlayRef.current) return;
    
    const sizeText = sliderOverlayRef.current.querySelector("#brush-size-text") as HTMLElement;
    const sliderFill = sliderOverlayRef.current.querySelector("#brush-slider-fill") as HTMLElement;
    
    if (sizeText) {
      const sizeCm = (sizePixels * pixelSpacing) / 10;
      sizeText.innerHTML = `
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 2px; color: #fbbf24;">Brush Thickness</div>
        <div style="font-size: 20px; font-weight: bold; margin-bottom: 2px;">${sizeCm.toFixed(2)} cm</div>
        <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">(${Math.round(sizePixels)} px)</div>
      `;
    }
    
    if (sliderFill) {
      // Map size to slider width (0-100%)
      const minSize = 1;
      const maxSize = 100;
      const percentage = ((sizePixels - minSize) / (maxSize - minSize)) * 100;
      sliderFill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    }
  };

  return null; // This component only handles interactions, no visual rendering
}
