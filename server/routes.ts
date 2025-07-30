import { Express } from "express";
import { Server } from "http";
import { registerPatientRoutes } from "./routes/patient-routes";
import { registerStudyRoutes } from "./routes/study-routes";
import { registerImageRoutes } from "./routes/image-routes";
import { registerUploadRoutes } from "./routes/upload-routes";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register all route modules
  registerPatientRoutes(app);
  registerStudyRoutes(app);
  registerImageRoutes(app);
  registerUploadRoutes(app);

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  return new Promise((resolve) => {
    resolve({} as Server);
  });
}