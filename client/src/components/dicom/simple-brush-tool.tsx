import React, { useRef, useEffect, useState, useCallback } from "react";
import { canvasToWorld } from "@/lib/dicom-coordinates";
import { createAdaptivePreview } from "@/lib/smart-brush-utils";
import { combineContours } from "@/lib/clipper-boolean-operations";

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
  console.log('SimpleBrushTool render:', { isActive, selectedStructure, hasCanvas: !!canvasRef.current, isEraseMode });
  const [isDrawing, setIsDrawing] = useState(false);
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
        console.log('🔹 Temporary erase mode activated (Shift held)');
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && isShiftPressed) {
        setIsShiftPressed(false);
        setIsTemporaryEraseMode(false);
        console.log('🔹 Temporary erase mode deactivated (Shift released)');
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
      console.log('Creating overlay canvas');
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

    // Draw brush cursor or adaptive preview shape
    // For smart brush, show preview even while drawing
    if (cursorPosition && (!isDrawing || smartBrushEnabled)) {
      let currentBrushSize = isAdjustingSize ? adjustedBrushSize : brushSize;
      
      // Convert brush size from pixels to world coordinates to match actual output
      const pixelSpacing = imageMetadata?.pixelSpacing ? imageMetadata.pixelSpacing.split('\\').map(Number)[0] : 0.9765625;
      const brushSizeInMM = currentBrushSize * pixelSpacing;
      
      // Convert world size back to screen pixels for cursor display
      const zoomScale = ctTransform?.current?.scale || 1;
      const cursorRadiusInScreenPixels = (brushSizeInMM / pixelSpacing) * zoomScale;
      
      // Debug what condition will be used
      if (Math.random() < 0.05) {
        console.log('Draw overlay conditions:', {
          smartBrushEnabled,
          hasAdaptivePreviewPoints: !!adaptivePreviewPoints,
          adaptivePreviewPointsLength: adaptivePreviewPoints?.length || 0,
          isEraseMode,
          isTemporaryEraseMode
        });
      }

      // For smart brush, show adaptive preview shape if available
      if (smartBrushEnabled && adaptivePreviewPoints && adaptivePreviewPoints.length > 2 && !isEraseMode && !isTemporaryEraseMode) {
        // Draw adaptive preview shape
        console.log(`Drawing adaptive preview with ${adaptivePreviewPoints.length} points at cursor (${cursorPosition.x}, ${cursorPosition.y})`, adaptivePreviewPoints.slice(0, 3));
        
        // Add visibility debugging
        const bounds = {
          minX: Math.min(...adaptivePreviewPoints.map(p => p.x)),
          maxX: Math.max(...adaptivePreviewPoints.map(p => p.x)),
          minY: Math.min(...adaptivePreviewPoints.map(p => p.y)),
          maxY: Math.max(...adaptivePreviewPoints.map(p => p.y))
        };
        console.log('Preview bounds:', bounds);
        console.log('Canvas size:', overlayCanvasRef.current.width, 'x', overlayCanvasRef.current.height);
        
        ctx.save();
        
        // Draw filled shape first with higher opacity
        ctx.beginPath();
        adaptivePreviewPoints.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.closePath();
        
        // Fill with structure color (no outline for cleaner preview)
        ctx.fillStyle = structureColor;
        ctx.globalAlpha = 0.3; // Semi-transparent fill
        ctx.fill();
        
        ctx.restore();
      } else {
        // Regular brush cursor
        ctx.beginPath();
        ctx.arc(cursorPosition.x, cursorPosition.y, cursorRadiusInScreenPixels, 0, 2 * Math.PI);
        ctx.strokeStyle = structureColor;
        ctx.lineWidth = smartBrushEnabled ? 3 : 2;
        if (smartBrushEnabled) {
          ctx.setLineDash([6, 3]); // Dashed line to indicate smart brush
        }
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash
      }

      // Draw center dot
      ctx.beginPath();
      ctx.arc(cursorPosition.x, cursorPosition.y, 2, 0, 2 * Math.PI);
      ctx.fillStyle = structureColor;
      ctx.fill();
    }

    // Draw current brush stroke - only for regular brush, not smart brush
    if (brushPointsRef.current.length > 0 && !smartBrushEnabled) {
      ctx.strokeStyle = structureColor;
      const currentBrushSize = isAdjustingSize ? adjustedBrushSize : brushSize;
      
      // Use same coordinate system as cursor and output
      const pixelSpacing = imageMetadata?.pixelSpacing ? imageMetadata.pixelSpacing.split('\\').map(Number)[0] : 0.9765625;
      const brushSizeInMM = currentBrushSize * pixelSpacing;
      const zoomScale = ctTransform?.current?.scale || 1;
      const strokeWidthInScreenPixels = (brushSizeInMM / pixelSpacing) * zoomScale * 2; // Diameter
      
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
    }
    
    // Draw all collected adaptive shapes during smart brush drawing
    if (isDrawing && smartBrushEnabled && adaptiveShapesRef.current.length > 0) {
      ctx.save();
      
      // Draw each collected adaptive shape
      adaptiveShapesRef.current.forEach((shape, shapeIndex) => {
        if (shape.length > 2) {
          // Draw filled shape with structure color
          ctx.beginPath();
          shape.forEach((point, index) => {
            if (index === 0) {
              ctx.moveTo(point.x, point.y);
            } else {
              ctx.lineTo(point.x, point.y);
            }
          });
          ctx.closePath();
          
          // Fill with semi-transparent structure color (no outline for cleaner preview)
          ctx.fillStyle = structureColor;
          ctx.globalAlpha = 0.3; // Slightly higher opacity since no outline
          ctx.fill();
        }
      });
      
      ctx.restore();
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
        
        const deltaX = e.clientX - sizeAdjustStart.x;
        const pixelSpacing = imageMetadata?.pixelSpacing ? imageMetadata.pixelSpacing.split('\\').map(Number)[0] : 0.9765625;
        
        // Calculate minimum pixels for 0.1 cm (1 mm)
        const minPixelsFor1mm = Math.ceil(1 / pixelSpacing); // ~1 pixel for typical spacing
        const maxPixels = 102; // ~10 cm for typical spacing
        
        // More sensitive scaling - 50 pixels = 1 cm change
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

      const coords = getCanvasCoords(e);
      setCursorPosition(coords);

      // Generate adaptive preview when smart brush is enabled (both hovering and drawing)
      if (smartBrushEnabled && !isEraseMode && !isTemporaryEraseMode && canvasRef.current) {
        console.log(`Smart brush preview check: enabled=${smartBrushEnabled}, erase=${isEraseMode}, tempErase=${isTemporaryEraseMode}, hasCanvas=${!!canvasRef.current}`);
        try {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
            const pixelX = Math.round((coords.x - transform.offsetX) / transform.scale);
            const pixelY = Math.round((coords.y - transform.offsetY) / transform.scale);
            
            // Get the actual DICOM image dimensions from transform
            const imageWidth = transform.imageWidth || imageMetadata?.Columns || 512;
            const imageHeight = transform.imageHeight || imageMetadata?.Rows || 512;
            const canvasWidth = canvasRef.current.width;
            const canvasHeight = canvasRef.current.height;
            
            // Calculate where the DICOM image is rendered on the canvas
            const scaledWidth = imageWidth * transform.scale;
            const scaledHeight = imageHeight * transform.scale;
            const imageStartX = (canvasWidth - scaledWidth) / 2;
            const imageStartY = (canvasHeight - scaledHeight) / 2;
            
            // Adjust pixel coordinates to be relative to the extracted image area
            const adjustedPixelX = (coords.x - imageStartX) / transform.scale;
            const adjustedPixelY = (coords.y - imageStartY) / transform.scale;
            
            // Check if cursor is within the actual DICOM image bounds
            if (adjustedPixelX < 0 || adjustedPixelX >= imageWidth || 
                adjustedPixelY < 0 || adjustedPixelY >= imageHeight) {
              // Cursor is outside the DICOM image - don't show preview
              setAdaptivePreviewPoints(null);
              return;
            }
            
            // Debug log - only log occasionally to reduce noise
            if (Math.random() < 0.05) {
              console.log('Canvas:', canvasWidth, 'x', canvasHeight);
              console.log('Image:', imageWidth, 'x', imageHeight); 
              console.log('Scaled:', scaledWidth, 'x', scaledHeight);
              console.log('Image starts at:', imageStartX, imageStartY);
              console.log('Canvas mouse:', coords.x, coords.y);
              console.log('Adjusted pixel:', adjustedPixelX, adjustedPixelY);
            }
            
            // Get pixel data only from the area where the DICOM image is rendered
            const imageData = ctx.getImageData(
              Math.floor(imageStartX),
              Math.floor(imageStartY),
              Math.ceil(scaledWidth),
              Math.ceil(scaledHeight)
            );
            const pixelData = imageData.data;
            
            // Convert RGBA to grayscale
            const grayscaleData = new Float32Array(scaledWidth * scaledHeight);
            for (let i = 0; i < grayscaleData.length; i++) {
              grayscaleData[i] = pixelData[i * 4];
            }
            
            // Create adaptive preview shape
            const previewPoints = createAdaptivePreview(
              grayscaleData,
              Math.ceil(scaledWidth),
              Math.ceil(scaledHeight),
              Math.round(adjustedPixelX * transform.scale),
              Math.round(adjustedPixelY * transform.scale),
              brushSize
            );
            
            // Convert preview points back to canvas coordinates
            let canvasPreviewPoints = previewPoints.map(p => ({
              x: p.x + imageStartX,
              y: p.y + imageStartY
            }));
            
            // Apply temporal smoothing to reduce jumpiness
            if (previousPreviewPointsRef.current && 
                previousPreviewPointsRef.current.length === canvasPreviewPoints.length) {
              // Blend with previous frame for smooth transitions
              const blendFactor = 0.7; // How much to keep from previous frame
              canvasPreviewPoints = canvasPreviewPoints.map((point, i) => {
                const prevPoint = previousPreviewPointsRef.current![i];
                return {
                  x: prevPoint.x * blendFactor + point.x * (1 - blendFactor),
                  y: prevPoint.y * blendFactor + point.y * (1 - blendFactor)
                };
              });
            }
            
            // Only update if we have valid points
            if (canvasPreviewPoints.length > 2) {
              console.log('Setting adaptive preview points:', canvasPreviewPoints.length, 'Smart brush enabled:', smartBrushEnabled, 'isEraseMode:', isEraseMode, 'isTemporaryEraseMode:', isTemporaryEraseMode);
              previousPreviewPointsRef.current = canvasPreviewPoints;
              setAdaptivePreviewPoints(canvasPreviewPoints);
              
              // Convert preview to world coordinates and send to viewer for rendering
              if (onPreviewUpdate && canvasRef.current) {
                const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
                const worldPoints: number[] = [];
                
                // Convert each point from canvas to world coordinates
                for (const point of canvasPreviewPoints) {
                  const worldPoint = canvasToWorld(
                    point.x,
                    point.y,
                    canvasRef.current.width,
                    canvasRef.current.height,
                    imageMetadata || {},
                    currentSlicePosition
                  );
                  
                  // Add to flat array format (x,y,z)
                  worldPoints.push(worldPoint[0], worldPoint[1], worldPoint[2]);
                }
                
                // Send preview contour to viewer
                onPreviewUpdate([{
                  points: worldPoints,
                  slicePosition: currentSlicePosition,
                  isPreview: true
                }]);
              }
              
              // If drawing with smart brush, collect this adaptive shape
              console.log(`Smart brush collection check: isDrawing=${isDrawing}, smartBrushEnabled=${smartBrushEnabled}, previewPoints=${canvasPreviewPoints.length}`);
              if (isDrawing && smartBrushEnabled) {
                adaptiveShapesRef.current.push(canvasPreviewPoints);
                console.log(`✅ Collected adaptive shape #${adaptiveShapesRef.current.length} with ${canvasPreviewPoints.length} points`);
                
                // Send all collected adaptive shapes as preview during drawing
                if (onPreviewUpdate && canvasRef.current) {
                  const allPreviewContours: any[] = [];
                  
                  // Convert all collected adaptive shapes to world coordinates
                  for (const shape of adaptiveShapesRef.current) {
                    const worldPoints: number[] = [];
                    for (const point of shape) {
                      const worldPoint = canvasToWorld(
                        point.x,
                        point.y,
                        canvasRef.current.width,
                        canvasRef.current.height,
                        imageMetadata || {},
                        currentSlicePosition
                      );
                      worldPoints.push(worldPoint[0], worldPoint[1], worldPoint[2]);
                    }
                    
                    allPreviewContours.push({
                      points: worldPoints,
                      slicePosition: currentSlicePosition,
                      isPreview: true
                    });
                  }
                  
                  // Send all preview contours to show the full path
                  onPreviewUpdate(allPreviewContours);
                }
              }
            }
          }
        } catch (error) {
          console.error("Error creating adaptive preview:", error instanceof Error ? error.message : error);
          console.error("Stack:", error instanceof Error ? error.stack : "No stack");
          setAdaptivePreviewPoints(null);
          // Clear preview on error
          if (onPreviewUpdate) {
            onPreviewUpdate(null);
          }
        }
      } else {
        setAdaptivePreviewPoints(null);
        // Clear preview when smart brush is not enabled or in erase mode
        if (onPreviewUpdate && smartBrushEnabled) {
          onPreviewUpdate(null);
        }
      }

      if (isDrawing && selectedStructure) {
        e.preventDefault();
        e.stopPropagation();
        
        // For standard brush, collect and render points
        if (!smartBrushEnabled) {
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
        // For smart brush, the adaptive shapes are already being collected above
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
        adaptiveShapesRef.current = []; // Clear adaptive shapes for new stroke
        
        if (smartBrushEnabled) {
          console.log("🎨 Smart brush stroke started - adaptive shapes cleared");
        }
        
        // For standard brush, start collecting points
        if (!smartBrushEnabled) {
          addBrushPoint(coords.x, coords.y);
        }
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
          console.log(`Right-click slider: Updated brush size from ${brushSize}px to ${adjustedBrushSize}px`);
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
        console.log("Finalizing brush stroke: No structure selected");
        brushPointsRef.current = [];
        adaptiveShapesRef.current = [];
        return;
      }

      // Get current zoom/pan transform
      const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
      
      // Parse DICOM metadata once
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
      const [rowSpacing, colSpacing] = pixelSpacing;

      // Determine if we're in erase mode
      const isInEraseMode = isEraseMode || isTemporaryEraseMode;

      // Handle smart brush mode
      if (smartBrushEnabled && adaptiveShapesRef.current.length > 0 && !isInEraseMode) {
        console.log(`🎨 Finalizing smart brush with ${adaptiveShapesRef.current.length} adaptive shapes`);
        console.log(`🎨 Adaptive shapes point counts: ${adaptiveShapesRef.current.map(shape => shape.length).join(', ')}`);
        
        // Convert adaptive shapes to world coordinate contours for ClipperLib
        const contours: number[][] = [];
        
        adaptiveShapesRef.current.forEach((shape, index) => {
          if (shape.length > 2) {
            const contour: number[] = [];
            shape.forEach(p => {
              const pixelX = (p.x - transform.offsetX) / transform.scale;
              const pixelY = (p.y - transform.offsetY) / transform.scale;
              const worldX = imagePosition[0] + (pixelX * colSpacing);
              const worldY = imagePosition[1] + (pixelY * rowSpacing);
              const worldZ = currentSlicePosition;
              contour.push(worldX, worldY, worldZ);
            });
            contours.push(contour);
            console.log(`🎨 Converted adaptive shape ${index + 1} to world coords: ${contour.length / 3} points`);
          }
        });
        
        if (contours.length === 0) {
          console.log("No valid contours to merge");
          return;
        }
        
        // Combine all adaptive shapes into a single path
        // Treat all collected shapes as one continuous stroke
        console.log(`Combining ${contours.length} adaptive shapes into single path`);
        
        if (contours.length === 1) {
          // Single shape - just use it directly
          const singleContour = contours[0];
          console.log(`Smart brush completed: ${singleContour.length / 3} points for structure ${selectedStructure}`);
          
          if (onContourUpdate) {
            onContourUpdate({
              action: "replace_contour",
              structureId: selectedStructure,
              slicePosition: currentSlicePosition,
              pointCount: singleContour.length / 3,
              points: singleContour,
              brushSize: brushSize,
              isAdaptiveBrush: true,
            });
          }
        } else {
          // Multiple shapes - union them all together
          try {
            let mergedContours = [contours[0]];
            
            // Merge each subsequent contour with the result
            for (let i = 1; i < contours.length; i++) {
              const combinedResults: number[][] = [];
              
              // Combine the new contour with each existing merged contour
              for (const existingContour of mergedContours) {
                const result = await combineContours(existingContour, contours[i]);
                combinedResults.push(...result);
              }
              
              if (combinedResults.length > 0) {
                mergedContours = combinedResults;
              }
            }
            
            // Take the largest resulting contour
            let largestContour = mergedContours[0];
            if (mergedContours.length > 1) {
              let maxArea = 0;
              for (const contour of mergedContours) {
                const area = calculateContourArea(contour);
                if (area > maxArea) {
                  maxArea = area;
                  largestContour = contour;
                }
              }
            }
            
            console.log(`Smart brush completed: ${largestContour.length / 3} points for structure ${selectedStructure}`);

            // Send as replace contour action (creates a complete contour)
            if (onContourUpdate) {
              onContourUpdate({
                action: "replace_contour",
                structureId: selectedStructure,
                slicePosition: currentSlicePosition,
                pointCount: largestContour.length / 3,
                points: largestContour,
                brushSize: brushSize,
                isAdaptiveBrush: true,
              });
            }
          } catch (unionError) {
            console.error("Error unioning adaptive shapes, sending as brush stroke instead:", unionError);
            
            // Fall back to sending all shapes as a brush stroke
            const allPoints: number[] = [];
            contours.forEach(contour => {
              // Add each contour's points
              allPoints.push(...contour);
            });
            
            if (onContourUpdate && allPoints.length > 0) {
              onContourUpdate({
                action: "brush_stroke",
                structureId: selectedStructure,
                slicePosition: currentSlicePosition,
                pointCount: allPoints.length / 3,
                points: allPoints,
                brushSize: brushSize,
                isAdaptiveBrush: true,
              });
            }
          }
        }
      } 
      // Handle regular brush mode
      else if (brushPointsRef.current.length > 0 && !smartBrushEnabled) {
        console.log(`Finalizing regular brush with ${brushPointsRef.current.length} points`);

        // Regular brush mode - convert all brush points to world coordinates
        const worldPoints = brushPointsRef.current.map((point) => {
          const pixelX = (point.x - transform.offsetX) / transform.scale;
          const pixelY = (point.y - transform.offsetY) / transform.scale;
          const worldX = imagePosition[0] + (pixelX * colSpacing);
          const worldY = imagePosition[1] + (pixelY * rowSpacing);
          const worldZ = currentSlicePosition;
          
          console.log(`Brush point: Canvas(${point.x.toFixed(1)}, ${point.y.toFixed(1)}) -> Pixel(${pixelX.toFixed(1)}, ${pixelY.toFixed(1)}) -> World(${worldX.toFixed(1)}, ${worldY.toFixed(1)}, ${worldZ.toFixed(1)})`);
          
          return [worldX, worldY, worldZ];
        });

        const actionType = isInEraseMode ? "erase_stroke" : "brush_stroke";
        
        console.log(
          `${isInEraseMode ? 'Erase' : 'Brush'} stroke completed: ${worldPoints.length} points ${isInEraseMode ? 'removed from' : 'added to'} structure ${selectedStructure} at slice ${currentSlicePosition}mm`,
        );

        // Notify parent component with the brush/erase stroke data
        if (onContourUpdate) {
          onContourUpdate({
            action: actionType,
            structureId: selectedStructure,
            slicePosition: currentSlicePosition,
            pointCount: worldPoints.length,
            points: worldPoints,
            brushSize: brushSize,
            predictionEnabled: predictionEnabled,
            isEraseMode: isInEraseMode,
          });
        }
      }
    } catch (error) {
      console.error("Error in finalizeBrushStroke:", error);
    } finally {
      // Always clear brush points and adaptive shapes
      brushPointsRef.current = [];
      adaptiveShapesRef.current = [];
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
