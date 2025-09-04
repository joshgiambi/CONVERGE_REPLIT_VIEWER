import { createCanvas, Image, CanvasRenderingContext2D as NodeCanvasRenderingContext2D } from 'canvas';
import GIFEncoder from 'gifencoder';
import fs from 'fs';
import path from 'path';
import dicomParser from 'dicom-parser';

export async function generateSeriesGIF(seriesId: number, storage: any): Promise<Buffer> {
  try {
    // Get all images for the series and series info
    const [images, series] = await Promise.all([
      storage.getImagesBySeriesId(seriesId),
      storage.getSeries(seriesId)
    ]);
    
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
    
    const selectedImages = [] as any[];
    for (let i = 0; i < totalImages && selectedImages.length < framesToGenerate; i += step) {
      selectedImages.push(images[i]);
    }

    // Create canvas and GIF encoder
    const width = 256;
    const height = 256;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d') as unknown as NodeCanvasRenderingContext2D;
    
    const encoder = new GIFEncoder(width, height);
    
    // Create stream for collecting data
    const stream = encoder.createWriteStream();
    const chunks: Buffer[] = [];
    
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    encoder.start();
    encoder.setRepeat(0); // 0 for repeat, -1 for no-repeat
    encoder.setDelay(100); // frame delay in ms
    encoder.setQuality(10); // image quality. 10 is default

    let framesAdded = 0;
    
    // Create a placeholder frame function
    const createPlaceholderFrame = (index: number) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      
      // Draw modality text
      ctx.fillStyle = '#444444';
      (ctx as any).font = 'bold 48px Arial';
      ;(ctx as any).textAlign = 'center';
      ;(ctx as any).textBaseline = 'middle';
      ;(ctx as any).fillText(series?.modality || 'DICOM', width / 2, height / 2 - 20);
      
      // Draw frame number
      ;(ctx as any).font = '24px Arial';
      ctx.fillStyle = '#666666';
      ;(ctx as any).fillText(`Frame ${index + 1}/${framesToGenerate}`, width / 2, height / 2 + 30);
      
      encoder.addFrame(ctx as unknown as any);
      framesAdded++;
    };

    // Process each selected image
    for (let i = 0; i < selectedImages.length; i++) {
      const image = selectedImages[i];
      try {
        // Read DICOM file
        const filePath = image.filePath || path.join('uploads', image.sopInstanceUID + '.dcm');
        if (!fs.existsSync(filePath)) {
          console.log(`File not found: ${filePath}, using placeholder`);
          createPlaceholderFrame(i);
          continue;
        }

        const buffer = fs.readFileSync(filePath);
        const byteArray = new Uint8Array(buffer);
        
        let dataSet;
        try {
          dataSet = dicomParser.parseDicom(byteArray);
        } catch (parseError) {
          console.log('Error parsing DICOM file:', parseError);
          createPlaceholderFrame(i);
          continue;
        }
        
        // Get pixel data element
        const pixelDataElement = (dataSet as any).elements.x7fe00010;
        if (!pixelDataElement) {
          console.log('No pixel data found, using placeholder frame');
          createPlaceholderFrame(i);
          continue;
        }

        // Get image dimensions
        const rows = (dataSet as any).uint16('x00280010') || 512;
        const columns = (dataSet as any).uint16('x00280011') || 512;
        
        // Get window/level
        const windowCenter = parseFloat((dataSet as any).string('x00281050') || '40');
        const windowWidth = parseFloat((dataSet as any).string('x00281051') || '300');
        
        // Get pixel data
        let pixelData: Uint16Array;
        if ((pixelDataElement as any).fragments) {
          // Handle encapsulated pixel data
          const fragments = (pixelDataElement as any).fragments as any[];
          let totalLength = 0;
          fragments.forEach((fragment: any) => {
            totalLength += fragment.length;
          });
          
          const combinedArray = new Uint8Array(totalLength);
          let offset = 0;
          fragments.forEach((fragment: any) => {
            const fragmentData = new Uint8Array(byteArray.buffer, fragment.position, fragment.length);
            combinedArray.set(fragmentData, offset);
            offset += fragment.length;
          });
          
          pixelData = new Uint16Array(combinedArray.buffer);
        } else {
          // Handle uncompressed pixel data
          const pixelDataOffset = (pixelDataElement as any).dataOffset;
          const pixelDataLength = (pixelDataElement as any).length;
          pixelData = new Uint16Array(byteArray.buffer, pixelDataOffset, pixelDataLength / 2);
        }
        
        // Create temporary canvas for this frame
        const frameCanvas = createCanvas(columns, rows);
        const frameCtx = frameCanvas.getContext('2d') as unknown as NodeCanvasRenderingContext2D;
        const imageData = (frameCtx as any).createImageData(columns, rows);
        const data = imageData.data as Uint8ClampedArray;
        
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
        
        (frameCtx as any).putImageData(imageData, 0, 0);
        
        // Scale to target size and draw on main canvas
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        
        // Calculate scale to fit
        const scale = Math.min(width / columns, height / rows);
        const scaledWidth = columns * scale;
        const scaledHeight = rows * scale;
        const x = (width - scaledWidth) / 2;
        const y = (height - scaledHeight) / 2;
        
        (ctx as any).drawImage(frameCanvas as any, x, y, scaledWidth, scaledHeight);
        
        // Add frame number overlay
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        (ctx as any).font = '12px Arial';
        ;(ctx as any).fillText(`${selectedImages.indexOf(image) + 1}/${framesToGenerate}`, 5, 15);
        
        // Add frame to GIF
        encoder.addFrame(ctx as unknown as any);
        framesAdded++;
        
      } catch (error) {
        console.error(`Error processing frame: ${error}`);
        createPlaceholderFrame(i);
      }
    }

    // Ensure at least one frame was added
    if (framesAdded === 0) {
      createPlaceholderFrame(0);
    }

    encoder.finish();
    
    // Wait for stream to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Get the GIF buffer from chunks
    const gifBuffer = Buffer.concat(chunks);
    
    // Return valid GIF or minimal placeholder
    if (!gifBuffer || gifBuffer.length === 0) {
      console.log('Warning: GIF buffer is empty, returning placeholder');
      // Create minimal 1x1 GIF
      return Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
        0x01, 0x00, 0x01, 0x00, // 1x1 pixel
        0x80, 0x00, 0x00, // Global color table
        0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, // Black and white
        0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // Graphics control
        0x2C, 0x00, 0x00, 0x00, 0x00, // Image descriptor
        0x01, 0x00, 0x01, 0x00, 0x00,
        0x02, 0x02, 0x44, 0x01, 0x00, // Image data
        0x3B // Trailer
      ]);
    }
    
    return gifBuffer;
    
  } catch (error) {
    console.error('Error generating GIF:', error);
    // Return minimal error GIF
    return Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
      0x01, 0x00, 0x01, 0x00, // 1x1 pixel
      0x80, 0x00, 0x00, // Global color table
      0xFF, 0x00, 0x00, 0xFF, 0xFF, 0xFF, // Red and white
      0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // Graphics control
      0x2C, 0x00, 0x00, 0x00, 0x00, // Image descriptor
      0x01, 0x00, 0x01, 0x00, 0x00,
      0x02, 0x02, 0x44, 0x01, 0x00, // Image data
      0x3B // Trailer
    ]);
  }
}