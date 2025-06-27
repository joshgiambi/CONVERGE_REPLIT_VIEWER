import express from "express";
import { createServer } from "http";
import { setupVite } from "./vite";
import { registerRoutes } from "./routes";

const app = express();
const server = createServer(app);

async function startServer() {
  // Setup routes first
  await registerRoutes(app);
  
  // Setup Vite development server
  await setupVite(app, server);

  const port = process.env.PORT || 5000;
  server.listen(port, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${port}`);
  });
}

startServer().catch(console.error);