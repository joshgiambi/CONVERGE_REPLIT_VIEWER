import { createCanvas } from 'canvas';
import GIFEncoder from 'gifencoder';
import fs from 'fs';
import path from 'path';
import dicomParser from 'dicom-parser';

export async function generateSeriesGIF(seriesId: number, storage: any): Promise<Buffer> {
  try {
    // Get all images for the series
    const images = await storage.getImagesBySeriesId(seriesId);
    if (!images || images.length === 0) {
      throw new Error('No images found for series');
    }

    // Sort images by instance number or slice location
    images.sort((a: any, b: any) => {
      const aNum = a.instanceNumber || a.sliceLocation || 0;
      const bNum = b.instanceNumber || b.sliceLocation || 0;
      return aNum - bNum;
    });

    // Select up to 30 evenly spaced images
    const totalImages = images.length;
    const framesToGenerate = Math.min(30, totalImages);
    const step = totalImages > 30 ? Math.floor(totalImages / 30) : 1;
    
    const selectedImages = [];
    for (let i = 0; i < totalImages && selectedImages.length < framesToGenerate; i += step) {
      selectedImages.push(images[i]);
    }

    // Create canvas and GIF encoder
    const width = 256;
    const height = 256;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    const encoder = new GIFEncoder(width, height);
    const chunks: Buffer[] = [];
    
    encoder.createReadStream().on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    encoder.start();
    encoder.setRepeat(0); // 0 for repeat, -1 for no-repeat
    encoder.setDelay(100); // frame delay in ms
    encoder.setQuality(10); // image quality. 10 is default

    // Process each selected image
    for (const image of selectedImages) {
      try {
        // Read DICOM file
        const filePath = image.filePath || path.join('uploads', image.sopInstanceUID + '.dcm');
        if (!fs.existsSync(filePath)) {
          console.log(`File not found: ${filePath}`);
          continue;
        }

        const buffer = fs.readFileSync(filePath);
        const byteArray = new Uint8Array(buffer);
        const dataSet = (dicomParser as any).parseDicom(byteArray, {});
        
        // Get pixel data
        const pixelDataElement = dataSet.elements.x7fe00010;
        if (!pixelDataElement) {
          console.log('No pixel data found in DICOM file');
          continue;
        }

        // Get image dimensions
        const rows = dataSet.uint16('x00280010') || 512;
        const columns = dataSet.uint16('x00280011') || 512;
        
        // Get window/level
        const windowCenter = parseFloat(dataSet.string('x00281050') || '40');
        const windowWidth = parseFloat(dataSet.string('x00281051') || '300');
        
        // Get pixel data
        const pixelData = new Uint16Array(buffer.buffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        
        // Create temporary canvas for this frame
        const frameCanvas = createCanvas(columns, rows);
        const frameCtx = frameCanvas.getContext('2d');
        const imageData = frameCtx.createImageData(columns, rows);
        const data = imageData.data;
        
        // Apply window/level
        const min = windowCenter - windowWidth / 2;
        const max = windowCenter + windowWidth / 2;
        
        for (let i = 0; i < pixelData.length; i++) {
          const pixel = pixelData[i];
          let value = 255 * (pixel - min) / windowWidth;
          value = Math.max(0, Math.min(255, value));
          
          const offset = i * 4;
          data[offset] = value;     // R
          data[offset + 1] = value; // G
          data[offset + 2] = value; // B
          data[offset + 3] = 255;   // A
        }
        
        frameCtx.putImageData(imageData, 0, 0);
        
        // Scale to target size and draw on main canvas
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        
        // Calculate scale to fit
        const scale = Math.min(width / columns, height / rows);
        const scaledWidth = columns * scale;
        const scaledHeight = rows * scale;
        const x = (width - scaledWidth) / 2;
        const y = (height - scaledHeight) / 2;
        
        ctx.drawImage(frameCanvas, x, y, scaledWidth, scaledHeight);
        
        // Add frame number overlay
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '12px Arial';
        ctx.fillText(`${selectedImages.indexOf(image) + 1}/${framesToGenerate}`, 5, 15);
        
        // Add frame to GIF
        encoder.addFrame(ctx);
        
      } catch (error) {
        console.error(`Error processing frame: ${error}`);
      }
    }

    encoder.finish();
    
    // Wait for all chunks to be collected
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return Buffer.concat(chunks);
    
  } catch (error) {
    console.error('Error generating GIF:', error);
    throw error;
  }
}