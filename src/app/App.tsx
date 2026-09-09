import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { SetupProvider } from "../features/case-setup/SetupProvider";
import { AppShell } from "../layout/AppShell";
import { AdvocatesPage } from "../pages/AdvocatesPage";
import { CaseDetailPage } from "../pages/CaseDetailPage";
import { ChargeSheetPage } from "../pages/ChargeSheetPage";
import { DeliberationPage } from "../pages/DeliberationPage";
import { HistoryPage } from "../pages/HistoryPage";
import { HomePage } from "../pages/HomePage";
import { JonSnowSettingsPage } from "../pages/JonSnowSettingsPage";
import { JudgesPage } from "../pages/JudgesPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ResultPage } from "../pages/ResultPage";
import { ReviewPage } from "../pages/ReviewPage";
import { RunPage } from "../pages/RunPage";
import { SmartImportPage } from "../pages/SmartImportPage";
import { AppThemeProvider } from "./AppThemeProvider";

// M14 presentation-routing correction (PR #40): the Jon Snow launcher
// used to navigate to a dedicated, dark-themed `/demo/jon-snow/runs/
// :runId` presentation wrapper (the removed JonSnowRunPage). A Jon Snow
// run is a real Tribunal run, so it now navigates straight to the same
// generic `/runs/:runId` route every other run uses (JonSnowSettingsPage
// .tsx). This component exists only so a bookmarked/shared legacy URL
// keeps working -- it does no data fetching, execution, or rendering of
// its own; it immediately hands off to the exact same generic route via
// a `replace` navigation, preserving the runId, so there is exactly one
// canonical presentation route for every real run's data/execution/
// result.
function LegacyJonSnowRunRedirect() {
  const { runId } = useParams();

  return <Navigate replace to={`/runs/${runId}`} />;
}

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
         History/Case Detail regardless of a run's origin -- and, as of
         the M14 presentation-routing correction above, by the Jon Snow
         launcher's own successful-start navigation too. Theme is
         decided solely by the exact `/demo/jon-snow` settings path
         (src/app/jonSnowThemeRoute.ts) -- never by a run's origin or
         content. */}
      <Route path="/demo/jon-snow" element={<JonSnowSettingsPage />} />
      <Route path="/demo/jon-snow/runs/:runId" element={<LegacyJonSnowRunRedirect />} />
      <Route path="/runs/:runId" element={<RunPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/cases/:caseId" element={<CaseDetailPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function AppFrame() {
  // Milestone 14 (Ivory & Iron, Issue #39 Phase 4): AppThemeProvider is
  // ABOVE AppShell so the AppBar itself picks up the Jon Snow dark
  // chamber on /demo/jon-snow* routes, not just the page content below
  // it. It reads useLocation() and so must stay inside BrowserRouter
  // (see App() below).
  return (
    <AppThemeProvider>
      <SetupProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </SetupProvider>
    </AppThemeProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppFrame />
    </BrowserRouter>
  );
}
