import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

try {
  const root = document.getElementById("root");
  if (root) {
    createRoot(root).render(<App />);
  } else {
    console.error("Root element not found");
  }
} catch (error) {
  console.error("React rendering failed:", error);
  // Fallback UI
  document.body.innerHTML = `
    <div style="background:#000;color:#fff;padding:20px;font-family:Arial;text-align:center;min-height:100vh;">
      <h1 style="font-size:3rem;margin:50px 0;">CONVERGE</h1>
      <div style="background:#1a1a1a;padding:20px;border-radius:8px;max-width:600px;margin:0 auto;">
        <h2>DICOM Medical Imaging Platform</h2>
        <p>React Loading Error - Using Fallback Mode</p>
        <div style="margin:20px 0;">
          <button onclick="window.location.href='/test'" style="background:#4338ca;color:white;padding:10px 20px;border:none;border-radius:4px;cursor:pointer;margin:10px;">System Status</button>
          <button onclick="window.location.href='/dicom-viewer?studyId=4'" style="background:#059669;color:white;padding:10px 20px;border:none;border-radius:4px;cursor:pointer;margin:10px;">View CT Scans</button>
        </div>
      </div>
    </div>
  `;
}
