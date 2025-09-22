/**
 * Volume Renderer - Cornerstone3D Volume-based rendering
 * 
 * Assembles vtkImageData directly from in-memory Float32Array slices
 * for efficient volume rendering without complex loader registration.
 */

import * as cornerstone3D from '@cornerstonejs/core';
import { initializeCornerstone3D } from '@/lib/cornerstone3d-adapter';

export interface SliceData {
  data: Float32Array;
  width: number;
  height: number;
  sopInstanceUID: string;
  sliceLocation?: number;
  imagePositionPatient?: number[];
  pixelSpacing?: [number, number];
  windowCenter?: number;
  windowWidth?: number;
}

export interface VolumeConfig {
  seriesId: number;
  imageIds: string[];
  orientation: 'axial' | 'sagittal' | 'coronal';
  windowLevel?: { window: number; level: number };
}

export interface VolumeRenderResult {
  success: boolean;
  volumeId?: string;
  viewportId?: string;
  error?: string;
}

class VolumeRenderer {
  public renderingEngine: any = null; // Made public for external access
  public primaryViewport: any = null; // Made public for external access
  public fusionViewport: any = null; // Made public for external access
  private primaryVolumeId: string | null = null;
  private fusionVolumeId: string | null = null;
  private isInitialized = false;
  private container: HTMLElement | null = null;
  private initializationPromise: Promise<void> | null = null;
  private lastFusionOpacity: number = -1; // Cache last opacity to avoid redundant DOM updates

  constructor() {
    // Don't call initializeRenderer immediately - make it awaitable
  }

  public async ensureInitialized(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRenderer();
    }

    await this.initializationPromise;
    return this.isInitialized;
  }

  private async initializeRenderer(): Promise<void> {
    try {
      // Ensure Cornerstone3D is initialized
      const cs3dReady = await initializeCornerstone3D();
      if (!cs3dReady) {
        console.warn('Volume Renderer: Cornerstone3D not available, falling back to slice rendering');
        return;
      }

      const cornerstone3D = (window as any).cornerstone3D;
      if (!cornerstone3D) {
        console.warn('Volume Renderer: Cornerstone3D not found on window');
        return;
      }

      // Create rendering engine
      const renderingEngineId = `volume-engine-${Date.now()}`;
      this.renderingEngine = new cornerstone3D.RenderingEngine(renderingEngineId);
      
      // Volume loader registration not needed for STACK viewports
      
      this.isInitialized = true;
      console.log('🚀 Volume Renderer: Initialized successfully');
      
    } catch (error) {
      console.error('Volume Renderer: Initialization failed:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Assemble vtkImageData directly from Float32Array slices
   */
  public async assembleVolumeFromSlices(
    slices: SliceData[],
    volumeId: string
  ): Promise<any> {
    try {
      const cornerstone3D = (window as any).cornerstone3D;
      if (!cornerstone3D || !cornerstone3D.utilities) {
        throw new Error('Cornerstone3D utilities not available');
      }

      if (slices.length === 0) {
        throw new Error('No slices provided');
      }

      // Sort slices by slice location or index
      const sortedSlices = slices.sort((a, b) => {
        if (a.sliceLocation != null && b.sliceLocation != null) {
          return a.sliceLocation - b.sliceLocation;
        }
        return 0; // Keep original order if no slice location
      });

      const firstSlice = sortedSlices[0];
      const dimensions = [firstSlice.width, firstSlice.height, sortedSlices.length];
      const spacing = firstSlice.pixelSpacing ? [firstSlice.pixelSpacing[0], firstSlice.pixelSpacing[1], 1.0] : [1.0, 1.0, 1.0];
      
      // Calculate origin from first slice position
      const origin = firstSlice.imagePositionPatient ? 
        [firstSlice.imagePositionPatient[0], firstSlice.imagePositionPatient[1], firstSlice.imagePositionPatient[2]] :
        [0, 0, 0];

      // Assemble volume data
      const totalVoxels = dimensions[0] * dimensions[1] * dimensions[2];
      const volumeData = new Float32Array(totalVoxels);
      
      sortedSlices.forEach((slice, sliceIndex) => {
        const sliceSize = dimensions[0] * dimensions[1];
        const sliceOffset = sliceIndex * sliceSize;
        volumeData.set(slice.data, sliceOffset);
      });

      // Create vtkImageData directly
      const vtkImageData = cornerstone3D.utilities.vtkImageData.newInstance({
        dimensions,
        spacing,
        origin,
        direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] // Identity matrix
      });

      // Set scalar data
      const scalars = cornerstone3D.utilities.vtkDataArray.newInstance({
        name: 'Scalars',
        numberOfComponents: 1,
        values: volumeData
      });

      vtkImageData.getPointData().setScalars(scalars);

      // Create Cornerstone3D volume from vtkImageData
      const volume = new cornerstone3D.classes.ImageVolume({
        volumeId,
        metadata: {
          BitsAllocated: 32,
          BitsStored: 32,
          SamplesPerPixel: 1,
          HighBit: 31,
          PhotometricInterpretation: 'MONOCHROME2',
          PixelRepresentation: 1,
          Modality: 'CT',
          PixelSpacing: spacing.slice(0, 2),
          SpacingBetweenSlices: spacing[2],
          ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
          ImagePositionPatient: origin,
        },
        dimensions,
        spacing,
        origin,
        direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        vtkImageData
      });

      // Cache the volume
      cornerstone3D.cache.putVolumeLoadObject(volumeId, {
        promise: Promise.resolve(volume)
      });

      console.log(`🚀 Volume Renderer: Assembled volume ${volumeId} from ${slices.length} Float32Array slices`);
      return volume;

    } catch (error) {
      console.error(`Volume Renderer: Failed to assemble volume from slices:`, error);
      return null;
    }
  }

  /**
   * Set up volume rendering for a container element
   */
  public async setupVolumeRendering(
    containerElement: HTMLElement,
    primaryConfig: VolumeConfig,
    fusionConfig?: VolumeConfig
  ): Promise<VolumeRenderResult> {
    if (!this.isInitialized || !this.renderingEngine) {
      return { success: false, error: 'Volume renderer not initialized' };
    }

    try {
      this.container = containerElement;
      console.log('🚀 Volume Renderer: Starting setup with container:', containerElement.tagName);

      // Create primary viewport
      const primaryViewportId = 'primary-volume-viewport';
      const primaryElement = this.createViewportElement(primaryViewportId, containerElement);
      
      const primaryViewportInput = {
        viewportId: primaryViewportId,
        type: cornerstone3D.Enums.ViewportType.STACK, // Use STACK instead of ORTHOGRAPHIC for compatibility
        element: primaryElement,
        defaultOptions: {
          background: [0, 0, 0] as [number, number, number]
        }
      };

      this.renderingEngine.enableElement(primaryViewportInput);
      this.primaryViewport = this.renderingEngine.getViewport(primaryViewportId);

      // Use STACK approach with existing image loader (more compatible)
      console.log(`🚀 Volume Renderer: Setting up STACK viewport with ${primaryConfig.imageIds.length} images`);
      await this.primaryViewport.setStack(primaryConfig.imageIds, 0);
      
      // Apply window/level if specified
      if (primaryConfig.windowLevel) {
        this.setWindowLevel(primaryConfig.windowLevel, 'primary');
      }

      // Create fusion viewport if fusion config provided
      if (fusionConfig) {
        const fusionViewportId = 'fusion-volume-viewport';
        const fusionElement = this.createViewportElement(fusionViewportId, containerElement);
        
        const fusionViewportInput = {
          viewportId: fusionViewportId,
          type: cornerstone3D.Enums.ViewportType.STACK, // Use STACK for compatibility
          element: fusionElement,
          defaultOptions: {
            background: [0, 0, 0, 0] as [number, number, number, number] // Transparent
          }
        };

        this.renderingEngine.enableElement(fusionViewportInput);
        this.fusionViewport = this.renderingEngine.getViewport(fusionViewportId);

        // Set fusion stack
        await this.fusionViewport.setStack(fusionConfig.imageIds, 0);
        
        // Apply fusion window/level if specified
        if (fusionConfig.windowLevel) {
          this.setWindowLevel(fusionConfig.windowLevel, 'fusion');
        }

        // Make fusion viewport overlay on primary
        fusionElement.style.position = 'absolute';
        fusionElement.style.top = '0';
        fusionElement.style.left = '0';
        fusionElement.style.pointerEvents = 'none';
        fusionElement.style.opacity = '0.5';
      }

      // Initial render
      this.renderingEngine.render();

      console.log('🚀 Volume Renderer: Volume rendering setup complete');
      return { 
        success: true, 
        volumeId: this.primaryVolumeId,
        viewportId: primaryViewportId
      };

    } catch (error) {
      console.error('Volume Renderer: Setup failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Navigate to a specific slice index (STACK viewport navigation)
   */
  public navigateToSlice(sliceIndex: number, orientation: 'axial' | 'sagittal' | 'coronal' = 'axial'): void {
    if (!this.primaryViewport) return;

    try {
      // For STACK viewports, use setImageIdIndex
      this.primaryViewport.setImageIdIndex(sliceIndex);

      // Sync fusion viewport if available
      if (this.fusionViewport) {
        this.fusionViewport.setImageIdIndex(sliceIndex);
      }

      // Render (fast, just index update)
      this.renderingEngine.render();
      
    } catch (error) {
      console.error('Volume Renderer: Slice navigation failed:', error);
    }
  }

  /**
   * Update fusion opacity without re-rendering volumes
   */
  public setFusionOpacity(opacity: number): void {
    // Skip if opacity hasn't changed to avoid redundant DOM updates
    if (Math.abs(this.lastFusionOpacity - opacity) < 0.001) {
      return;
    }
    
    this.lastFusionOpacity = opacity;

    if (!this.fusionViewport || !this.container) return;

    try {
      // Try to apply opacity through viewport properties first (more efficient)
      if (this.fusionViewport.setProperties) {
        this.fusionViewport.setProperties({
          opacity: opacity
        });
        this.renderingEngine.render();
      } else {
        // Fallback to DOM manipulation
        const fusionElement = this.container.querySelector(`[data-viewport-id="fusion-volume-viewport"]`) as HTMLElement;
        if (fusionElement) {
          fusionElement.style.opacity = opacity.toString();
        }
      }
    } catch (error) {
      console.warn('Volume Renderer: Failed to set fusion opacity:', error);
    }
  }

  /**
   * Update window/level without re-rendering volumes
   */
  public setWindowLevel(windowLevel: { window: number; level: number }, target: 'primary' | 'fusion' = 'primary'): void {
    const viewport = target === 'primary' ? this.primaryViewport : this.fusionViewport;
    if (!viewport) return;

    try {
      viewport.setProperties({
        voiRange: {
          lower: windowLevel.level - windowLevel.window / 2,
          upper: windowLevel.level + windowLevel.window / 2
        }
      });
      
      this.renderingEngine.render();
    } catch (error) {
      console.error(`Volume Renderer: Failed to set window/level for ${target}:`, error);
    }
  }

  public createViewportElement(viewportId: string, container: HTMLElement): HTMLDivElement {
    const element = document.createElement('div');
    element.id = viewportId;
    element.setAttribute('data-viewport-id', viewportId);
    element.style.width = '100%';
    element.style.height = '100%';
    element.style.position = 'absolute';
    element.style.top = '0';
    element.style.left = '0';
    
    container.appendChild(element);
    return element;
  }

  public createBasicTransferFunction(lower: number, upper: number): any {
    try {
      const cornerstone3D = (window as any).cornerstone3D;
      if (!cornerstone3D.utilities || !cornerstone3D.utilities.transferFunctionUtils) {
        console.warn('Transfer function utilities not available');
        return null;
      }

      const transferFunction = cornerstone3D.utilities.transferFunctionUtils.createRGBTransferFunction();
      transferFunction.addRGBPoint(lower, 0, 0, 0);
      transferFunction.addRGBPoint(upper, 1, 1, 1);
      return transferFunction;
    } catch (error) {
      console.error('Failed to create transfer function:', error);
      return null;
    }
  }



  public cleanup(): void {
    try {
      if (this.renderingEngine) {
        if (this.primaryViewport) {
          this.renderingEngine.disableElement('primary-volume-viewport');
        }
        if (this.fusionViewport) {
          this.renderingEngine.disableElement('fusion-volume-viewport');
        }
        this.renderingEngine.destroy();
      }

      // Remove DOM elements created by createViewportElement
      if (this.container) {
        const primaryElement = this.container.querySelector('#primary-volume-viewport');
        if (primaryElement && primaryElement.parentNode) {
          primaryElement.parentNode.removeChild(primaryElement);
        }
        
        const fusionElement = this.container.querySelector('#fusion-volume-viewport');
        if (fusionElement && fusionElement.parentNode) {
          fusionElement.parentNode.removeChild(fusionElement);
        }
      }

      // Reset references
      this.primaryViewport = null;
      this.fusionViewport = null;
      this.container = null;
      this.renderingEngine = null;

      // Don't purge global cache - just clean up our specific resources
      // The global cache contains images used by the main viewer
      console.log('🚀 Volume Renderer: Cleanup complete (preserved global cache)');

      this.isInitialized = false;
      
    } catch (error) {
      console.error('Volume Renderer: Cleanup failed:', error);
    }
  }

  public isReady(): boolean {
    return this.isInitialized && !!this.renderingEngine;
  }
}

// Singleton instance
let volumeRenderer: VolumeRenderer | null = null;

/**
 * Get or create the volume renderer instance
 */
export function getVolumeRenderer(): VolumeRenderer {
  if (!volumeRenderer) {
    volumeRenderer = new VolumeRenderer();
  }
  return volumeRenderer;
}

/**
 * Check if volume rendering is available (async)
 */
export async function isVolumeRenderingAvailable(): Promise<boolean> {
  const renderer = getVolumeRenderer();
  return await renderer.ensureInitialized();
}

/**
 * Cleanup volume renderer resources
 */
export function cleanupVolumeRenderer(): void {
  if (volumeRenderer) {
    volumeRenderer.cleanup();
    volumeRenderer = null;
  }
}

/**
 * Extract slice data from image cache for volume assembly
 */
export function extractSliceDataFromCache(
  images: any[], 
  imageCache: Map<string, any>
): SliceData[] {
  const sliceData: SliceData[] = [];
  
  for (const image of images) {
    const cacheKey = image.sopInstanceUID || image.SOPInstanceUID;
    const cachedImage = imageCache.get(cacheKey);
    
    if (cachedImage && cachedImage.data) {
      sliceData.push({
        data: cachedImage.data,
        width: cachedImage.width,
        height: cachedImage.height,
        sopInstanceUID: cacheKey,
        sliceLocation: image.sliceLocation || image.parsedSliceLocation,
        imagePositionPatient: image.imagePositionPatient || image.parsedImagePosition,
        pixelSpacing: image.pixelSpacing || image.parsedPixelSpacing,
        windowCenter: image.windowCenter,
        windowWidth: image.windowWidth
      });
    }
  }
  
  console.log(`🚀 Volume Renderer: Extracted ${sliceData.length}/${images.length} slices from cache`);
  return sliceData;
}

/**
 * Convert image metadata to Cornerstone3D volume format using existing image IDs
 */
export function prepareVolumeImageIds(images: any[]): string[] {
  const imageIds = images.map((image, index) => {
    // Always use the actual loaded image ID to avoid cache misses
    if (image.imageId && typeof image.imageId === 'string') {
      return image.imageId; // ✅ Use existing loaded ID
    }
    
    // If no imageId, construct the same format the main loader uses
    const sopInstanceUID = image.sopInstanceUID || image.SOPInstanceUID;
    if (sopInstanceUID) {
      return `wadouri:/api/images/${encodeURIComponent(sopInstanceUID)}`;
    }
    
    // Last resort fallback
    return `wadouri:/api/images/synthetic-${index}`;
  });
  
  // Validate that we have real image IDs, not synthetic ones
  const realIds = imageIds.filter(id => !id.includes('synthetic'));
  console.log(`🚀 Volume Renderer: Prepared ${imageIds.length} image IDs (${realIds.length} real, ${imageIds.length - realIds.length} synthetic)`);
  
  if (realIds.length < imageIds.length * 0.9) {
    console.warn(`🚀 Volume Renderer: Warning - ${imageIds.length - realIds.length} synthetic IDs may cause loading issues`);
  }
  
  return imageIds;
}

