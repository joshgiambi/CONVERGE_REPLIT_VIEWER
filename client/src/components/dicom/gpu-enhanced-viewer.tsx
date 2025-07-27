// GPU-Enhanced DICOM Viewer Component
// Integrates Cornerstone3D GPU acceleration with existing medical imaging workflow

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { createGPUViewer, GPUAcceleratedViewer, PerformanceMetrics } from '@/lib/gpu-accelerated-viewer';
import { DICOMImage } from '@/lib/dicom-utils';

interface GPUEnhancedViewerProps {
  images: DICOMImage[];
  currentImageIndex: number;
  windowLevel: { center: number; width: number };
  zoom: number;
  panX: number;
  panY: number;
  onImageChange?: (index: number) => void;
  onWindowLevelChange?: (center: number, width: number) => void;
  onZoomChange?: (zoom: number) => void;
  onPanChange?: (x: number, y: number) => void;
  enablePerformanceMonitoring?: boolean;
}

export interface GPUEnhancedViewerRef {
  getPerformanceMetrics: () => PerformanceMetrics;
  enableVolumeRendering: () => void;
  enableMPR: () => void;
}

export const GPUEnhancedViewer = forwardRef<GPUEnhancedViewerRef, GPUEnhancedViewerProps>(({
  images,
  currentImageIndex,
  windowLevel,
  zoom,
  panX,
  panY,
  onImageChange,
  onWindowLevelChange,
  onZoomChange,
  onPanChange,
  enablePerformanceMonitoring = true
}, ref) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gpuViewer = useRef<GPUAcceleratedViewer | null>(null);
  const [isGPUEnabled, setIsGPUEnabled] = useState(false);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [gpuInitError, setGpuInitError] = useState<string | null>(null);

  // Initialize GPU viewer
  useEffect(() => {
    const initializeGPU = async () => {
      if (!canvasRef.current) return;

      try {
        console.log('🚀 Initializing GPU-accelerated DICOM viewer...');
        
        const viewer = createGPUViewer('gpu-viewport-1', canvasRef.current, {
          enableVolumeRendering: true,
          enableMPR: true,
          maxTextureSize: 4096,
          useSharedArrayBuffer: true,
          gpuMemoryLimit: 2048
        });

        await viewer.initialize();
        gpuViewer.current = viewer;
        setIsGPUEnabled(true);
        setGpuInitError(null);
        
        console.log('✅ GPU acceleration enabled successfully');
        
        // Start performance monitoring if enabled
        if (enablePerformanceMonitoring) {
          const updateMetrics = () => {
            if (gpuViewer.current) {
              setPerformanceMetrics(gpuViewer.current.getPerformanceMetrics());
            }
          };
          
          const interval = setInterval(updateMetrics, 1000);
          return () => clearInterval(interval);
        }
        
      } catch (error) {
        console.error('❌ GPU initialization failed:', error);
        setGpuInitError(error instanceof Error ? error.message : 'Unknown GPU error');
        setIsGPUEnabled(false);
        
        // Fallback to CPU rendering
        console.log('🔄 Falling back to CPU rendering');
      }
    };

    initializeGPU();

    return () => {
      if (gpuViewer.current) {
        gpuViewer.current.destroy();
      }
    };
  }, [enablePerformanceMonitoring]);

  // Load images when they change
  useEffect(() => {
    if (!gpuViewer.current || images.length === 0) return;

    const loadImages = async () => {
      try {
        const imageIds = images.map(img => `wadouri:/api/images/${img.sopInstanceUID}/raw`);
        await gpuViewer.current!.loadImages(imageIds);
        console.log(`📊 GPU-loaded ${images.length} images`);
      } catch (error) {
        console.error('Failed to load images with GPU:', error);
      }
    };

    loadImages();
  }, [images]);

  // Update window/level
  useEffect(() => {
    if (!gpuViewer.current) return;
    gpuViewer.current.setWindowLevel(windowLevel.center, windowLevel.width);
  }, [windowLevel]);

  // Update zoom
  useEffect(() => {
    if (!gpuViewer.current) return;
    gpuViewer.current.setZoom(zoom);
  }, [zoom]);

  // Update pan
  useEffect(() => {
    if (!gpuViewer.current) return;
    gpuViewer.current.setPan({ x: panX, y: panY });
  }, [panX, panY]);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    getPerformanceMetrics: () => {
      return gpuViewer.current?.getPerformanceMetrics() || {
        averageRenderTime: 0,
        averageImageLoadTime: 0,
        frameRate: 0,
        gpuMemoryUsage: 0,
        renderTimes: [],
        imageLoadTimes: []
      };
    },
    enableVolumeRendering: () => {
      gpuViewer.current?.enableVolumeRendering();
    },
    enableMPR: () => {
      gpuViewer.current?.enableMPR();
    }
  }));

  return (
    <div className="relative w-full h-full bg-black">
      {/* GPU Viewer Canvas */}
      <div 
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        style={{ 
          touchAction: 'none',
          userSelect: 'none'
        }}
      />
      
      {/* GPU Status Indicator */}
      <div className="absolute top-4 right-4 z-10">
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          isGPUEnabled 
            ? 'bg-green-900/80 text-green-300' 
            : 'bg-red-900/80 text-red-300'
        }`}>
          {isGPUEnabled ? '🚀 GPU' : '💻 CPU'}
        </div>
      </div>

      {/* Performance Metrics (Debug Mode) */}
      {enablePerformanceMonitoring && performanceMetrics && isGPUEnabled && (
        <div className="absolute top-4 left-4 z-10 bg-black/80 text-white p-3 rounded text-xs font-mono">
          <div>FPS: {performanceMetrics.frameRate.toFixed(1)}</div>
          <div>Render: {performanceMetrics.averageRenderTime.toFixed(1)}ms</div>
          <div>Load: {performanceMetrics.averageImageLoadTime.toFixed(1)}ms</div>
          <div>GPU Mem: {performanceMetrics.gpuMemoryUsage.toFixed(0)}MB</div>
        </div>
      )}

      {/* GPU Error Display */}
      {gpuInitError && (
        <div className="absolute bottom-4 left-4 right-4 z-10 bg-red-900/90 text-red-100 p-3 rounded">
          <div className="font-medium">GPU Acceleration Error:</div>
          <div className="text-sm mt-1">{gpuInitError}</div>
          <div className="text-xs mt-2 opacity-80">Falling back to CPU rendering</div>
        </div>
      )}

      {/* Image Counter */}
      {images.length > 0 && (
        <div className="absolute bottom-4 right-4 z-10 bg-black/80 text-white px-3 py-1 rounded text-sm">
          {currentImageIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
});

GPUEnhancedViewer.displayName = 'GPUEnhancedViewer';