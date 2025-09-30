import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

try {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Root element not found");
  }
  createRoot(root).render(<App />);
} catch (error) {
  console.error("Failed to mount React app:", error);
  document.body.innerHTML = `<div style="padding: 20px; color: red;">
    <h1>Failed to load application</h1>
    <pre>${error}</pre>
  </div>`;
}
