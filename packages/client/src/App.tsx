import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { EditorPage } from "./pages/EditorPage";
import { detectAndSetTimezone } from "./hooks/useTimezoneDetection";

export function App() {
  useEffect(() => {
    detectAndSetTimezone();
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
