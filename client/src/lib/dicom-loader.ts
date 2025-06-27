// Direct DICOM loading without Cornerstone dependencies
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
      
      // Extract image data
      const pixelData = dataSet.elements.x7fe00010;
      if (!pixelData) {
        throw new Error('No pixel data found');
      }

      // Get image dimensions
      const rows = dataSet.uint16('x00280010');
      const cols = dataSet.uint16('x00280011');
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      const samplesPerPixel = dataSet.uint16('x00280002') || 1;
      
      if (!rows || !cols) {
        throw new Error('Invalid image dimensions');
      }

      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Get pixel data array
      const pixelDataOffset = pixelData.dataOffset;
      const pixelDataLength = pixelData.length;
      
      if (bitsAllocated === 16) {
        // 16-bit grayscale
        const pixelArray = new Uint16Array(arrayBuffer, pixelDataOffset, pixelDataLength / 2);
        this.render16BitGrayscale(ctx, pixelArray, cols, rows);
      } else if (bitsAllocated === 8) {
        // 8-bit grayscale
        const pixelArray = new Uint8Array(arrayBuffer, pixelDataOffset, pixelDataLength);
        this.render8BitGrayscale(ctx, pixelArray, cols, rows);
      } else {
        throw new Error(`Unsupported bits allocated: ${bitsAllocated}`);
      }

      return canvas;
    } catch (error) {
      console.error('Error parsing DICOM:', error);
      // Return a canvas with error message
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('DICOM Parse Error', 256, 256);
        ctx.fillText(error.message, 256, 280);
      }
      
      return canvas;
    }
  }

  private render16BitGrayscale(ctx: CanvasRenderingContext2D, pixelArray: Uint16Array, width: number, height: number) {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Find min/max for windowing
    let min = pixelArray[0];
    let max = pixelArray[0];
    for (let i = 1; i < pixelArray.length; i++) {
      if (pixelArray[i] < min) min = pixelArray[i];
      if (pixelArray[i] > max) max = pixelArray[i];
    }

    const range = max - min;
    
    for (let i = 0; i < pixelArray.length; i++) {
      const normalizedValue = range > 0 ? ((pixelArray[i] - min) / range) * 255 : 0;
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

    for (let i = 0; i < pixelArray.length; i++) {
      const gray = pixelArray[i];
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