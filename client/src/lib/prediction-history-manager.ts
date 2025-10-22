/**
 * Prediction History Manager
 * 
 * Tracks contour evolution across slices to enable accurate trend-based predictions
 */

const normalizeSlicePosition = (value: number): number => {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1000) / 1000;
};

export interface ContourSnapshot {
  slicePosition: number;
  contour: number[];
  timestamp: number;
  descriptor: ShapeDescriptor;
}

export interface ShapeDescriptor {
  area: number;
  perimeter: number;
  centroid: { x: number; y: number };
  eccentricity: number;
  majorAxis: number;
  minorAxis: number;
  boundingBox: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface TrendAnalysis {
  areaChangeRate: number; // per slice
  centroidDrift: { x: number; y: number }; // per slice
  shapeStability: number; // 0-1, higher is more stable
  consistency: number; // 0-1, how consistent the trend is
}

export class PredictionHistoryManager {
  private history: Map<number, ContourSnapshot> = new Map();
  private maxHistorySize: number = 5;

  /**
   * Add a contour to history
   */
  addContour(slicePosition: number, contour: number[]): void {
    if (!contour || contour.length < 9) return;

    const normalizedSlice = normalizeSlicePosition(slicePosition);
    const descriptor = this.calculateShapeDescriptor(contour);
    
    this.history.set(normalizedSlice, {
      slicePosition: normalizedSlice,
      contour: [...contour], // Clone to prevent mutations
      timestamp: Date.now(),
      descriptor
    });

    // Prune old history if needed
    this.pruneHistory();
  }

  /**
   * Get contour at specific slice position
   */
  getContour(slicePosition: number): ContourSnapshot | null {
    const normalizedSlice = normalizeSlicePosition(slicePosition);
    return this.history.get(normalizedSlice) || null;
  }

  /**
   * Get all contours sorted by slice position
   */
  getAllContours(): ContourSnapshot[] {
    return Array.from(this.history.values()).sort((a, b) => a.slicePosition - b.slicePosition);
  }

  /**
   * Get nearest contours before and after target position
   */
  getNearestContours(targetSlice: number): { before: ContourSnapshot | null; after: ContourSnapshot | null } {
    const normalizedTarget = normalizeSlicePosition(targetSlice);
    const allContours = this.getAllContours();
    
    let before: ContourSnapshot | null = null;
    let after: ContourSnapshot | null = null;

    for (const snapshot of allContours) {
      if (snapshot.slicePosition < normalizedTarget) {
        if (!before || snapshot.slicePosition > before.slicePosition) {
          before = snapshot;
        }
      } else if (snapshot.slicePosition > normalizedTarget) {
        if (!after || snapshot.slicePosition < after.slicePosition) {
          after = snapshot;
        }
      }
    }

    return { before, after };
  }

  /**
   * Analyze trend across recent contours
   */
  analyzeTrend(): TrendAnalysis {
    const contours = this.getAllContours();
    
    if (contours.length < 2) {
      return {
        areaChangeRate: 0,
        centroidDrift: { x: 0, y: 0 },
        shapeStability: 1,
        consistency: 0
      };
    }

    // Calculate area change rate
    const areaChanges: number[] = [];
    for (let i = 1; i < contours.length; i++) {
      const prev = contours[i - 1];
      const curr = contours[i];
      const sliceGap = curr.slicePosition - prev.slicePosition;
      if (sliceGap > 0) {
        const areaChange = (curr.descriptor.area - prev.descriptor.area) / prev.descriptor.area;
        areaChanges.push(areaChange / sliceGap); // Normalize by slice distance
      }
    }
    const avgAreaChangeRate = areaChanges.length > 0 
      ? areaChanges.reduce((sum, v) => sum + v, 0) / areaChanges.length 
      : 0;

    // Calculate centroid drift
    const centroidDrifts: { x: number; y: number }[] = [];
    for (let i = 1; i < contours.length; i++) {
      const prev = contours[i - 1];
      const curr = contours[i];
      const sliceGap = curr.slicePosition - prev.slicePosition;
      if (sliceGap > 0) {
        centroidDrifts.push({
          x: (curr.descriptor.centroid.x - prev.descriptor.centroid.x) / sliceGap,
          y: (curr.descriptor.centroid.y - prev.descriptor.centroid.y) / sliceGap
        });
      }
    }
    const avgCentroidDrift = centroidDrifts.length > 0
      ? {
          x: centroidDrifts.reduce((sum, d) => sum + d.x, 0) / centroidDrifts.length,
          y: centroidDrifts.reduce((sum, d) => sum + d.y, 0) / centroidDrifts.length
        }
      : { x: 0, y: 0 };

    // Calculate shape stability (variance in eccentricity)
    const eccentricities = contours.map(c => c.descriptor.eccentricity);
    const avgEccentricity = eccentricities.reduce((sum, e) => sum + e, 0) / eccentricities.length;
    const variance = eccentricities.reduce((sum, e) => sum + Math.pow(e - avgEccentricity, 2), 0) / eccentricities.length;
    const shapeStability = Math.max(0, 1 - variance * 5); // Scale variance to 0-1

    // Calculate consistency (how linear the trends are)
    const areaVariance = areaChanges.length > 1
      ? areaChanges.reduce((sum, v) => sum + Math.pow(v - avgAreaChangeRate, 2), 0) / areaChanges.length
      : 0;
    const consistency = Math.max(0, 1 - areaVariance * 10);

    return {
      areaChangeRate: avgAreaChangeRate,
      centroidDrift: avgCentroidDrift,
      shapeStability,
      consistency
    };
  }

  /**
   * Calculate confidence for prediction at target distance
   */
  calculateConfidence(sourceSlice: number, targetSlice: number): number {
    const normalizedSource = normalizeSlicePosition(sourceSlice);
    const normalizedTarget = normalizeSlicePosition(targetSlice);
    const distance = Math.abs(normalizedTarget - normalizedSource);
    const trend = this.analyzeTrend();
    const historySize = this.history.size;

    // Base confidence from distance (exponential decay)
    let confidence = Math.exp(-distance * 0.3);

    // Boost confidence if we have good history
    if (historySize >= 3) {
      confidence *= (1 + trend.consistency * 0.3);
      confidence *= (1 + trend.shapeStability * 0.2);
    } else {
      // Penalize if we have little history
      confidence *= 0.5;
    }

    // Penalize high change rates (less predictable)
    const changeMagnitude = Math.abs(trend.areaChangeRate);
    if (changeMagnitude > 0.1) {
      confidence *= (1 - Math.min(changeMagnitude, 0.5));
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Calculate shape descriptor for a contour
   */
  private calculateShapeDescriptor(points: number[]): ShapeDescriptor {
    const n = points.length / 3;
    
    // Calculate centroid
    let sumX = 0, sumY = 0;
    for (let i = 0; i < points.length; i += 3) {
      sumX += points[i];
      sumY += points[i + 1];
    }
    const centroid = { x: sumX / n, y: sumY / n };

    // Calculate area using shoelace formula
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i * 3] * points[j * 3 + 1] - points[j * 3] * points[i * 3 + 1];
    }
    area = Math.abs(area) / 2;

    // Calculate perimeter
    let perimeter = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = points[j * 3] - points[i * 3];
      const dy = points[j * 3 + 1] - points[i * 3 + 1];
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }

    // Calculate bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
    }
    const boundingBox = { minX, maxX, minY, maxY };

    // Calculate second moments for eccentricity
    let muu20 = 0, muu02 = 0, muu11 = 0;
    for (let i = 0; i < points.length; i += 3) {
      const dx = points[i] - centroid.x;
      const dy = points[i + 1] - centroid.y;
      muu20 += dx * dx;
      muu02 += dy * dy;
      muu11 += dx * dy;
    }
    muu20 /= n;
    muu02 /= n;
    muu11 /= n;

    // Calculate eigenvalues for major/minor axes
    const trace = muu20 + muu02;
    const det = muu20 * muu02 - muu11 * muu11;
    const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * det));
    const lambda1 = (trace + discriminant) / 2;
    const lambda2 = (trace - discriminant) / 2;

    const majorAxis = 2 * Math.sqrt(Math.max(0, lambda1));
    const minorAxis = 2 * Math.sqrt(Math.max(0, lambda2));

    // Calculate eccentricity
    const eccentricity = minorAxis > 0 
      ? Math.sqrt(1 - (minorAxis * minorAxis) / (majorAxis * majorAxis))
      : 0;

    return {
      area,
      perimeter,
      centroid,
      eccentricity,
      majorAxis,
      minorAxis,
      boundingBox
    };
  }

  /**
   * Prune history to maintain max size
   */
  private pruneHistory(): void {
    if (this.history.size <= this.maxHistorySize) return;

    // Keep the most recent contours
    const sorted = Array.from(this.history.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp);

    this.history.clear();
    sorted.slice(0, this.maxHistorySize).forEach(([pos, snapshot]) => {
      this.history.set(pos, snapshot);
    });
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.history.clear();
  }

  /**
   * Get number of contours in history
   */
  size(): number {
    return this.history.size;
  }
}
