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
import { initializeCornerstone3D, registerVolumeStacks } from './cornerstone3d-adapter';

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
  updateSlice: (index: number, fusionImageId?: string | null) => Promise<void>;
  updateOpacity: (alpha: number) => void;
  dispose: () => void;
  isFusionEnabled: boolean;
  updateFusionImage?: (imageId: string | null) => Promise<void>;
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
  let currentSliceIndex = 0;
  let currentOpacity = clampOpacity(fusionOpacity);
  let fusionActorEntry: any | null = null;
  let currentFusionImageId: string | null = null;
  let suppressSliceEvent = false;

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

    if (!meta.get?.('imagePixelModule', imageId)) {
      meta.add?.('imagePixelModule', imageId, {
        rows,
        columns,
        samplesPerPixel: 1,
        photometricInterpretation: 'MONOCHROME2',
        bitsAllocated: 32,
        bitsStored: 32,
        highBit: 31,
        pixelRepresentation: 1,
      });
    }

    if (!meta.get?.('imagePlaneModule', imageId)) {
      meta.add?.('imagePlaneModule', imageId, {
        frameOfReferenceUID,
        rows,
        columns,
        imageOrientationPatient: orientation,
        imagePositionPatient: position,
        pixelSpacing,
        sliceThickness: image?.sliceThickness ?? 1,
      });
    }

    if (!meta.get?.('generalSeriesModule', imageId)) {
      meta.add?.('generalSeriesModule', imageId, {
        modality: image?.modality ?? 'PT',
        seriesInstanceUID: frameOfReferenceUID,
      });
    }

    if (!meta.get?.('generalImageModule', imageId)) {
      meta.add?.('generalImageModule', imageId, {
        instanceNumber,
      });
    }

    if (!meta.get?.('modalityLutModule', imageId)) {
      meta.add?.('modalityLutModule', imageId, {
        rescaleSlope: slope ?? 1,
        rescaleIntercept: intercept ?? 0,
      });
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

  const addFusionActorForImage = async (imageId: string) => {
    const image = await loadImage(imageId);
    ensureImageMetadata(imageId, image ?? undefined);
    removeFusionActor();

    if (typeof stackViewport.addImages === 'function') {
      stackViewport.addImages([
        {
          imageId,
          actorUID: FUSION_ACTOR_UID,
          visibility: true,
        },
      ]);
      fusionActorEntry = stackViewport.getActor?.(FUSION_ACTOR_UID) ?? null;
      applyOpacity(fusionActorEntry);
      renderingEngine.render();
    }
  };

  const setFusionImage = async (imageId: string | null) => {
    if (!imageId) {
      currentFusionImageId = null;
      removeFusionActor();
      renderingEngine.render();
      return;
    }

    if (currentFusionImageId === imageId) {
      return;
    }

    currentFusionImageId = imageId;
    await addFusionActorForImage(imageId);
  };

  await ensureStack();
  if (actors.fusion?.imageIds?.length) {
    currentFusionImageId = actors.fusion.imageIds[0];
    await setFusionImage(currentFusionImageId);
  }

  const handleStackNewImage = (event: Event) => {
    const detail = (event as CustomEvent<any>).detail;
    const targetIndex = detail?.imageIdIndex ?? detail?.imageIndex ?? currentSliceIndex;
    currentSliceIndex = targetIndex;
    currentFusionImageId = null;
    removeFusionActor();
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

  const updateSlice = async (index: number, fusionImageId?: string | null) => {
    const safeIndex = Math.max(0, Math.min(index, ctImageIds.length - 1));
    if (safeIndex === currentSliceIndex && (fusionImageId ?? null) === currentFusionImageId) {
      return;
    }

    try {
      suppressSliceEvent = true;
      if (typeof stackViewport.setImageIdIndex === 'function') {
        await stackViewport.setImageIdIndex(safeIndex);
      } else {
        await stackViewport.setStack(ctImageIds, safeIndex);
      }
    } catch (error) {
      console.warn('Cornerstone fusion manager: updateSlice fallback to sync only', error);
    } finally {
      suppressSliceEvent = false;
    }
    currentSliceIndex = safeIndex;
    await setFusionImage(fusionImageId ?? currentFusionImageId);
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
    removeFusionActor();
    try {
      const toolGroup = cornerstone3DTools.ToolGroupManager?.getToolGroup(`${viewportId}-tool-group`);
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
    updateFusionImage: setFusionImage,
  };
}
