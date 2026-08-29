// Milestone 7A -- user-funded OpenRouter BYOK correction (product/
// economics decision). A small, self-contained "paste your key" connect
// panel: inference costs are charged to the user's OWN OpenRouter
// account, never the operator's (SECURITY.md Sec 3.1, docs/economics.md
// Sec 22.1). Deliberately minimal for submission -- the upgradeable-
// later path is OpenRouter's own OAuth + PKCE flow
// (openrouter.ai/docs/use-cases/oauth-pkce), out of scope for this pass.
// Designed for direct reuse by M8's future Tribunal execution flow (same
// credential, same header, same "connect before any paid action" gate)
// -- not implemented in this pass.

import { Alert, Button, Chip, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import {
  clearUserOpenRouterKey,
  getUserOpenRouterKey,
  maskOpenRouterKey,
  setUserOpenRouterKey
} from "../services/openRouterCredential";

export type OpenRouterConnectProps = {
  connected: boolean;
  onConnectedChange: (connected: boolean) => void;
};

export function OpenRouterConnect({ connected, onConnectedChange }: OpenRouterConnectProps) {
  const [draftKey, setDraftKey] = useState("");
  const [error, setError] = useState("");

  function handleConnect() {
    const trimmed = draftKey.trim();

    if (!trimmed) {
      setError("Paste your OpenRouter API key first.");
      return;
    }

    // Never logged, never placed in a URL/query parameter -- held only
    // in this tab's sessionStorage (openRouterCredential.ts).
    setUserOpenRouterKey(trimmed);
    setDraftKey("");
    setError("");
    onConnectedChange(true);
  }

  function handleDisconnect() {
    clearUserOpenRouterKey();
    onConnectedChange(false);
  }

  // Read fresh at render time rather than cached in state -- avoids a
  // second source of truth for "what key is connected" beyond
  // sessionStorage itself. Only the last 4 characters are ever shown
  // ("do not display the full key again after connection").
  const maskedKey = connected ? maskOpenRouterKey(getUserOpenRouterKey() ?? "") : null;

  return (
    <Paper sx={{ p: { xs: 2, md: 3 } }} variant="outlined">
      <Stack spacing={1.5}>
        <Typography variant="subtitle1">OpenRouter connection</Typography>
        <Typography color="text.secondary" variant="body2">
          Extraction inference is charged to <strong>your own</strong> OpenRouter account, never
          ours. Get a key at{" "}
          <a href="https://openrouter.ai/keys" rel="noreferrer" target="_blank">
            openrouter.ai/keys
          </a>
          . Your key is held only in this browser tab for this session — never saved to our
          database, never logged, never shown again after you connect.
        </Typography>

        {connected ? (
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Chip color="success" label={`Connected (${maskedKey})`} size="small" />
            <Button onClick={handleDisconnect} size="small" variant="text">
              Disconnect
            </Button>
          </Stack>
        ) : (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              autoComplete="off"
              fullWidth
              label="OpenRouter API key"
              onChange={(event) => setDraftKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleConnect();
                }
              }}
              size="small"
              type="password"
              value={draftKey}
            />
            <Button onClick={handleConnect} variant="outlined">
              Connect
            </Button>
          </Stack>
        )}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </Paper>
  );
}
