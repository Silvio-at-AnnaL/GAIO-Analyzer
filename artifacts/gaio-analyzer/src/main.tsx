// Suppress AbortErrors that fire when in-flight poll requests are cancelled
// on component unmount during navigation — these are expected, not real errors.
window.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason instanceof DOMException &&
    event.reason.name === "AbortError"
  ) {
    event.preventDefault();
  }
});

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
