import { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export function registerStudyRoutes(app: Express) {
  // Get all studies
  app.get("/api/studies", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studies = await storage.getAllStudies();
      res.json(studies);
    } catch (error: any) {
      console.error("Error fetching studies:", error);
      next(error);
    }
  });

  // Get specific study
  app.get("/api/studies/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.id);
      const study = await storage.getStudy(studyId);
      
      if (!study) {
        return res.status(404).json({ message: "Study not found" });
      }
      
      res.json(study);
    } catch (error: any) {
      console.error("Error fetching study:", error);
      next(error);
    }
  });

  // Get series for a study
  app.get("/api/studies/:studyId/series", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.studyId);
      const series = await storage.getSeriesByStudyId(studyId);
      res.json(series);
    } catch (error: any) {
      console.error("Error fetching series:", error);
      res.status(500).json({ error: "Failed to fetch series" });
    }
  });
}