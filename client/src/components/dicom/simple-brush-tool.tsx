import React, { useRef, useEffect, useState, useCallback } from "react";
import { canvasToWorld } from "@/lib/dicom-coordinates";
import { createAdaptivePreview } from "@/lib/smart-brush-utils";
import { combineContours } from "@/lib/clipper-boolean-operations";
import { log } from '@/lib/log';

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
  smartBrushEnabled?: boolean;
  onBrushSizeChange?: (size: number) => void;
  ctTransform: React.RefObject<{ 
    scale: number; 
    offsetX: number; 
    offsetY: number;
    imageWidth?: number;
    imageHeight?: number;
  }>;
  isEraseMode?: boolean; // New prop for erase mode
  dicomImage?: any; // For accessing pixel data
  onPreviewUpdate?: (previewContours: any[] | null) => void; // New prop for smart brush preview
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
  smartBrushEnabled = false,
  onBrushSizeChange,
  ctTransform,
  isEraseMode = false,
  dicomImage = null,
  onPreviewUpdate,
}: SimpleBrushToolProps) {
  log.debug(`SimpleBrushTool render: active=${isActive} selected=${selectedStructure} erase=${isEraseMode}`, 'brush');
  const [isDrawing, setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false); // Immediate tracking for drawing state
  const [cursorPosition, setCursorPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const animationFrameRef = useRef<number | null>(null);
  
  // For smart brush - collect adaptive shapes while drawing
  const adaptiveShapesRef = useRef<Array<{ x: number; y: number }[]>>([]);
  
  // Shift key detection for temporary erase mode in brush tool
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isTemporaryEraseMode, setIsTemporaryEraseMode] = useState(false);
  
  // Right-click diameter adjustment state
  const [isAdjustingSize, setIsAdjustingSize] = useState(false);
  const [sizeAdjustStart, setSizeAdjustStart] = useState<{ x: number; y: number; size: number } | null>(null);
  const [adjustedBrushSize, setAdjustedBrushSize] = useState(brushSize);
  const sliderOverlayRef = useRef<HTMLDivElement | null>(null);
  
  // Smart brush preview state - just the morphing shape points
  const [adaptivePreviewPoints, setAdaptivePreviewPoints] = useState<{x: number, y: number}[] | null>(null);
  const previousPreviewPointsRef = useRef<{x: number, y: number}[] | null>(null);
  
  // Performance optimization: throttle mouse move events
  const lastUpdateTime = useRef(0);
  const updateThrottle = 16; // ~60fps

  // Update adjusted brush size when prop changes
  useEffect(() => {
    setAdjustedBrushSize(brushSize);
  }, [brushSize]);

  // Handle shift key for temporary erase mode (only for brush tool, not erase tool)
  useEffect(() => {
    if (!isActive || isEraseMode) return; // Only work for brush tool, not erase tool
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isShiftPressed) {
        setIsShiftPressed(true);
        setIsTemporaryEraseMode(true);
        log.debug('🔹 Temporary erase mode activated (Shift held)', 'brush');
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && isShiftPressed) {
        setIsShiftPressed(false);
        setIsTemporaryEraseMode(false);
        log.debug('🔹 Temporary erase mode deactivated (Shift released)', 'brush');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive, isEraseMode, isShiftPressed]);

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
      log.debug('Creating overlay canvas','brush');
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.style.position = "absolute";
      
      // Position the overlay canvas exactly on top of the main canvas
      const mainRect = mainCanvas.getBoundingClientRect();
      const parentRect = mainCanvas.parentElement!.getBoundingClientRect();
      overlayCanvas.style.top = `${mainRect.top - parentRect.top}px`;
      overlayCanvas.style.left = `${mainRect.left - parentRect.left}px`;
      
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

    // Update overlay canvas size and position if main canvas size changes
    if (
      overlayCanvasRef.current.width !== mainCanvas.width ||
      overlayCanvasRef.current.height !== mainCanvas.height
    ) {
      overlayCanvasRef.current.width = mainCanvas.width;
      overlayCanvasRef.current.height = mainCanvas.height;
      
      // Also update position in case main canvas moved
      const mainRect = mainCanvas.getBoundingClientRect();
      const parentRect = mainCanvas.parentElement!.getBoundingClientRect();
      overlayCanvasRef.current.style.top = `${mainRect.top - parentRect.top}px`;
      overlayCanvasRef.current.style.left = `${mainRect.left - parentRect.left}px`;
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, canvasRef]);

  // Get structure color - red for erase modes, structure color for normal mode
  const getStructureColor = () => {
    // Determine if we're in any erase mode
    const isInEraseMode = isEraseMode || isTemporaryEraseMode;
    
    if (isInEraseMode) {
      return "#ff4444"; // Bright red for erase mode
    }
    
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
    
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    const structureColor = getStructureColor();

    if (cursorPosition) {
        const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
        const pixelSpacing = imageMetadata?.pixelSpacing ? imageMetadata.pixelSpacing.split('\\').map(Number)[0] : 0.9765625;
        const cursorRadiusInScreenPixels = brushSize * pixelSpacing / (pixelSpacing / transform.scale);

        if (smartBrushEnabled && adaptivePreviewPoints && adaptivePreviewPoints.length > 2 && !isEraseMode && !isTemporaryEraseMode) {
            ctx.save();
            ctx.beginPath();
            adaptivePreviewPoints.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            });
            ctx.closePath();
            ctx.fillStyle = structureColor;
            ctx.globalAlpha = 0.3; // Semi-transparent fill
            ctx.fill();

            // 2. Draw the outline for the adaptive shape using the same path.
            ctx.strokeStyle = structureColor;
            ctx.lineWidth = 2; // A thin, clean line
            ctx.globalAlpha = 0.8; // A more solid line for better visibility
            ctx.setLineDash([6, 3]); // Dashed line to indicate smart brush
            ctx.stroke();

            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(cursorPosition.x, cursorPosition.y, cursorRadiusInScreenPixels, 0, 2 * Math.PI);
            ctx.strokeStyle = structureColor;
            ctx.lineWidth = 2;
            if (smartBrushEnabled) ctx.setLineDash([6, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.arc(cursorPosition.x, cursorPosition.y, 2, 0, 2 * Math.PI);
        ctx.fillStyle = structureColor;
        ctx.fill();
    }

    // Draw the preview of the entire brush path
    if (isDrawing) {
        if (!smartBrushEnabled && brushPointsRef.current.length > 0) {
            // Regular brush path preview
            ctx.strokeStyle = structureColor;
            const pixelSpacing = imageMetadata?.pixelSpacing ? imageMetadata.pixelSpacing.split('\\').map(Number)[0] : 0.9765625;
            const brushSizeInMM = brushSize * pixelSpacing;
            const zoomScale = ctTransform?.current?.scale || 1;
            const strokeWidthInScreenPixels = (brushSizeInMM / pixelSpacing) * zoomScale * 2;
            
            ctx.lineWidth = strokeWidthInScreenPixels;
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
        } else if (smartBrushEnabled && adaptiveShapesRef.current.length > 0) {
            // Smart brush path preview
            ctx.save();
            ctx.fillStyle = structureColor;
            ctx.globalAlpha = 0.3; // Use the same transparency as the live preview fill

            // Draw each collected adaptive shape to form the path
            adaptiveShapesRef.current.forEach((shape) => {
                if (shape.length > 2) {
                    ctx.beginPath();
                    shape.forEach((point, index) => {
                        if (index === 0) {
                            ctx.moveTo(point.x, point.y);
                        } else {
                            ctx.lineTo(point.x, point.y);
                        }
                    });
                    ctx.closePath();
                    ctx.fill();
                }
            });
            ctx.restore();
        }
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
    isEraseMode,
    isTemporaryEraseMode,
    adaptivePreviewPoints,
    smartBrushEnabled,
    dicomImage,
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

    // This is the fix for the right-click-to-resize functionality.
    // The previous logic was preventing the mouse move events from being
    // correctly processed when adjusting the brush size.
    const handleMouseMove = (e: MouseEvent) => {
        if (!isAdjustingSize && Date.now() - lastUpdateTime.current < updateThrottle) {
          return;
        }
        lastUpdateTime.current = Date.now();
        if (isAdjustingSize && sizeAdjustStart) {
            e.preventDefault();
            e.stopPropagation();
            
            const deltaX = e.clientX - sizeAdjustStart.x;
            const pixelSpacing = imageMetadata?.pixelSpacing ? imageMetadata.pixelSpacing.split('\\').map(Number)[0] : 0.9765625;
            
            const minPixelsFor1mm = Math.ceil(1 / pixelSpacing);
            const maxPixels = 102;
            
            const deltaCm = deltaX / 50;
            const baseSizeCm = (sizeAdjustStart.size * pixelSpacing) / 10;
            const newSizeCm = Math.max(0.1, Math.min(10, baseSizeCm + deltaCm));
            const newSizePixels = Math.max(minPixelsFor1mm, Math.min(maxPixels, (newSizeCm * 10) / pixelSpacing));
            
            setAdjustedBrushSize(Math.round(newSizePixels));
            
            // Update slider overlay with live feedback
            if (sliderOverlayRef.current) {
              const sizeText = sliderOverlayRef.current.querySelector("#brush-size-text") as HTMLElement;
              const sliderFill = sliderOverlayRef.current.querySelector("#brush-slider-fill") as HTMLElement;
              
              if (sizeText) {
                const sizeCm = (newSizePixels * pixelSpacing) / 10;
                sizeText.innerHTML = `
                  <div style="font-size: 16px; font-weight: 600; margin-bottom: 2px; color: #60a5fa;">Brush Thickness</div>
                  <div style="font-size: 20px; font-weight: bold; margin-bottom: 2px;">${sizeCm.toFixed(2)} cm</div>
                  <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">(${Math.round(newSizePixels)} px)</div>
                `;
              }
              
              if (sliderFill) {
                // Map size to slider width (0-100%) for 0.1cm to 10cm range
                const currentSizeCm = (newSizePixels * pixelSpacing) / 10;
                const percentage = ((currentSizeCm - 0.1) / (10 - 0.1)) * 100;
                sliderFill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
              }
            }
            return;
        }

        // Performance optimization: throttle mouse move events
        const now = Date.now();
        if (now - lastUpdateTime.current < updateThrottle && !isDrawing) {
            return;
        }
        lastUpdateTime.current = now;

        const coords = getCanvasCoords(e);
        setCursorPosition(coords);

        if (smartBrushEnabled && !isEraseMode && !isTemporaryEraseMode && canvasRef.current) {
            try {
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                    const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
                    
                    const imageWidth = transform.imageWidth || imageMetadata?.Columns || 512;
                    const imageHeight = transform.imageHeight || imageMetadata?.Rows || 512;
                    const scaledWidth = imageWidth * transform.scale;
                    const scaledHeight = imageHeight * transform.scale;
                    const imageStartX = (canvasRef.current.width - scaledWidth) / 2 + transform.offsetX;
                    const imageStartY = (canvasRef.current.height - scaledHeight) / 2 + transform.offsetY;

                    const cursorXOnImage = coords.x - imageStartX;
                    const cursorYOnImage = coords.y - imageStartY;
                    
                    if (cursorXOnImage < 0 || cursorXOnImage >= scaledWidth || cursorYOnImage < 0 || cursorYOnImage >= scaledHeight) {
                        setAdaptivePreviewPoints(null);
                        return;
                    }
                    
                    const imageData = ctx.getImageData(
                        Math.floor(imageStartX),
                        Math.floor(imageStartY),
                        Math.ceil(scaledWidth),
                        Math.ceil(scaledHeight)
                    );
                    const grayscaleData = new Float32Array(scaledWidth * scaledHeight);
                    for (let i = 0; i < grayscaleData.length; i++) {
                        grayscaleData[i] = imageData.data[i * 4];
                    }
                    
                    // This is the core fix: The brush radius must be scaled by the zoom level
                    // to match the coordinate space of the preview.
                    const radiusInCanvasPixels = brushSize * transform.scale;
                    
                    const previewPoints = createAdaptivePreview(
                        grayscaleData,
                        Math.ceil(scaledWidth),
                        Math.ceil(scaledHeight),
                        cursorXOnImage,
                        cursorYOnImage,
                        radiusInCanvasPixels
                    );
                    
                    let canvasPreviewPoints = previewPoints.map(p => ({
                        x: p.x + imageStartX,
                        y: p.y + imageStartY
                    }));
                    
                    // Light temporal smoothing
                    if (previousPreviewPointsRef.current && previousPreviewPointsRef.current.length === canvasPreviewPoints.length) {
                        const blendFactor = 0.7;
                        canvasPreviewPoints = canvasPreviewPoints.map((point, i) => {
                            const prevPoint = previousPreviewPointsRef.current![i];
                            return {
                                x: prevPoint.x * blendFactor + point.x * (1 - blendFactor),
                                y: prevPoint.y * blendFactor + point.y * (1 - blendFactor)
                            };
                        });
                    }
                    
                    if (canvasPreviewPoints.length > 2) {
                        previousPreviewPointsRef.current = canvasPreviewPoints;
                        setAdaptivePreviewPoints(canvasPreviewPoints);
                        
                        if (isDrawingRef.current) {
                            adaptiveShapesRef.current.push(canvasPreviewPoints);
                        }
                    }
                }
            } catch (error) {
                log.warn(`Error creating adaptive preview: ${String(error)}`, 'brush');
                setAdaptivePreviewPoints(null);
            }
        } else {
            setAdaptivePreviewPoints(null);
        }

        if (isDrawingRef.current && selectedStructure) {
            if (!smartBrushEnabled) {
                const lastPoint = brushPointsRef.current[brushPointsRef.current.length - 1];
                if (!lastPoint) {
                  brushPointsRef.current.push(coords);
                } else {
                  const dx = coords.x - lastPoint.x;
                  const dy = coords.y - lastPoint.y;
                  const dist = Math.hypot(dx, dy);
                  const scale = (ctTransform?.current?.scale || 1);
                  const step = Math.max(1, Math.min((brushSize * scale) * 0.5, 8)); // canvas pixels
                  const steps = Math.max(1, Math.ceil(dist / step));
                  for (let i = 1; i <= steps; i++) {
                    brushPointsRef.current.push({
                      x: lastPoint.x + (dx * i) / steps,
                      y: lastPoint.y + (dy * i) / steps,
                    });
                  }
                }
            }
        }
    };

    const handleMouseDown = (e: MouseEvent) => {
      log.debug(`🖱️ Mouse down event triggered, button:${e.button} selected:${selectedStructure} adjusting:${isAdjustingSize}`, 'brush');
      if (e.button === 0 && selectedStructure && !isAdjustingSize) {
        log.debug("✅ Entering drawing mode", 'brush');
        // Left click and structure selected
        e.preventDefault();
        e.stopPropagation();
        
        // Set both state and ref for immediate access
        setIsDrawing(true);
        isDrawingRef.current = true;
        log.debug("✅ Set isDrawing to true (state and ref)", 'brush');
        
        const coords = getCanvasCoords(e);
        log.debug(`✅ Got canvas coords: ${coords.x},${coords.y}`, 'brush');
        brushPointsRef.current = [coords];
        adaptiveShapesRef.current = []; // Clear adaptive shapes for new stroke
        
        log.debug(`🎨 Smart brush enabled: ${smartBrushEnabled}`, 'brush');
        if (smartBrushEnabled) {
          log.debug("🎨 Smart brush stroke started - adaptive shapes cleared", 'brush');
        }
        
        // For standard brush, start collecting points
        if (!smartBrushEnabled) {
          addBrushPoint(coords.x, coords.y);
        }
      } else if (e.button === 2) {
        // Right click - start diameter adjustment
        e.preventDefault();
        e.stopPropagation();
        log.debug('Right-click detected, starting diameter adjustment','brush');
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
      if (isDrawingRef.current) {
        log.debug(`🛑 Mouse up - finalizing stroke. Smart brush enabled: ${smartBrushEnabled}, Adaptive shapes collected: ${adaptiveShapesRef.current.length}`,'brush');
        finalizeBrushStroke();
        setIsDrawing(false);
        isDrawingRef.current = false; // Clear the ref too
        
        // Clear adaptive preview points and preview after finalizing smart brush
        if (smartBrushEnabled) {
          setAdaptivePreviewPoints(null);
          if (onPreviewUpdate) {
            onPreviewUpdate(null);
          }
        }
      }
      
      if (isAdjustingSize) {
        // Apply the new brush size and sync with main toolbar
        if (onBrushSizeChange && adjustedBrushSize !== brushSize) {
          onBrushSizeChange(adjustedBrushSize);
          log.debug(`Right-click slider: Updated brush size from ${brushSize}px to ${adjustedBrushSize}px`,'brush');
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
      setAdaptivePreviewPoints(null);
      // Clear preview when mouse leaves
      if (onPreviewUpdate) {
        onPreviewUpdate(null);
      }
      if (isDrawingRef.current) {
        finalizeBrushStroke();
      }
      setIsDrawing(false);
      isDrawingRef.current = false;
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

  // Helper function to calculate contour area
  const calculateContourArea = (contour: number[]): number => {
    let area = 0;
    const n = contour.length / 3;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = contour[i * 3];
      const y1 = contour[i * 3 + 1];
      const x2 = contour[j * 3];
      const y2 = contour[j * 3 + 1];
      area += (x1 * y2 - x2 * y1);
    }
    
    return Math.abs(area / 2);
  };

  const finalizeBrushStroke = async () => {
    try {
        if (!selectedStructure || !rtStructures?.structures) {
            return;
        }

        const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
        const isInEraseMode = isEraseMode || isTemporaryEraseMode;

        if (smartBrushEnabled && adaptiveShapesRef.current.length > 0 && !isInEraseMode) {
            console.log(`🎨 Finalizing smart brush with ${adaptiveShapesRef.current.length} adaptive shapes`);
            
            const adaptivePolygons: number[][] = [];
            adaptiveShapesRef.current.forEach((shape) => {
                if (shape.length > 2) {
                    const worldPoints: number[] = [];
                    shape.forEach(p => {
                        const pixelX = (p.x - transform.offsetX) / transform.scale;
                        const pixelY = (p.y - transform.offsetY) / transform.scale;
                        const worldPoint = pixelToWorld(pixelX, pixelY, imageMetadata, currentSlicePosition);
                        worldPoints.push(worldPoint[0], worldPoint[1], worldPoint[2]);
                    });
                    adaptivePolygons.push(worldPoints);
                }
            });

            if (adaptivePolygons.length === 0) {
            log.debug("No valid adaptive shapes to create contour", 'brush');
                return;
            }
            
            const { polygonUnion } = await import('@/lib/polygon-union');
            const unifiedPolygon = polygonUnion(adaptivePolygons);

            if (onContourUpdate) {
                onContourUpdate({
                    action: "smart_brush_stroke",
                    structureId: selectedStructure,
                    slicePosition: currentSlicePosition,
                    points: unifiedPolygon,
                });
            }
        } else if (!smartBrushEnabled && brushPointsRef.current.length > 0) {
            log.debug(`Finalizing regular brush with ${brushPointsRef.current.length} points`, 'brush');

            // Regular brush mode - convert all brush points to world coordinates
            const worldPoints = brushPointsRef.current.map((point) => {
                const pixelX = (point.x - transform.offsetX) / transform.scale;
                const pixelY = (point.y - transform.offsetY) / transform.scale;
                return pixelToWorld(pixelX, pixelY, imageMetadata, currentSlicePosition);
            });

            // Light decimation to prevent lumpy/sawtooth contours on fast strokes
            const decimateByDistance = (pts: [number, number, number][], minDistMm = 0.5) => {
              if (pts.length <= 2) return pts;
              const out: [number, number, number][] = [pts[0]];
              let last = pts[0];
              for (let i = 1; i < pts.length - 1; i++) {
                const p = pts[i];
                const dx = p[0] - last[0];
                const dy = p[1] - last[1];
                const dist = Math.hypot(dx, dy);
                if (dist >= minDistMm) {
                  out.push(p);
                  last = p;
                }
              }
              out.push(pts[pts.length - 1]);
              return out;
            };
            const filteredPoints = decimateByDistance(worldPoints);

            const actionType = isInEraseMode ? "erase_stroke" : "brush_stroke";
            
            // Notify parent component with the brush/erase stroke data
            if (onContourUpdate) {
              onContourUpdate({
                action: actionType,
                structureId: selectedStructure,
                slicePosition: currentSlicePosition,
                pointCount: filteredPoints.length,
                points: filteredPoints,
                brushSize: brushSize,
                predictionEnabled: predictionEnabled,
                isEraseMode: isInEraseMode,
              });
            }
        }
    } catch (error) {
        log.error(`Error in finalizeBrushStroke: ${String(error)}`, 'brush');
    } finally {
        brushPointsRef.current = [];
        adaptiveShapesRef.current = [];
    }
};

const pixelToWorld = (pixelX: number, pixelY: number, imageMetadata: any, slicePosition: number): [number, number, number] => {
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;

    const worldX = imagePosition[0] + (pixelX * colSpacing);
    const worldY = imagePosition[1] + (pixelY * rowSpacing);
    
    return [worldX, worldY, slicePosition];
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
    const pixelSpacing = imageMetadata?.pixelSpacing ? imageMetadata.pixelSpacing.split('\\').map(Number)[0] : 1.171875;
    
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
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 2px; color: #60a5fa;">Brush Thickness</div>
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
    sliderFill.style.backgroundColor = "#60a5fa"; // Blue to match UI theme
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
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 2px; color: #60a5fa;">Brush Thickness</div>
        <div style="font-size: 20px; font-weight: bold; margin-bottom: 2px;">${sizeCm.toFixed(2)} cm</div>
        <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">(${Math.round(sizePixels)} px)</div>
      `;
    }
    
    if (sliderFill) {
      // Map size to slider width (0-100%) - medical range 1-102px to cover 1mm-100mm
      const minSize = 1;
      const maxSize = 102;
      const percentage = ((sizePixels - minSize) / (maxSize - minSize)) * 100;
      sliderFill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    }
  };

  return null; // This component only handles interactions, no visual rendering
}
