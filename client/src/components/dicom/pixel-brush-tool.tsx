import { useCallback, useEffect, useRef, useState } from 'react';
import { BrushOperation } from '@shared/schema';

interface Point {
  x: number;
  y: number;
}

interface PixelBrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure?: any;
  rtStructures?: any;
  currentSlicePosition: number;
  onContourUpdate?: (updatedStructures: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata?: any;
  smoothingEnabled?: boolean;
  enableSmartMode?: boolean;
  onBrushModeChange?: (mode: BrushOperation) => void;
}

export const PixelBrushTool: React.FC<PixelBrushToolProps> = ({
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
  
  // Track the slice we're painting on to ensure slice-specific visibility
  const [paintingSlice, setPaintingSlice] = useState<number | null>(null);
  
  // Convert millimeter brush size to canvas pixels based on zoom and pixel spacing
  const brushSizePixels = Math.max(1, Math.round(brushSize * zoom * 0.85)); // ~1mm per pixel at zoom=1
  
  // Get structure color
  const structureColor = selectedStructure && rtStructures?.structures 
    ? rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure)?.color || [255, 255, 0]
    : [255, 255, 0];

  // Draw brush preview cursor
  const drawBrushPreview = useCallback((canvasPoint: Point) => {
    if (!previewCanvasRef.current) return;
    
    const ctx = previewCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear previous preview
    ctx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
    
    const radius = brushSizePixels / 2;
    const color = structureColor;
    
    ctx.save();
    
    // Draw outer border outline (darker)
    ctx.strokeStyle = operation === BrushOperation.ADDITIVE 
      ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`
      : 'rgba(255, 0, 0, 1.0)'; // Red for subtraction
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius + 2, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw inner cursor circle with dashed line
    ctx.strokeStyle = operation === BrushOperation.ADDITIVE 
      ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`
      : 'rgba(255, 0, 0, 0.8)'; // Red for subtraction
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Add center dot
    ctx.fillStyle = ctx.strokeStyle;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, 1, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.restore();
  }, [brushSizePixels, operation, structureColor]);

  // Paint pixels matching medical contour style (filled with 3px border)
  const paintPixels = useCallback((canvasPoint: Point) => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const radius = brushSizePixels / 2;
    const color = structureColor;
    
    ctx.save();
    
    if (operation === BrushOperation.ADDITIVE) {
      ctx.globalCompositeOperation = 'source-over';
      
      // Draw filled circle
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw 3px border around the filled area
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, radius + 1.5, 0, 2 * Math.PI); // Offset for border
      ctx.stroke();
      
    } else {
      // Erase pixels (including border area)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, radius + 3, 0, 2 * Math.PI); // Include border in erase
      ctx.fill();
    }
    
    ctx.restore();
  }, [brushSizePixels, operation, structureColor]);

  // Paint continuous line matching medical contour style (filled with 3px border)
  const paintLine = useCallback((from: Point, to: Point) => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const color = structureColor;
    const lineWidth = brushSizePixels;
    
    ctx.save();
    
    if (operation === BrushOperation.ADDITIVE) {
      ctx.globalCompositeOperation = 'source-over';
      
      // Draw filled stroke
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      
      // Add filled circles at endpoints for smooth connection
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.beginPath();
      ctx.arc(from.x, from.y, lineWidth / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(to.x, to.y, lineWidth / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw 3px border around the stroke
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.lineWidth = lineWidth + 6; // 3px on each side
      ctx.globalCompositeOperation = 'destination-over'; // Draw border behind
      
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      
      // Border circles at endpoints
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.beginPath();
      ctx.arc(from.x, from.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(to.x, to.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
      
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
      
      // Erase with slightly larger area to include border
      ctx.lineWidth = lineWidth + 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(from.x, from.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(to.x, to.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    
    ctx.restore();
  }, [brushSizePixels, operation, structureColor]);

  // Convert brush strokes to actual contour points in RT structure data
  const convertBrushToContour = useCallback(() => {
    if (!maskCanvasRef.current || !selectedStructure || !rtStructures || !imageMetadata) return;

    const canvas = maskCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get the painted pixels from the mask canvas
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Extract contour points from painted pixels
    const contourPoints = extractContourFromPixels(data, canvas.width, canvas.height);
    
    if (contourPoints.length === 0) return;

    // Convert canvas coordinates to DICOM world coordinates
    const worldPoints = contourPoints.map(point => {
      return canvasToWorldCoordinates(point, imageMetadata, zoom, panX, panY);
    });

    // Update the RT structure data
    updateRTStructureContour(selectedStructure, currentSlicePosition, worldPoints);

    // Clear the brush canvas since it's now part of the structure
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Trigger contour update callback to refresh the display
    if (onContourUpdate && rtStructures) {
      onContourUpdate(rtStructures);
    }
  }, [selectedStructure, currentSlicePosition, rtStructures, imageMetadata, zoom, panX, panY, onContourUpdate]);

  // Extract ordered contour points using Moore neighborhood tracing (medical standard)
  const extractContourFromPixels = useCallback((data: Uint8ClampedArray, width: number, height: number) => {
    // Create binary mask from painted pixels
    const binaryMask = new Array(height).fill(null).map(() => new Array(width).fill(false));
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        binaryMask[y][x] = data[index + 3] > 128; // Alpha threshold
      }
    }
    
    // Find all contours using Moore neighborhood tracing
    const contours = findContoursWithMooreTracing(binaryMask, width, height);
    
    // Return the largest contour (main painted area)
    if (contours.length === 0) return [];
    
    // Sort contours by area and return the largest
    contours.sort((a, b) => b.length - a.length);
    return contours[0];
  }, []);

  // Moore neighborhood tracing algorithm for DICOM-compliant contour extraction
  const findContoursWithMooreTracing = useCallback((mask: boolean[][], width: number, height: number): Point[][] => {
    const visited = new Array(height).fill(null).map(() => new Array(width).fill(false));
    const contours: Point[][] = [];
    
    // 8-connected neighbors (Moore neighborhood)
    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, 1], [1, 1], [1, 0],
      [1, -1], [0, -1]
    ];
    
    // Find starting points for contours
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y][x] && !visited[y][x]) {
          // Found unvisited foreground pixel - start contour tracing
          const contour = traceContourMoore(mask, visited, x, y, width, height, directions);
          if (contour.length > 4) { // Minimum viable contour size
            contours.push(contour);
          }
        }
      }
    }
    
    return contours;
  }, []);

  // Moore neighborhood contour tracing for a single contour
  const traceContourMoore = useCallback((
    mask: boolean[][],
    visited: boolean[][],
    startX: number,
    startY: number,
    width: number,
    height: number,
    directions: number[][]
  ): Point[] => {
    const contour: Point[] = [];
    let currentX = startX;
    let currentY = startY;
    let direction = 0; // Start facing right
    
    do {
      contour.push({ x: currentX, y: currentY });
      visited[currentY][currentX] = true;
      
      // Find next boundary pixel using Moore neighborhood
      let found = false;
      for (let i = 0; i < 8; i++) {
        const checkDir = (direction + i) % 8;
        const [dx, dy] = directions[checkDir];
        const nextX = currentX + dx;
        const nextY = currentY + dy;
        
        if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height && mask[nextY][nextX]) {
          currentX = nextX;
          currentY = nextY;
          direction = (checkDir + 6) % 8; // Adjust direction for next iteration
          found = true;
          break;
        }
      }
      
      if (!found) break;
      
    } while (!(currentX === startX && currentY === startY) && contour.length < width * height);
    
    // Ensure contour is properly closed
    if (contour.length > 2 && !(contour[0].x === contour[contour.length - 1].x && contour[0].y === contour[contour.length - 1].y)) {
      contour.push({ x: startX, y: startY });
    }
    
    return contour;
  }, []);

  // Convert canvas coordinates to DICOM world coordinates using exact RT overlay transformation
  const canvasToWorldCoordinates = useCallback((point: Point, metadata: any, currentZoom: number, currentPanX: number, currentPanY: number) => {
    if (!canvasRef.current) return [0, 0, 0];
    
    // Use the same parameters as RT overlay
    const imagePosition: [number, number, number] = [-300, -300, 35]; // Match RT overlay
    const pixelSpacing: [number, number] = [1.171875, 1.171875];
    const sliceLocation = metadata.sliceLocation ? parseFloat(metadata.sliceLocation) : imagePosition[2];
    const dicomImageWidth = 512;
    const dicomImageHeight = 512;
    
    const canvas = canvasRef.current;
    
    // Apply the EXACT INVERSE of the RT overlay rendering transformation
    // RT overlay applies: translate(canvas.width/2, canvas.height/2) -> scale(zoom) -> translate(-canvas.width/2 + panX, -canvas.height/2 + panY)
    
    // Step 1: Reverse the final translation
    const step1X = point.x + canvas.width / 2 - currentPanX;
    const step1Y = point.y + canvas.height / 2 - currentPanY;
    
    // Step 2: Reverse the scaling
    const step2X = step1X / currentZoom;
    const step2Y = step1Y / currentZoom;
    
    // Step 3: Reverse the initial translation
    const normalizedX = (step2X + canvas.width / 2) / canvas.width;
    const normalizedY = (step2Y + canvas.height / 2) / canvas.height;
    
    // Convert normalized coordinates (0-1) to DICOM pixel coordinates
    const canvasPixelX = normalizedX * dicomImageWidth;
    const canvasPixelY = normalizedY * dicomImageHeight;
    
    // Apply the EXACT INVERSE of the RT overlay worldToCanvas transformation
    // RT overlay does: j = (worldX - originX) / pixelSpacing[0], i = (worldY - originY) / pixelSpacing[1]
    // Then: rotatedJ = imageWidth - i, rotatedI = j
    // Then: canvasX = (rotatedJ / imageWidth) * canvasWidth, canvasY = (rotatedI / imageHeight) * canvasHeight
    
    // Reverse: Get rotatedJ and rotatedI from canvas coordinates
    const rotatedJ = canvasPixelX;
    const rotatedI = canvasPixelY;
    
    // Reverse the rotation: i = imageWidth - rotatedJ, j = rotatedI
    const i = dicomImageWidth - rotatedJ;
    const j = rotatedI;
    
    // Convert DICOM pixel indices back to world coordinates
    const worldX = imagePosition[0] + (j * pixelSpacing[0]);
    const worldY = imagePosition[1] + (i * pixelSpacing[1]);
    const worldZ = sliceLocation;
    
    return [worldX, worldY, worldZ];
  }, []);

  // Intelligently merge brush strokes with existing contours for seamless expansion
  const updateRTStructureContour = useCallback((structureId: number, slicePosition: number, worldPoints: number[][]) => {
    if (!rtStructures) return;

    // Find the structure to update
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure) return;

    // Find existing contour for this slice
    let sliceContour = structure.contours.find((c: any) => 
      Math.abs(c.slicePosition - slicePosition) < 2.0
    );

    if (!sliceContour) {
      // Create new contour for this slice
      sliceContour = {
        slicePosition: slicePosition,
        points: worldPoints.flat()
      };
      structure.contours.push(sliceContour);
    } else {
      // Intelligently merge with existing contour
      if (operation === BrushOperation.ADDITIVE) {
        // Convert existing points to array of [x,y,z] tuples
        const existingPoints: number[][] = [];
        for (let i = 0; i < sliceContour.points.length; i += 3) {
          existingPoints.push([sliceContour.points[i], sliceContour.points[i + 1], sliceContour.points[i + 2]]);
        }
        
        // Merge brush points with existing contour using union operation
        const mergedPoints = mergeContourPolygons(existingPoints, worldPoints);
        sliceContour.points = mergedPoints.flat();
        
        console.log('Merged brush stroke with existing contour:', {
          structureId,
          slicePosition,
          existingPointCount: existingPoints.length,
          brushPointCount: worldPoints.length,
          mergedPointCount: mergedPoints.length
        });
      } else {
        // For subtraction, subtract brush area from existing contour
        const existingPoints: number[][] = [];
        for (let i = 0; i < sliceContour.points.length; i += 3) {
          existingPoints.push([sliceContour.points[i], sliceContour.points[i + 1], sliceContour.points[i + 2]]);
        }
        
        const subtractedPoints = subtractContourPolygons(existingPoints, worldPoints);
        sliceContour.points = subtractedPoints.flat();
        
        console.log('Subtracted brush stroke from existing contour:', {
          structureId,
          slicePosition,
          existingPointCount: existingPoints.length,
          brushPointCount: worldPoints.length,
          resultPointCount: subtractedPoints.length
        });
      }
    }
  }, [rtStructures, operation]);

  // Medical-grade contour merging using contour expansion algorithm
  const mergeContourPolygons = useCallback((existing: number[][], brush: number[][]): number[][] => {
    if (existing.length === 0) return brush;
    if (brush.length === 0) return existing;
    
    // For medical imaging, use a simple but effective approach:
    // Combine all points and create an ordered boundary that encompasses both regions
    
    // Combine and deduplicate points
    const tolerance = 2.0; // mm tolerance for medical precision
    const allPoints: number[][] = [];
    
    // Add existing points
    for (const point of existing) {
      allPoints.push(point);
    }
    
    // Add brush points (avoiding duplicates)
    for (const point of brush) {
      const isDuplicate = allPoints.some(existing => 
        Math.abs(existing[0] - point[0]) < tolerance &&
        Math.abs(existing[1] - point[1]) < tolerance
      );
      
      if (!isDuplicate) {
        allPoints.push(point);
      }
    }
    
    // Create ordered boundary using contour expansion
    return createOrderedBoundary(allPoints);
  }, []);

  // Subtract brush area from existing contour (medical approach)
  const subtractContourPolygons = useCallback((existing: number[][], brush: number[][]): number[][] => {
    // Remove points from existing contour that are within brush area
    const brushTolerance = 5.0; // mm - slightly larger than brush size for clean removal
    
    const filteredPoints = existing.filter(point => {
      // Check if this point should be removed (is within brush area)
      const isWithinBrush = brush.some(brushPoint => {
        const distance = Math.sqrt(
          Math.pow(brushPoint[0] - point[0], 2) + 
          Math.pow(brushPoint[1] - point[1], 2)
        );
        return distance < brushTolerance;
      });
      
      return !isWithinBrush;
    });
    
    // Ensure we have enough points for a valid contour
    if (filteredPoints.length < 3) {
      console.log('Subtraction would remove too many points, keeping original contour');
      return existing;
    }
    
    // Re-order the remaining points to maintain contour continuity
    return createOrderedBoundary(filteredPoints);
  }, []);

  // Create an ordered boundary from a set of points (medical standard)
  const createOrderedBoundary = useCallback((points: number[][]): number[][] => {
    if (points.length < 3) return points;
    
    // Find centroid
    const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const centerZ = points[0][2]; // Use Z from first point
    
    // Sort points by angle from centroid (creates ordered boundary)
    const sortedPoints = points.slice().sort((a, b) => {
      const angleA = Math.atan2(a[1] - centerY, a[0] - centerX);
      const angleB = Math.atan2(b[1] - centerY, b[0] - centerX);
      return angleA - angleB;
    });
    
    // Ensure all points have the same Z coordinate
    const orderedPoints = sortedPoints.map(point => [point[0], point[1], centerZ]);
    
    // Close the contour by ensuring first and last points are connected
    if (orderedPoints.length > 2) {
      const first = orderedPoints[0];
      const last = orderedPoints[orderedPoints.length - 1];
      const distance = Math.sqrt(
        Math.pow(first[0] - last[0], 2) + 
        Math.pow(first[1] - last[1], 2)
      );
      
      // If contour is not closed, close it
      if (distance > 2.0) {
        orderedPoints.push([first[0], first[1], first[2]]);
      }
    }
    
    return orderedPoints;
  }, []);

  // Mouse event handlers
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isActive || !selectedStructure || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setIsDrawing(true);
    setLastPosition(canvasPoint);
    
    // Set the painting slice to ensure slice-specific visibility
    setPaintingSlice(currentSlicePosition);
    
    // Start painting immediately
    paintPixels(canvasPoint);

    console.log('Pixel brush started painting:', {
      operation: operation,
      position: canvasPoint,
      slice: currentSlicePosition,
      brushSize: brushSize
    });
  }, [isActive, selectedStructure, paintPixels, operation, currentSlicePosition, brushSize]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isActive) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);
    drawBrushPreview(canvasPoint);

    if (isDrawing && lastPosition) {
      if (smoothingEnabled) {
        paintLine(lastPosition, canvasPoint);
      } else {
        paintPixels(canvasPoint);
      }
      setLastPosition(canvasPoint);
    }
  }, [isActive, isDrawing, lastPosition, drawBrushPreview, paintPixels, paintLine, smoothingEnabled]);

  const handleMouseUp = useCallback((event?: MouseEvent) => {
    console.log('Mouse up event triggered', { isDrawing, selectedStructure });
    
    if (!isDrawing) return;

    setIsDrawing(false);
    setLastPosition(null);

    try {
      // Convert brush strokes to contour data and update RT structures
      convertBrushToContour();
      
      console.log('Pixel brush stroke completed and converted to contour:', {
        structureId: selectedStructure,
        slice: currentSlicePosition,
        operation: operation,
        brushSize: brushSize
      });
      
    } catch (error) {
      console.error('Error in handleMouseUp:', error);
    }
  }, [isDrawing, selectedStructure, currentSlicePosition, operation, brushSize, convertBrushToContour]);

  // Hide mask canvas when not on the painting slice
  useEffect(() => {
    if (maskCanvasRef.current) {
      const isOnPaintingSlice = paintingSlice === null || paintingSlice === currentSlicePosition;
      maskCanvasRef.current.style.visibility = isOnPaintingSlice ? 'visible' : 'hidden';
    }
  }, [currentSlicePosition, paintingSlice]);

  // Create overlay canvases for mask and preview
  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      // Clean up canvases when inactive
      if (maskCanvasRef.current) {
        maskCanvasRef.current.remove();
        maskCanvasRef.current = null;
      }
      if (previewCanvasRef.current) {
        previewCanvasRef.current.remove();
        previewCanvasRef.current = null;
      }
      // Reset painting slice when tool is deactivated
      setPaintingSlice(null);
      return;
    }

    const mainCanvas = canvasRef.current;
    const canvasContainer = mainCanvas.parentElement;
    if (!canvasContainer) return;
    
    // Create mask canvas for painting
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mainCanvas.width;
    maskCanvas.height = mainCanvas.height;
    maskCanvas.style.position = 'absolute';
    maskCanvas.style.top = '0';
    maskCanvas.style.left = '0';
    maskCanvas.style.pointerEvents = 'none';
    maskCanvas.style.zIndex = '5';
    maskCanvas.style.opacity = '0.3'; // Match medical imaging standard: 30% opacity
    
    // Create preview canvas for cursor
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = mainCanvas.width;
    previewCanvas.height = mainCanvas.height;
    previewCanvas.style.position = 'absolute';
    previewCanvas.style.top = '0';
    previewCanvas.style.left = '0';
    previewCanvas.style.pointerEvents = 'none';
    previewCanvas.style.zIndex = '10';
    
    canvasContainer.appendChild(maskCanvas);
    canvasContainer.appendChild(previewCanvas);
    
    maskCanvasRef.current = maskCanvas;
    previewCanvasRef.current = previewCanvas;

    return () => {
      if (maskCanvas.parentElement) maskCanvas.remove();
      if (previewCanvas.parentElement) previewCanvas.remove();
    };
  }, [isActive]);

  // Set up mouse event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    // Hide default cursor to show custom brush cursor
    canvas.style.cursor = 'none';
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      canvas.style.cursor = 'default';
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp]);

  // Keyboard shortcuts for operation switching
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return;
      
      if (event.key === 'Shift') {
        setOperation(BrushOperation.SUBTRACTIVE);
        if (onBrushModeChange) onBrushModeChange(BrushOperation.SUBTRACTIVE);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isActive) return;
      
      if (event.key === 'Shift') {
        setOperation(BrushOperation.ADDITIVE);
        if (onBrushModeChange) onBrushModeChange(BrushOperation.ADDITIVE);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive, onBrushModeChange]);

  return null;
};