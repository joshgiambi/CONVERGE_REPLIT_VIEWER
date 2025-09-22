/**
 * Cornerstone3D Adapter Layer
 * 
 * This adapter provides a migration path from Cornerstone Core to Cornerstone3D
 * while maintaining backward compatibility with existing functionality.
 */

import * as cornerstone3D from '@cornerstonejs/core';
import { metaData as cornerstoneMetaData } from '@cornerstonejs/core';
import { init as initCore3D } from '@cornerstonejs/core';
import { init as initTools3D } from '@cornerstonejs/tools';
import * as cornerstone3DTools from '@cornerstonejs/tools';

// Feature flag to control migration phases
export const ENABLE_CORNERSTONE3D = true; // Enabled for GPU acceleration

// Store initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
let imageLoaderRegistered = false;
let metadataProviderRegistered = false;

type MetadataStoreEntry = Record<string, any>;
const metadataStore = new Map<string, MetadataStoreEntry>();

function mergeMetadataModules(imageId: string, modules: Partial<MetadataStoreEntry>) {
  ensureMetadataProvider();
  const entry = metadataStore.get(imageId) ?? {};
  Object.entries(modules).forEach(([moduleKey, moduleValue]) => {
    if (moduleValue !== undefined) {
      entry[moduleKey] = moduleValue;
    }
  });
  metadataStore.set(imageId, entry);
}

export function setCornerstoneMetadata(imageId: string, modules: Partial<MetadataStoreEntry>) {
  mergeMetadataModules(imageId, modules);
}

function ensureMetadataProvider() {
  if (metadataProviderRegistered) return;
  cornerstoneMetaData.addProvider((type: string, imageId: string) => {
    const entry = metadataStore.get(imageId);
    if (!entry) return undefined;
    return entry[type];
  }, 10);
  metadataProviderRegistered = true;
}

type CachedImageMetadata = {
  sopInstanceUID: string;
  pixelSpacing?: [number, number];
  imageOrientationPatient?: number[];
  imagePositionPatient?: number[];
  sliceThickness?: number;
  frameOfReferenceUID?: string;
  windowCenter?: number;
  windowWidth?: number;
  rescaleSlope?: number;
  rescaleIntercept?: number;
  modality?: string;
  minPixelValue?: number;
  maxPixelValue?: number;
  instanceNumber?: number;
};

type CachedImageEntry = {
  id: string;
  sopInstanceUID: string;
  width: number;
  height: number;
  data: Float32Array;
  metadata?: CachedImageMetadata;
};

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
const imageDataCache = new Map<string, CachedImageEntry>();

function normalizeImageId(imageId: string): string {
  return imageId.startsWith('superbeam://') ? imageId.slice('superbeam://'.length) : imageId;
}

function cacheImageData(imageId: string, entry: CachedImageEntry) {
  imageDataCache.set(imageId, entry);
  const normalizedId = normalizeImageId(imageId);
  if (normalizedId !== imageId) {
    imageDataCache.set(normalizedId, entry);
  }
  if (entry.sopInstanceUID) {
    imageDataCache.set(entry.sopInstanceUID, entry);
  }
}

function getCachedImage(imageId: string): CachedImageEntry | undefined {
  return imageDataCache.get(imageId) ?? imageDataCache.get(normalizeImageId(imageId));
}

function calculateMinMax(data: Float32Array): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (Number.isNaN(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: -1000, max: 3000 };
  }

  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }

  return { min, max };
}

export interface VolumeStackSlice {
  sopInstanceUID: string;
  width: number;
  height: number;
  pixelData: Float32Array;
  metadata?: Partial<CachedImageMetadata>;
}

export interface RegisterVolumeStacksOptions {
  renderingEngineId: string;
  viewportId: string;
  ctSlices: VolumeStackSlice[];
  fusionSlices?: VolumeStackSlice[];
}

export interface RegisteredVolumeActors {
  ct: {
    actorId: string;
    imageIds: string[];
  };
  fusion?: {
    actorId: string;
    imageIds: string[];
  } | null;
}

export interface RegisterVolumeStacksResult {
  renderingEngine: any;
  viewport: any;
  actors: RegisteredVolumeActors;
}

export function cacheStackSlice(prefix: 'ct' | 'fusion', slice: VolumeStackSlice): string {
  const imageId = `superbeam://${prefix}/${slice.sopInstanceUID}`;
  const baseMetadata: CachedImageMetadata = {
    sopInstanceUID: slice.sopInstanceUID,
    ...(slice.metadata ?? {}),
  };

  if (!Number.isFinite(baseMetadata.minPixelValue) || !Number.isFinite(baseMetadata.maxPixelValue)) {
    const range = calculateMinMax(slice.pixelData);
    baseMetadata.minPixelValue = baseMetadata.minPixelValue ?? range.min;
    baseMetadata.maxPixelValue = baseMetadata.maxPixelValue ?? range.max;
  }

  cacheImageData(imageId, {
    id: imageId,
    sopInstanceUID: slice.sopInstanceUID,
    width: slice.width,
    height: slice.height,
    data: slice.pixelData,
    metadata: baseMetadata,
  });

  registerSliceMetadata(imageId, slice, baseMetadata, prefix);

  return imageId;
}

function registerSliceMetadata(
  imageId: string,
  slice: VolumeStackSlice,
  metadata: CachedImageMetadata,
  prefix: 'ct' | 'fusion'
) {
  ensureMetadataProvider();

  const rows = slice.height;
  const columns = slice.width;
  const pixelSpacing = metadata.pixelSpacing ?? [1, 1];
  const imageOrientationPatient = metadata.imageOrientationPatient ?? [1, 0, 0, 0, 1, 0];
  const imagePositionPatient = metadata.imagePositionPatient ?? [0, 0, 0];
  const frameOfReferenceUID = metadata.frameOfReferenceUID ?? `superbeam-${prefix}-for`;
  const sliceThickness = metadata.sliceThickness ?? 1;
  const instanceNumberCandidate = (metadata as any).instanceNumber;
  const instanceNumber = Number.isFinite(instanceNumberCandidate)
    ? Number(instanceNumberCandidate)
    : 1;
  const modality = metadata.modality ?? (prefix === 'ct' ? 'CT' : 'PT');

  mergeMetadataModules(imageId, {
    generalSeriesModule: {
      modality,
      seriesInstanceUID: frameOfReferenceUID,
    },
    generalImageModule: {
      instanceNumber,
    },
    imagePlaneModule: {
      frameOfReferenceUID,
      rows,
      columns,
      imageOrientationPatient,
      imagePositionPatient,
      pixelSpacing,
      sliceThickness,
    },
    imagePixelModule: {
      rows,
      columns,
      samplesPerPixel: 1,
      photometricInterpretation: 'MONOCHROME2',
      bitsAllocated: 32,
      bitsStored: 32,
      highBit: 31,
      pixelRepresentation: 1,
    },
    modalityLutModule: {
      rescaleSlope: metadata.rescaleSlope ?? 1,
      rescaleIntercept: metadata.rescaleIntercept ?? 0,
    },
  });
}

function cacheSlices(imageIds: string[], slices: VolumeStackSlice[], prefix: 'ct' | 'fusion') {
  slices.forEach((slice) => {
    const imageId = cacheStackSlice(prefix, slice);
    imageIds.push(imageId);
  });
}

export function registerVolumeStacks(options: RegisterVolumeStacksOptions): RegisterVolumeStacksResult {
  if (!imageLoaderRegistered) {
    registerCustomImageLoader();
  }

  const { renderingEngineId, viewportId, ctSlices, fusionSlices } = options;

  const renderingEngine = cornerstone3D.getRenderingEngine(renderingEngineId);
  if (!renderingEngine) {
    throw new Error(`Rendering engine ${renderingEngineId} not found`);
  }

  const viewport = renderingEngine.getViewport(viewportId);
  if (!viewport) {
    throw new Error(`Viewport ${viewportId} not found on rendering engine ${renderingEngineId}`);
  }

  const ctImageIds: string[] = [];
  cacheSlices(ctImageIds, ctSlices, 'ct');

  const fusionImageIds: string[] = [];
  cacheSlices(fusionImageIds, fusionSlices ?? [], 'fusion');

  return {
    renderingEngine,
    viewport,
    actors: {
      ct: {
        actorId: 'ct-stack',
        imageIds: ctImageIds,
      },
      fusion: fusionImageIds.length
        ? {
            actorId: 'fusion-stack',
            imageIds: fusionImageIds,
          }
        : null,
    },
  };
}

/**
 * Custom image loader for Float32Array data
 */
function loadAndCacheImage(imageId: string): any {
  console.log('[Custom Loader] loadAndCacheImage called with:', imageId);

  const promise = new Promise((resolve, reject) => {
    try {
      const cachedData = getCachedImage(imageId);

      if (!cachedData) {
        console.error('[Custom Loader] No cached data found for:', imageId);
        reject(new Error(`Image data not found for ${imageId}`));
        return;
      }

      const { data, width, height, metadata } = cachedData;
      const normalizedMetadata = metadata ?? { sopInstanceUID: cachedData.sopInstanceUID };

      const slope = normalizedMetadata.rescaleSlope ?? (normalizedMetadata as any).slope ?? 1;
      const intercept = normalizedMetadata.rescaleIntercept ?? (normalizedMetadata as any).intercept ?? 0;
      const pixelSpacing = Array.isArray(normalizedMetadata.pixelSpacing) && normalizedMetadata.pixelSpacing.length === 2
        ? normalizedMetadata.pixelSpacing as [number, number]
        : ([1, 1] as [number, number]);
      const imagePosition = normalizedMetadata.imagePositionPatient ?? (normalizedMetadata as any).imagePosition ?? [0, 0, 0];
      const imageOrientation = normalizedMetadata.imageOrientationPatient ?? (normalizedMetadata as any).imageOrientation ?? [1, 0, 0, 0, 1, 0];

      let minPixel = normalizedMetadata.minPixelValue;
      let maxPixel = normalizedMetadata.maxPixelValue;
      if (!Number.isFinite(minPixel) || !Number.isFinite(maxPixel)) {
        const range = calculateMinMax(data);
        minPixel = range.min;
        maxPixel = range.max;
      }

      const image = {
        imageId,
        rows: height,
        columns: width,
        height,
        width,
        intercept,
        slope,
        windowCenter: normalizedMetadata.windowCenter ?? 40,
        windowWidth: normalizedMetadata.windowWidth ?? 300,
        pixelSpacing,
        imagePositionPatient: imagePosition,
        imageOrientationPatient: imageOrientation,
        sliceThickness: normalizedMetadata.sliceThickness,
        frameOfReferenceUID: normalizedMetadata.frameOfReferenceUID,
        sizeInBytes: data.byteLength,
        getPixelData: () => data,
        minPixelValue: minPixel,
        maxPixelValue: maxPixel,
        stats: {
          lastGetPixelDataTime: 0,
        },
        decodeTimeInMS: 0,
        floatPixelData: data,
        color: false,
        columnPixelSpacing: pixelSpacing[1],
        rowPixelSpacing: pixelSpacing[0],
        modality: normalizedMetadata.modality,
      };

      console.log('[Custom Loader] Created image object with size:', image.width, 'x', image.height);
      resolve(image);
    } catch (error) {
      console.error('[Custom Loader] Error in loadAndCacheImage:', error);
      reject(error);
    }
  });

  return { promise };
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
    const cachedId = `superbeam://ct/${imageData.sopInstanceUID}`;
    cacheImageData(cachedId, {
      id: cachedId,
      sopInstanceUID: imageData.sopInstanceUID,
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
      metadata: {
        sopInstanceUID: imageData.sopInstanceUID,
        windowCenter: windowLevel.center,
        windowWidth: windowLevel.width,
        pixelSpacing: [1, 1],
        imagePositionPatient: [0, 0, 0],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      },
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
