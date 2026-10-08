import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

async function start() {
  // In a plain browser during development, fake the Rust backend so the UI can be worked on.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    (await import("./dev/mockBackend")).installMockBackend();
  }
  const { default: App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
