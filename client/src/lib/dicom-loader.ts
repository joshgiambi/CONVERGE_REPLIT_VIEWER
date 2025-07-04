// Robust DICOM loading without external dependencies
export class DICOMLoader {
  private static instance: DICOMLoader;

  static getInstance(): DICOMLoader {
    if (!DICOMLoader.instance) {
      DICOMLoader.instance = new DICOMLoader();
    }
    return DICOMLoader.instance;
  }

  async loadDICOMImage(sopInstanceUID: string): Promise<HTMLCanvasElement> {
    try {
      const response = await fetch(`/api/images/${sopInstanceUID}`);
      if (!response.ok) {
        throw new Error(`Failed to load DICOM: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return this.renderDICOMToCanvas(arrayBuffer);
    } catch (error) {
      console.error('Error loading DICOM:', error);
      throw error;
    }
  }

  private async renderDICOMToCanvas(arrayBuffer: ArrayBuffer): Promise<HTMLCanvasElement> {
    // Load dicom-parser if not already available
    if (!window.dicomParser) {
      await this.loadDICOMParser();
    }

    const dicomParser = window.dicomParser;
    const byteArray = new Uint8Array(arrayBuffer);
    
    try {
      const dataSet = dicomParser.parseDicom(byteArray);
      
      // Extract image data safely
      const pixelData = dataSet.elements?.x7fe00010;
      if (!pixelData) {
        throw new Error('No pixel data found in DICOM');
      }

      // Get image dimensions with fallbacks
      const rows = this.getUint16(dataSet, 'x00280010') || 512;
      const cols = this.getUint16(dataSet, 'x00280011') || 512;
      const bitsAllocated = this.getUint16(dataSet, 'x00280100') || 16;
      
      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Get pixel data array with proper bounds checking
      const pixelDataOffset = pixelData.dataOffset || 0;
      const pixelDataLength = pixelData.length || 0;
      
      if (pixelDataOffset >= arrayBuffer.byteLength || pixelDataLength <= 0) {
        throw new Error('Invalid pixel data bounds');
      }

      if (bitsAllocated === 16) {
        // 16-bit grayscale
        const availableBytes = arrayBuffer.byteLength - pixelDataOffset;
        const pixelCount = Math.min(availableBytes / 2, rows * cols);
        const pixelArray = new Uint16Array(arrayBuffer, pixelDataOffset, pixelCount);
        this.render16BitGrayscale(ctx, pixelArray, cols, rows);
      } else if (bitsAllocated === 8) {
        // 8-bit grayscale
        const availableBytes = arrayBuffer.byteLength - pixelDataOffset;
        const pixelCount = Math.min(availableBytes, rows * cols);
        const pixelArray = new Uint8Array(arrayBuffer, pixelDataOffset, pixelCount);
        this.render8BitGrayscale(ctx, pixelArray, cols, rows);
      } else {
        throw new Error(`Unsupported bits allocated: ${bitsAllocated}`);
      }

      return canvas;
    } catch (error: any) {
      console.error('Error parsing DICOM:', error);
      // Return a canvas with error message
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = 'red';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Error loading DICOM', 256, 240);
        ctx.fillText(error?.message || 'Unknown error', 256, 270);
      }
      
      return canvas;
    }
  }

  private getUint16(dataSet: any, tag: string): number | null {
    try {
      return dataSet.uint16(tag);
    } catch {
      return null;
    }
  }

  private render16BitGrayscale(ctx: CanvasRenderingContext2D, pixelArray: Uint16Array, width: number, height: number) {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    if (pixelArray.length === 0) {
      // Fill with black if no pixel data
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;     // R
        data[i + 1] = 0; // G
        data[i + 2] = 0; // B
        data[i + 3] = 255; // A
      }
      ctx.putImageData(imageData, 0, 0);
      return;
    }

    // Find min/max for windowing
    let min = pixelArray[0];
    let max = pixelArray[0];
    for (let i = 1; i < pixelArray.length; i++) {
      if (pixelArray[i] < min) min = pixelArray[i];
      if (pixelArray[i] > max) max = pixelArray[i];
    }

    const range = max - min;
    const totalPixels = width * height;
    
    for (let i = 0; i < totalPixels; i++) {
      const pixelValue = i < pixelArray.length ? pixelArray[i] : 0;
      const normalizedValue = range > 0 ? ((pixelValue - min) / range) * 255 : 0;
      const gray = Math.max(0, Math.min(255, normalizedValue));
      
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private render8BitGrayscale(ctx: CanvasRenderingContext2D, pixelArray: Uint8Array, width: number, height: number) {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    if (pixelArray.length === 0) {
      // Fill with black if no pixel data
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;     // R
        data[i + 1] = 0; // G
        data[i + 2] = 0; // B
        data[i + 3] = 255; // A
      }
      ctx.putImageData(imageData, 0, 0);
      return;
    }

    const totalPixels = width * height;
    
    for (let i = 0; i < totalPixels; i++) {
      const gray = i < pixelArray.length ? pixelArray[i] : 0;
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private async loadDICOMParser(): Promise<void> {
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
  }
}

declare global {
  interface Window {
    dicomParser: any;
  }
}

export const dicomLoader = DICOMLoader.getInstance();