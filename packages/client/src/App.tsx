import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { EditorPage } from "./pages/EditorPage";
import { detectAndSetTimezone } from "./hooks/useTimezoneDetection";

export function App() {
  useEffect(() => {
    // I5 (review 2026-04-24): abort the detection on unmount so a
    // late-resolving GET/PATCH can't land after the app has torn down
    // (matters for tests and for tab/window teardown during startup).
    const controller = new AbortController();
    detectAndSetTimezone(controller.signal);
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects/:slug" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}
