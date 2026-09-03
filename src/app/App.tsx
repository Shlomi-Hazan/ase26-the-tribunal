import { CssBaseline, ThemeProvider } from "@mui/material";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SetupProvider } from "../features/case-setup/SetupProvider";
import { AppShell } from "../layout/AppShell";
import { AdvocatesPage } from "../pages/AdvocatesPage";
import { CaseDetailPage } from "../pages/CaseDetailPage";
import { ChargeSheetPage } from "../pages/ChargeSheetPage";
import { DeliberationPage } from "../pages/DeliberationPage";
import { HistoryPage } from "../pages/HistoryPage";
import { HomePage } from "../pages/HomePage";
import { JonSnowRunPage } from "../pages/JonSnowRunPage";
import { JonSnowSettingsPage } from "../pages/JonSnowSettingsPage";
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
      {/* Milestone 12 (Issue #32 Sec 5): `/` is now a small generic Home
         surface -- it previously redirected straight into
         `/new/charge-sheet`, and there was no Home page. */}
      <Route path="/" element={<HomePage />} />
      <Route path="/new/charge-sheet" element={<ChargeSheetPage />} />
      <Route path="/new/smart-import" element={<SmartImportPage />} />
      <Route path="/new/advocates" element={<AdvocatesPage />} />
      <Route path="/new/judges" element={<JudgesPage />} />
      <Route path="/new/review" element={<ReviewPage />} />
      {/* Milestone-4-era mock-data UI-shell preview pages -- unrelated to
         and never confused with /demo/jon-snow below (Issue #32 Sec 10). */}
      <Route path="/demo/deliberation" element={<DeliberationPage />} />
      <Route path="/demo/result" element={<ResultPage />} />
      {/* Milestone 12 (Issue #32 Sec 10; human product override, PR #34
         Sec 16): /demo/jon-snow is now "Modify settings / models" --
         Home's Jon Snow card is the true one-click primary path. The
         generic /runs/:runId below is unchanged and still reused by
         History/Case Detail regardless of a run's origin -- theme is
         decided solely by which of these two routes was used. */}
      <Route path="/demo/jon-snow" element={<JonSnowSettingsPage />} />
      <Route path="/demo/jon-snow/runs/:runId" element={<JonSnowRunPage />} />
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
