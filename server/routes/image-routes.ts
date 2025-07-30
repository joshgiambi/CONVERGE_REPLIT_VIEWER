import { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { generateSeriesGIF } from '../gif-generator';
import * as fs from "fs";
import * as path from "path";

export function registerImageRoutes(app: Express) {
  // Serve DICOM files
  app.get("/api/images/:sopInstanceUID", async (req, res) => {
    try {
      const sopInstanceUID = req.params.sopInstanceUID;
      const image = await storage.getImageBySopInstanceUID(sopInstanceUID);
      
      if (!image || !image.filePath) {
        return res.status(404).json({ message: "Image not found" });
      }

      if (!fs.existsSync(image.filePath)) {
        return res.status(404).json({ message: "Image file not found on disk" });
      }

      res.setHeader('Content-Type', 'application/dicom');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      
      const stream = fs.createReadStream(image.filePath);
      stream.pipe(res);
    } catch (error) {
      console.error("Error serving DICOM file:", error);
      res.status(500).json({ error: "Failed to serve DICOM file" });
    }
  });

  // Get images for a series
  app.get("/api/series/:seriesId/images", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const images = await storage.getImagesBySeriesId(seriesId);
      res.json(images);
    } catch (error: any) {
      console.error("Error fetching images:", error);
      next(error);
    }
  });

  // Generate GIF for a series
  app.get("/api/series/:seriesId/gif", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const series = await storage.getSeries(seriesId);
      
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      const images = await storage.getImagesBySeriesId(seriesId);
      if (images.length === 0) {
        return res.status(404).json({ error: "No images found for series" });
      }

      console.log(`Generating GIF for series ${seriesId} with ${images.length} images`);
      const gifBuffer = await generateSeriesGIF(images, {
        width: 512,
        height: 512,
        delay: 100,
        windowCenter: series.windowCenter || 40,
        windowWidth: series.windowWidth || 400
      });

      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(gifBuffer);
    } catch (error: any) {
      console.error("Error generating GIF:", error);
      res.status(500).json({ error: "Failed to generate GIF", details: error.message });
    }
  });

  // Get complete metadata dump for debugging
  app.get("/api/metadata/all", async (req, res) => {
    try {
      const patients = await storage.getAllPatients();
      const studies = await storage.getAllStudies();
      const series = await storage.getAllSeries();
      
      // Get images for each series with metadata
      const seriesWithImages = await Promise.all(
        series.map(async (s) => {
          const images = await storage.getImagesBySeriesId(s.id);
          return {
            ...s,
            images: images.map(img => ({
              id: img.id,
              sopInstanceUID: img.sopInstanceUID,
              instanceNumber: img.instanceNumber,
              sliceLocation: img.sliceLocation,
              windowCenter: img.windowCenter,
              windowWidth: img.windowWidth,
              imagePosition: img.imagePosition,
              imageOrientation: img.imageOrientation,
              pixelSpacing: img.pixelSpacing,
              metadata: img.metadata
            }))
          };
        })
      );
      
      res.json({
        patients,
        studies,
        series: seriesWithImages,
        summary: {
          totalPatients: patients.length,
          totalStudies: studies.length,
          totalSeries: series.length,
          totalImages: seriesWithImages.reduce((sum, s) => sum + s.images.length, 0)
        }
      });
    } catch (error) {
      console.error("Error fetching metadata:", error);
      res.status(500).json({ error: "Failed to fetch metadata" });
    }
  });
}