import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { setupVite } from "./vite";
import { registerRoutes } from "./routes";
import { logger } from "./logger";
import net from "node:net";

const app = express();
const server = createServer(app);

// Add JSON parsing middleware with generous limit to support SegVol payloads
// SegVol requests can include large per-slice arrays and optional volume context
app.use(express.json({ limit: '500mb' }));

async function startServer() {
  // Setup routes first
  await registerRoutes(app);
  
  // Setup Vite development server
  await setupVite(app, server);

  // Choose a free port: honor PORT if supplied; otherwise scan preferred list
  const preferredPorts = [5173, 5174, 5175, 5176, 5177, 3001, 8787];
  const envPort = Number(process.env.PORT);

  const findAvailablePort = async (candidates: number[]): Promise<number> => {
    const tryListen = (p: number) => new Promise<boolean>((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close(() => resolve(true));
        })
        .listen(p, '0.0.0.0');
    });
    if (Number.isFinite(envPort) && envPort > 0) {
      const ok = await tryListen(envPort);
      if (ok) return envPort;
    }
    for (const p of candidates) {
      const ok = await tryListen(p);
      if (ok) return p;
    }
    // Last resort: OS-assigned ephemeral
    return await new Promise<number>((resolve) => {
      const s = net.createServer()
        .once('listening', () => {
          const addr = s.address();
          const chosen = typeof addr === 'object' && addr ? addr.port : 0;
          s.close(() => resolve(chosen));
        })
        .listen(0, '0.0.0.0');
    });
  };

  const port = await findAvailablePort(preferredPorts);
  server.listen(port, "0.0.0.0", () => {
    logger.info(`🚀 Server running on port ${port}`, 'server');
  });
}

startServer().catch(console.error);
