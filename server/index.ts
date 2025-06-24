import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.static("dist"));

(async () => {
  const server = await registerRoutes(app);
  
  // setup vite in development, serve static files in production
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const PORT = Number(process.env.PORT) || 5000;
  
  // Always bind to 0.0.0.0 for Replit compatibility
  server.listen(PORT, "0.0.0.0", () => {
    log(`Server running on 0.0.0.0:${PORT}`);
    log(`DICOM upload functionality enabled`);
    log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    if (process.env.REPLIT_DOMAINS) {
      log(`Available at: ${process.env.REPLIT_DOMAINS}`);
    }
  });
})();