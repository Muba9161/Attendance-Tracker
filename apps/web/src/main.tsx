import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

// Gracefully handle benign Recharts ResizeObserver loop notifications in browsers
if (typeof window !== "undefined") {
  const originalErrorHandler = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    if (
      typeof message === "string" &&
      (message.includes("ResizeObserver loop") || message.includes("undelivered notifications"))
    ) {
      return true; // prevent unnecessary error logging for benign browser resize observer notifications
    }
    if (originalErrorHandler) {
      return originalErrorHandler(message, source, lineno, colno, error);
    }
    return false;
  };
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Failed to find the root element in index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

