import * as cornerstone3D from '@cornerstonejs/core';
import {
  PanTool,
  ZoomTool,
  StackScrollTool,
  ToolGroupManager,
  Enums as cornerstoneToolEnums,
  addTool,
} from '@cornerstonejs/tools';
import type { VolumeStackSlice } from './cornerstone3d-adapter';
import { initializeCornerstone3D, registerVolumeStacks, setCornerstoneMetadata } from './cornerstone3d-adapter';

export interface FusionManagerOptions {
  element: HTMLDivElement;
  renderingEngineId?: string;
  viewportId?: string;
  ctSlices: VolumeStackSlice[];
  fusionSlices?: VolumeStackSlice[];
  fusionOpacity?: number;
  onSliceChanged?: (index: number) => void;
}

export interface FusionManagerHandle {
  renderingEngineId: string;
  viewportId: string;
  updateSlice: (index: number) => Promise<void>;
  updateOpacity: (alpha: number) => void;
  setFusionVisibility: (visible: boolean) => void;
  dispose: () => void;
  isFusionEnabled: boolean;
}

const DEFAULT_RENDERING_ENGINE_ID = 'fusion-rendering-engine';
const DEFAULT_VIEWPORT_ID_PREFIX = 'fusion-stack-viewport';
const FUSION_ACTOR_UID = 'fusion-overlay-actor';

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export async function synchronizeActors(options: FusionManagerOptions): Promise<FusionManagerHandle> {
  const {
    element,
    ctSlices,
    fusionSlices = [],
    fusionOpacity = 0.6,
    onSliceChanged,
  } = options;

  if (!element) {
    throw new Error('Fusion manager requires a container element');
  }

  if (!ctSlices.length) {
    throw new Error('Fusion manager requires CT stack slices');
  }

  const hasFusion = fusionSlices.length > 0;
  const renderingEngineId = options.renderingEngineId ?? DEFAULT_RENDERING_ENGINE_ID;
  const viewportId = options.viewportId ?? `${DEFAULT_VIEWPORT_ID_PREFIX}-${Date.now()}`;

  const initialized = await initializeCornerstone3D();
  if (!initialized) {
    throw new Error('Cornerstone3D failed to initialize');
  }

  let renderingEngine = cornerstone3D.getRenderingEngine(renderingEngineId);
  if (!renderingEngine) {
    renderingEngine = new cornerstone3D.RenderingEngine(renderingEngineId);
  }

  const viewportInput = {
    viewportId,
    type: cornerstone3D.Enums.ViewportType.STACK,
    element,
    defaultOptions: {
      background: [0, 0, 0] as [number, number, number],
    },
  };

  renderingEngine.enableElement(viewportInput);

  const { viewport, actors } = registerVolumeStacks({
    renderingEngineId,
    viewportId,
    ctSlices,
    fusionSlices,
  });

  const stackViewport = viewport as any;

  const ctImageIds = actors.ct.imageIds;
  const fusionImageIds = actors.fusion?.imageIds || [];
  let currentSliceIndex = 0;
  let currentOpacity = clampOpacity(fusionOpacity);
  let fusionActorEntry: any | null = null;
  let suppressSliceEvent = false;
  let fusionStackLoaded = false;

  try {
    addTool?.(PanTool);
    addTool?.(ZoomTool);
    addTool?.(StackScrollTool);
  } catch (error) {
    // Tools may already be registered; ignore
  }

  const toolGroupId = `${viewportId}-tool-group`;
  let toolGroup = ToolGroupManager?.getToolGroup(toolGroupId);
  if (!toolGroup && ToolGroupManager) {
    toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
    toolGroup?.addTool(PanTool.toolName);
    toolGroup?.addTool(ZoomTool.toolName);
    toolGroup?.addTool(StackScrollTool.toolName);
    toolGroup?.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: cornerstoneToolEnums?.MouseBindings.Primary }],
    });
    toolGroup?.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: cornerstoneToolEnums?.MouseBindings.Secondary }],
    });
    toolGroup?.setToolActive(StackScrollTool.toolName);
  }
  toolGroup?.addViewport?.(viewportId, renderingEngineId);

  const ensureStack = async () => {
    if (typeof stackViewport.setStack === 'function') {
      try {
        await stackViewport.setStack(ctImageIds, 0);
      } catch (error) {
        console.warn('Cornerstone fusion manager: setStack failed, retrying without options', error);
        await stackViewport.setStack(ctImageIds);
      }
    }
    renderingEngine.render();
  };

  const loadImage = async (imageId: string) => {
    try {
      const loadResult = cornerstone3D.imageLoader.loadAndCacheImage(imageId);
      const imagePromise = (loadResult as any)?.promise ?? loadResult;
      if (imagePromise?.then) {
        return await imagePromise;
      }
      return imagePromise ?? null;
    } catch (error) {
      console.error('Cornerstone fusion manager: failed to queue image load', error);
      throw error;
    }
  };

  const ensureImageMetadata = (imageId: string, image: any | null | undefined) => {
    if (!imageId) return;
    const meta = cornerstone3D.metaData;
    const rows = image?.rows ?? image?.height ?? 0;
    const columns = image?.columns ?? image?.width ?? 0;
    const pixelSpacing = Array.isArray(image?.pixelSpacing) && image?.pixelSpacing.length === 2
      ? image.pixelSpacing
      : [1, 1];
    const orientation = Array.isArray(image?.imageOrientationPatient) && image?.imageOrientationPatient.length === 6
      ? image.imageOrientationPatient
      : [1, 0, 0, 0, 1, 0];
    const position = Array.isArray(image?.imagePositionPatient) && image?.imagePositionPatient.length === 3
      ? image.imagePositionPatient
      : [0, 0, 0];
    const frameOfReferenceUID = image?.frameOfReferenceUID ?? 'superbeam-fusion-for';
    const instanceNumber = Number.isFinite(image?.instanceNumber) ? Number(image.instanceNumber) : 1;
    const slope = Number.isFinite(image?.slope) ? Number(image.slope) : Number(image?.rescaleSlope ?? 1);
    const intercept = Number.isFinite(image?.intercept) ? Number(image.intercept) : Number(image?.rescaleIntercept ?? 0);
    const modules: Record<string, any> = {};

    if (!meta.get?.('imagePixelModule', imageId)) {
      modules.imagePixelModule = {
        rows,
        columns,
        samplesPerPixel: 1,
        photometricInterpretation: 'MONOCHROME2',
        bitsAllocated: 32,
        bitsStored: 32,
        highBit: 31,
        pixelRepresentation: 1,
      };
    }

    if (!meta.get?.('imagePlaneModule', imageId)) {
      modules.imagePlaneModule = {
        frameOfReferenceUID,
        rows,
        columns,
        imageOrientationPatient: orientation,
        imagePositionPatient: position,
        pixelSpacing,
        sliceThickness: image?.sliceThickness ?? 1,
      };
    }

    if (!meta.get?.('generalSeriesModule', imageId)) {
      modules.generalSeriesModule = {
        modality: image?.modality ?? 'PT',
        seriesInstanceUID: frameOfReferenceUID,
      };
    }

    if (!meta.get?.('generalImageModule', imageId)) {
      modules.generalImageModule = {
        instanceNumber,
      };
    }

    if (!meta.get?.('modalityLutModule', imageId)) {
      modules.modalityLutModule = {
        rescaleSlope: slope ?? 1,
        rescaleIntercept: intercept ?? 0,
      };
    }

    if (Object.keys(modules).length) {
      setCornerstoneMetadata(imageId, modules);
    }
  };

  const removeFusionActor = () => {
    if (fusionActorEntry && typeof stackViewport.removeActors === 'function') {
      try {
        stackViewport.removeActors([FUSION_ACTOR_UID]);
      } catch (error) {
        console.warn('Cornerstone fusion manager: unable to remove fusion actor', error);
      }
    }
    fusionActorEntry = null;
  };

  const applyOpacity = (entry: any) => {
    if (!entry?.actor?.getProperty) return;
    const property = entry.actor.getProperty();
    if (property.setOpacity) {
      property.setOpacity(currentOpacity);
    }
    if (property.setInterpolationTypeToLinear) {
      property.setInterpolationTypeToLinear();
    }
  };

  const loadFusionStack = async () => {
    if (!fusionImageIds.length || fusionStackLoaded) return;

    try {
      // Pre-load all fusion images and metadata
      console.log(`Loading fusion stack with ${fusionImageIds.length} images`);
      for (const imageId of fusionImageIds) {
        const image = await loadImage(imageId);
        ensureImageMetadata(imageId, image ?? undefined);
      }

      // Add entire fusion stack as overlay images
      if (typeof stackViewport.addImages === 'function') {
        const fusionImages = fusionImageIds.map(imageId => ({
          imageId,
          actorUID: FUSION_ACTOR_UID,
          visibility: true,
        }));
        
        stackViewport.addImages(fusionImages);
        fusionActorEntry = stackViewport.getActor?.(FUSION_ACTOR_UID) ?? null;
        applyOpacity(fusionActorEntry);
        fusionStackLoaded = true;
        console.log('Fusion stack loaded successfully');
        renderingEngine.render();
      }
    } catch (error) {
      console.error('Failed to load fusion stack:', error);
    }
  };

  const setFusionVisibility = (visible: boolean) => {
    if (!fusionActorEntry) return;
    
    try {
      if (fusionActorEntry.actor?.setVisibility) {
        fusionActorEntry.actor.setVisibility(visible);
      } else if (fusionActorEntry.setVisibility) {
        fusionActorEntry.setVisibility(visible);
      }
      renderingEngine.render();
    } catch (error) {
      console.warn('Failed to set fusion visibility:', error);
    }
  };

  const removeFusionStack = () => {
    if (fusionActorEntry && typeof stackViewport.removeActors === 'function') {
      try {
        stackViewport.removeActors([FUSION_ACTOR_UID]);
      } catch (error) {
        console.warn('Cornerstone fusion manager: unable to remove fusion actor', error);
      }
    }
    fusionActorEntry = null;
    fusionStackLoaded = false;
  };

  await ensureStack();
  
  // Load fusion stack upfront if available
  if (fusionImageIds.length > 0) {
    await loadFusionStack();
  }

  const handleStackNewImage = (event: Event) => {
    const detail = (event as CustomEvent<any>).detail;
    const targetIndex = detail?.imageIdIndex ?? detail?.imageIndex ?? currentSliceIndex;
    currentSliceIndex = targetIndex;
    
    // DON'T destroy fusion overlay - it's now a persistent stack
    // Just notify of slice change
    if (!suppressSliceEvent) {
      onSliceChanged?.(targetIndex);
    }
  };

  const handleCameraOrVOI = () => {
    renderingEngine.render();
  };

  element.addEventListener(cornerstone3D.EVENTS.STACK_NEW_IMAGE, handleStackNewImage);
  element.addEventListener(cornerstone3D.EVENTS.CAMERA_MODIFIED, handleCameraOrVOI);
  element.addEventListener(cornerstone3D.EVENTS.VOI_MODIFIED, handleCameraOrVOI);

  const updateSlice = async (index: number) => {
    const safeIndex = Math.max(0, Math.min(index, ctImageIds.length - 1));
    if (safeIndex === currentSliceIndex) {
      return;
    }

    try {
      suppressSliceEvent = true;
      if (typeof stackViewport.setImageIdIndex === 'function') {
        await stackViewport.setImageIdIndex(safeIndex);
      } else {
        await stackViewport.setStack(ctImageIds, safeIndex);
      }
      // Fusion stack automatically follows the primary stack - no manual sync needed
      renderingEngine.render();
    } catch (error) {
      console.warn('Cornerstone fusion manager: updateSlice failed', error);
    } finally {
      suppressSliceEvent = false;
    }
    currentSliceIndex = safeIndex;
  };

  const updateOpacity = (alpha: number) => {
    currentOpacity = clampOpacity(alpha);
    if (!fusionActorEntry) return;
    applyOpacity(fusionActorEntry);
    renderingEngine.render();
  };

  const dispose = () => {
    element.removeEventListener(cornerstone3D.EVENTS.STACK_NEW_IMAGE, handleStackNewImage);
    element.removeEventListener(cornerstone3D.EVENTS.CAMERA_MODIFIED, handleCameraOrVOI);
    element.removeEventListener(cornerstone3D.EVENTS.VOI_MODIFIED, handleCameraOrVOI);
    removeFusionStack();
    try {
      const toolGroup = ToolGroupManager?.getToolGroup(`${viewportId}-tool-group`);
      toolGroup?.removeViewports?.(renderingEngineId, viewportId);
    } catch (error) {
      console.warn('Cornerstone fusion manager: tool group cleanup warning', error);
    }
    try {
      const renderingEngine = cornerstone3D.getRenderingEngine(renderingEngineId);
      renderingEngine?.disableElement?.(viewportId);
    } catch (error) {
      console.warn('Cornerstone fusion manager: rendering engine cleanup warning', error);
    }
  };

  return {
    renderingEngineId,
    viewportId,
    updateSlice,
    updateOpacity,
    dispose,
    isFusionEnabled: hasFusion,
    setFusionVisibility,
  };
}
