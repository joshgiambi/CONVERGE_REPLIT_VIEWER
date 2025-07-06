import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";

interface MultiPlanarViewerProps {
  images: any[];
  currentIndex: number;
  windowLevel: { width: number; center: number };
  rtStructures?: any;
  structureVisibility?: Map<number, boolean>;
  contourSettings?: { width: number; opacity: number };
}

export function MultiPlanarViewer({
  images,
  currentIndex,
  windowLevel,
  rtStructures,
  structureVisibility,
  contourSettings,
}: MultiPlanarViewerProps) {
  const axialCanvasRef = useRef<HTMLCanvasElement>(null);
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const [volumeData, setVolumeData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load and organize volume data
  useEffect(() => {
    const loadVolumeData = async () => {
      if (!images || images.length === 0) return;
      
      setIsLoading(true);
      try {
        // Load all image slices into a 3D volume
        const volume = [];
        
        for (const image of images) {
          const response = await fetch(image.filePath);
          const arrayBuffer = await response.arrayBuffer();
          const byteArray = new Uint8Array(arrayBuffer);
          const dataSet = window.dicomParser.parseDicom(byteArray);
          
          // Extract pixel data
          const pixelDataElement = dataSet.elements.x7fe00010;
          if (!pixelDataElement) continue;
          
          const rows = dataSet.uint16("x00280010") || 512;
          const cols = dataSet.uint16("x00280011") || 512;
          const bitsAllocated = dataSet.uint16("x00280100") || 16;
          
          let pixelArray;
          if (bitsAllocated === 16) {
            pixelArray = new Int16Array(
              arrayBuffer,
              pixelDataElement.dataOffset,
              pixelDataElement.length / 2
            );
          } else {
            pixelArray = new Uint8Array(
              arrayBuffer,
              pixelDataElement.dataOffset,
              pixelDataElement.length
            );
          }
          
          volume.push({
            pixelData: pixelArray,
            rows,
            cols,
            metadata: {
              windowCenter: dataSet.intString("x00281050"),
              windowWidth: dataSet.intString("x00281051"),
              pixelSpacing: dataSet.string("x00280030"),
              sliceThickness: dataSet.floatString("x00180050"),
              imagePosition: dataSet.string("x00200032"),
              imageOrientation: dataSet.string("x00200037"),
            }
          });
        }
        
        setVolumeData({
          slices: volume,
          dimensions: {
            rows: volume[0]?.rows || 512,
            cols: volume[0]?.cols || 512,
            slices: volume.length
          }
        });
      } catch (error) {
        console.error("Error loading volume data:", error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadVolumeData();
  }, [images]);

  // Render axial view (XY plane)
  const renderAxialView = (ctx: CanvasRenderingContext2D, sliceIndex: number) => {
    if (!volumeData || sliceIndex >= volumeData.slices.length) return;
    
    const slice = volumeData.slices[sliceIndex];
    const { rows, cols } = slice;
    const imageData = ctx.createImageData(cols, rows);
    const data = imageData.data;
    
    // Apply window/level
    const min = windowLevel.center - windowLevel.width / 2;
    const max = windowLevel.center + windowLevel.width / 2;
    
    for (let i = 0; i < slice.pixelData.length; i++) {
      const pixelValue = slice.pixelData[i];
      let normalizedValue = ((pixelValue - min) / windowLevel.width) * 255;
      normalizedValue = Math.max(0, Math.min(255, normalizedValue));
      
      const gray = Math.round(normalizedValue);
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;
      data[pixelIndex + 1] = gray;
      data[pixelIndex + 2] = gray;
      data[pixelIndex + 3] = 255;
    }
    
    ctx.putImageData(imageData, 0, 0);
  };

  // Render sagittal view (YZ plane - side view)
  const renderSagittalView = (ctx: CanvasRenderingContext2D, xIndex: number) => {
    if (!volumeData || !volumeData.slices.length) return;
    
    const { rows, slices } = volumeData.dimensions;
    const imageData = ctx.createImageData(slices.length, rows);
    const data = imageData.data;
    
    // Apply window/level
    const min = windowLevel.center - windowLevel.width / 2;
    const max = windowLevel.center + windowLevel.width / 2;
    
    for (let z = 0; z < slices.length; z++) {
      const slice = volumeData.slices[z];
      if (!slice) continue;
      
      for (let y = 0; y < rows; y++) {
        const sourceIndex = y * slice.cols + xIndex;
        const pixelValue = slice.pixelData[sourceIndex] || 0;
        
        let normalizedValue = ((pixelValue - min) / windowLevel.width) * 255;
        normalizedValue = Math.max(0, Math.min(255, normalizedValue));
        
        const gray = Math.round(normalizedValue);
        const targetIndex = (y * slices.length + z) * 4;
        
        data[targetIndex] = gray;
        data[targetIndex + 1] = gray;
        data[targetIndex + 2] = gray;
        data[targetIndex + 3] = 255;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  };

  // Render coronal view (XZ plane - front view)
  const renderCoronalView = (ctx: CanvasRenderingContext2D, yIndex: number) => {
    if (!volumeData || !volumeData.slices.length) return;
    
    const { cols, slices } = volumeData.dimensions;
    const imageData = ctx.createImageData(cols, slices.length);
    const data = imageData.data;
    
    // Apply window/level
    const min = windowLevel.center - windowLevel.width / 2;
    const max = windowLevel.center + windowLevel.width / 2;
    
    for (let z = 0; z < slices.length; z++) {
      const slice = volumeData.slices[z];
      if (!slice) continue;
      
      for (let x = 0; x < cols; x++) {
        const sourceIndex = yIndex * slice.cols + x;
        const pixelValue = slice.pixelData[sourceIndex] || 0;
        
        let normalizedValue = ((pixelValue - min) / windowLevel.width) * 255;
        normalizedValue = Math.max(0, Math.min(255, normalizedValue));
        
        const gray = Math.round(normalizedValue);
        const targetIndex = (z * cols + x) * 4;
        
        data[targetIndex] = gray;
        data[targetIndex + 1] = gray;
        data[targetIndex + 2] = gray;
        data[targetIndex + 3] = 255;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  };

  // Update all views when data changes
  useEffect(() => {
    if (!volumeData || isLoading) return;
    
    // Update axial view
    const axialCtx = axialCanvasRef.current?.getContext("2d");
    if (axialCtx && axialCanvasRef.current) {
      axialCanvasRef.current.width = volumeData.dimensions.cols;
      axialCanvasRef.current.height = volumeData.dimensions.rows;
      renderAxialView(axialCtx, currentIndex);
    }
    
    // Update sagittal view
    const sagittalCtx = sagittalCanvasRef.current?.getContext("2d");
    if (sagittalCtx && sagittalCanvasRef.current) {
      sagittalCanvasRef.current.width = volumeData.dimensions.slices;
      sagittalCanvasRef.current.height = volumeData.dimensions.rows;
      const xIndex = Math.floor(volumeData.dimensions.cols / 2);
      renderSagittalView(sagittalCtx, xIndex);
    }
    
    // Update coronal view
    const coronalCtx = coronalCanvasRef.current?.getContext("2d");
    if (coronalCtx && coronalCanvasRef.current) {
      coronalCanvasRef.current.width = volumeData.dimensions.cols;
      coronalCanvasRef.current.height = volumeData.dimensions.slices;
      const yIndex = Math.floor(volumeData.dimensions.rows / 2);
      renderCoronalView(coronalCtx, yIndex);
    }
  }, [volumeData, currentIndex, windowLevel, isLoading]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="text-white">Loading volume data...</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-2 h-full p-2 bg-black">
      {/* Axial View - Top Left */}
      <Card className="relative overflow-hidden bg-black border-gray-700">
        <canvas
          ref={axialCanvasRef}
          className="absolute inset-0 w-full h-full object-contain"
        />
        <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-xs text-white">
          Axial
        </div>
      </Card>
      
      {/* Sagittal View - Top Right */}
      <Card className="relative overflow-hidden bg-black border-gray-700">
        <canvas
          ref={sagittalCanvasRef}
          className="absolute inset-0 w-full h-full object-contain"
        />
        <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-xs text-white">
          Sagittal
        </div>
      </Card>
      
      {/* Coronal View - Bottom Left */}
      <Card className="relative overflow-hidden bg-black border-gray-700">
        <canvas
          ref={coronalCanvasRef}
          className="absolute inset-0 w-full h-full object-contain"
        />
        <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-xs text-white">
          Coronal
        </div>
      </Card>
      
      {/* 3D View Placeholder - Bottom Right */}
      <Card className="relative overflow-hidden bg-black border-gray-700 flex items-center justify-center">
        <div className="text-gray-500 text-sm">3D View (Coming Soon)</div>
      </Card>
    </div>
  );
}