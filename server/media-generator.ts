import dicomParser from 'dicom-parser';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { db } from './db';
import { mediaPreviews, images, series } from '@shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { MediaPreview, DicomImage } from '@shared/schema';

ffmpeg.setFfmpegPath(ffmpegPath.path);

export class MediaGeneratorService {
  private previewsDir = path.join(process.cwd(), 'storage', 'previews');

  constructor() {
    this.ensureDirectoriesExist();
  }

  private async ensureDirectoriesExist() {
    await fs.mkdir(this.previewsDir, { recursive: true });
    await fs.mkdir(path.join(this.previewsDir, 'thumbnails'), { recursive: true });
    await fs.mkdir(path.join(this.previewsDir, 'movies'), { recursive: true });
  }

  // Extract pixel data from DICOM file
  private async extractPixelData(filePath: string): Promise<{
    pixelData: Uint8Array | Uint16Array;
    width: number;
    height: number;
    windowCenter: number;
    windowWidth: number;
    photometricInterpretation: string;
  } | null> {
    try {
      const dicomData = await fs.readFile(filePath);
      const dataSet = dicomParser.parseDicom(dicomData);

      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        console.error('No pixel data found in DICOM file');
        return null;
      }

      const width = dataSet.uint16('x00280011');
      const height = dataSet.uint16('x00280010');
      const bitsAllocated = dataSet.uint16('x00280100');
      const photometricInterpretation = dataSet.string('x00280004') || 'MONOCHROME2';
      
      // Get window center and width for proper display
      const windowCenter = parseFloat(dataSet.string('x00281050') || '40');
      const windowWidth = parseFloat(dataSet.string('x00281051') || '400');

      if (!width || !height) {
        console.error('Invalid dimensions in DICOM file');
        return null;
      }

      let pixelData: Uint8Array | Uint16Array;
      
      if (bitsAllocated === 16) {
        const byteArray = new Uint8Array(dataSet.byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length);
        pixelData = new Uint16Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength / 2);
      } else {
        pixelData = new Uint8Array(dataSet.byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length);
      }

      return {
        pixelData,
        width,
        height,
        windowCenter,
        windowWidth,
        photometricInterpretation
      };
    } catch (error) {
      console.error('Error extracting pixel data:', error);
      return null;
    }
  }

  // Apply window/level to pixel data
  private applyWindowLevel(
    pixelData: Uint8Array | Uint16Array,
    windowCenter: number,
    windowWidth: number,
    photometricInterpretation: string
  ): Uint8Array {
    const minValue = windowCenter - windowWidth / 2;
    const maxValue = windowCenter + windowWidth / 2;
    const output = new Uint8Array(pixelData.length);

    for (let i = 0; i < pixelData.length; i++) {
      let value = pixelData[i];
      
      // Apply window/level
      if (value <= minValue) {
        value = 0;
      } else if (value >= maxValue) {
        value = 255;
      } else {
        value = ((value - minValue) / windowWidth) * 255;
      }

      // Invert if MONOCHROME1
      if (photometricInterpretation === 'MONOCHROME1') {
        value = 255 - value;
      }

      output[i] = Math.round(value);
    }

    return output;
  }

  // Generate thumbnail from a single DICOM image
  async generateThumbnail(dicomFilePath: string, seriesId: number): Promise<MediaPreview | null> {
    try {
      const pixelInfo = await this.extractPixelData(dicomFilePath);
      if (!pixelInfo) {
        throw new Error('Failed to extract pixel data');
      }

      const { pixelData, width, height, windowCenter, windowWidth, photometricInterpretation } = pixelInfo;
      
      // Apply window/level
      const processedData = this.applyWindowLevel(pixelData, windowCenter, windowWidth, photometricInterpretation);

      // Create image with sharp
      const thumbnailPath = path.join(this.previewsDir, 'thumbnails', `series_${seriesId}.jpg`);
      
      await sharp(processedData, {
        raw: {
          width,
          height,
          channels: 1
        }
      })
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
      .jpeg({ quality: 85 })
      .toFile(thumbnailPath);

      // Get file size
      const stats = await fs.stat(thumbnailPath);

      // Save to database
      const [preview] = await db.insert(mediaPreviews)
        .values({
          seriesId,
          type: 'thumbnail',
          format: 'jpg',
          filePath: thumbnailPath,
          width: 256,
          height: 256,
          fileSize: stats.size,
          status: 'completed',
          processedAt: new Date()
        })
        .returning();

      return preview;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      
      // Log error to database
      await db.insert(mediaPreviews)
        .values({
          seriesId,
          type: 'thumbnail',
          format: 'jpg',
          filePath: '',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      
      return null;
    }
  }

  // Generate animated GIF from DICOM series
  async generateAnimatedGif(seriesId: number, frameStep: number = 1): Promise<MediaPreview | null> {
    try {
      // Get all images for the series
      const seriesImages = await db.select()
        .from(images)
        .where(eq(images.seriesId, seriesId))
        .orderBy(images.instanceNumber);

      if (seriesImages.length === 0) {
        throw new Error('No images found for series');
      }

      const tempFramesDir = path.join(this.previewsDir, 'temp', `series_${seriesId}`);
      await fs.mkdir(tempFramesDir, { recursive: true });

      // Process frames with step
      const framePaths: string[] = [];
      for (let i = 0; i < seriesImages.length; i += frameStep) {
        const image = seriesImages[i];
        const pixelInfo = await this.extractPixelData(image.filePath);
        
        if (!pixelInfo) continue;

        const { pixelData, width, height, windowCenter, windowWidth, photometricInterpretation } = pixelInfo;
        const processedData = this.applyWindowLevel(pixelData, windowCenter, windowWidth, photometricInterpretation);

        const framePath = path.join(tempFramesDir, `frame_${String(i).padStart(4, '0')}.jpg`);
        
        await sharp(processedData, {
          raw: {
            width,
            height,
            channels: 1
          }
        })
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
        .jpeg({ quality: 90 })
        .toFile(framePath);

        framePaths.push(framePath);
      }

      if (framePaths.length === 0) {
        throw new Error('No frames could be processed');
      }

      // Create animated GIF using ffmpeg
      const gifPath = path.join(this.previewsDir, 'movies', `series_${seriesId}.gif`);
      
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(path.join(tempFramesDir, 'frame_%04d.jpg'))
          .inputOptions(['-framerate', '10'])
          .outputOptions([
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2',
            '-loop', '0'
          ])
          .output(gifPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });

      // Clean up temp frames
      await fs.rm(tempFramesDir, { recursive: true, force: true });

      // Get file size
      const stats = await fs.stat(gifPath);

      // Save to database
      const [preview] = await db.insert(mediaPreviews)
        .values({
          seriesId,
          type: 'movie',
          format: 'gif',
          filePath: gifPath,
          width: 512,
          height: 512,
          frameCount: framePaths.length,
          fileSize: stats.size,
          status: 'completed',
          processedAt: new Date()
        })
        .returning();

      return preview;
    } catch (error) {
      console.error('Error generating animated GIF:', error);
      
      // Log error to database
      await db.insert(mediaPreviews)
        .values({
          seriesId,
          type: 'movie',
          format: 'gif',
          filePath: '',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      
      return null;
    }
  }

  // Get or generate preview for a series
  async getOrGeneratePreview(seriesId: number, type: 'thumbnail' | 'movie'): Promise<MediaPreview | null> {
    // Check if preview already exists
    const [existing] = await db.select()
      .from(mediaPreviews)
      .where(and(
        eq(mediaPreviews.seriesId, seriesId),
        eq(mediaPreviews.type, type),
        eq(mediaPreviews.status, 'completed')
      ))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Generate new preview
    if (type === 'thumbnail') {
      // Get first image of the series
      const [firstImage] = await db.select()
        .from(images)
        .where(eq(images.seriesId, seriesId))
        .orderBy(images.instanceNumber)
        .limit(1);

      if (!firstImage) {
        return null;
      }

      return await this.generateThumbnail(firstImage.filePath, seriesId);
    } else {
      return await this.generateAnimatedGif(seriesId);
    }
  }

  // Process all pending series
  async processAllPendingSeries() {
    // Get all series first
    const allSeries = await db.select()
      .from(series);

    // Get series that already have thumbnails
    const existingPreviews = await db.select()
      .from(mediaPreviews)
      .where(and(
        eq(mediaPreviews.type, 'thumbnail'),
        eq(mediaPreviews.status, 'completed')
      ));

    const seriesWithThumbnails = new Set(existingPreviews.map(p => p.seriesId));
    const seriesWithoutThumbnails = allSeries.filter(s => !seriesWithThumbnails.has(s.id));

    console.log(`Found ${seriesWithoutThumbnails.length} series without thumbnails`);

    for (const s of seriesWithoutThumbnails) {
      console.log(`Processing series ${s.id}: ${s.seriesDescription}`);
      await this.getOrGeneratePreview(s.id, 'thumbnail');
    }
  }
}

// Export singleton instance
export const mediaGenerator = new MediaGeneratorService();