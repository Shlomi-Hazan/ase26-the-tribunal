import { Alert } from "@mui/material";

// Milestone 11 (Issue #27) -- the existing SECURITY.md Sec 15 public-demo
// retention/privacy contract, shown on every surface that displays
// already-submitted (possibly someone else's) historical Case/Run
// material: /history, /cases/:caseId, /runs/:runId. Static, always
// visible, non-modal, and requires no acknowledgement on these read-only
// historical pages -- distinct from the existing pre-run-start Review
// screen warning (docs/ui-spec.md Sec 10), which remains its own
// unmodified gate before Convene. Introduces no authentication/account
// language: V1 has no private per-user ownership guarantee.
export function PublicDemoRetentionNotice() {
  return (
    <Alert severity="info">
      This is a shared, single-tenant public course/demo application. Submitted cases
      and Tribunal runs may be retained and visible in this shared history -- there is
      no private per-user storage or ownership guarantee. Do not submit sensitive,
      private, confidential, or personally identifying information.
    </Alert>
  );
}
