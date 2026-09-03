import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    // Milestone 13 (Issue #36 CI-flake correction) -- evidence-first
    // step 1 of 3 (see Issue #36's own plan): bound Vitest's default
    // worker-thread concurrency, which was previously unset (defaulting
    // to the host's full CPU count). The observed, repeatedly-recurring
    // caseSetup.test.tsx CI-only timeout flake (different individual
    // test hitting the fixed 5000ms default each time, always resolved
    // by an unmodified rerun, always passing locally in isolation) is
    // most consistent with CPU oversubscription on GitHub's small,
    // shared-vCPU hosted runner under this suite's full, uncapped
    // file-level parallelism -- not a genuine hang or a code regression.
    // This targets that root cause directly (less concurrent CPU-bound
    // work competing for the same physical cores) rather than papering
    // over the symptom with a blanket timeout increase. Per Issue #36's
    // plan: measure the effect of this change alone first; only add a
    // modest, evidence-based testTimeout adjustment afterward if
    // legitimate tests still measurably exceed the default under this
    // bounded configuration. `maxWorkers` is Vitest 4's own top-level
    // worker-concurrency option (the pre-4 `poolOptions.threads.
    // maxThreads` shape no longer exists in this installed version).
    maxWorkers: 2
  }
});
