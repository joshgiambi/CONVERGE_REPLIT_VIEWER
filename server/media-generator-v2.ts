import { DicomImage, NativePixelDecoder } from 'dcmjs-imaging';
import { createCanvas } from 'canvas';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { db } from './db';
import { images, series, mediaPreviews } from '@shared/schema';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import Bull from 'bull';

// Configure ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath.path);

export class MediaGeneratorService {
  private initialized = false;
  private queue: Bull.Queue | null = null;

  constructor() {}

  async initialize() {
    if (!this.initialized) {
      console.log('Initializing NativePixelDecoder...');
      await NativePixelDecoder.initializeAsync();
      this.initialized = true;
      console.log('NativePixelDecoder initialized');
    }
  }

  async generateThumbnail(dicomPath: string, outputPath: string, maxSize: number = 256): Promise<{
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    path: string;
  } | null> {
    try {
      await this.initialize();
      
      console.log(`Generating thumbnail for ${dicomPath}`);
      
      // Load DICOM file
      const dicomBuffer = await fs.readFile(dicomPath);
      const arrayBuffer = dicomBuffer.buffer.slice(
        dicomBuffer.byteOffset, 
        dicomBuffer.byteOffset + dicomBuffer.byteLength
      );

      // Render image using dcmjs-imaging
      const image = new DicomImage(arrayBuffer);
      const result = image.render();
      
      console.log(`Rendered image: ${result.width}x${result.height}`);
      
      // Calculate thumbnail dimensions
      const scale = Math.min(maxSize / result.width, maxSize / result.height);
      const thumbWidth = Math.floor(result.width * scale);
      const thumbHeight = Math.floor(result.height * scale);
      
      // Create thumbnail using canvas
      const canvas = createCanvas(thumbWidth, thumbHeight);
      const ctx = canvas.getContext('2d');
      
      // Create temporary canvas for original image
      const tempCanvas = createCanvas(result.width, result.height);
      const tempCtx = tempCanvas.getContext('2d');
      const imageData = tempCtx.createImageData(result.width, result.height);
      imageData.data.set(new Uint8ClampedArray(result.pixels));
      tempCtx.putImageData(imageData, 0, 0);
      
      // Scale to thumbnail size
      ctx.drawImage(tempCanvas, 0, 0, thumbWidth, thumbHeight);
      
      // Save thumbnail as PNG
      const buffer = canvas.toBuffer('image/png');
      await fs.writeFile(outputPath, buffer);
      
      console.log(`Thumbnail saved to ${outputPath}`);
      
      return {
        width: thumbWidth,
        height: thumbHeight,
        originalWidth: result.width,
        originalHeight: result.height,
        path: outputPath
      };
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return null;
    }
  }

  async generateAnimatedPreview(
    seriesId: number,
    outputPath: string,
    options: { 
      fps?: number; 
      maxImages?: number;
      quality?: number;
      size?: number;
    } = {}
  ): Promise<string | null> {
    const { 
      fps = 5, 
      maxImages = 20,
      quality = 80,
      size = 256
    } = options;

    try {
      // Get images for the series
      const seriesImages = await db
        .select()
        .from(images)
        .where(eq(images.seriesId, seriesId))
        .orderBy(images.sliceLocation)
        .limit(maxImages);

      if (seriesImages.length === 0) {
        console.log('No images found for series');
        return null;
      }

      console.log(`Creating animated preview with ${seriesImages.length} images`);

      // Generate frames
      const tempDir = path.join(process.cwd(), 'temp', `series-${seriesId}`);
      await fs.mkdir(tempDir, { recursive: true });

      const framePromises = seriesImages.map(async (img, index) => {
        const framePath = path.join(tempDir, `frame-${String(index).padStart(3, '0')}.png`);
        const result = await this.generateThumbnail(img.filePath, framePath, size);
        return result ? framePath : null;
      });

      const framePaths = (await Promise.all(framePromises)).filter(Boolean) as string[];

      if (framePaths.length === 0) {
        console.log('No frames generated');
        return null;
      }

      // Create GIF using ffmpeg
      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(tempDir, 'frame-%03d.png'))
          .inputFPS(fps)
          .outputOptions([
            '-vf', `scale=${size}:-1:flags=lanczos`,
            '-loop', '0'
          ])
          .output(outputPath)
          .on('end', async () => {
            console.log('GIF created successfully');
            // Clean up temp files
            try {
              await fs.rm(tempDir, { recursive: true, force: true });
            } catch (err) {
              console.error('Error cleaning temp files:', err);
            }
            resolve(outputPath);
          })
          .on('error', async (err) => {
            console.error('Error creating GIF:', err);
            // Clean up temp files
            try {
              await fs.rm(tempDir, { recursive: true, force: true });
            } catch (err) {
              console.error('Error cleaning temp files:', err);
            }
            reject(err);
          })
          .run();
      });
    } catch (error) {
      console.error('Error generating animated preview:', error);
      return null;
    }
  }

  async getOrGeneratePreview(seriesId: number): Promise<{
    thumbnailPath?: string;
    animatedPath?: string;
  } | null> {
    try {
      // Check if preview already exists
      const [existing] = await db
        .select()
        .from(mediaPreviews)
        .where(eq(mediaPreviews.seriesId, seriesId));

      if (existing) {
        console.log(`Preview already exists for series ${seriesId}`);
        return {
          thumbnailPath: existing.thumbnailPath || undefined,
          animatedPath: existing.animatedPath || undefined
        };
      }

      // Get series info
      const [seriesInfo] = await db
        .select()
        .from(series)
        .where(eq(series.id, seriesId));

      if (!seriesInfo) {
        console.log('Series not found');
        return null;
      }

      console.log(`Processing series ${seriesId}: ${seriesInfo.seriesDescription || 'Unnamed'}`);

      // Skip RT structures and other non-image series
      const modality = seriesInfo.modality?.toUpperCase();
      if (modality === 'RTSTRUCT' || modality === 'REG' || modality === 'RTPLAN' || modality === 'RTDOSE') {
        console.log(`Skipping ${modality} series`);
        return null;
      }

      // Get first image for thumbnail
      const [firstImage] = await db
        .select()
        .from(images)
        .where(eq(images.seriesId, seriesId))
        .orderBy(images.sliceLocation)
        .limit(1);

      if (!firstImage) {
        console.log('No images found for series');
        return null;
      }

      // Create output directory
      const outputDir = path.join(process.cwd(), 'storage', 'previews');
      await fs.mkdir(outputDir, { recursive: true });

      // Generate thumbnail
      const thumbnailPath = path.join(outputDir, `series-${seriesId}-thumb.png`);
      const thumbnailResult = await this.generateThumbnail(
        firstImage.filePath,
        thumbnailPath,
        256
      );

      let animatedPath: string | null = null;

      // Generate animated preview for series with multiple images
      const imageCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(images)
        .where(eq(images.seriesId, seriesId));

      if (imageCount[0].count > 1) {
        const gifPath = path.join(outputDir, `series-${seriesId}-preview.gif`);
        animatedPath = await this.generateAnimatedPreview(seriesId, gifPath);
      }

      // Save to database
      if (thumbnailResult || animatedPath) {
        await db.insert(mediaPreviews).values({
          seriesId,
          thumbnailPath: thumbnailResult ? thumbnailPath : null,
          animatedPath,
          generatedAt: new Date()
        });

        return {
          thumbnailPath: thumbnailResult ? thumbnailPath : undefined,
          animatedPath: animatedPath || undefined
        };
      }

      return null;
    } catch (error) {
      console.error('Error getting or generating preview:', error);
      return null;
    }
  }

  async processAllPendingSeries(): Promise<void> {
    try {
      // Find series without previews
      const seriesWithoutPreviews = await db
        .select({ id: series.id, description: series.seriesDescription })
        .from(series)
        .leftJoin(mediaPreviews, eq(series.id, mediaPreviews.seriesId))
        .where(isNull(mediaPreviews.id));

      console.log(`Found ${seriesWithoutPreviews.length} series without thumbnails`);

      for (const s of seriesWithoutPreviews) {
        console.log(`Processing series ${s.id}: ${s.description || 'Unnamed'}`);
        await this.getOrGeneratePreview(s.id);
      }

      console.log('Finished processing all series');
    } catch (error) {
      console.error('Error processing pending series:', error);
    }
  }

  async getPreviewUrl(seriesId: number): Promise<{
    thumbnailUrl?: string;
    animatedUrl?: string;
  } | null> {
    const [preview] = await db
      .select()
      .from(mediaPreviews)
      .where(eq(mediaPreviews.seriesId, seriesId));

    if (!preview) {
      return null;
    }

    const result: { thumbnailUrl?: string; animatedUrl?: string } = {};

    if (preview.thumbnailPath) {
      result.thumbnailUrl = `/api/media/thumbnail/${seriesId}`;
    }

    if (preview.animatedPath) {
      result.animatedUrl = `/api/media/animated/${seriesId}`;
    }

    return result;
  }
}

// Export singleton instance
export const mediaGenerator = new MediaGeneratorService();