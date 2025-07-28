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
 * Check if GPU acceleration is available
 */
export function isGPUAccelerationAvailable(): boolean {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return !!gl;
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