export interface DICOMSeries {
  id: number;
  seriesInstanceUID: string;
  seriesDescription: string;
  modality: string;
  seriesNumber?: number;
  imageCount: number;
  sliceThickness?: string;
  images: DICOMImage[];
}

export interface DICOMImage {
  id: number;
  sopInstanceUID: string;
  instanceNumber?: number;
  filePath: string;
  fileName: string;
  windowCenter?: string;
  windowWidth?: string;
}

export interface DICOMStudy {
  id: number;
  studyInstanceUID: string;
  patientName?: string;
  patientID?: string;
  studyDate?: string;
  studyDescription?: string;
  series: DICOMSeries[];
}

export interface WindowLevel {
  window: number;
  level: number;
}

export const WINDOW_LEVEL_PRESETS: Record<string, WindowLevel> = {
  lung: { window: 1500, level: -600 },
  bone: { window: 2000, level: 300 },
  brain: { window: 100, level: 50 },
  abdomen: { window: 400, level: 50 },
  mediastinum: { window: 350, level: 50 },
  liver: { window: 150, level: 90 },
};

export function isDICOMFile(file: File): boolean {
  // Check file extension
  const validExtensions = ['.dcm', '.dicom', '.ima', '.img'];
  const hasValidExtension = validExtensions.some(ext => 
    file.name.toLowerCase().endsWith(ext)
  );
  
  // Files without extension might still be DICOM
  return hasValidExtension || file.name.indexOf('.') === -1;
}

export function createImageId(sopInstanceUID: string): string {
  return `wadouri:/api/dicom/${sopInstanceUID}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDate(dateString: string): string {
  if (!dateString) return 'Unknown';
  
  try {
    // DICOM dates are in YYYYMMDD format
    if (dateString.length === 8) {
      const year = dateString.substring(0, 4);
      const month = dateString.substring(4, 6);
      const day = dateString.substring(6, 8);
      const date = new Date(`${year}-${month}-${day}`);
      return date.toLocaleDateString();
    }
    
    return new Date(dateString).toLocaleDateString();
  } catch (error) {
    return dateString;
  }
}

export function getModalityDisplayName(modality: string): string {
  const modalityNames: Record<string, string> = {
    'CT': 'Computed Tomography',
    'MR': 'Magnetic Resonance',
    'PT': 'Positron Emission Tomography',
    'NM': 'Nuclear Medicine',
    'US': 'Ultrasound',
    'XA': 'X-Ray Angiography',
    'RF': 'Radiofluoroscopy',
    'DX': 'Digital Radiography',
    'CR': 'Computed Radiography',
    'MG': 'Mammography',
    'OT': 'Other',
  };
  
  return modalityNames[modality] || modality;
}

export function sortImagesByInstance(images: DICOMImage[]): DICOMImage[] {
  return [...images].sort((a, b) => {
    const aInstance = a.instanceNumber || 0;
    const bInstance = b.instanceNumber || 0;
    return aInstance - bInstance;
  });
}

export function calculateWindowLevel(windowCenter: string, windowWidth: string): WindowLevel {
  const center = parseFloat(windowCenter) || 40;
  const width = parseFloat(windowWidth) || 400;
  
  return {
    level: center,
    window: width
  };
}
