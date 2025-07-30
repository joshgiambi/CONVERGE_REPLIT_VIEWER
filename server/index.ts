import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { setupVite } from "./vite";
import { registerRoutes } from "./routes";

const app = express();
const server = createServer(app);

// Add JSON parsing middleware with increased limit for RT structure contours
app.use(express.json({ limit: '50mb' }));

async function startServer() {
  // Setup routes first
  await registerRoutes(app);
  
  // Setup Vite development server
  await setupVite(app, server);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(port, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${port}`);
  });
}

startServer().catch(console.error);