/**
 * Centralized API service for DICOM viewer operations
 * Extracted from scattered fetch calls in WorkingViewer
 */

/**
 * Fetch series images from API
 */
export async function fetchSeriesImages(seriesId: number) {
  const response = await fetch(`/api/series/${seriesId}/images`);
  if (!response.ok) {
    throw new Error(`Failed to fetch series images: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch images in batch for performance
 */
export async function fetchImagesBatch(imageIds: number[]) {
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
export async function fetchRTStructures(studyId: number) {
  const response = await fetch(`/api/studies/${studyId}/rt-structures`);
  if (!response.ok) {
    throw new Error(`Failed to fetch RT structures: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch registration matrix for fusion
 */
export async function fetchRegistrationMatrix(studyId: number) {
  const response = await fetch(`/api/registrations/${studyId}`);
  if (!response.ok) {
    return null; // Registration is optional
  }
  return response.json();
}

/**
 * Fetch image metadata
 */
export async function fetchImageMetadata(imageId: number) {
  const response = await fetch(`/api/images/${imageId}/metadata`);
  if (!response.ok) {
    throw new Error(`Failed to fetch image metadata: ${response.statusText}`);
  }
  return response.json();
}