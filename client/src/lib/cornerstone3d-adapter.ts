/**
 * Cornerstone3D Adapter Layer
 * 
 * This adapter provides a migration path from Cornerstone Core to Cornerstone3D
 * while maintaining backward compatibility with existing functionality.
 */

import * as cornerstone3D from '@cornerstonejs/core';
import * as cornerstone3DTools from '@cornerstonejs/tools';
import { init as initCore3D } from '@cornerstonejs/core';
import { init as initTools3D } from '@cornerstonejs/tools';

// Feature flag to control migration phases
export const ENABLE_CORNERSTONE3D = false; // Will be enabled gradually

// Store initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Check if GPU acceleration is available
 */
export function isGPUAccelerationAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl !== null;
  } catch (e) {
    console.warn('Failed to check GPU availability:', e);
    return false;
  }
}

/**
 * Initialize Cornerstone3D with WebGL detection and fallback
 */
export async function initializeCornerstone3D(): Promise<boolean> {
  if (isInitialized) {
    return true;
  }

  // If already initializing, wait for it
  if (initializationPromise) {
    await initializationPromise;
    return isInitialized;
  }

  initializationPromise = (async () => {
    try {
      // Check WebGL support
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) {
        console.warn('WebGL not supported, falling back to Cornerstone Core');
        return;
      }

      // Initialize Cornerstone3D
      await initCore3D();
      await initTools3D();

      // Set rendering engine to use GPU (by not using CPU rendering)
      cornerstone3D.setUseCPURendering(false);
      
      isInitialized = true;
      console.log('Cornerstone3D initialized successfully with GPU acceleration');
    } catch (error) {
      console.error('Failed to initialize Cornerstone3D:', error);
      isInitialized = false;
    }
  })();

  await initializationPromise;
  return isInitialized;
}

/**
 * Create a hybrid viewport that can work with both Cornerstone versions
 */
export interface HybridViewport {
  element: HTMLDivElement;
  isCornerstone3D: boolean;
  renderingEngineId?: string;
  viewportId?: string;
}

/**
 * Adapter function to create viewport with fallback
 */
export async function createHybridViewport(
  element: HTMLDivElement,
  useCornerstone3D: boolean = ENABLE_CORNERSTONE3D
): Promise<HybridViewport> {
  if (useCornerstone3D && await initializeCornerstone3D()) {
    // Cornerstone3D viewport creation
    const renderingEngineId = 'superbeamRenderingEngine';
    const viewportId = `viewport-${Date.now()}`;
    
    try {
      // Get or create rendering engine
      let renderingEngine = cornerstone3D.getRenderingEngine(renderingEngineId);
      if (!renderingEngine) {
        renderingEngine = new cornerstone3D.RenderingEngine(renderingEngineId);
      }

      // Enable the element for Cornerstone3D
      const viewportInput = {
        viewportId,
        type: cornerstone3D.Enums.ViewportType.STACK,
        element,
        defaultOptions: {
          background: [0, 0, 0] as [number, number, number],
        },
      };

      renderingEngine.enableElement(viewportInput);

      return {
        element,
        isCornerstone3D: true,
        renderingEngineId,
        viewportId,
      };
    } catch (error) {
      console.error('Failed to create Cornerstone3D viewport, falling back:', error);
    }
  }

  // Fallback to Cornerstone Core
  // The existing cornerstone.enable(element) will be called by the component
  return {
    element,
    isCornerstone3D: false,
  };
}

/**
 * Adapter for displaying images
 */
export async function displayImage(
  viewport: HybridViewport,
  imageId: string,
  imageData?: any
): Promise<void> {
  if (viewport.isCornerstone3D && viewport.renderingEngineId && viewport.viewportId) {
    // Cornerstone3D image display
    const renderingEngine = cornerstone3D.getRenderingEngine(viewport.renderingEngineId);
    if (!renderingEngine) {
      throw new Error('Rendering engine not found');
    }

    const viewport3D = renderingEngine.getViewport(viewport.viewportId);
    
    // For now, we'll use stack viewport
    await (viewport3D as any).setStack([imageId]);
    
    // Render the image
    renderingEngine.render();
  } else {
    // Use existing Cornerstone Core display method
    // This will be handled by the existing component logic
    return;
  }
}

/**
 * Adapter for viewport operations (pan, zoom, etc.)
 */
export function getViewportState(viewport: HybridViewport): any {
  if (viewport.isCornerstone3D && viewport.renderingEngineId && viewport.viewportId) {
    const renderingEngine = cornerstone3D.getRenderingEngine(viewport.renderingEngineId);
    if (!renderingEngine) return null;

    const viewport3D = renderingEngine.getViewport(viewport.viewportId);
    const camera = viewport3D.getCamera();
    
    return {
      scale: camera.parallelScale,
      translation: {
        x: camera.position ? camera.position[0] : 0,
        y: camera.position ? camera.position[1] : 0,
      },
      // Map to Cornerstone Core format for compatibility
    };
  }

  // Fallback handled by existing logic
  return null;
}



/**
 * Cleanup function for viewports
 */
export function cleanupViewport(viewport: HybridViewport): void {
  if (viewport.isCornerstone3D && viewport.renderingEngineId) {
    try {
      const renderingEngine = cornerstone3D.getRenderingEngine(viewport.renderingEngineId);
      if (renderingEngine && viewport.viewportId) {
        renderingEngine.disableElement(viewport.viewportId);
      }
    } catch (error) {
      console.error('Error cleaning up Cornerstone3D viewport:', error);
    }
  }
  // Cornerstone Core cleanup will be handled by existing logic
}

/**
 * GPU-accelerated rendering function for 16-bit DICOM images
 * This replaces the CPU-based render16BitImage function when GPU is available
 */
export async function render16BitImageGPU(
  canvas: HTMLCanvasElement,
  imageData: {
    data: Float32Array;
    width: number;
    height: number;
    sopInstanceUID: string;
  },
  windowLevel: { width: number; center: number },
  ctTransform: { scale: number; offsetX: number; offsetY: number }
): Promise<void> {
  try {
    // Get or create rendering engine
    const renderingEngineId = 'superbeamGPURenderingEngine';
    let renderingEngine = cornerstone3D.getRenderingEngine(renderingEngineId);
    
    if (!renderingEngine) {
      renderingEngine = new cornerstone3D.RenderingEngine(renderingEngineId);
    }

    // Create a unique viewport ID
    const viewportId = `gpu-viewport-${imageData.sopInstanceUID}`;
    
    // Check if viewport already exists
    let viewport = renderingEngine.getViewport(viewportId);
    
    if (!viewport) {
      // Create a container element for Cornerstone3D
      const container = canvas.parentElement;
      if (!container) {
        throw new Error('Canvas must have a parent element');
      }

      // Enable the element for Cornerstone3D
      const viewportInput = {
        viewportId,
        type: cornerstone3D.Enums.ViewportType.STACK,
        element: container as HTMLDivElement,
        defaultOptions: {
          background: [0, 0, 0] as [number, number, number],
        },
      };

      renderingEngine.enableElement(viewportInput);
      viewport = renderingEngine.getViewport(viewportId);
    }

    // Create image object for Cornerstone3D
    const imageId = `gpu-image://${imageData.sopInstanceUID}`;
    
    // Register the image with Cornerstone3D's image loader
    // For now, we'll convert our Float32Array to a format Cornerstone3D expects
    const scalarArray = imageData.data;
    const dimensions = [imageData.width, imageData.height, 1];
    const spacing = [1, 1, 1]; // Will be updated with actual pixel spacing
    const origin = [0, 0, 0];
    const direction = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    // Create a volume-like object that Cornerstone3D can understand
    const imageVolume = {
      imageId,
      dimensions,
      spacing,
      origin,
      direction,
      scalarData: scalarArray,
      sizeInBytes: scalarArray.byteLength,
      imageData: {
        dimensions,
        spacing,
        origin,
        direction,
        scalarData: scalarArray,
        metadata: {
          Modality: 'CT',
        },
      },
    };

    // Apply window/level settings
    const { width: windowWidth, center: windowCenter } = windowLevel;
    const voiRange = {
      lower: windowCenter - windowWidth / 2,
      upper: windowCenter + windowWidth / 2,
    };
    
    // Cornerstone3D uses different API for setting VOI
    if ('setVOI' in viewport) {
      (viewport as any).setVOI(voiRange);
    }

    // Apply zoom and pan from ctTransform
    const camera = viewport.getCamera();
    camera.parallelScale = 1 / ctTransform.scale;
    
    // Update camera position for pan
    if (camera.position) {
      camera.position[0] = -ctTransform.offsetX / ctTransform.scale;
      camera.position[1] = -ctTransform.offsetY / ctTransform.scale;
    }
    
    viewport.setCamera(camera);

    // For now, fall back to CPU rendering until we complete the GPU pipeline
    // This ensures the viewer continues to work while we develop the GPU path
    console.log('GPU rendering pipeline initialized, using CPU fallback for now');
    
    // Use the existing CPU rendering as fallback
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Call the original render16BitImage logic inline
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    const imgData = tempCtx.createImageData(imageData.width, imageData.height);
    const data = imgData.data;
    const pixelArray = imageData.data;
    
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;

    for (let i = 0; i < pixelArray.length; i++) {
      const pixelValue = pixelArray[i];
      let normalizedValue;
      
      if (pixelValue <= min) {
        normalizedValue = 0;
      } else if (pixelValue >= max) {
        normalizedValue = 255;
      } else {
        normalizedValue = ((pixelValue - min) / windowWidth) * 255;
      }

      const gray = Math.max(0, Math.min(255, normalizedValue));
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;
      data[pixelIndex + 1] = gray;
      data[pixelIndex + 2] = gray;
      data[pixelIndex + 3] = 255;
    }

    tempCtx.putImageData(imgData, 0, 0);
    
    // Apply transforms and draw to main canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Use the transform values directly - they already include centering and pan
    const scaledWidth = imageData.width * ctTransform.scale;
    const scaledHeight = imageData.height * ctTransform.scale;
    
    // ctTransform.offsetX/Y already contains the final position (centering + pan)
    const x = ctTransform.offsetX;
    const y = ctTransform.offsetY;
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);

  } catch (error) {
    console.error('Error in GPU rendering:', error);
    throw error;
  }
}