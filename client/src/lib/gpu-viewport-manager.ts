/**
 * GPU Viewport Manager - OHIF-style Cornerstone3D integration
 * This manages the GPU viewport separately from the CPU canvas
 */

interface GPUViewportState {
  renderingEngine: any;
  viewport: any;
  element: HTMLDivElement;
  isActive: boolean;
}

const gpuViewports = new Map<string, GPUViewportState>();

export async function createOrUpdateGPUViewport(
  containerElement: HTMLElement,
  imageData: {
    data: Float32Array;
    width: number;
    height: number;
    sopInstanceUID: string;
  },
  windowLevel: { width: number; center: number },
  ctTransform: { scale: number; offsetX: number; offsetY: number }
): Promise<boolean> {
  // Check if Cornerstone3D is properly initialized
  const cornerstone3D = (window as any).cornerstone3D;
  if (!cornerstone3D || !cornerstone3D.RenderingEngine || !cornerstone3D.Enums || !cornerstone3D.cache) {
    console.error('Cornerstone3D not fully initialized:', {
      cornerstone3D: !!cornerstone3D,
      RenderingEngine: !!(cornerstone3D?.RenderingEngine),
      Enums: !!(cornerstone3D?.Enums),
      cache: !!(cornerstone3D?.cache)
    });
    return false;
  }

  const viewportId = 'superbeam-gpu-viewport';
  const renderingEngineId = 'superbeam-gpu-engine';

  try {
    // Get or create GPU viewport state
    let viewportState = gpuViewports.get(viewportId);

    if (!viewportState) {
      // Create GPU viewport div (OHIF style)
      const gpuElement = document.createElement('div');
      gpuElement.className = 'gpu-viewport';
      gpuElement.id = viewportId;
      gpuElement.style.width = '1280px';
      gpuElement.style.height = '1280px';
      gpuElement.style.position = 'absolute';
      gpuElement.style.top = '0';
      gpuElement.style.left = '0';
      gpuElement.style.zIndex = '10'; // Ensure GPU viewport is above canvas
      gpuElement.style.pointerEvents = 'none'; // Allow interactions to pass through
      gpuElement.style.backgroundColor = 'black'; // Ensure background is visible
      
      // Add to container
      containerElement.appendChild(gpuElement);
      
      // Force layout calculation
      gpuElement.offsetHeight; // Force reflow
      
      const rect = gpuElement.getBoundingClientRect();
      console.log('GPU viewport element dimensions:', {
        width: rect.width,
        height: rect.height,
        offsetWidth: gpuElement.offsetWidth,
        offsetHeight: gpuElement.offsetHeight
      });

      // Create rendering engine
      const renderingEngineId = `gpu-engine-${Date.now()}`; // Unique ID
      const renderingEngine = new cornerstone3D.RenderingEngine(renderingEngineId);

      // Enable the element with explicit dimensions
      const viewportInput = {
        viewportId,
        type: cornerstone3D.Enums.ViewportType.STACK,
        element: gpuElement,
        defaultOptions: {
          background: [0, 0, 0] as [number, number, number],
          displayArea: {
            imageArea: [1.0, 1.0],
            imageCanvasPoint: {
              imagePoint: [0.5, 0.5],
              canvasPoint: [0.5, 0.5]
            }
          }
        },
      };

      renderingEngine.enableElement(viewportInput);
      const viewport = renderingEngine.getViewport(viewportId);
      
      // Force resize with timeout to ensure DOM is ready
      setTimeout(() => {
        renderingEngine.resize();
        viewport.render();
      }, 100);

      viewportState = {
        renderingEngine,
        viewport,
        element: gpuElement,
        isActive: true
      };

      gpuViewports.set(viewportId, viewportState);
    }

    // Create image ID
    const imageId = `wadouri:${imageData.sopInstanceUID}`;

    // Store image in cache
    const cache = cornerstone3D.cache;
    
    // Create a proper image object for Cornerstone3D
    const pixelData = imageData.data;
    const sizeInBytes = pixelData.byteLength;
    
    const image = {
      imageId,
      rows: imageData.height,
      columns: imageData.width,
      height: imageData.height,
      width: imageData.width,
      color: false,
      windowCenter: windowLevel.center,
      windowWidth: windowLevel.width,
      pixelSpacing: [1, 1],
      getPixelData: () => pixelData,
      minPixelValue: Math.min(...Array.from(pixelData.slice(0, 1000))), // Sample for performance
      maxPixelValue: Math.max(...Array.from(pixelData.slice(0, 1000))),
      sizeInBytes: sizeInBytes,
      invert: false,
      intercept: 0,
      slope: 1,
    };

    // Check if image is already in cache
    const cachedImage = cache.getImageLoadObject(imageId);
    if (!cachedImage) {
      // Put image in cache
      cache.putImageLoadObject(imageId, {
        promise: Promise.resolve(image),
      });
    }

    // Set the stack
    await viewportState.viewport.setStack([imageId], 0);

    // Apply window/level
    viewportState.viewport.setProperties({
      voiRange: {
        lower: windowLevel.center - windowLevel.width / 2,
        upper: windowLevel.center + windowLevel.width / 2,
      },
    });
    
    // Force render after setting stack
    viewportState.viewport.render();

    // Apply zoom and pan
    const camera = viewportState.viewport.getCamera();
    if (camera && ctTransform) {
      // Apply zoom
      camera.parallelScale = camera.parallelScale / ctTransform.scale;
      
      // Apply pan
      camera.focalPoint = [
        -ctTransform.offsetX / ctTransform.scale,
        -ctTransform.offsetY / ctTransform.scale,
        camera.focalPoint[2]
      ];
      
      viewportState.viewport.setCamera(camera);
    }

    // Render
    viewportState.viewport.render();

    // Show GPU viewport
    viewportState.element.style.display = 'block';
    
    console.log('GPU viewport rendering complete:', {
      viewportId,
      imageId,
      dimensions: `${imageData.width}x${imageData.height}`,
      windowLevel: `W:${windowLevel.width} C:${windowLevel.center}`,
      transform: ctTransform
    });

    return true;
  } catch (error) {
    console.error('GPU viewport creation failed:', error);
    return false;
  }
}

export function hideGPUViewport(viewportId: string = 'superbeam-gpu-viewport') {
  const viewportState = gpuViewports.get(viewportId);
  if (viewportState && viewportState.element) {
    viewportState.element.style.display = 'none';
  }
}

export function showGPUViewport(viewportId: string = 'superbeam-gpu-viewport') {
  const viewportState = gpuViewports.get(viewportId);
  if (viewportState && viewportState.element) {
    viewportState.element.style.display = 'block';
  }
}

export function cleanupGPUViewports() {
  gpuViewports.forEach((state, id) => {
    try {
      if (state.renderingEngine && state.viewport) {
        state.renderingEngine.disableElement(id);
      }
      if (state.element && state.element.parentNode) {
        state.element.parentNode.removeChild(state.element);
      }
    } catch (error) {
      console.error('Error cleaning up GPU viewport:', error);
    }
  });
  gpuViewports.clear();
}