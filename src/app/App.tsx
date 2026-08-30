import { CssBaseline, ThemeProvider } from "@mui/material";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SetupProvider } from "../features/case-setup/SetupProvider";
import { AppShell } from "../layout/AppShell";
import { AdvocatesPage } from "../pages/AdvocatesPage";
import { CaseDetailPage } from "../pages/CaseDetailPage";
import { ChargeSheetPage } from "../pages/ChargeSheetPage";
import { DeliberationPage } from "../pages/DeliberationPage";
import { HistoryPage } from "../pages/HistoryPage";
import { JudgesPage } from "../pages/JudgesPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ResultPage } from "../pages/ResultPage";
import { ReviewPage } from "../pages/ReviewPage";
import { RunPage } from "../pages/RunPage";
import { SmartImportPage } from "../pages/SmartImportPage";
import { theme } from "../theme/theme";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/new/charge-sheet" />} />
      <Route path="/new/charge-sheet" element={<ChargeSheetPage />} />
      <Route path="/new/smart-import" element={<SmartImportPage />} />
      <Route path="/new/advocates" element={<AdvocatesPage />} />
      <Route path="/new/judges" element={<JudgesPage />} />
      <Route path="/new/review" element={<ReviewPage />} />
      <Route path="/demo/deliberation" element={<DeliberationPage />} />
      <Route path="/demo/result" element={<ResultPage />} />
      <Route path="/runs/:runId" element={<RunPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/cases/:caseId" element={<CaseDetailPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function AppFrame() {
  return (
    <SetupProvider>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </SetupProvider>
  );
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AppFrame />
      </BrowserRouter>
    </ThemeProvider>
  );
}
