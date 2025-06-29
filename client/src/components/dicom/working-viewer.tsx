import { useEffect, useRef, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
}

export function WorkingViewer({ seriesId, studyId, windowLevel: externalWindowLevel, onWindowLevelChange, onZoomIn, onZoomOut, onResetZoom, rtStructures: externalRTStructures, structureVisibility: externalStructureVisibility }: WorkingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0 });
  
  // Use external RT structures if provided, otherwise load our own
  const rtStructures = externalRTStructures;
  const structureVisibility = externalStructureVisibility || new Map();
  const [showStructures, setShowStructures] = useState(true);

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
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);


  useEffect(() => {
    loadImages();
  }, [seriesId, loadImages]);

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

  // OPTIMIZED: Fast metadata extraction without full image download
  const extractQuickMetadata = useCallback(async (sopInstanceUID: string) => {
    try {
      // First try to get just the DICOM header (first 2KB should contain metadata)
      const response = await fetch(`/api/images/${sopInstanceUID}`, {
        headers: { 'Range': 'bytes=0-2048' } // Just get header portion
      });
      
      if (response.status === 206 || response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);
        const dataSet = window.dicomParser.parseDicom(byteArray);
        
        const sliceLocation = dataSet.floatString('x00201041');
        const imagePosition = dataSet.string('x00200032');
        const instanceNumber = dataSet.intString('x00200013');
        
        let zPosition = null;
        if (imagePosition) {
          const positions = imagePosition.split('\\').map((p: string) => parseFloat(p));
          zPosition = positions[2];
        }
        
        return {
          parsedSliceLocation: sliceLocation ? parseFloat(sliceLocation) : null,
          parsedZPosition: zPosition,
          parsedInstanceNumber: instanceNumber ? parseInt(instanceNumber) : null
        };
      }
    } catch (error) {
      // Fallback: if range request fails, use instance number
      console.warn(`Range request failed for ${sopInstanceUID}, using fallback`);
    }
    
    return {
      parsedSliceLocation: null,
      parsedZPosition: null,
      parsedInstanceNumber: null
    };
  }, []);

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

  // OPTIMIZED: Fast DICOM parsing with performance improvements
  const parseDicomImageOptimized = useCallback(async (arrayBuffer: ArrayBuffer) => {
    try {
      const byteArray = new Uint8Array(arrayBuffer);
      const dataSet = window.dicomParser.parseDicom(byteArray);
      
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        throw new Error('No pixel data found in DICOM file');
      }
      
      const rows = dataSet.uint16('x00280010') || 512;
      const cols = dataSet.uint16('x00280011') || 512;
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      
      const rescaleSlope = dataSet.floatString('x00281053') || 1;
      const rescaleIntercept = dataSet.floatString('x00281052') || -1024;
      
      if (bitsAllocated === 16) {
        const rawPixelArray = new Uint16Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        const huPixelArray = new Float32Array(rawPixelArray.length);
        
        // OPTIMIZED: Unrolled loop for better performance
        const len = rawPixelArray.length;
        const slope = rescaleSlope;
        const intercept = rescaleIntercept;
        
        for (let i = 0; i < len; i += 4) {
          huPixelArray[i] = rawPixelArray[i] * slope + intercept;
          if (i + 1 < len) huPixelArray[i + 1] = rawPixelArray[i + 1] * slope + intercept;
          if (i + 2 < len) huPixelArray[i + 2] = rawPixelArray[i + 2] * slope + intercept;
          if (i + 3 < len) huPixelArray[i + 3] = rawPixelArray[i + 3] * slope + intercept;
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
  }, []);

  // OPTIMIZED: Maximum speed preloading with controlled concurrency
  const preloadAllImagesOptimized = useCallback(async (imageList: any[]) => {
    console.log('Starting optimized preload of all images...');
    setIsPreloading(true);
    
    const newCache = new Map();
    const maxConcurrent = 8; // Optimal concurrency for most browsers
    let completed = 0;
    
    // Process images in batches for maximum speed
    const processImage = async (image: any, index: number) => {
      try {
        const imageResponse = await fetch(`/api/images/${image.sopInstanceUID}`);
        if (!imageResponse.ok) {
          throw new Error(`Failed to load image ${index + 1}`);
        }
        
        const arrayBuffer = await imageResponse.arrayBuffer();
        const imageData = await parseDicomImageOptimized(arrayBuffer);
        
        if (imageData) {
          newCache.set(image.sopInstanceUID, imageData);
        }
        
        completed++;
        setLoadingProgress({ loaded: completed, total: imageList.length });
        
        if (completed % 10 === 0) {
          console.log(`Preloaded ${completed}/${imageList.length} images`);
        }
      } catch (error) {
        console.warn(`Failed to preload image ${index + 1}:`, error);
        completed++;
        setLoadingProgress({ loaded: completed, total: imageList.length });
      }
    };
    
    // Process in controlled batches for optimal performance
    for (let i = 0; i < imageList.length; i += maxConcurrent) {
      const batch = imageList.slice(i, i + maxConcurrent);
      const promises = batch.map((image, batchIndex) => 
        processImage(image, i + batchIndex)
      );
      
      await Promise.allSettled(promises);
      
      // Update cache progressively for immediate display
      setImageCache(new Map(newCache));
      
      // Small yield to prevent browser freeze
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    setImageCache(newCache);
    setIsPreloading(false);
    console.log(`Preloading complete: ${newCache.size}/${imageList.length} images cached`);
  }, [parseDicomImageOptimized]);

  // OPTIMIZED: Fast image list loading with minimal metadata
  const loadImages = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setLoadingProgress({ loaded: 0, total: 0 });
      
      // Load DICOM parser first
      await loadDicomParser();
      
      const response = await fetch(`/api/series/${seriesId}/images`);
      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.statusText}`);
      }
      
      const seriesImages = await response.json();
      setLoadingProgress({ loaded: 0, total: seriesImages.length });
      
      // OPTIMIZED: Extract metadata in smaller batches to avoid overwhelming browser
      const batchSize = 10;
      const imagesWithMetadata = [];
      
      for (let i = 0; i < seriesImages.length; i += batchSize) {
        const batch = seriesImages.slice(i, i + batchSize);
        
        const batchResults = await Promise.all(
          batch.map(async (img: any) => {
            try {
              const metadata = await extractQuickMetadata(img.sopInstanceUID);
              return { ...img, ...metadata };
            } catch (error) {
              console.warn(`Failed to parse metadata for ${img.fileName}:`, error);
              return {
                ...img,
                parsedSliceLocation: null,
                parsedZPosition: null,
                parsedInstanceNumber: img.instanceNumber
              };
            }
          })
        );
        
        imagesWithMetadata.push(...batchResults);
        setLoadingProgress({ loaded: imagesWithMetadata.length, total: seriesImages.length });
        
        // Small delay to prevent browser lock-up
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Sort by spatial position
      const sortedImages = imagesWithMetadata.sort((a: any, b: any) => {
        if (a.parsedSliceLocation !== null && b.parsedSliceLocation !== null) {
          return a.parsedSliceLocation - b.parsedSliceLocation;
        }
        if (a.parsedZPosition !== null && b.parsedZPosition !== null) {
          return a.parsedZPosition - b.parsedZPosition;
        }
        if (a.parsedInstanceNumber !== null && b.parsedInstanceNumber !== null) {
          return a.parsedInstanceNumber - b.parsedInstanceNumber;
        }
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });
      
      setImages(sortedImages);
      setCurrentIndex(0);
      
      // Start aggressive preloading immediately
      preloadAllImagesOptimized(sortedImages);
      
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [seriesId, loadDicomParser, extractQuickMetadata, preloadAllImagesOptimized]);

  const [imageMetadata, setImageMetadata] = useState<any>(null);

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
    
    setIsLoading(true);
    try {
      const currentImage = images[currentIndex];
      const cacheKey = currentImage.sopInstanceUID;
      
      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      let imageData = imageCache.get(cacheKey);
      
      if (!imageData) {
        // Show loading indicator for this specific image
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Loading image...', canvas.width / 2, canvas.height / 2);
        return;
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
    } finally {
      setIsLoading(false);
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
    
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    
    rtStructures.structures.forEach((structure: any) => {
      // Check if this structure is visible
      const isVisible = structureVisibility.get(structure.roiNumber) ?? true;
      if (!isVisible) return;
      
      // Use the structure's actual color, not hardcoded yellow
      const color = structure.color || [255, 255, 0]; // fallback to yellow only if no color
      const [r, g, b] = color;
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;
      
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
    
    if (e.button === 0) { // Left click for pan
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanX(panX);
      setLastPanY(panY);
    } else if (e.button === 2) { // Right click for window/level
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
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
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
            className="max-w-full max-h-full object-contain border border-indigo-700 rounded cursor-move"
            style={{ 
              backgroundColor: 'black',
              imageRendering: 'auto',
              userSelect: 'none'
            }}
          />
          {/* Preloading overlay with progress */}
          {isPreloading && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
              <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
                <div className="text-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">Loading Medical Images</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {loadingProgress.loaded} of {loadingProgress.total} images loaded
                  </p>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${loadingProgress.total > 0 ? (loadingProgress.loaded / loadingProgress.total) * 100 : 0}%` 
                    }}
                  ></div>
                </div>
                
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span>
                    {Math.round(loadingProgress.total > 0 ? (loadingProgress.loaded / loadingProgress.total) * 100 : 0)}%
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* Single image loading overlay */}
          {isLoading && !isPreloading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="bg-white p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  <span>Loading image...</span>
                </div>
              </div>
            </div>
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