import { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export function registerPatientRoutes(app: Express) {
  // Get all patients
  app.get("/api/patients", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patients = await storage.getAllPatients();
      res.json(patients);
    } catch (error: any) {
      console.error("Error fetching patients:", error);
      next(error);
    }
  });

  // Get specific patient
  app.get("/api/patients/:id", async (req, res) => {
    try {
      const patient = await storage.getPatient(parseInt(req.params.id));
      if (!patient) {
        return res.status(404).json({ message: "Patient not found" });
      }
      res.json(patient);
    } catch (error) {
      console.error("Error fetching patient:", error);
      res.status(500).json({ error: "Failed to fetch patient" });
    }
  });

  // Get studies for a patient
  app.get("/api/patients/:id/studies", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = parseInt(req.params.id);
      const studies = await storage.getStudiesByPatientId(patientId);
      res.json(studies);
    } catch (error: any) {
      console.error("Error fetching studies:", error);
      next(error);
    }
  });

  // Get patient tags for filtering
  app.get("/api/patient-tags", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tags = await storage.getAllPatientTags();
      res.json(tags);
    } catch (error: any) {
      console.error("Error fetching patient tags:", error);
      next(error);
    }
  });
}