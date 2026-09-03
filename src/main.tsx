import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { captureJonSnowDemoAccessFromLocation } from "./services/jonSnowDemoAccess";

// Milestone 12 (human product override, PR #34 Sec 9): captured
// synchronously here, before any React render, so a component's initial
// render (e.g. Home's own useState(() => hasJonSnowDemoAccess())) never
// races the capability being written to sessionStorage and stripped
// from the visible URL.
captureJonSnowDemoAccessFromLocation();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root element was not found.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
