// DICOM types for RT structure operations

export interface RTContour {
  slicePosition: number;
  points: number[];
  numberOfPoints: number;
}

export interface RTStructure {
  roiNumber: number;
  structureName: string;
  color: [number, number, number];
  contours: RTContour[];
}

export interface RTStructureSet {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  structures: RTStructure[];
}

// Extended contour data for operations
export interface ContourData extends RTContour {
  sliceZ: number;
  type?: 'CLOSED_PLANAR' | 'OPEN_PLANAR' | 'POINT';
  geometricType?: string;
}