/**
 * Centralized API service for all DICOM viewer data fetching
 * Replaces scattered fetch calls throughout the WorkingViewer component
 */

export interface SeriesImages {
  images: any[];
  metadata?: any;
}

export interface RTStructures {
  structures: any[];
}

export interface RegistrationMatrix {
  matrix: number[];
}

/**
 * Fetch images for a series with metadata
 */
export async function fetchSeriesImages(seriesId: number): Promise<SeriesImages> {
  const response = await fetch(`/api/series/${seriesId}/images`);
  if (!response.ok) {
    throw new Error(`Failed to fetch series images: ${response.statusText}`);
  }
  const images = await response.json();
  return { images };
}

/**
 * Fetch batch of images for performance
 */
export async function fetchImagesBatch(imageIds: number[]): Promise<any[]> {
  const response = await fetch('/api/images/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageIds })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch image batch: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Fetch RT structures for a study
 */
export async function fetchRTStructures(studyId: number): Promise<RTStructures> {
  const response = await fetch(`/api/studies/${studyId}/rt-structures`);
  if (!response.ok) {
    throw new Error(`Failed to fetch RT structures: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch registration matrix for fusion
 */
export async function fetchRegistrationMatrix(studyId: number): Promise<RegistrationMatrix | null> {
  try {
    const response = await fetch(`/api/registrations/${studyId}`);
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.warn('No registration matrix found:', error);
    return null;
  }
}

/**
 * Save contour updates to server
 */
export async function saveContourUpdates(seriesId: number, payload: any): Promise<any> {
  const response = await fetch(`/api/rt-structures/${seriesId}/contours`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    throw new Error(`Failed to save contour updates: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Fetch image metadata
 */
export async function fetchImageMetadata(imageId: number): Promise<any> {
  const response = await fetch(`/api/images/${imageId}/metadata`);
  if (!response.ok) {
    throw new Error(`Failed to fetch image metadata: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Undo last contour operation
 */
export async function undoContourOperation(seriesId: number): Promise<any> {
  const response = await fetch(`/api/rt-structures/${seriesId}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to undo operation: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Redo last contour operation
 */
export async function redoContourOperation(seriesId: number): Promise<any> {
  const response = await fetch(`/api/rt-structures/${seriesId}/redo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to redo operation: ${response.statusText}`);
  }
  
  return response.json();
}