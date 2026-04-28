import { AuthProvider } from "@/auth/AuthContext";
import App from "@/App";
import { CategoryLabelsProvider } from "@/contexts/CategoryLabelsContext";
import "@/index.css";
import "@/theme/theme-light-overrides.css";
import { ThemeProvider } from "@/theme/ThemeContext";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CategoryLabelsProvider>
            <App />
          </CategoryLabelsProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
