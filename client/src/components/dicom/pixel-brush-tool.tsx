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
    try {
      if (!maskCanvasRef.current || !selectedStructure || !rtStructures || !imageMetadata) return;

      console.log('🎨 Converting brush to contour');
      
      const canvas = maskCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Get the painted pixels from the mask canvas
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Extract contour points from painted pixels - SIMPLIFIED VERSION
      const contourPoints = extractContourFromPixels(data, canvas.width, canvas.height);
      
      if (contourPoints.length === 0) {
        console.log('No brush strokes found');
        return;
      }

      console.log(`Found ${contourPoints.length} contour points`);

      // Convert canvas coordinates to DICOM world coordinates
      const worldPoints = contourPoints.map(point => 
        canvasToWorldCoordinates(point, imageMetadata, zoom, panX, panY)
      );

      // Update the RT structure data
      updateRTStructureContour(selectedStructure, currentSlicePosition, worldPoints);

      // Clear the brush canvas since it's now part of the structure
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      console.log('✅ Brush converted to contour successfully');
    } catch (error) {
      console.error('❌ Error converting brush to contour:', error);
    }
  }, [selectedStructure, currentSlicePosition, rtStructures, imageMetadata, zoom, panX, panY]);

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

  // Simplified coordinate transformation - direct match to RT overlay approach
  const canvasToWorldCoordinates = useCallback((point: Point, metadata: any, currentZoom: number, currentPanX: number, currentPanY: number) => {
    if (!canvasRef.current) return [0, 0, 0];
    
    const canvas = canvasRef.current;
    const sliceLocation = metadata.sliceLocation ? parseFloat(metadata.sliceLocation) : 0;
    
    // Account for zoom and pan (same as RT overlay approach)
    const adjustedX = (point.x - canvas.width / 2) / currentZoom + canvas.width / 2 - currentPanX;
    const adjustedY = (point.y - canvas.height / 2) / currentZoom + canvas.height / 2 - currentPanY;
    
    // Use actual metadata or fallback to HN-ATLAS defaults
    const imagePosition = metadata.imagePosition ? 
      metadata.imagePosition.split('\\').map(Number) : [-300, -300, 35];
    const pixelSpacing = metadata.pixelSpacing ? 
      metadata.pixelSpacing.split('\\').map(Number) : [1.171875, 1.171875];
    
    // Convert canvas coordinates to DICOM world coordinates (simplified approach)
    const normalizedX = adjustedX / canvas.width;
    const normalizedY = adjustedY / canvas.height;
    
    const worldX = imagePosition[0] + (normalizedX * 512 * pixelSpacing[0]);
    const worldY = imagePosition[1] + (normalizedY * 512 * pixelSpacing[1]);
    const worldZ = sliceLocation;
    
    return [worldX, worldY, worldZ];
  }, []);

  // Smart contour expansion - merge with existing contours like pushing boundaries
  const updateRTStructureContour = useCallback((structureId: number, slicePosition: number, worldPoints: number[][]) => {
    if (!rtStructures || !onContourUpdate) return;

    console.log('=== RT STRUCTURE UPDATE DEBUG ===');
    console.log('Structure ID:', structureId, 'Slice:', slicePosition);
    console.log('Brush world points to add:', worldPoints.length);

    // Create a deep copy of rtStructures to avoid mutation
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    
    // Find the structure to update
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure) {
      console.log('ERROR: Structure not found with ROI number:', structureId);
      return;
    }

    console.log('Found structure:', structure.structureName, 'with', structure.contours.length, 'existing contours');

    // Find existing contour for this slice - use stricter tolerance to prevent cross-slice contamination
    let existingContour = structure.contours.find((c: any) => 
      Math.abs(c.slicePosition - slicePosition) < 0.1
    );
    
    console.log('Looking for existing contour on slice:', slicePosition);
    console.log('Available contours on slices:', structure.contours.map((c: any) => c.slicePosition));
    console.log('Found existing contour:', existingContour ? 'YES' : 'NO');
    
    // CRITICAL: Ensure we're storing the EXACT slice position to prevent cross-slice contamination
    console.log('EXACT slice position being stored:', slicePosition);

    if (!existingContour) {
      // No existing contour - create new one
      const newContour = {
        slicePosition: slicePosition,
        points: worldPoints.flat()
      };
      structure.contours.push(newContour);
      console.log('Created new contour - no existing contour found for this slice');
      console.log('New contour points (first 5):', newContour.points.slice(0, 15)); // 5 points x 3 coords each
    } else {
      console.log('Found existing contour with', existingContour.points.length / 3, 'points');
      console.log('Existing contour points (first 5):', existingContour.points.slice(0, 15));
      
      // Existing contour exists - check if brush touches it or should be separate  
      if (operation === BrushOperation.ADDITIVE) {
        // Convert existing points to array of [x,y,z] tuples
        const existingPoints: number[][] = [];
        for (let i = 0; i < existingContour.points.length; i += 3) {
          existingPoints.push([existingContour.points[i], existingContour.points[i + 1], existingContour.points[i + 2]]);
        }
        
        console.log('Existing points range - X:', Math.min(...existingPoints.map(p => p[0])).toFixed(1), 'to', Math.max(...existingPoints.map(p => p[0])).toFixed(1));
        console.log('Existing points range - Y:', Math.min(...existingPoints.map(p => p[1])).toFixed(1), 'to', Math.max(...existingPoints.map(p => p[1])).toFixed(1));
        
        // Smart merge: combine brush points with existing contour
        const expandedPoints = expandContourWithBrush(existingPoints, worldPoints);
        existingContour.points = expandedPoints.flat();
        
        console.log('Expanded existing contour:', {
          structureId,
          slicePosition,
          originalPoints: existingPoints.length,
          brushPoints: worldPoints.length,
          finalPoints: expandedPoints.length
        });
        console.log('Final contour points (first 5):', existingContour.points.slice(0, 15));
      } else {
        console.log('Subtraction mode - reducing contour');
      }
    }
    
    console.log('=== RT STRUCTURE UPDATE COMPLETE ===');
    
    // Trigger update with the new rtStructures copy
    onContourUpdate(updatedRTStructures);
  }, [rtStructures, operation, onContourUpdate]);

  // Expand existing contour by intelligently adding brush points
  const expandContourWithBrush = useCallback((existingPoints: number[][], brushPoints: number[][]): number[][] => {
    console.log('Expanding contour - existing points:', existingPoints.length, 'brush points:', brushPoints.length);
    
    // For now, use a simple union approach - combine all points and create convex hull
    const allPoints = [...existingPoints, ...brushPoints];
    
    // Remove duplicates within tolerance
    const tolerance = 5.0; // mm - slightly larger tolerance for medical precision
    const uniquePoints: number[][] = [];
    
    for (const point of allPoints) {
      const isDuplicate = uniquePoints.some(existing => 
        Math.abs(existing[0] - point[0]) < tolerance &&
        Math.abs(existing[1] - point[1]) < tolerance
      );
      
      if (!isDuplicate) {
        uniquePoints.push(point);
      }
    }
    
    console.log('After deduplication:', uniquePoints.length, 'unique points');
    
    // Create ordered boundary that encompasses both regions
    const orderedContour = createOrderedContour(uniquePoints);
    console.log('Final ordered contour:', orderedContour.length, 'points');
    
    return orderedContour;
  }, []);

  // Create properly ordered contour from combined points
  const createOrderedContour = useCallback((points: number[][]): number[][] => {
    if (points.length < 3) return points;
    
    // Find centroid
    const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const centerZ = points[0][2];
    
    // Sort points by angle from centroid to create proper contour ordering
    const sortedPoints = points.slice().sort((a, b) => {
      const angleA = Math.atan2(a[1] - centerY, a[0] - centerX);
      const angleB = Math.atan2(b[1] - centerY, b[0] - centerX);
      return angleA - angleB;
    });
    
    // Ensure all points have same Z coordinate
    return sortedPoints.map(point => [point[0], point[1], centerZ]);
  }, []);

  // Conservative boundary that only minimally expands existing contour
  const createConservativeBoundary = useCallback((mergedPoints: number[][], existing: number[][], brushPoints: number[][]): number[][] => {
    if (mergedPoints.length < 3) return existing;
    
    // Use existing contour as base and only add brush points that create minimal expansion
    const conservativePoints: number[][] = [...existing];
    
    // Find insertion points for brush expansion
    for (const brushPoint of brushPoints) {
      // Find closest existing contour point
      let closestIndex = 0;
      let minDistance = Infinity;
      
      for (let i = 0; i < existing.length; i++) {
        const distance = Math.sqrt(
          Math.pow(existing[i][0] - brushPoint[0], 2) + 
          Math.pow(existing[i][1] - brushPoint[1], 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      }
      
      // Only add brush point if it's very close (within 5mm) to existing contour
      if (minDistance < 5.0) {
        // Insert brush point near the closest existing point
        conservativePoints.splice(closestIndex + 1, 0, brushPoint);
      }
    }
    
    return createOrderedBoundary(conservativePoints);
  }, []);

  // Conservative contour merging - only expand locally where brush touches
  const mergeContourPolygons = useCallback((existing: number[][], brush: number[][]): number[][] => {
    if (existing.length === 0) return brush;
    if (brush.length === 0) return existing;
    
    // Find the closest points between existing contour and brush area
    const maxDistance = 10.0; // mm - only merge if brush is very close to existing contour
    const nearbyBrushPoints: number[][] = [];
    
    for (const brushPoint of brush) {
      const isNearExisting = existing.some(existingPoint => {
        const distance = Math.sqrt(
          Math.pow(existingPoint[0] - brushPoint[0], 2) + 
          Math.pow(existingPoint[1] - brushPoint[1], 2)
        );
        return distance < maxDistance;
      });
      
      if (isNearExisting) {
        nearbyBrushPoints.push(brushPoint);
      }
    }
    
    // If brush is not close to existing contour, keep them separate
    if (nearbyBrushPoints.length === 0) {
      console.log('Brush area too far from existing contour, creating separate contour');
      return brush; // Create new separate contour
    }
    
    // Only merge nearby brush points with existing contour
    const tolerance = 1.0; // mm
    const mergedPoints: number[][] = [...existing];
    
    for (const brushPoint of nearbyBrushPoints) {
      const isDuplicate = mergedPoints.some(existing => 
        Math.abs(existing[0] - brushPoint[0]) < tolerance &&
        Math.abs(existing[1] - brushPoint[1]) < tolerance
      );
      
      if (!isDuplicate) {
        mergedPoints.push(brushPoint);
      }
    }
    
    // Create minimal expansion that only includes the painted area
    return createConservativeBoundary(mergedPoints, existing, nearbyBrushPoints);
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
    console.log('🚨 MOUSE DOWN FIRED!', { isActive, selectedStructure, button: event.button });
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
    
    // CRITICAL: Enable pointer events on mask canvas during active painting
    if (maskCanvasRef.current) {
      maskCanvasRef.current.style.pointerEvents = 'auto';
      console.log('🖱️ ENABLED mask canvas pointer events for painting');
    }
    
    // Set the painting slice to ensure slice-specific visibility
    setPaintingSlice(currentSlicePosition);
    
    // Start painting immediately
    paintPixels(canvasPoint);

    console.log('🎨 BRUSH TOOL: Mouse down - starting to paint', {
      operation: operation,
      position: canvasPoint,
      slice: currentSlicePosition,
      brushSize: brushSize,
      smoothingEnabled: smoothingEnabled
    });
  }, [isActive, selectedStructure, paintPixels, operation, currentSlicePosition, brushSize]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isActive) return;
    
    // Enhanced debug - track all mouse movements
    if (isDrawing) {
      console.log('🖱️ MOUSE MOVE while drawing', { x: event.clientX, y: event.clientY });
    }

    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);
    drawBrushPreview(canvasPoint);

    if (isDrawing && lastPosition) {
      console.log('🖌️ BRUSH TOOL: Drawing stroke', { from: lastPosition, to: canvasPoint, smoothingEnabled });
      if (smoothingEnabled) {
        paintLine(lastPosition, canvasPoint);
      } else {
        paintPixels(canvasPoint);
      }
    }
    
    // Always update last position when drawing for next stroke
    if (isDrawing) {
      setLastPosition(canvasPoint);
    }
  }, [isActive, isDrawing, lastPosition, drawBrushPreview, paintPixels, paintLine, smoothingEnabled]);

  const handleMouseUp = useCallback((event?: MouseEvent) => {
    console.log('🖱️ MOUSE UP EVENT TRIGGERED - Brush Tool', { isDrawing, selectedStructure });
    
    if (!isDrawing) {
      console.log('❌ Not drawing, skipping conversion');
      return;
    }

    setIsDrawing(false);
    setLastPosition(null);

    // CRITICAL: Disable pointer events on mask canvas to restore scroll wheel functionality
    if (maskCanvasRef.current) {
      maskCanvasRef.current.style.pointerEvents = 'none';
      console.log('🖱️ DISABLED mask canvas pointer events - scroll wheel restored');
    }

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

  // Hide mask canvas when not on the painting slice - AND CLEAR IT TO PREVENT CROSS-SLICE BLEEDING
  useEffect(() => {
    if (maskCanvasRef.current) {
      const isOnPaintingSlice = paintingSlice === null || paintingSlice === currentSlicePosition;
      
      console.log('🎭 SLICE CHANGE DEBUG:', {
        currentSlice: currentSlicePosition,
        paintingSlice: paintingSlice,
        isOnPaintingSlice: isOnPaintingSlice,
        action: isOnPaintingSlice ? 'SHOW' : 'HIDE_AND_CLEAR'
      });
      
      if (isOnPaintingSlice) {
        maskCanvasRef.current.style.visibility = 'visible';
      } else {
        maskCanvasRef.current.style.visibility = 'hidden';
        // CRITICAL: Clear the mask canvas when switching slices to prevent bleeding
        const ctx = maskCanvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
          console.log('🧹 CLEARED mask canvas on slice change');
        }
      }
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
    
    // Create mask canvas for painting - MUST sync with main canvas transformations
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mainCanvas.width;
    maskCanvas.height = mainCanvas.height;
    maskCanvas.style.position = 'absolute';
    maskCanvas.style.top = '0';
    maskCanvas.style.left = '0';
    maskCanvas.style.pointerEvents = 'none'; // Start with pointer events disabled to allow scroll wheel
    maskCanvas.style.zIndex = '5';
    maskCanvas.style.opacity = '0.3'; // Match medical imaging standard: 30% opacity
    
    // CRITICAL: Apply the same CSS transforms as the main canvas to maintain alignment
    maskCanvas.style.transform = mainCanvas.style.transform;
    maskCanvas.style.transformOrigin = mainCanvas.style.transformOrigin;
    
    // Create preview canvas for cursor - MUST sync with main canvas transformations
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = mainCanvas.width;
    previewCanvas.height = mainCanvas.height;
    previewCanvas.style.position = 'absolute';
    previewCanvas.style.top = '0';
    previewCanvas.style.left = '0';
    previewCanvas.style.pointerEvents = 'none';
    previewCanvas.style.zIndex = '10';
    
    // CRITICAL: Apply the same CSS transforms as the main canvas to maintain alignment
    previewCanvas.style.transform = mainCanvas.style.transform;
    previewCanvas.style.transformOrigin = mainCanvas.style.transformOrigin;
    
    canvasContainer.appendChild(maskCanvas);
    canvasContainer.appendChild(previewCanvas);
    
    // Attach mouse event listeners to the mask canvas for proper interaction
    maskCanvas.addEventListener('mousedown', handleMouseDown);
    maskCanvas.addEventListener('mousemove', handleMouseMove);
    maskCanvas.addEventListener('mouseup', handleMouseUp);
    maskCanvas.addEventListener('mouseleave', handleMouseUp);
    
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

  // CRITICAL: Update overlay canvas transformations when zoom/pan changes
  useEffect(() => {
    if (!isActive || !canvasRef.current || !maskCanvasRef.current || !previewCanvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;

    console.log('🔄 SYNCING CANVAS TRANSFORMATIONS - Zoom/Pan Update');
    console.log('Main canvas transform:', mainCanvas.style.transform);
    
    // Sync transformations to maintain alignment during zoom/pan
    maskCanvas.style.transform = mainCanvas.style.transform;
    maskCanvas.style.transformOrigin = mainCanvas.style.transformOrigin;
    
    previewCanvas.style.transform = mainCanvas.style.transform;
    previewCanvas.style.transformOrigin = mainCanvas.style.transformOrigin;
    
  }, [isActive, zoom, panX, panY]);

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