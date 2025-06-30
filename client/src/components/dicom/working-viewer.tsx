import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SimpleBrushTool } from './simple-brush-tool';

interface WorkingViewerProps {
  seriesId: number;
  studyId?: number;
  windowLevel?: { window: number; level: number };
  onWindowLevelChange?: (windowLevel: { window: number; level: number }) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  rtStructures?: any;
  structureVisibility?: Map<number, boolean>;
  brushToolState?: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
  };
  selectedForEdit?: number | null;
  onBrushSizeChange?: (size: number) => void;
  onContourUpdate?: (updatedStructures: any) => void;
  contourSettings?: { width: number; opacity: number };
}

export function WorkingViewer({ 
  seriesId, 
  studyId, 
  windowLevel: externalWindowLevel, 
  onWindowLevelChange, 
  onZoomIn, 
  onZoomOut, 
  onResetZoom, 
  rtStructures: externalRTStructures, 
  structureVisibility: externalStructureVisibility,
  brushToolState,
  selectedForEdit,
  onBrushSizeChange,
  onContourUpdate,
  contourSettings
}: WorkingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use external RT structures if provided, otherwise load our own
  const [localRTStructures, setLocalRTStructures] = useState(externalRTStructures);
  const rtStructures = localRTStructures || externalRTStructures;
  const structureVisibility = externalStructureVisibility || new Map();
  const [showStructures, setShowStructures] = useState(true);
  const [renderTrigger, setRenderTrigger] = useState(0);

  // Update local structures when external ones change
  useEffect(() => {
    setLocalRTStructures(externalRTStructures);
  }, [externalRTStructures]);

  // No longer need to load RT structures here - handled by parent component
  // Convert external window/level format to internal width/center format
  const currentWindowLevel = externalWindowLevel 
    ? { width: externalWindowLevel.window, center: externalWindowLevel.level }
    : { width: 400, center: 40 };

  // Function to update external window/level when internal changes
  const updateWindowLevel = (newWindowLevel: { width: number; center: number }) => {
    if (onWindowLevelChange) {
      onWindowLevelChange({ window: newWindowLevel.width, level: newWindowLevel.center });
    }
  };
  const [imageCache, setImageCache] = useState<Map<string, { data: Float32Array, width: number, height: number }>>(new Map());
  const [isPreloading, setIsPreloading] = useState(false);
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);


  useEffect(() => {
    loadImages();
  }, [seriesId]);

  useEffect(() => {
    if (images.length > 0 && !isPreloading) {
      displayCurrentImage();
      // Load metadata for current image
      const currentImage = images[currentIndex];
      if (currentImage?.id) {
        loadImageMetadata(currentImage.id);
      }
    }
  }, [images, currentIndex, currentWindowLevel, isPreloading]);

  const loadImages = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`/api/series/${seriesId}/images`);
      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.statusText}`);
      }
      
      const seriesImages = await response.json();
      
      // First parse DICOM metadata for proper spatial ordering
      const imagesWithMetadata = await Promise.all(seriesImages.map(async (img: any) => {
        try {
          const response = await fetch(`/api/images/${img.sopInstanceUID}`);
          const arrayBuffer = await response.arrayBuffer();
          
          if (!window.dicomParser) {
            await loadDicomParser();
          }
          
          const byteArray = new Uint8Array(arrayBuffer);
          const dataSet = window.dicomParser.parseDicom(byteArray);
          
          // Extract spatial metadata
          const sliceLocation = dataSet.floatString('x00201041');
          const imagePosition = dataSet.string('x00200032');
          const instanceNumber = dataSet.intString('x00200013');
          
          // Parse image position (z-coordinate is third value)
          let zPosition = null;
          if (imagePosition) {
            const positions = imagePosition.split('\\').map((p: string) => parseFloat(p));
            zPosition = positions[2];
          }
          
          return {
            ...img,
            parsedSliceLocation: sliceLocation ? parseFloat(sliceLocation) : null,
            parsedZPosition: zPosition,
            parsedInstanceNumber: instanceNumber ? parseInt(instanceNumber) : img.instanceNumber
          };
        } catch (error) {
          console.warn(`Failed to parse DICOM metadata for ${img.fileName}:`, error);
          return {
            ...img,
            parsedSliceLocation: null,
            parsedZPosition: null,
            parsedInstanceNumber: img.instanceNumber
          };
        }
      }));
      
      // Sort by spatial position - prefer slice location, then z-position, then instance number
      const sortedImages = imagesWithMetadata.sort((a: any, b: any) => {
        // Primary: slice location
        if (a.parsedSliceLocation !== null && b.parsedSliceLocation !== null) {
          return a.parsedSliceLocation - b.parsedSliceLocation;
        }
        
        // Secondary: z-position from image position
        if (a.parsedZPosition !== null && b.parsedZPosition !== null) {
          return a.parsedZPosition - b.parsedZPosition;
        }
        
        // Tertiary: instance number
        if (a.parsedInstanceNumber !== null && b.parsedInstanceNumber !== null) {
          return a.parsedInstanceNumber - b.parsedInstanceNumber;
        }
        
        // Final fallback: filename
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });
      
      setImages(sortedImages);
      setCurrentIndex(0);
      
      // Preload all images immediately
      preloadAllImages(sortedImages);
      
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const parseDicomImage = async (arrayBuffer: ArrayBuffer) => {
    try {
      // Load dicom-parser if not already loaded
      if (!window.dicomParser) {
        await loadDicomParser();
      }
      
      const byteArray = new Uint8Array(arrayBuffer);
      const dataSet = window.dicomParser.parseDicom(byteArray);
      
      // Extract image data
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        throw new Error('No pixel data found in DICOM file');
      }
      
      // Get image dimensions and parameters
      const rows = dataSet.uint16('x00280010') || 512;
      const cols = dataSet.uint16('x00280011') || 512;
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      
      // Get rescale parameters for Hounsfield Units
      const rescaleSlope = dataSet.floatString('x00281053') || 1;
      const rescaleIntercept = dataSet.floatString('x00281052') || -1024;
      
      if (bitsAllocated === 16) {
        const rawPixelArray = new Uint16Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        // Convert to Hounsfield Units
        const huPixelArray = new Float32Array(rawPixelArray.length);
        for (let i = 0; i < rawPixelArray.length; i++) {
          huPixelArray[i] = rawPixelArray[i] * rescaleSlope + rescaleIntercept;
        }
        
        return {
          data: huPixelArray,
          width: cols,
          height: rows
        };
      } else {
        throw new Error('Only 16-bit images supported');
      }
    } catch (error) {
      console.error('Error parsing DICOM image:', error);
      return null;
    }
  };

  const preloadAllImages = async (imageList: any[]) => {
    console.log('Starting to preload all images...');
    setIsPreloading(true);
    const newCache = new Map();
    
    // Load all images in parallel
    const loadPromises = imageList.map(async (image, index) => {
      try {
        const imageResponse = await fetch(`/api/images/${image.sopInstanceUID}`);
        if (!imageResponse.ok) {
          throw new Error(`Failed to load image ${index + 1}`);
        }
        
        const arrayBuffer = await imageResponse.arrayBuffer();
        const imageData = await parseDicomImage(arrayBuffer);
        
        if (imageData) {
          newCache.set(image.sopInstanceUID, imageData);
          console.log(`Preloaded image ${index + 1}/${imageList.length}`);
        }
      } catch (error) {
        console.warn(`Failed to preload image ${index + 1}:`, error);
      }
    });
    
    // Wait for all images to load
    await Promise.allSettled(loadPromises);
    setImageCache(newCache);
    setIsPreloading(false);
    console.log(`Preloading complete: ${newCache.size}/${imageList.length} images cached`);
  };

  const loadImageMetadata = async (imageId: number) => {
    try {
      const response = await fetch(`/api/images/${imageId}/metadata`);
      if (response.ok) {
        const metadata = await response.json();
        console.log('Image metadata:', metadata);
        setImageMetadata(metadata);
        
        // Debug Frame of Reference UID matching
        if (studyId) {
          const frameRefResponse = await fetch(`/api/studies/${studyId}/frame-references`);
          if (frameRefResponse.ok) {
            const frameRefs = await frameRefResponse.json();
            console.log('Frame of Reference UIDs by modality:', frameRefs);
            
            // Check if CT and RTSTRUCT have matching Frame of Reference UIDs
            if (frameRefs.CT && frameRefs.RTSTRUCT) {
              const ctFrame = frameRefs.CT.frameOfReferenceUID;
              const rtFrame = frameRefs.RTSTRUCT.frameOfReferenceUID;
              if (ctFrame !== rtFrame) {
                console.warn('Frame of Reference UID mismatch!');
                console.warn('CT Frame UID:', ctFrame);
                console.warn('RTSTRUCT Frame UID:', rtFrame);
              } else {
                console.log('Frame of Reference UIDs match - good alignment expected');
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load image metadata:', error);
    }
  };

  const displayCurrentImage = async () => {
    if (!canvasRef.current || images.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    try {
      const currentImage = images[currentIndex];
      const cacheKey = currentImage.sopInstanceUID;
      
      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      let imageData = imageCache.get(cacheKey);
      
      if (!imageData) {
        // Image should be preloaded, but fallback just in case
        console.warn('Image not in cache, this should not happen after preloading:', cacheKey);
        throw new Error('Image not available in cache');
      }
      
      // Keep fixed canvas size for consistent display
      canvas.width = 1024;
      canvas.height = 1024;
      
      // Render with current window/level settings
      render16BitImage(ctx, imageData.data, imageData.width, imageData.height);
      
      // Render RT structure overlays if available
      if (rtStructures && showStructures) {
        renderRTStructures(ctx, canvas, currentImage);
      }
      
    } catch (error: any) {
      console.error('Error displaying image:', error);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'red';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Error loading DICOM', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillText(error.message, canvas.width / 2, canvas.height / 2 + 10);
    }
  };

  const render16BitImage = (ctx: CanvasRenderingContext2D, pixelArray: Float32Array, width: number, height: number) => {
    // Create image data at original size
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Apply window/level settings
    const { width: windowWidth, center: windowCenter } = currentWindowLevel;
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;
    
    for (let i = 0; i < pixelArray.length; i++) {
      const pixelValue = pixelArray[i];
      
      // Apply windowing
      let normalizedValue;
      if (pixelValue <= min) {
        normalizedValue = 0;
      } else if (pixelValue >= max) {
        normalizedValue = 255;
      } else {
        normalizedValue = ((pixelValue - min) / windowWidth) * 255;
      }
      
      const gray = Math.max(0, Math.min(255, normalizedValue));
      
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    // Create a temporary canvas for the original image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    
    tempCtx.putImageData(imageData, 0, 0);
    
    // Scale and draw to the main canvas with zoom and pan
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    
    // Use 1:1 pixel scaling at default zoom for proper alignment
    const totalScale = zoom; // No base scaling - use original image size
    const scaledWidth = width * totalScale;
    const scaledHeight = height * totalScale;
    
    // Center the image on canvas with pan offset
    const x = (canvasWidth - scaledWidth) / 2 + panX;
    const y = (canvasHeight - scaledHeight) / 2 + panY;
    
    // Enable smooth scaling for better zoom quality while preserving medical image integrity
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
  };

  const render8BitImage = (ctx: CanvasRenderingContext2D, pixelArray: Uint8Array, width: number, height: number) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < pixelArray.length; i++) {
      const gray = pixelArray[i];
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const renderRTStructures = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, currentImage: any) => {
    if (!rtStructures || !currentImage) return;
    
    // Get current slice position
    const currentSlicePosition = currentImage.parsedSliceLocation || currentImage.parsedZPosition || (currentIndex + 1);
    const tolerance = 2.0; // mm tolerance for slice matching
    
    // Save context state
    ctx.save();
    
    // Apply global contour settings
    const lineWidth = contourSettings?.width || 2;
    const fillOpacity = (contourSettings?.opacity || 80) / 100;
    
    // Set line width (scaled for zoom)
    ctx.lineWidth = lineWidth / zoom;
    // Keep stroke at full opacity - only fill should be affected by opacity setting
    ctx.globalAlpha = 1;
    
    rtStructures.structures.forEach((structure: any) => {
      // Check if this structure is visible or if it's selected for editing
      const isVisible = structureVisibility.get(structure.roiNumber);
      const isSelectedForEdit = selectedForEdit === structure.roiNumber;
      
      // Always show selected structure for editing, even if visibility is off
      if (!isVisible && !isSelectedForEdit) return;
      
      // Use the structure's actual color, not hardcoded yellow
      const color = structure.color || [255, 255, 0]; // fallback to yellow only if no color
      const [r, g, b] = color;
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;
      
      structure.contours.forEach((contour: any) => {
        // Check if this contour is on the current slice
        if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance) {
          drawContour(ctx, contour, canvas.width, canvas.height, currentImage);
        }
      });
    });
    
    // Restore context state
    ctx.restore();
  };

  const drawContour = (ctx: CanvasRenderingContext2D, contour: any, canvasWidth: number, canvasHeight: number, currentImage: any) => {
    if (contour.points.length < 6) return; // Need at least 2 points (x,y,z each)
    
    ctx.beginPath();
    
    // Get image dimensions for proper scaling
    const imageWidth = currentImage?.width || 512;
    const imageHeight = currentImage?.height || 512;
    
    // Calculate base scaling to fill the entire canvas (same as image rendering)
    const baseScale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;
    
    // Apply pan offset to centering (same as image rendering)
    const imageX = (canvasWidth - scaledWidth) / 2 + panX;
    const imageY = (canvasHeight - scaledHeight) / 2 + panY;
    
    // Convert DICOM coordinates to canvas coordinates with proper scaling
    for (let i = 0; i < contour.points.length; i += 3) {
      const dicomX = contour.points[i];     // DICOM X coordinate
      const dicomY = contour.points[i + 1]; // DICOM Y coordinate
      
      // Coordinate transformation that matches the image scale
      const imageWidth = currentImage?.width || 512;
      const imageHeight = currentImage?.height || 512;
      
      // Proper DICOM coordinate transformation with affine matrix
      let pixelX, pixelY;
      
      if (imageMetadata && imageMetadata.imagePosition && imageMetadata.pixelSpacing && imageMetadata.imageOrientation) {
        // Parse DICOM spatial metadata
        const imagePosition = imageMetadata.imagePosition.split('\\').map(Number); // [x, y, z] origin
        const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);   // [row_spacing, col_spacing]
        const imageOrientation = imageMetadata.imageOrientation.split('\\').map(Number); // 6 values: row_cosines, col_cosines
        
        // Build affine transformation matrix from patient coordinates to voxel indices
        // ImageOrientationPatient contains direction cosines for rows and columns
        const rowCosX = imageOrientation[0];
        const rowCosY = imageOrientation[1]; 
        const rowCosZ = imageOrientation[2];
        const colCosX = imageOrientation[3];
        const colCosY = imageOrientation[4];
        const colCosZ = imageOrientation[5];
        
        // Transform from patient coordinates (mm) to voxel indices
        // Using inverse affine transformation
        const deltaX = dicomX - imagePosition[0];
        const deltaY = dicomY - imagePosition[1];
        
        // Project onto row and column directions, then divide by spacing
        const origPixelX = (deltaX * colCosX + deltaY * colCosY) / pixelSpacing[1]; // column index
        const origPixelY = (deltaX * rowCosX + deltaY * rowCosY) / pixelSpacing[0]; // row index
        
        // Apply 90-degree counter-rotation to fix sideways orientation
        pixelX = imageHeight - origPixelY; // Rotate coordinates
        pixelY = origPixelX;
        
        // Apply horizontal flip to correct mirrored appearance
        pixelX = imageWidth - pixelX;
        
        // Debug coordinate transformation for verification (can be removed in production)
        if (i === 0 && currentIndex === 0) {
          console.log('RT coordinate transformation verified:', {
            dicomCoords: [dicomX, dicomY],
            originalPixel: [origPixelX, origPixelY],
            finalPixel: [pixelX, pixelY]
          });
        }
      } else {
        // Enhanced fallback with better anatomical scaling
        const scale = 0.8; // Better scale for anatomical accuracy
        const centerX = imageWidth / 2;
        const centerY = imageHeight / 2;
        pixelX = centerX + (dicomX * scale);
        pixelY = centerY + (dicomY * scale);
        
        if (i === 0 && currentIndex === 0) {
          console.log('Using fallback transformation - metadata unavailable');
          console.log('DICOM coordinates:', dicomX, dicomY);
          console.log('Pixel coordinates:', pixelX, pixelY);
          console.log('Applied scale factor:', scale);
        }
      }
      
      // Apply same transformation as image (zoom and pan)
      const scaledWidth = imageWidth * zoom;
      const scaledHeight = imageHeight * zoom;
      const imageX = (canvasWidth - scaledWidth) / 2 + panX;
      const imageY = (canvasHeight - scaledHeight) / 2 + panY;
      
      const canvasX = imageX + (pixelX * zoom);
      const canvasY = imageY + (pixelY * zoom);
      
      if (i === 0) {
        ctx.moveTo(canvasX, canvasY);
      } else {
        ctx.lineTo(canvasX, canvasY);
      }
    }
    
    // Close the contour
    ctx.closePath();
    
    // Fill and stroke the contour
    ctx.fill();
    ctx.stroke();
  };

  const loadDicomParser = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.dicomParser) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load dicom-parser'));
      document.head.appendChild(script);
    });
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };



  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if brush tool is active - if so, skip pan functionality
    const isBrushActive = brushToolState?.isActive && brushToolState?.tool === 'brush';
    
    if (e.button === 0 && !isBrushActive) { // Left click for pan (disabled during brush mode)
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanX(panX);
      setLastPanY(panY);
    } else if (e.button === 2 && !isBrushActive) { // Right click for window/level (disabled during brush mode)
      const startX = e.clientX;
      const startY = e.clientY;
      const startWindow = currentWindowLevel.width;
      const startCenter = currentWindowLevel.center;

      const handleWindowLevelDrag = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        
        const newWidth = Math.max(1, startWindow + deltaX * 2);
        const newCenter = startCenter - deltaY * 1.5;
        
        updateWindowLevel({ width: newWidth, center: newCenter });
      };

      const handleWindowLevelEnd = (endEvent: MouseEvent) => {
        endEvent.preventDefault();
        document.removeEventListener('mousemove', handleWindowLevelDrag);
        document.removeEventListener('mouseup', handleWindowLevelEnd);
      };

      document.addEventListener('mousemove', handleWindowLevelDrag);
      document.addEventListener('mouseup', handleWindowLevelEnd);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip pan functionality if brush tool is active
    const isBrushActive = brushToolState?.isActive && brushToolState?.tool === 'brush';
    
    if (isDragging && !isBrushActive) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  };

  const handleCanvasMouseUp = () => {
    // Skip pan functionality if brush tool is active
    const isBrushActive = brushToolState?.isActive && brushToolState?.tool === 'brush';
    
    if (!isBrushActive) {
      setIsDragging(false);
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll for zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.max(0.1, Math.min(5, prev * zoomFactor)));
    } else {
      // Regular scroll for slice navigation
      if (e.deltaY > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(5, prev * 1.2));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(0.1, prev / 1.2));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  // Expose zoom functions to parent component via imperative handle
  useEffect(() => {
    // Always expose zoom functions for toolbar access
    (window as any).currentViewerZoom = {
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
      resetZoom: handleResetZoom
    };
    

    
    return () => {
      delete (window as any).currentViewerZoom;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToPrevious();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goToNext();
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentIndex, images]);

  if (isLoading) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          <p>Loading CT scan...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-red-400">
          <p className="mb-2">Error loading CT scan:</p>
          <p className="text-sm">{error}</p>
          <Button onClick={loadImages} className="mt-4 bg-indigo-600 hover:bg-indigo-700">
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-black border-indigo-800">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-indigo-700">
        <div className="flex items-center space-x-2">
          <Badge className="bg-indigo-900 text-indigo-200">
            CT Scan
          </Badge>
          {images.length > 0 && (
            <Badge variant="outline" className="border-indigo-600 text-indigo-300">
              {currentIndex + 1} / {images.length}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {rtStructures && (
            <Button
              size="sm"
              variant={showStructures ? "default" : "outline"}
              onClick={() => setShowStructures(!showStructures)}
              className="text-xs bg-green-600 hover:bg-green-700"
            >
              RT ({rtStructures.structures.length})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={goToNext}
            disabled={currentIndex === images.length - 1}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={1024}
            height={1024}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onWheel={handleCanvasWheel}
            onContextMenu={(e) => e.preventDefault()}
            className={`max-w-full max-h-full object-contain rounded ${
              brushToolState?.isActive && brushToolState?.tool === 'brush' 
                ? '' 
                : 'cursor-move'
            }`}
            style={{ 
              backgroundColor: 'black',
              imageRendering: 'auto',
              userSelect: 'none'
            }}
          />
          
          {/* SimpleBrushTool overlay */}
          {brushToolState?.isActive && brushToolState?.tool === 'brush' && selectedForEdit && (
            <SimpleBrushTool
              canvasRef={canvasRef}
              isActive={brushToolState.isActive}
              brushSize={brushToolState.brushSize}
              selectedStructure={selectedForEdit}
              rtStructures={rtStructures}
              currentSlicePosition={images.length > 0 && images[currentIndex] ? 
                (images[currentIndex].parsedSliceLocation ?? 
                 images[currentIndex].parsedZPosition ??
                 currentIndex) : 0
              }
              onContourUpdate={(updatedStructures) => {
                if (onContourUpdate) {
                  onContourUpdate(updatedStructures);
                } else {
                  console.log('Contour updated:', updatedStructures);
                }
              }}
              zoom={zoom}
              panX={panX}
              panY={panY}
              currentImage={images.length > 0 ? images[currentIndex] : null}
              imageMetadata={imageMetadata}
            />
          )}
          
          {/* Current Window/Level and Z position display */}
          <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
            <div>W:{Math.round(currentWindowLevel.width)} L:{Math.round(currentWindowLevel.center)}</div>
            {images.length > 0 && images[currentIndex] && (
              <div className="mt-1">
                Z: {images[currentIndex].parsedSliceLocation?.toFixed(1) || 
                     images[currentIndex].parsedZPosition?.toFixed(1) || 
                     (currentIndex + 1)}
              </div>
            )}
            {rtStructures && showStructures && (
              <div className="mt-1 text-green-400">
                RT Structures: {rtStructures.structures.length} ROIs
              </div>
            )}
          </div>




        </div>
      </div>

    </Card>
  );
}

declare global {
  interface Window {
    dicomParser: any;
    workingViewerZoomIn?: () => void;
    workingViewerZoomOut?: () => void;
    workingViewerResetZoom?: () => void;
  }
}