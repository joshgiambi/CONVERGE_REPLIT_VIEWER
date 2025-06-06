import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Move, RotateCw, Maximize2 } from 'lucide-react';
import { DICOMSeries, DICOMImage, WindowLevel, createImageId } from '@/lib/dicom-utils';
import { cornerstoneConfig } from '@/lib/cornerstone-config';

interface OrthogonalViewerProps {
  series: DICOMSeries | null;
  windowLevel: WindowLevel;
}

interface ViewportInfo {
  name: string;
  icon: any;
  currentSlice: number;
  totalSlices: number;
  position: { x: number; y: number; z: number };
}

export function OrthogonalViewer({ series, windowLevel }: OrthogonalViewerProps) {
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  
  const [viewports, setViewports] = useState<Record<string, any>>({});
  const [viewportInfo, setViewportInfo] = useState<Record<string, ViewportInfo>>({
    axial: { name: 'Axial', icon: Move, currentSlice: 0, totalSlices: 0, position: { x: 0, y: 0, z: 0 } },
    sagittal: { name: 'Sagittal', icon: RotateCw, currentSlice: 0, totalSlices: 0, position: { x: 0, y: 0, z: 0 } },
    coronal: { name: 'Coronal', icon: Maximize2, currentSlice: 0, totalSlices: 0, position: { x: 0, y: 0, z: 0 } }
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    initializeViewports();
    
    return () => {
      // Cleanup viewports
      Object.values(viewports).forEach(element => {
        if (element && window.cornerstone) {
          try {
            window.cornerstone.disable(element);
          } catch (error) {
            console.warn('Error disabling viewport:', error);
          }
        }
      });
    };
  }, []);

  useEffect(() => {
    if (series && series.images.length > 0) {
      loadSeries(series);
    }
  }, [series]);

  useEffect(() => {
    applyWindowLevel();
  }, [windowLevel]);

  const initializeViewports = async () => {
    try {
      // Create placeholder viewports for now
      const elements = {
        axial: axialRef.current,
        sagittal: sagittalRef.current,
        coronal: coronalRef.current
      };

      const newViewports: Record<string, any> = {};
      Object.entries(elements).forEach(([key, element]) => {
        if (element) {
          newViewports[key] = element;
          // Add placeholder content
          element.style.background = 'linear-gradient(45deg, #1a1a1a 25%, #2d2d2d 25%, #2d2d2d 50%, #1a1a1a 50%, #1a1a1a 75%, #2d2d2d 75%, #2d2d2d)';
          element.style.backgroundSize = '20px 20px';
        }
      });

      setViewports(newViewports);
    } catch (error) {
      console.error('Error initializing viewports:', error);
    }
  };

  const loadSeries = async (series: DICOMSeries) => {
    if (!series.images.length) return;
    
    setIsLoading(true);
    
    try {
      const cornerstone = cornerstoneConfig.getCornerstone();
      
      // Sort images by instance number
      const sortedImages = [...series.images].sort((a, b) => 
        (a.instanceNumber || 0) - (b.instanceNumber || 0)
      );
      
      // Load first image in each viewport (for now, same image in all views)
      // In a full implementation, you would reconstruct sagittal and coronal from axial slices
      const firstImage = sortedImages[0];
      const imageId = createImageId(firstImage.sopInstanceUID);
      
      for (const [viewportName, element] of Object.entries(viewports)) {
        if (element) {
          try {
            const image = await cornerstone.loadImage(imageId);
            cornerstone.displayImage(element, image);
            
            // Apply initial window/level if available
            if (firstImage.windowCenter && firstImage.windowWidth) {
              const viewport = cornerstone.getViewport(element);
              viewport.voi.windowCenter = parseFloat(firstImage.windowCenter);
              viewport.voi.windowWidth = parseFloat(firstImage.windowWidth);
              cornerstone.setViewport(element, viewport);
            }
            
            updateViewportInfo(viewportName, element);
          } catch (error) {
            console.error(`Error loading image in ${viewportName}:`, error);
          }
        }
      }
      
      // Update viewport info with series data
      setViewportInfo(prev => ({
        ...prev,
        axial: { ...prev.axial, currentSlice: 1, totalSlices: sortedImages.length },
        sagittal: { ...prev.sagittal, currentSlice: 1, totalSlices: sortedImages.length },
        coronal: { ...prev.coronal, currentSlice: 1, totalSlices: sortedImages.length }
      }));
      
    } catch (error) {
      console.error('Error loading series:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateViewportInfo = (viewportName: string, element: HTMLElement) => {
    try {
      const cornerstone = cornerstoneConfig.getCornerstone();
      const viewport = cornerstone.getViewport(element);
      
      if (viewport) {
        setViewportInfo(prev => ({
          ...prev,
          [viewportName]: {
            ...prev[viewportName],
            position: {
              x: Math.round(viewport.translation?.x || 0),
              y: Math.round(viewport.translation?.y || 0),
              z: Math.round(viewport.scale || 1 * 100) // Convert scale to percentage
            }
          }
        }));
      }
    } catch (error) {
      console.warn('Error updating viewport info:', error);
    }
  };

  const applyWindowLevel = () => {
    const cornerstone = cornerstoneConfig.getCornerstone();
    if (!cornerstone) return;

    Object.values(viewports).forEach(element => {
      if (element) {
        try {
          const viewport = cornerstone.getViewport(element);
          if (viewport) {
            viewport.voi.windowWidth = windowLevel.window;
            viewport.voi.windowCenter = windowLevel.level;
            cornerstone.setViewport(element, viewport);
          }
        } catch (error) {
          console.warn('Error applying window/level:', error);
        }
      }
    });
  };

  const renderViewport = (ref: React.RefObject<HTMLDivElement>, viewportName: string) => {
    const info = viewportInfo[viewportName];
    const IconComponent = info.icon;

    return (
      <div className="relative h-full">
        <div
          ref={ref}
          className="w-full h-full bg-black border-2 border-dicom-gray rounded-lg overflow-hidden"
          style={{ minHeight: '300px' }}
        />
        
        {/* Viewport Label */}
        <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm border border-dicom-yellow/30 px-3 py-1 rounded text-sm text-white">
          <div className="flex items-center">
            <IconComponent className="w-4 h-4 mr-2 text-dicom-yellow" />
            {info.name}
          </div>
        </div>
        
        {/* Slice Counter */}
        <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm border border-dicom-yellow/30 px-3 py-1 rounded text-xs font-mono text-dicom-yellow">
          Slice: {info.currentSlice}/{info.totalSlices}
        </div>
        
        {/* Position Info */}
        <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm border border-dicom-yellow/30 px-3 py-1 rounded text-xs font-mono text-gray-300">
          <div className="space-y-1">
            <div>Position: {info.position.x}, {info.position.y}</div>
            <div>Zoom: {info.position.z}%</div>
          </div>
        </div>
        
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="bg-dicom-dark rounded-lg p-4 flex items-center">
              <div className="w-5 h-5 border border-dicom-yellow border-t-transparent rounded-full animate-spin mr-3" />
              <span className="text-dicom-yellow">Loading...</span>
            </div>
          </div>
        )}
        
        {/* Crosshair for coronal view */}
        {viewportName === 'coronal' && !isLoading && (
          <div className="absolute inset-0 pointer-events-none">
            <div 
              className="absolute w-full h-0.5 bg-dicom-yellow/50" 
              style={{ top: '50%', transform: 'translateY(-50%)' }} 
            />
            <div 
              className="absolute h-full w-0.5 bg-dicom-yellow/50" 
              style={{ left: '50%', transform: 'translateX(-50%)' }} 
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
      {/* Axial View */}
      <Card className="bg-dicom-dark/50 border-dicom-gray p-2">
        {renderViewport(axialRef, 'axial')}
      </Card>

      {/* Sagittal View */}
      <Card className="bg-dicom-dark/50 border-dicom-gray p-2">
        {renderViewport(sagittalRef, 'sagittal')}
      </Card>

      {/* Coronal View - Full Width */}
      <Card className="md:col-span-2 bg-dicom-dark/50 border-dicom-gray p-2">
        {renderViewport(coronalRef, 'coronal')}
      </Card>
    </div>
  );
}
