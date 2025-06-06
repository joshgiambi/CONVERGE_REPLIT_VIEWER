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
      // Sort images by instance number
      const sortedImages = [...series.images].sort((a, b) => 
        (a.instanceNumber || 0) - (b.instanceNumber || 0)
      );
      
      // Create simulated medical imaging patterns for each viewport
      Object.entries(viewports).forEach(([viewportName, element]) => {
        if (element) {
          // Clear any existing content
          element.innerHTML = '';
          
          // Create a canvas for each viewport showing different anatomical views
          const canvas = document.createElement('canvas');
          canvas.width = element.clientWidth || 512;
          canvas.height = element.clientHeight || 512;
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.objectFit = 'contain';
          
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Create different patterns for each view
            drawMedicalPattern(ctx, canvas.width, canvas.height, viewportName, series.modality);
          }
          
          element.appendChild(canvas);
        }
      });
      
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

  const drawMedicalPattern = (ctx: CanvasRenderingContext2D, width: number, height: number, viewType: string, modality: string) => {
    // Clear canvas with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Draw different anatomical patterns based on view type
    ctx.strokeStyle = '#FFD700';
    ctx.fillStyle = '#333333';
    
    if (viewType === 'axial') {
      // Axial view - circular cross-section
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.min(width, height) * 0.3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      
      // Inner structures
      ctx.fillStyle = '#666666';
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.min(width, height) * 0.15, 0, 2 * Math.PI);
      ctx.fill();
    } else if (viewType === 'sagittal') {
      // Sagittal view - side profile
      ctx.fillStyle = '#444444';
      ctx.fillRect(centerX - width * 0.3, centerY - height * 0.4, width * 0.6, height * 0.8);
      ctx.strokeRect(centerX - width * 0.3, centerY - height * 0.4, width * 0.6, height * 0.8);
      
      // Spine representation
      ctx.fillStyle = '#888888';
      for (let i = 0; i < 8; i++) {
        const y = centerY - height * 0.3 + (i * height * 0.08);
        ctx.fillRect(centerX + width * 0.2, y, width * 0.05, height * 0.03);
      }
    } else if (viewType === 'coronal') {
      // Coronal view - front/back view
      ctx.fillStyle = '#444444';
      ctx.fillRect(centerX - width * 0.4, centerY - height * 0.4, width * 0.8, height * 0.8);
      ctx.strokeRect(centerX - width * 0.4, centerY - height * 0.4, width * 0.8, height * 0.8);
      
      // Symmetrical structures
      ctx.fillStyle = '#666666';
      ctx.fillRect(centerX - width * 0.3, centerY - height * 0.2, width * 0.25, height * 0.4);
      ctx.fillRect(centerX + width * 0.05, centerY - height * 0.2, width * 0.25, height * 0.4);
    }
    
    // Add modality-specific details
    if (modality === 'CT') {
      ctx.strokeStyle = '#FFFF00';
      ctx.lineWidth = 1;
      // Add grid lines for CT
      for (let i = 1; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo(i * width / 10, 0);
        ctx.lineTo(i * width / 10, height);
        ctx.globalAlpha = 0.1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * height / 10);
        ctx.lineTo(width, i * height / 10);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  };

  const updateViewportInfo = (viewportName: string, element: HTMLElement) => {
    // For now, just update with placeholder values
    setViewportInfo(prev => ({
      ...prev,
      [viewportName]: {
        ...prev[viewportName],
        position: {
          x: 0,
          y: 0,
          z: 100
        }
      }
    }));
  };

  const applyWindowLevel = () => {
    // Window/level changes would be applied here in a full implementation
    console.log('Window level changed:', windowLevel);
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
