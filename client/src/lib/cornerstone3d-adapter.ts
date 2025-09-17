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
export const ENABLE_CORNERSTONE3D = true; // Enabled for GPU acceleration

// Store initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
let imageLoaderRegistered = false;

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
      
      // Register our custom image loader for Float32Array data
      registerCustomImageLoader();
      
      // Make Cornerstone3D available globally for GPU viewport manager
      (window as any).cornerstone3D = cornerstone3D;
      (window as any).cornerstone3DTools = cornerstone3DTools;
      
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
 * Register a custom image loader for Float32Array DICOM data
 */
function registerCustomImageLoader() {
  if (imageLoaderRegistered) {
    console.log('[Register] Image loader already registered');
    return;
  }

  // Register custom scheme for our images
  if (cornerstone3D && cornerstone3D.imageLoader) {
    console.log('[Register] Cornerstone3D imageLoader available, registering custom loader...');
    cornerstone3D.imageLoader.registerImageLoader('superbeam', loadAndCacheImage);
    console.log('[Register] Custom image loader registered for superbeam:// scheme');
    console.log('[Register] Registered loader function:', loadAndCacheImage);
  } else {
    console.error('[Register] Cornerstone3D imageLoader not available');
    console.log('[Register] cornerstone3D object:', cornerstone3D);
    return;
  }
  
  imageLoaderRegistered = true;
}

// Store image data temporarily for the loader
const imageDataCache = new Map<string, any>();

/**
 * Custom image loader for Float32Array data
 */
function loadAndCacheImage(imageId: string): any {
  console.log('[Custom Loader] loadAndCacheImage called with:', imageId);
  
  // Return an object with a promise property as expected by Cornerstone3D
  const promise = new Promise((resolve, reject) => {
    try {
      const cleanId = imageId.replace('superbeam://', '');
      console.log('[Custom Loader] Looking for cached data with ID:', cleanId);
      
      const cachedData = imageDataCache.get(cleanId);
      
      if (!cachedData) {
        console.error('[Custom Loader] No cached data found for:', cleanId);
        reject(new Error(`Image data not found for ${imageId}`));
        return;
      }

      const { data, width, height, metadata } = cachedData;
      console.log('[Custom Loader] Found cached data:', { width, height, dataLength: data.length, metadata });
      
      // Calculate min/max values safely
      let minPixel = Infinity;
      let maxPixel = -Infinity;
      
      try {
        for (let i = 0; i < data.length; i++) {
          if (data[i] < minPixel) minPixel = data[i];
          if (data[i] > maxPixel) maxPixel = data[i];
        }
        console.log('[Custom Loader] Calculated min/max:', minPixel, maxPixel);
      } catch (err) {
        console.error('[Custom Loader] Error calculating min/max:', err);
        minPixel = -1000;
        maxPixel = 3000;
      }
      
      // Create an image object compatible with Cornerstone3D
      // Pull common DICOM display/geometry fields from metadata if present
      const slope = (metadata?.rescaleSlope ?? metadata?.slope ?? 1) as number;
      const intercept = (metadata?.rescaleIntercept ?? metadata?.intercept ?? 0) as number;
      const px = Array.isArray(metadata?.pixelSpacing) ? metadata.pixelSpacing : undefined;
      const ipp = metadata?.imagePosition || metadata?.imagePositionPatient;
      const iop = metadata?.imageOrientation || metadata?.imageOrientationPatient;

      const image = {
        imageId,
        rows: height,
        columns: width,
        height,
        width,
        intercept,
        slope,
        windowCenter: metadata?.windowCenter || 40,
        windowWidth: metadata?.windowWidth || 300,
        pixelSpacing: px || [1, 1],
        imagePositionPatient: ipp || [0, 0, 0],
        imageOrientationPatient: iop || [1, 0, 0, 0, 1, 0],
        sizeInBytes: data.byteLength,
        getPixelData: () => data,
        // Calculate min/max without spread operator for large arrays
        minPixelValue: data.reduce((min, val) => val < min ? val : min, Infinity),
        maxPixelValue: data.reduce((max, val) => val > max ? val : max, -Infinity),
        stats: {
          lastGetPixelDataTime: 0,
        },
        decodeTimeInMS: 0,
        floatPixelData: data,
        color: false,
        columnPixelSpacing: (px?.[1] ?? px?.[0] ?? 1),
        rowPixelSpacing: (px?.[0] ?? px?.[1] ?? 1),
      };

      console.log('[Custom Loader] Created image object with size:', image.width, 'x', image.height);
      resolve(image);
    } catch (error) {
      console.error('[Custom Loader] Error in loadAndCacheImage:', error);
      reject(error);
    }
  });
  
  const result = { promise };
  console.log('[Custom Loader] Returning result object:', result);
  return result;
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
      // Ensure canvas has proper dimensions before initialization
      if (!canvas.width || !canvas.height) {
        canvas.width = 1280;
        canvas.height = 1280;
      }
      
      // Ensure canvas is visible and has computed dimensions
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) {
        console.warn('Canvas appears too small:', rect.width, 'x', rect.height);
        // Set minimum size style to ensure proper rendering
        canvas.style.minWidth = '512px';
        canvas.style.minHeight = '512px';
      }
      
      // Get the parent container
      const container = canvas.parentElement;
      if (!container) {
        throw new Error('Canvas must have a parent element');
      }

      // Create a div wrapper for Cornerstone3D with proper dimensions
      let cs3dElement = document.querySelector('.cs3d-viewport-wrapper') as HTMLDivElement;
      if (!cs3dElement) {
        cs3dElement = document.createElement('div');
        cs3dElement.className = 'cs3d-viewport-wrapper';
        cs3dElement.style.width = `${canvas.width}px`;
        cs3dElement.style.height = `${canvas.height}px`;
        cs3dElement.style.position = 'fixed';
        cs3dElement.style.top = '0';
        cs3dElement.style.left = '0';
        cs3dElement.style.opacity = '0'; // Invisible but still rendered
        cs3dElement.style.pointerEvents = 'none'; // Don't capture mouse events
        cs3dElement.style.zIndex = '-1'; // Behind everything
        
        // Add to body for GPU rendering
        document.body.appendChild(cs3dElement);
      }

      // Configure viewport for Cornerstone3D
      const viewportInput = {
        viewportId,
        type: cornerstone3D.Enums.ViewportType.STACK,
        element: cs3dElement,
        defaultOptions: {
          background: [0, 0, 0] as [number, number, number],
        },
      };

      renderingEngine.enableElement(viewportInput);
      viewport = renderingEngine.getViewport(viewportId);
    }

    // Create image object for Cornerstone3D
    const imageId = `superbeam://${imageData.sopInstanceUID}`;
    
    // Store image data in cache for our custom loader
    imageDataCache.set(imageData.sopInstanceUID, {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
      metadata: {
        windowCenter: windowLevel.center,
        windowWidth: windowLevel.width,
        pixelSpacing: [1, 1], // Will be updated with actual spacing
        imagePosition: [0, 0, 0], // Will be updated with actual position
        imageOrientation: [1, 0, 0, 0, 1, 0], // Will be updated with actual orientation
      }
    });

    // Load the image through Cornerstone3D
    try {
      console.log('Attempting to load image with ID:', imageId);
      console.log('Image data cached:', imageDataCache.has(imageData.sopInstanceUID));
      
      // First register the custom loader if not already done
      registerCustomImageLoader();
      
      console.log('About to load image...');
      
      // In Cornerstone3D, we need to use the cache module to load images
      let image;
      try {
        // First, try to get from cache
        image = cornerstone3D.cache.getImage(imageId);
        
        if (!image) {
          console.log('Image not in cache, loading via custom loader...');
          
          // Our custom loader returns an object with a promise
          const loaderResult = loadAndCacheImage(imageId);
          if (loaderResult && loaderResult.promise) {
            image = await loaderResult.promise;
            console.log('Custom loader returned image:', image);
            
            // Put the image in Cornerstone3D's cache
            cornerstone3D.cache.putImageLoadObject(imageId, loaderResult);
          } else {
            throw new Error('Custom loader did not return a valid result');
          }
        }
        
        console.log('Image loaded successfully:', image);
      } catch (error) {
        console.error('Error loading image:', error);
        throw error;
      }
      
      // Set the image on the viewport
      if ('setStack' in viewport) {
        const stack = viewport as any;
        await stack.setStack([imageId], 0);
        
        // Apply window/level settings
        const { width: windowWidth, center: windowCenter } = windowLevel;
        const properties = {
          voiRange: {
            lower: windowCenter - windowWidth / 2,
            upper: windowCenter + windowWidth / 2,
          },
        };
        stack.setProperties(properties);
        
        // Apply zoom and pan from ctTransform
        const camera = viewport.getCamera();
        if (camera) {
          // Cornerstone3D uses a different scale calculation
          const currentParallelScale = camera.parallelScale || 1;
          const targetScale = currentParallelScale / ctTransform.scale;
          camera.parallelScale = targetScale;
          
          // Apply pan by adjusting focal point
          if (camera.focalPoint) {
            camera.focalPoint[0] = -ctTransform.offsetX;
            camera.focalPoint[1] = -ctTransform.offsetY;
          }
          
          viewport.setCamera(camera);
        }
        
        // Render the viewport
        viewport.render();
        
        // Wait a frame for GPU rendering to complete
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        // Copy the GPU-rendered image back to the original canvas
        const cs3dElement = document.querySelector('.cs3d-viewport-wrapper') as HTMLDivElement;
        if (cs3dElement) {
          const gpuCanvas = cs3dElement.querySelector('canvas') as HTMLCanvasElement;
          if (gpuCanvas && canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              // Clear and copy GPU render to original canvas
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(gpuCanvas, 0, 0, canvas.width, canvas.height);
              
              // Ensure original canvas remains visible
              canvas.style.display = 'block';
              canvas.style.visibility = 'visible';
              
              console.log('GPU canvas copied successfully', {
                gpuCanvasSize: { width: gpuCanvas.width, height: gpuCanvas.height },
                targetCanvasSize: { width: canvas.width, height: canvas.height }
              });
            } else {
              console.error('Failed to get 2D context from display canvas');
            }
          } else {
            console.error('GPU canvas not found in cs3dElement');
          }
        } else {
          console.error('cs3dElement not found when trying to copy GPU render');
        }
        
        console.log('GPU rendering completed and copied to display canvas');
        return;
      }
    } catch (error) {
      console.error('GPU rendering failed, falling back to CPU:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        viewportId,
        imageId,
        cs3dElementExists: !!cs3dElement,
        canvasDimensions: { width: canvas.width, height: canvas.height }
      });
      
      // On error, ensure original canvas is visible
      canvas.style.display = 'block';
      canvas.style.visibility = 'visible';
    }

    // Fall back to CPU rendering if GPU fails
    console.log('Using CPU fallback for rendering');
    
    // Ensure canvas is visible for CPU rendering
    canvas.style.display = 'block';
    
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
    
    const min = windowLevel.center - windowLevel.width / 2;
    const max = windowLevel.center + windowLevel.width / 2;

    for (let i = 0; i < pixelArray.length; i++) {
      const pixelValue = pixelArray[i];
      let normalizedValue;
      
      if (pixelValue <= min) {
        normalizedValue = 0;
      } else if (pixelValue >= max) {
        normalizedValue = 255;
      } else {
        normalizedValue = ((pixelValue - min) / windowLevel.width) * 255;
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
