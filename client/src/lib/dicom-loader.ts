// Direct DICOM loading without Cornerstone dependencies
export class DICOMLoader {
  private static instance: DICOMLoader;
  private imageCache = new Map<string, HTMLCanvasElement>();
  private loadingPromises = new Map<string, Promise<HTMLCanvasElement>>();

  static getInstance(): DICOMLoader {
    if (!DICOMLoader.instance) {
      DICOMLoader.instance = new DICOMLoader();
    }
    return DICOMLoader.instance;
  }

  async loadDICOMImage(sopInstanceUID: string): Promise<HTMLCanvasElement> {
    // Check cache first
    if (this.imageCache.has(sopInstanceUID)) {
      return this.imageCache.get(sopInstanceUID)!;
    }

    // Check if already loading
    if (this.loadingPromises.has(sopInstanceUID)) {
      return this.loadingPromises.get(sopInstanceUID)!;
    }

    // Start loading
    const loadingPromise = this.loadImageFromServer(sopInstanceUID);
    this.loadingPromises.set(sopInstanceUID, loadingPromise);

    try {
      const canvas = await loadingPromise;
      this.imageCache.set(sopInstanceUID, canvas);
      this.loadingPromises.delete(sopInstanceUID);
      return canvas;
    } catch (error) {
      this.loadingPromises.delete(sopInstanceUID);
      throw error;
    }
  }

  private async loadImageFromServer(sopInstanceUID: string): Promise<HTMLCanvasElement> {
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

    // Optimize min/max finding with typed array methods
    let min = Math.min(...pixelArray);
    let max = Math.max(...pixelArray);
    
    const range = max - min;
    const scale = range > 0 ? 255 / range : 0;
    
    // Optimize pixel processing with fewer operations
    for (let i = 0; i < pixelArray.length; i++) {
      const gray = range > 0 ? Math.round((pixelArray[i] - min) * scale) : 0;
      
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

  // Cache management methods
  clearCache(): void {
    this.imageCache.clear();
    this.loadingPromises.clear();
  }

  getCacheSize(): number {
    return this.imageCache.size;
  }

  removeCachedImage(sopInstanceUID: string): void {
    this.imageCache.delete(sopInstanceUID);
  }
}

declare global {
  interface Window {
    dicomParser: any;
  }
}

export const dicomLoader = DICOMLoader.getInstance();