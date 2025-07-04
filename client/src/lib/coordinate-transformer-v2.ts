// V2 Professional Coordinate Transformer
// Medical-grade DICOM spatial transformation system

import {
  Point,
  Point3D,
  DisplayPoint,
  DICOMImageMetadata,
  SlicingMode,
} from "@shared/schema";

export class CoordinateTransformerV2 {
  private static readonly SCALING_FACTOR = 1000;

  // Transform patient coordinates to pixel coordinates
  static patientToPixel(
    patientPoint: Point3D,
    imageMetadata: DICOMImageMetadata,
  ): Point {
    const {
      imagePositionPatient,
      imageOrientationPatient,
      pixelSpacing,
      rows,
      columns,
    } = imageMetadata;

    // Extract image orientation vectors
    const rowVector = [
      imageOrientationPatient[0],
      imageOrientationPatient[1],
      imageOrientationPatient[2],
    ];

    const colVector = [
      imageOrientationPatient[3],
      imageOrientationPatient[4],
      imageOrientationPatient[5],
    ];

    // Calculate relative position from image origin
    const deltaX = patientPoint.x - imagePositionPatient[0];
    const deltaY = patientPoint.y - imagePositionPatient[1];
    const deltaZ = patientPoint.z - imagePositionPatient[2];

    // Project onto image plane using orientation vectors
    const pixelX =
      (deltaX * rowVector[0] + deltaY * rowVector[1] + deltaZ * rowVector[2]) /
      pixelSpacing[0];
    const pixelY =
      (deltaX * colVector[0] + deltaY * colVector[1] + deltaZ * colVector[2]) /
      pixelSpacing[1];

    return {
      x: Math.round(pixelX),
      y: Math.round(pixelY),
    };
  }

  // Transform pixel coordinates to patient coordinates
  static pixelToPatient(
    pixelPoint: Point,
    imageMetadata: DICOMImageMetadata,
  ): Point3D {
    const { imagePositionPatient, imageOrientationPatient, pixelSpacing } =
      imageMetadata;

    // Extract image orientation vectors
    const rowVector = [
      imageOrientationPatient[0],
      imageOrientationPatient[1],
      imageOrientationPatient[2],
    ];

    const colVector = [
      imageOrientationPatient[3],
      imageOrientationPatient[4],
      imageOrientationPatient[5],
    ];

    // Calculate patient position using DICOM transformation
    const patientX =
      imagePositionPatient[0] +
      pixelPoint.x * pixelSpacing[0] * rowVector[0] +
      pixelPoint.y * pixelSpacing[1] * colVector[0];

    const patientY =
      imagePositionPatient[1] +
      pixelPoint.x * pixelSpacing[0] * rowVector[1] +
      pixelPoint.y * pixelSpacing[1] * colVector[1];

    const patientZ =
      imagePositionPatient[2] +
      pixelPoint.x * pixelSpacing[0] * rowVector[2] +
      pixelPoint.y * pixelSpacing[1] * colVector[2];

    return {
      x: patientX,
      y: patientY,
      z: patientZ,
    };
  }

  // Transform world coordinates to scaled coordinates for ClipperLib
  static worldToScaled(point: Point): Point {
    return {
      x: Math.round(point.x * this.SCALING_FACTOR),
      y: Math.round(point.y * this.SCALING_FACTOR),
    };
  }

  // Transform scaled coordinates back to world coordinates
  static scaledToWorld(point: Point): Point {
    return {
      x: point.x / this.SCALING_FACTOR,
      y: point.y / this.SCALING_FACTOR,
    };
  }

  // Transform world coordinates to display coordinates using viewport
  static worldToDisplay(worldPoint: Point, viewport: any): DisplayPoint {
    if (!viewport) {
      console.warn("No viewport provided for coordinate transformation");
      return { x: worldPoint.x, y: worldPoint.y };
    }

    try {
      // Use cornerstone viewport transformation if available
      if (window.cornerstone && viewport) {
        const canvasPoint = window.cornerstone.pixelToCanvas(
          viewport.element,
          worldPoint,
        );
        return {
          x: Math.round(canvasPoint.x),
          y: Math.round(canvasPoint.y),
        };
      }

      // Fallback transformation using viewport properties
      const scale = viewport.scale || 1;
      const translation = viewport.translation || { x: 0, y: 0 };

      return {
        x: Math.round(worldPoint.x * scale + translation.x),
        y: Math.round(worldPoint.y * scale + translation.y),
      };
    } catch (error) {
      console.error("World to display transformation failed:", error);
      return { x: worldPoint.x, y: worldPoint.y };
    }
  }

  // Transform display coordinates to world coordinates using viewport
  static displayToWorld(displayPoint: DisplayPoint, viewport: any): Point {
    if (!viewport) {
      console.warn("No viewport provided for coordinate transformation");
      return { x: displayPoint.x, y: displayPoint.y };
    }

    try {
      // Use cornerstone viewport transformation if available
      if (window.cornerstone && viewport) {
        const pixelPoint = window.cornerstone.canvasToPixel(
          viewport.element,
          displayPoint,
        );
        return {
          x: Math.round(pixelPoint.x),
          y: Math.round(pixelPoint.y),
        };
      }

      // Fallback transformation using viewport properties
      const scale = viewport.scale || 1;
      const translation = viewport.translation || { x: 0, y: 0 };

      return {
        x: Math.round((displayPoint.x - translation.x) / scale),
        y: Math.round((displayPoint.y - translation.y) / scale),
      };
    } catch (error) {
      console.error("Display to world transformation failed:", error);
      return { x: displayPoint.x, y: displayPoint.y };
    }
  }

  // Apply medical coordinate system transformation for proper anatomical orientation
  static applyMedicalTransform(
    point: Point,
    imageMetadata: DICOMImageMetadata,
  ): Point {
    // Apply 90-degree counter-rotation and horizontal flip for correct anatomical display
    // This addresses the coordinate system issues identified in the V2 guide
    const { rows, columns } = imageMetadata;

    // Apply coordinate transformation for proper medical display
    const transformed = {
      x: columns - point.y, // 90-degree rotation + horizontal flip
      y: point.x, // 90-degree rotation
    };

    return transformed;
  }

  // Reverse medical coordinate system transformation
  static reverseMedicalTransform(
    point: Point,
    imageMetadata: DICOMImageMetadata,
  ): Point {
    // Reverse the medical transformation
    const { rows, columns } = imageMetadata;

    const reversed = {
      x: point.y, // Reverse 90-degree rotation
      y: columns - point.x, // Reverse horizontal flip and rotation
    };

    return reversed;
  }

  // Get slice position for specific slicing mode
  static getSlicePosition(
    patientPoint: Point3D,
    slicingMode: SlicingMode,
    imageMetadata: DICOMImageMetadata,
  ): number {
    switch (slicingMode) {
      case SlicingMode.K: // Axial
        return patientPoint.z;
      case SlicingMode.J: // Coronal
        return patientPoint.y;
      case SlicingMode.I: // Sagittal
        return patientPoint.x;
      default:
        return patientPoint.z;
    }
  }

  // Calculate distance between two points in patient coordinates
  static calculateDistance(point1: Point3D, point2: Point3D): number {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = point2.z - point1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Calculate pixel area to physical area conversion
  static pixelAreaToPhysicalArea(
    pixelArea: number,
    imageMetadata: DICOMImageMetadata,
  ): number {
    const { pixelSpacing } = imageMetadata;
    return pixelArea * pixelSpacing[0] * pixelSpacing[1];
  }

  // Validate coordinate transformation parameters
  static validateImageMetadata(metadata: DICOMImageMetadata): boolean {
    if (
      !metadata.imagePositionPatient ||
      metadata.imagePositionPatient.length !== 3
    ) {
      console.error("Invalid image position patient");
      return false;
    }

    if (
      !metadata.imageOrientationPatient ||
      metadata.imageOrientationPatient.length !== 6
    ) {
      console.error("Invalid image orientation patient");
      return false;
    }

    if (!metadata.pixelSpacing || metadata.pixelSpacing.length !== 2) {
      console.error("Invalid pixel spacing");
      return false;
    }

    if (!metadata.rows || !metadata.columns) {
      console.error("Invalid image dimensions");
      return false;
    }

    return true;
  }

  // Create transformation matrix for advanced operations
  static createTransformationMatrix(
    imageMetadata: DICOMImageMetadata,
  ): number[][] {
    if (!this.validateImageMetadata(imageMetadata)) {
      throw new Error("Invalid image metadata for transformation matrix");
    }

    const { imagePositionPatient, imageOrientationPatient, pixelSpacing } =
      imageMetadata;

    // Create 4x4 transformation matrix for homogeneous coordinates
    const matrix = [
      [
        imageOrientationPatient[0] * pixelSpacing[0],
        imageOrientationPatient[3] * pixelSpacing[1],
        0,
        imagePositionPatient[0],
      ],
      [
        imageOrientationPatient[1] * pixelSpacing[0],
        imageOrientationPatient[4] * pixelSpacing[1],
        0,
        imagePositionPatient[1],
      ],
      [
        imageOrientationPatient[2] * pixelSpacing[0],
        imageOrientationPatient[5] * pixelSpacing[1],
        0,
        imagePositionPatient[2],
      ],
      [0, 0, 0, 1],
    ];

    return matrix;
  }

  // Apply transformation matrix to point
  static applyTransformationMatrix(
    point: Point,
    matrix: number[][],
    zValue = 0,
  ): Point3D {
    const homogeneous = [point.x, point.y, zValue, 1];
    const result = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result[i] += matrix[i][j] * homogeneous[j];
      }
    }

    return {
      x: result[0] / result[3],
      y: result[1] / result[3],
      z: result[2] / result[3],
    };
  }
}
