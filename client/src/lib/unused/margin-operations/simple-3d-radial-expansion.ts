// Simple 3D Radial Expansion
// Creates true spherical expansion by generating contours on all slices within the expanded volume
// This is simpler than the full distance field approach but provides true 3D radial expansion

export interface Contour3D {
  points: number[];        // [x1, y1, z1, x2, y2, z2, ...]
  slicePosition: number;   // Z position in world coordinates
}

export interface ImageContext3D {
  pixelSpacing: [number, number];    // [row spacing, column spacing] in mm
  sliceThickness: number;            // mm
  imagePosition: [number, number, number]; // World coordinates origin
}

/**
 * Apply true 3D radial expansion to a structure
 * Creates new contours on intermediate slices for proper spherical expansion
 */
export async function applySimple3DRadialExpansion(
  inputContours: Contour3D[],
  marginMm: number,
  imageContext: ImageContext3D,
  generateIntermediateSlices: boolean = true
): Promise<Contour3D[]> {
  
  console.log('🔹 🌐 Starting simple 3D radial expansion:', {
    marginMm,
    inputContourCount: inputContours.length,
    generateIntermediateSlices,
    imageContext: {
      pixelSpacing: imageContext.pixelSpacing,
      sliceThickness: imageContext.sliceThickness
    }
  });

  if (inputContours.length === 0) {
    return [];
  }

  try {
    // Step 1: Find the bounding box of the original structure
    const bounds = calculateStructureBounds(inputContours);
    console.log('🔹 📊 Original structure bounds:', bounds);

    // Step 2: Expand bounding box by margin
    const expandedBounds = {
      minX: bounds.minX - marginMm,
      maxX: bounds.maxX + marginMm,
      minY: bounds.minY - marginMm,
      maxY: bounds.maxY + marginMm,
      minZ: bounds.minZ - Math.abs(marginMm), // Expand in Z direction too
      maxZ: bounds.maxZ + Math.abs(marginMm)
    };
    console.log('🔹 📊 Expanded bounds:', expandedBounds);

    // Step 3: Generate slice positions within expanded bounds
    const slicePositions = generateSlicePositions(expandedBounds, imageContext.sliceThickness, generateIntermediateSlices);
    console.log(`🔹 📊 Generated ${slicePositions.length} slice positions for 3D expansion`);

    // Step 4: For each slice position, generate the expanded contour
    const expandedContours: Contour3D[] = [];
    
    for (const sliceZ of slicePositions) {
      const contourForSlice = generateExpandedContourAtSlice(
        inputContours,
        sliceZ,
        marginMm,
        imageContext
      );
      
      if (contourForSlice && contourForSlice.points.length >= 9) {
        expandedContours.push(contourForSlice);
        console.log(`🔹 ✅ Generated expanded contour at slice ${sliceZ.toFixed(1)}mm with ${contourForSlice.points.length / 3} points`);
      }
    }

    console.log(`🔹 🌐 ✅ 3D radial expansion completed: ${inputContours.length} → ${expandedContours.length} contours`);
    return expandedContours;

  } catch (error) {
    console.error('🔹 ❌ 3D radial expansion failed:', error);
    // Fallback to simple slice-by-slice expansion
    return applyFallbackExpansion(inputContours, marginMm);
  }
}

/**
 * Calculate bounding box of the entire structure
 */
function calculateStructureBounds(contours: Contour3D[]): {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
} {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const contour of contours) {
    for (let i = 0; i < contour.points.length; i += 3) {
      const x = contour.points[i];
      const y = contour.points[i + 1];
      const z = contour.points[i + 2];

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * Generate slice positions within the expanded bounds
 */
function generateSlicePositions(
  bounds: { minZ: number; maxZ: number },
  sliceThickness: number,
  generateIntermediate: boolean
): number[] {
  const positions: number[] = [];
  
  if (generateIntermediate) {
    // Generate slices at regular intervals within the expanded bounds
    const startZ = Math.floor(bounds.minZ / sliceThickness) * sliceThickness;
    const endZ = Math.ceil(bounds.maxZ / sliceThickness) * sliceThickness;
    
    for (let z = startZ; z <= endZ; z += sliceThickness) {
      if (z >= bounds.minZ && z <= bounds.maxZ) {
        positions.push(z);
      }
    }
  } else {
    // Just use the original slice positions (fallback)
    // This would need to be passed in if we wanted to use it
  }
  
  return positions.sort((a, b) => a - b);
}

/**
 * Generate expanded contour at a specific slice position
 * Uses spherical distance calculation to determine if points are inside the expanded structure
 */
function generateExpandedContourAtSlice(
  inputContours: Contour3D[],
  sliceZ: number,
  marginMm: number,
  imageContext: ImageContext3D
): Contour3D | null {
  
  // Find the bounds for this slice by projecting the 3D structure
  const sliceBounds = calculateSliceBounds(inputContours, sliceZ, marginMm);
  
  if (!sliceBounds) {
    return null; // No structure influence at this slice
  }

  // Generate a contour by sampling points around the perimeter
  const contourPoints = generateContourBySphericalSampling(
    inputContours,
    sliceZ,
    marginMm,
    sliceBounds,
    imageContext
  );

  if (contourPoints.length < 9) {
    return null;
  }

  return {
    points: contourPoints,
    slicePosition: sliceZ
  };
}

/**
 * Calculate bounds for a specific slice considering 3D spherical expansion
 */
function calculateSliceBounds(
  inputContours: Contour3D[],
  sliceZ: number,
  marginMm: number
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let hasInfluence = false;

  for (const contour of inputContours) {
    const zDistance = Math.abs(contour.slicePosition - sliceZ);
    
    // Check if this contour can influence this slice (within spherical radius)
    if (zDistance <= Math.abs(marginMm)) {
      hasInfluence = true;
      
      // Calculate the remaining radial distance at this Z level
      const remainingRadius = Math.sqrt(Math.max(0, marginMm * marginMm - zDistance * zDistance));
      
      // Find XY bounds of this contour and expand by remaining radius
      for (let i = 0; i < contour.points.length; i += 3) {
        const x = contour.points[i];
        const y = contour.points[i + 1];
        
        minX = Math.min(minX, x - remainingRadius);
        maxX = Math.max(maxX, x + remainingRadius);
        minY = Math.min(minY, y - remainingRadius);
        maxY = Math.max(maxY, y + remainingRadius);
      }
    }
  }

  return hasInfluence ? { minX, maxX, minY, maxY } : null;
}

/**
 * Generate contour points by spherical sampling
 */
function generateContourBySphericalSampling(
  inputContours: Contour3D[],
  sliceZ: number,
  marginMm: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  imageContext: ImageContext3D
): number[] {
  
  const contourPoints: number[] = [];
  const resolution = Math.min(1.0, Math.abs(marginMm) / 10); // Adaptive resolution
  
  // Find the center of the structure at this slice
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  
  // Generate points in a circle and test if they're on the boundary
  const numSamples = Math.max(32, Math.ceil(2 * Math.PI * Math.abs(marginMm) / resolution));
  
  for (let i = 0; i < numSamples; i++) {
    const angle = (2 * Math.PI * i) / numSamples;
    
    // Start from center and march outward to find the boundary
    const direction: [number, number] = [Math.cos(angle), Math.sin(angle)];
    const boundaryPoint = findBoundaryPoint(
      inputContours,
      [centerX, centerY, sliceZ],
      direction,
      marginMm,
      resolution
    );
    
    if (boundaryPoint) {
      contourPoints.push(boundaryPoint[0], boundaryPoint[1], sliceZ);
    }
  }
  
  return contourPoints;
}

/**
 * Find boundary point by marching from center outward
 */
function findBoundaryPoint(
  inputContours: Contour3D[],
  startPoint: [number, number, number],
  direction: [number, number],
  marginMm: number,
  resolution: number
): [number, number] | null {
  
  const maxDistance = Math.abs(marginMm) * 2; // Search up to 2x the margin
  const stepSize = resolution;
  
  for (let distance = 0; distance <= maxDistance; distance += stepSize) {
    const testPoint: [number, number, number] = [
      startPoint[0] + direction[0] * distance,
      startPoint[1] + direction[1] * distance,
      startPoint[2]
    ];
    
    const distanceToStructure = calculateDistanceToStructure(testPoint, inputContours);
    const targetDistance = Math.abs(marginMm);
    
    // Check if we're close to the target distance (boundary)
    if (Math.abs(distanceToStructure - targetDistance) < resolution / 2) {
      return [testPoint[0], testPoint[1]];
    }
    
    // If we've gone past the target, we can stop
    if (distanceToStructure > targetDistance + resolution) {
      // Back up a bit and return previous point
      const prevDistance = Math.max(0, distance - stepSize);
      return [
        startPoint[0] + direction[0] * prevDistance,
        startPoint[1] + direction[1] * prevDistance
      ];
    }
  }
  
  return null;
}

/**
 * Calculate minimum distance from a point to the structure surface
 */
function calculateDistanceToStructure(
  testPoint: [number, number, number],
  inputContours: Contour3D[]
): number {
  
  let minDistance = Infinity;
  
  for (const contour of inputContours) {
    // Calculate distance to each point in the contour
    for (let i = 0; i < contour.points.length; i += 3) {
      const contourPoint: [number, number, number] = [
        contour.points[i],
        contour.points[i + 1],
        contour.points[i + 2]
      ];
      
      const distance = calculateEuclideanDistance(testPoint, contourPoint);
      minDistance = Math.min(minDistance, distance);
    }
  }
  
  return minDistance;
}

/**
 * Calculate Euclidean distance between two 3D points
 */
function calculateEuclideanDistance(
  p1: [number, number, number],
  p2: [number, number, number]
): number {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  const dz = p1[2] - p2[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Fallback to simple slice-by-slice expansion if 3D expansion fails
 */
async function applyFallbackExpansion(
  inputContours: Contour3D[],
  marginMm: number
): Promise<Contour3D[]> {
  
  console.log('🔹 ⚠️ Using fallback slice-by-slice expansion');
  
  const { growContourSimple } = await import('./simple-polygon-operations');
  const expandedContours: Contour3D[] = [];
  
  for (const contour of inputContours) {
    try {
      const expandedPoints = growContourSimple(contour.points, marginMm);
      expandedContours.push({
        points: expandedPoints,
        slicePosition: contour.slicePosition
      });
    } catch (error) {
      console.error('🔹 ❌ Fallback expansion failed for contour:', error);
      // Keep original contour if expansion fails
      expandedContours.push(contour);
    }
  }
  
  return expandedContours;
}

/**
 * Simplified interface for single contour expansion
 */
export async function apply3DRadialExpansionToSingleContour(
  contourPoints: number[],
  marginMm: number,
  imageContext: ImageContext3D
): Promise<number[]> {
  
  if (!contourPoints || contourPoints.length < 9) {
    return contourPoints;
  }

  const inputContour: Contour3D = {
    points: contourPoints,
    slicePosition: contourPoints[2] || 0
  };

  const expandedContours = await applySimple3DRadialExpansion(
    [inputContour],
    marginMm,
    imageContext,
    false // Don't generate intermediate slices for single contour
  );

  return expandedContours.length > 0 ? expandedContours[0].points : contourPoints;
} 