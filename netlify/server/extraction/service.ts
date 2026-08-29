// Milestone 7A -- initial/retry extraction orchestration (ADR 0004
// Decisions 8, 13, 15, 16, 19). Implements the exact ordered flow the
// implementation task locked: admission control -> deterministic input
// processing -> resolve/freeze semantic config -> fingerprint/replay
// handling -> authoritative model/route/economics guard -> handler-time
// check -> atomic claim -> post-claim handler-time recheck -> pinned
// provider request -> response handling -> strict parse/validate ->
// terminalize -> persist validated_result -> return staged preview.
//
// Never reordered into spend-before-claim. Normal automated tests inject
// FakeExtractionProvider/FakeExtractionRepository -- zero real network
// calls anywhere in this module's own test suite.

import Decimal from "decimal.js";
import { z } from "zod";
import type { PreflightReasonCode } from "../openrouter/errors";
import { normalizeHttpFailure, ProviderError } from "../openrouter/errors";
import type { OpenRouterProvider } from "../openrouter/provider";
import type { ModelMetadataCache, Clock } from "../openrouter/cache";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import { buildFutureCompletionRequest } from "../openrouter/executionRequest";
import {
  packageExtractionJsonSchema,
  packageExtractionSchema,
  deriveExtractionStatus,
  type PackageExtractionResult
} from "../../../src/schemas/packageExtraction";
import { getPackageExtractionPrompt } from "../../../src/prompts/package-extraction/registry";
import { resolveNormalizedDossier, type DossierSource } from "./inputPipeline";
import { computeExtractionFingerprint } from "./fingerprint";
import { HandlerDeadline, type MonotonicClock } from "./deadline";
import {
  ExtractionError,
  isRetryableExtractionFailure,
  type ExtractionHardFailureCode
} from "./errors";
import {
  ExtractionAttemptAlreadyClaimedError,
  ExtractionIdempotencyConflictError,
  type BlockInput,
  type ExtractionRepository,
  type SetupExtractionAttemptRow
} from "./repository";
import {
  evaluateExtractionEligibility,
  evaluateRetryBudget,
  type ExtractionPreflightResult
} from "./preflight";
import {
  EXTRACTION_NEW_START_RATE_LIMIT,
  EXTRACTION_OUTPUT_CAP_TOKENS,
  EXTRACTION_PREFLIGHT_RATE_LIMIT,
  EXTRACTION_RETRY_RATE_LIMIT
} from "./constants";
import { hashedAdmissionBucket } from "./rateLimit";
import { buildDossierUserMessageContent, EXTRACTION_STRUCTURED_OUTPUT_NAME } from "./tokenEstimation";

export type ExtractionSourceDeps = {
  provider: OpenRouterProvider;
  // Used ONLY for the completion call, so it can be constructed with the
  // freshly computed post-claim effective timeout (Decision 8) -- kept
  // distinct from `provider` (used for listModels/listEndpoints, where a
  // dynamic per-request timeout has no meaning) rather than reaching into
  // RealOpenRouterProvider's internals. Defaults to `provider` itself when
  // omitted (every test's fake provider ignores timeoutMs entirely).
  createTimedProvider?: (timeoutMs: number) => OpenRouterProvider;
  // New this pass (independent pre-live audit, Section 6): same idea as
  // createTimedProvider above, but for the metadata (listModels/
  // listEndpoints) path -- constructs a provider bounded to the freshly
  // recomputed remaining handler time for each individual metadata call.
  createTimedMetadataProvider?: (timeoutMs: number) => OpenRouterProvider;
  repository: ExtractionRepository;
  // Corrected this pass (second independent pre-live re-audit, Section
  // 9): removed the dead `rateLimiter?: SlidingWindowRateLimiter`
  // field -- preflight/new-start/retry are now ALL authoritatively
  // gated through `repository.checkAndRecordAdmission` (Sections 3/4/9),
  // and nothing in this module ever read this field even before that;
  // a plumbed-through-but-silently-ignored dependency is exactly the
  // kind of misleading residue this pass exists to remove, not merely
  // re-document. `SlidingWindowRateLimiter` itself (rateLimit.ts)
  // remains available/tested as a standalone utility -- it is just no
  // longer wired into this service.
  sourceIp: string;
  configuredModelId: string;
  promptVersion: string;
  modelCache?: ModelMetadataCache<RawOpenRouterModel[]>;
  endpointCache?: ModelMetadataCache<RawOpenRouterEndpoint[]>;
  metadataClock?: Clock;
  deadlineClock?: MonotonicClock;
};

export type ApiResult = { statusCode: number; body: Record<string, unknown> };

const extractionRequestIdSchema = z.string().uuid();

const dossierSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({
    kind: z.literal("file"),
    filename: z.string(),
    contentBase64: z.string()
  })
]);

export function validateDossierSource(raw: unknown): DossierSource {
  const result = dossierSourceSchema.safeParse(raw);

  if (!result.success) {
    throw new ExtractionError("INPUT_INVALID", "Invalid source.");
  }

  return result.data;
}

function deriveSourceType(
  sourceKind: "text" | "file",
  sourceFilename: string | null
): "PASTED_TEXT" | "TXT_FILE" | "MD_FILE" | "PDF_FILE" {
  if (sourceKind === "text" || !sourceFilename) {
    return "PASTED_TEXT";
  }

  const lower = sourceFilename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    return "PDF_FILE";
  }

  if (lower.endsWith(".md")) {
    return "MD_FILE";
  }

  return "TXT_FILE";
}

// Maps M7's granular PreflightReasonCode set onto the extraction
// taxonomy's coarser hard-failure codes (ADR Decision 16). PRICING_UNAVAILABLE
// and BUDGET_EXCEEDED get their own dedicated extraction codes;
// everything else collapses into MODEL_NOT_ELIGIBLE -- never left
// unmapped.
function mapReasonCodesToExtractionFailure(
  reasonCodes: PreflightReasonCode[]
): ExtractionHardFailureCode {
  if (reasonCodes.includes("BUDGET_EXCEEDED")) {
    return "BLOCKED_BUDGET";
  }

  if (
    reasonCodes.includes("PRICING_UNAVAILABLE") ||
    reasonCodes.includes("PRICING_UNREPRESENTABLE")
  ) {
    return "PRICING_UNAVAILABLE";
  }

  return "MODEL_NOT_ELIGIBLE";
}

function blockedResponse(
  statusCode: number,
  errorCode: string,
  message: string,
  attempt?: Record<string, unknown>
): ApiResult {
  return {
    statusCode,
    body: { status: "blocked", errorCode, message, ...(attempt ? { attempt } : {}) }
  };
}

function attemptSummary(attempt: SetupExtractionAttemptRow) {
  return {
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    canonicalModelId: attempt.canonicalModelId,
    providerEndpointTag: attempt.providerEndpointTag,
    conservativeMaxCostUsd: attempt.conservativeMaxCostUsd,
    actualInputTokens: attempt.actualInputTokens,
    actualOutputTokens: attempt.actualOutputTokens,
    actualCostUsd: attempt.actualCostUsd,
    latencyMs: attempt.latencyMs,
    errorCode: attempt.errorCode
  };
}

function successResponse(
  validatedResult: PackageExtractionResult,
  attempt: SetupExtractionAttemptRow
): ApiResult {
  const status = deriveExtractionStatus(validatedResult.warnings);

  return {
    statusCode: 200,
    body: {
      status: status === "success" ? "success" : "needs_review",
      draft: validatedResult,
      warnings: validatedResult.warnings,
      attempt: attemptSummary(attempt)
    }
  };
}

function reValidatePersistedResult(raw: unknown): PackageExtractionResult {
  const result = packageExtractionSchema.safeParse(raw);

  if (!result.success) {
    throw new ExtractionError(
      "INVALID_STRUCTURED_OUTPUT",
      "Persisted extraction result failed re-validation."
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------
// Preflight (Decision 19) -- read-only, zero createChatCompletion calls,
// zero persistence, uses the CURRENT configuration (a preflight is never
// itself a logical extraction, so there is nothing to freeze).
// ---------------------------------------------------------------------

export async function runExtractionPreflight(
  rawSource: unknown,
  deps: ExtractionSourceDeps
): Promise<ApiResult> {
  // Corrected this pass (second independent pre-live re-audit, Section
  // 9): preflight now shares the SAME Supabase-backed authoritative
  // admission RPC new-start uses (Section 4), under its own bucket
  // namespace/threshold, rather than the process-local
  // SlidingWindowRateLimiter alone -- that limiter cannot enforce a
  // shared bound across Netlify's ephemeral, horizontally-scaled
  // runtimes any more for preflight than it could for new-start.
  // Preflight has no extraction id yet, so it passes `null` -- every
  // preflight call is counted independently, never deduplicated.
  const admitted = await deps.repository.checkAndRecordAdmission(
    hashedAdmissionBucket("extraction-preflight", deps.sourceIp),
    null,
    EXTRACTION_PREFLIGHT_RATE_LIMIT.windowMs / 1000,
    EXTRACTION_PREFLIGHT_RATE_LIMIT.maxAcceptedRequests
  );

  if (!admitted) {
    return blockedResponse(429, "RATE_LIMITED", "Too many preflight requests. Try again shortly.");
  }

  const source = validateDossierSource(rawSource);
  const deadline = new HandlerDeadline(deps.deadlineClock);

  let normalized;

  try {
    normalized = await resolveNormalizedDossier(source, deadline);
  } catch (error) {
    return toErrorResponse(error);
  }

  let eligibility;

  try {
    eligibility = await evaluateExtractionEligibility(
      deps.configuredModelId,
      normalized.normalizedText,
      {
        provider: deps.provider,
        deadline,
        createTimedMetadataProvider: deps.createTimedMetadataProvider,
        modelCache: deps.modelCache,
        endpointCache: deps.endpointCache,
        clock: deps.metadataClock
      }
    );
  } catch (error) {
    return toErrorResponse(error);
  }

  return { statusCode: 200, body: toPreflightBody(eligibility, deps.promptVersion) };
}

function toPreflightBody(eligibility: ExtractionPreflightResult, promptVersion: string) {
  return {
    eligible: eligibility.eligible,
    configuredModelId: eligibility.configuredModelId,
    canonicalModelId: eligibility.canonicalModelId,
    providerEndpointTag: eligibility.providerEndpointTag,
    // Corrected this pass (Section 2/14): the quote/UI displays the
    // LOGICAL (both-attempts) figure as the headline estimate -- what
    // the user is actually agreeing to spend up to -- with the
    // per-attempt figure also exposed for the secondary audit detail.
    logicalConservativeMaxCostUsd: eligibility.logicalConservativeMaxCostUsd,
    perAttemptConservativeMaxCostUsd: eligibility.perAttemptConservativeMaxCostUsd,
    hardCeilingUsd: eligibility.hardCeilingUsd,
    blockedReasonCodes: eligibility.eligible
      ? []
      : [mapReasonCodesToExtractionFailure(eligibility.blockedReasonCodes)],
    pricingObservedAt: eligibility.pricingObservedAt,
    // New this pass (second independent pre-live re-audit, Section 8):
    // ADR 0004 Decision 18 requires Extraction Review to show the frozen
    // prompt version at secondary audit-detail level -- the prior
    // PreflightResponse never exposed it at all, so the UI could not
    // possibly display it no matter what it tried to render. This IS
    // the version a NEW extraction would freeze if started right now
    // (Decision 15) -- preflight is inherently pre-claim, so there is no
    // "stored" version yet to report instead.
    promptVersion
  };
}

function toErrorResponse(error: unknown): ApiResult {
  if (error instanceof ExtractionError) {
    return blockedResponse(400, error.code, error.message);
  }

  if (error instanceof ProviderError) {
    return blockedResponse(502, "PROVIDER_UNAVAILABLE", "Provider request failed.");
  }

  return blockedResponse(500, "INPUT_INVALID", "Unexpected error.");
}

// ---------------------------------------------------------------------
// Initial billable endpoint (Decision 19/21).
// ---------------------------------------------------------------------

export async function submitInitialExtraction(
  extractionId: string,
  rawSource: unknown,
  deps: ExtractionSourceDeps
): Promise<ApiResult> {
  const idResult = extractionRequestIdSchema.safeParse(extractionId);

  if (!idResult.success) {
    return blockedResponse(400, "INPUT_INVALID", "extractionRequestId must be a valid UUID.");
  }

  // Step 0 (idempotent-replay lookup, Decision 15's four-row table):
  // only a GENUINELY NEW logical extraction consumes a rate-limit
  // admission slot (Decision 19) -- checked here, before admission
  // control, so a replay never counts.
  const existingExtraction = await deps.repository.getExtraction(extractionId);

  if (existingExtraction) {
    return replayExisting(extractionId, rawSource, existingExtraction.requestFingerprint, deps);
  }

  // Step 1: admission control -- new-start rate limit. Corrected this
  // pass (independent pre-live audit, Section 4): the AUTHORITATIVE
  // check is the Supabase-backed admission RPC (race-safe across
  // Netlify's ephemeral, horizontally-scaled runtimes) -- a
  // single-process in-memory limiter cannot enforce this exact
  // production target. The bucket is a hashed, privacy-conscious
  // representation of the trusted source IP (never a raw client-
  // supplied forwarding header, Section 5).
  //
  // Corrected AGAIN this pass (second independent pre-live re-audit,
  // Section 3): passing `extractionId` here is the fix, not merely the
  // existing-row check above. The existing-row check alone still lets
  // two concurrent requests for the SAME brand-new id both observe "no
  // row yet" (the row is only created much later, by whichever wins
  // claimAttemptOne) and both reach this line -- without an identity key
  // here, each would independently consume its own admission slot for
  // what is really one logical request. The RPC now deduplicates by
  // (bucket, extractionId) itself (under the same per-bucket advisory
  // lock it already used for the sliding-window count), so both calls
  // return `true` but only the first is actually counted.
  const admissionBucket = hashedAdmissionBucket("extraction-start", deps.sourceIp);
  const admitted = await deps.repository.checkAndRecordAdmission(
    admissionBucket,
    extractionId,
    EXTRACTION_NEW_START_RATE_LIMIT.windowMs / 1000,
    EXTRACTION_NEW_START_RATE_LIMIT.maxAcceptedRequests
  );

  if (!admitted) {
    return blockedResponse(429, "RATE_LIMITED", "Too many new extractions started. Try again shortly.");
  }

  const source = validateDossierSource(rawSource);
  const deadline = new HandlerDeadline(deps.deadlineClock);

  // Step 2: deterministic input processing. Corrected this pass
  // (independent pre-live audit, Section 12): a failure here occurs
  // BEFORE any real dossier content was ever successfully normalized --
  // there is no genuine semantic identity to persist yet, and the prior
  // revision's fingerprint over an empty string was a fabricated
  // placeholder, not this request's actual (unknowable) content.
  // Preferred design: return the input error directly, with zero
  // logical-extraction persistence -- these failures are deterministic
  // functions of the input alone, so idempotency tracking adds nothing
  // real to protect.
  let normalized;

  try {
    normalized = await resolveNormalizedDossier(source, deadline);
  } catch (error) {
    return toErrorResponse(error);
  }

  // Step 3: resolve/freeze semantic config (this IS a new id -- current
  // application config is what freezes). A real fingerprint now exists,
  // so every guard failure from this point on IS persisted as a
  // pre-claim block (Decision 13) under this genuine fingerprint.
  const sourceType = deriveSourceType(normalized.sourceKind, normalized.sourceFilename);
  const requestFingerprint = computeExtractionFingerprint({
    normalizedDossierText: normalized.normalizedText,
    promptVersion: deps.promptVersion,
    configuredModelId: deps.configuredModelId
  });

  // Step 4: current prompt version must resolve BEFORE any claim
  // (independent pre-live audit, Section 13) -- fail closed here rather
  // than claiming attempt #1 and only discovering the historical
  // registry can't resolve the CURRENT version after spend-adjacent
  // state already exists. Retry already resolves its own STORED version
  // before claim; this mirrors that same discipline for a new id's
  // CURRENT version.
  if (!getPackageExtractionPrompt(deps.promptVersion)) {
    return safeBlockOrConflict(
      deps,
      {
        extractionId,
        sourceType,
        requestFingerprint,
        promptVersion: deps.promptVersion,
        configuredModelId: deps.configuredModelId,
        status: "PROMPT_VERSION_UNAVAILABLE",
        // A NEW logical extraction -- valid only before any attempt has
        // ever been claimed for this id (Section 5).
        expectedMaxAttemptNumber: 0
      },
      () =>
        blockedResponse(
          400,
          "PROMPT_VERSION_UNAVAILABLE",
          "The current extraction prompt version could not be resolved."
        )
    );
  }

  // Step 5 (authoritative guard) evaluated before the deadline recheck
  // per the locked step order -- pre-claim deadline is checked
  // immediately below it, both still strictly before any claim. Passes
  // `deadline` through so metadata fetches are bounded by the SAME
  // handler-wide deadline (Section 6) -- a metadata-path
  // INPUT_PROCESSING_TIMEOUT propagates as its own ExtractionError,
  // caught and persisted like any other pre-claim block below.
  let eligibility;

  try {
    eligibility = await evaluateExtractionEligibility(
      deps.configuredModelId,
      normalized.normalizedText,
      {
        provider: deps.provider,
        deadline,
        createTimedMetadataProvider: deps.createTimedMetadataProvider,
        modelCache: deps.modelCache,
        endpointCache: deps.endpointCache,
        clock: deps.metadataClock
      }
    );
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : "PRICING_UNAVAILABLE";

    return safeBlockOrConflict(
      deps,
      {
        extractionId,
        sourceType,
        requestFingerprint,
        promptVersion: deps.promptVersion,
        configuredModelId: deps.configuredModelId,
        status: code,
        expectedMaxAttemptNumber: 0
      },
      () => toErrorResponse(error)
    );
  }

  if (!eligibility.eligible || !eligibility.route) {
    const failureCode = mapReasonCodesToExtractionFailure(eligibility.blockedReasonCodes);

    return safeBlockOrConflict(
      deps,
      {
        extractionId,
        sourceType,
        requestFingerprint,
        promptVersion: deps.promptVersion,
        configuredModelId: deps.configuredModelId,
        status: failureCode,
        expectedMaxAttemptNumber: 0
      },
      () => blockedResponse(400, failureCode, "The configured extraction model/route is not eligible.")
    );
  }

  // Step 6: pre-claim handler-time check.
  try {
    deadline.assertMinimumWindow();
  } catch (error) {
    return safeBlockOrConflict(
      deps,
      {
        extractionId,
        sourceType,
        requestFingerprint,
        promptVersion: deps.promptVersion,
        configuredModelId: deps.configuredModelId,
        status: "INPUT_PROCESSING_TIMEOUT",
        expectedMaxAttemptNumber: 0
      },
      () => toErrorResponse(error)
    );
  }

  // Step 7: atomic attempt #1 claim. A concurrent caller may have created
  // this same id with a DIFFERENT dossier in the race window between our
  // own earlier fingerprint computation and this claim -- the RPC/fake
  // repository re-checks the fingerprint atomically and throws
  // ExtractionIdempotencyConflictError in that case, defense in depth
  // beyond the "no existing row yet" check already performed above.
  let claim;

  try {
    claim = await deps.repository.claimAttemptOne({
      extractionId,
      sourceType,
      requestFingerprint,
      promptVersion: deps.promptVersion,
      configuredModelId: deps.configuredModelId,
      canonicalModelId: eligibility.route.canonicalModelId,
      providerEndpointTag: eligibility.route.providerEndpointTag,
      perAttemptConservativeMaxCostUsd: eligibility.perAttemptConservativeMaxCostUsd
    });
  } catch (error) {
    if (error instanceof ExtractionIdempotencyConflictError) {
      return blockedResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "A different dossier was already submitted for this extraction request."
      );
    }

    throw error;
  }

  if (!claim.wonClaim) {
    // Lost the claim (a genuine concurrent duplicate of this exact new
    // id) -- zero provider calls, return the winner's current state.
    return await loadAttemptOutcome(extractionId, deps);
  }

  return runAttempt({
    extractionId,
    attemptNumber: 1,
    promptVersion: deps.promptVersion,
    normalizedDossierText: normalized.normalizedText,
    route: eligibility.route,
    deadline,
    deps
  });
}

// ---------------------------------------------------------------------
// Idempotent replay of an existing extractionRequestId (Decision 15's
// four-row table). Never consumes a rate-limit admission slot.
// ---------------------------------------------------------------------

async function replayExisting(
  extractionId: string,
  rawSource: unknown,
  storedFingerprint: string,
  deps: ExtractionSourceDeps
): Promise<ApiResult> {
  let source: DossierSource;

  try {
    source = validateDossierSource(rawSource);
  } catch (error) {
    return toErrorResponse(error);
  }

  const extraction = await deps.repository.getExtraction(extractionId);

  if (!extraction) {
    return blockedResponse(500, "INPUT_INVALID", "Extraction disappeared unexpectedly.");
  }

  const deadline = new HandlerDeadline(deps.deadlineClock);
  let normalized;

  try {
    normalized = await resolveNormalizedDossier(source, deadline);
  } catch {
    // Even a re-normalization failure on replay must still be evaluated
    // as a fingerprint check first (a mismatched dossier is a conflict,
    // not merely "invalid input") -- but since we cannot compute a
    // fingerprint from unparseable input, this narrow case reports the
    // original parse failure directly. Zero provider calls either way.
    return blockedResponse(400, "INPUT_INVALID", "Dossier could not be re-normalized for replay.");
  }

  const recomputedFingerprint = computeExtractionFingerprint({
    normalizedDossierText: normalized.normalizedText,
    promptVersion: extraction.promptVersion,
    configuredModelId: extraction.configuredModelId
  });

  if (recomputedFingerprint !== storedFingerprint) {
    return blockedResponse(
      409,
      "IDEMPOTENCY_CONFLICT",
      "A different dossier was already submitted for this extraction request."
    );
  }

  // Existing CLAIMED -> in-progress, zero calls. Existing terminal
  // (hard failure/block or success/needs-review) -> same state, zero
  // calls (re-validating a persisted validated_result on the way out).
  return loadAttemptOutcome(extractionId, deps);
}

// The logical extraction's effective outcome is always its LATEST
// attempt's outcome (ADR Decision 13: "attempt #2 becomes the effective
// result if it succeeds") -- attempt #2 is checked first, falling back to
// attempt #1 only when #2 was never claimed at all.
async function loadAttemptOutcome(
  extractionId: string,
  deps: ExtractionSourceDeps
): Promise<ApiResult> {
  // Corrected this pass (independent pre-live audit, Section 9):
  // opportunistic stale-claim reconciliation now also runs on this
  // plain read/replay path, not only inside the two claim RPCs -- a
  // replay of a CLAIMED attempt at/beyond the 120s stale threshold
  // (no retry ever attempted) previously returned "in_progress"
  // forever instead of surfacing UNKNOWN_OUTCOME.
  await deps.repository.reconcileAttempts(extractionId);

  // Attempt #2's result, if it exists at all, is always the logical
  // extraction's effective one (ADR Decision 13) -- checked first.
  const attemptTwo = await deps.repository.getAttempt(extractionId, 2);
  const attempt = attemptTwo ?? (await deps.repository.getAttempt(extractionId, 1));

  if (!attempt) {
    // No attempt row exists at all -- this is a pre-claim block outcome
    // (ADR Decision 13's "no-spend block persistence"): only
    // setup_extractions.final_status carries the terminal reason, zero
    // attempt rows were ever created.
    const extraction = await deps.repository.getExtraction(extractionId);

    if (extraction?.finalStatus) {
      return blockedResponse(
        400,
        extraction.finalStatus,
        "This extraction request was blocked before any provider attempt."
      );
    }

    return blockedResponse(
      500,
      "INPUT_INVALID",
      "No attempt exists for this extraction request."
    );
  }

  if (attempt.status === "CLAIMED") {
    return {
      statusCode: 200,
      body: { status: "in_progress", attempt: attemptSummary(attempt) }
    };
  }

  if (
    attempt.status === "SUCCESS" ||
    attempt.status === "EXTRACTION_INCOMPLETE" ||
    attempt.status === "EXTRACTION_AMBIGUOUS"
  ) {
    if (!attempt.validatedResult) {
      return blockedResponse(500, "INPUT_INVALID", "Persisted result missing.");
    }

    try {
      const revalidated = reValidatePersistedResult(attempt.validatedResult);

      return successResponse(revalidated, attempt);
    } catch {
      return blockedResponse(
        500,
        "INVALID_STRUCTURED_OUTPUT",
        "Persisted extraction result failed re-validation."
      );
    }
  }

  const failureCode = (attempt.errorCode ?? attempt.status) as string;

  return blockedResponse(400, failureCode, "This extraction attempt did not succeed.", attemptSummary(attempt));
}

// Corrected this pass (second independent pre-live re-audit, Section 4):
// the prior revision's `safeBlock` caught EVERY exception from
// `deps.repository.block(...)` unconditionally, including a genuine
// `ExtractionIdempotencyConflictError` -- the SQL/fake repository's own
// real semantic-identity mismatch signal (this extractionId already
// belongs to a DIFFERENT dossier/fingerprint). Swallowing that meant a
// concurrent/racing request that reused someone else's id, then reached
// a pre-claim block, silently got back whatever THIS request's own
// original failure reason happened to be (e.g. PROMPT_VERSION_UNAVAILABLE)
// instead of the true 409 IDEMPOTENCY_CONFLICT that actually happened --
// masking a real conflict as an unrelated error. `ExtractionIdempotencyConflictError`
// now always propagates to `fallback`'s caller as 409
// IDEMPOTENCY_CONFLICT.
//
// `ExtractionAttemptAlreadyClaimedError` (Section 5) is handled the same
// way, in spirit: this pre-claim block LOST a race against a concurrent
// request for the SAME logical id that already claimed (or completed)
// attempt #1 -- final_status was NOT overwritten, so this call is no
// longer the authoritative outcome. Rather than return its own stale
// failure reason (or a made-up conflict code), it resolves through the
// SAME state machine loadAttemptOutcome/replay already use, so the
// caller gets back whatever the ACTUAL winning attempt's real outcome
// is (in_progress / success / needs_review / a real terminal failure).
//
// Every OTHER exception (e.g. a transient persistence write failure)
// still follows the existing best-effort audit-write policy -- it never
// masks the real pre-claim failure this call was already about to
// return.
async function safeBlockOrConflict(
  deps: ExtractionSourceDeps,
  input: BlockInput,
  fallback: () => ApiResult
): Promise<ApiResult> {
  try {
    await deps.repository.block(input);
  } catch (error) {
    if (error instanceof ExtractionIdempotencyConflictError) {
      return blockedResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "A different dossier was already submitted for this extraction request."
      );
    }

    if (error instanceof ExtractionAttemptAlreadyClaimedError) {
      return loadAttemptOutcome(input.extractionId, deps);
    }
    // Best-effort audit write -- any OTHER persistence error never masks
    // the real pre-claim failure already about to be returned below.
  }

  return fallback();
}

// ---------------------------------------------------------------------
// Provider call + terminalization -- shared by attempt #1 and attempt #2
// (Decision 8/13, steps 8-15).
// ---------------------------------------------------------------------

async function runAttempt(params: {
  extractionId: string;
  attemptNumber: 1 | 2;
  promptVersion: string;
  normalizedDossierText: string;
  route: NonNullable<ExtractionPreflightResult["route"]>;
  deadline: HandlerDeadline;
  deps: ExtractionSourceDeps;
}): Promise<ApiResult> {
  const { extractionId, attemptNumber, promptVersion, normalizedDossierText, route, deadline, deps } =
    params;

  // Step 8: post-claim handler-time recheck -- freshly recomputed,
  // never reusing the pre-claim remainingMs.
  try {
    deadline.assertMinimumWindow();
  } catch {
    await deps.repository.terminalize({
      extractionId,
      attemptNumber,
      status: "INPUT_PROCESSING_TIMEOUT",
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostUsd: null,
      latencyMs: null,
      providerRequestId: null,
      errorCode: "INPUT_PROCESSING_TIMEOUT",
      validatedResult: null
    });

    return blockedResponse(
      400,
      "INPUT_PROCESSING_TIMEOUT",
      "Insufficient time remained to attempt the provider call."
    );
  }

  const promptBuilder = getPackageExtractionPrompt(promptVersion);

  if (!promptBuilder) {
    // Should not arise under the immutability rule, but handled
    // explicitly rather than assumed impossible (Decision 7).
    await deps.repository.terminalize({
      extractionId,
      attemptNumber,
      status: "PROVIDER_UNAVAILABLE",
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostUsd: null,
      latencyMs: null,
      providerRequestId: null,
      errorCode: "PROMPT_VERSION_UNAVAILABLE",
      validatedResult: null
    });

    return blockedResponse(
      400,
      "PROMPT_VERSION_UNAVAILABLE",
      "The historical prompt for this extraction's version could not be resolved."
    );
  }

  const effectiveTimeoutMs = deadline.effectiveProviderTimeoutMs();
  const timedProvider = deps.createTimedProvider
    ? deps.createTimedProvider(effectiveTimeoutMs)
    : deps.provider;

  const request = buildFutureCompletionRequest({
    route,
    messages: [
      { role: "system", content: promptBuilder() },
      {
        role: "user",
        // Corrected this pass (second independent pre-live re-audit,
        // Section 6): this was a SECOND, independently hard-coded copy
        // of the exact wrapper text -- tokenEstimation.ts's
        // buildDossierUserMessageContent claimed to be the ONE canonical
        // serialization shared with the real request builder, but this
        // call site never actually used it, so that anti-drift claim was
        // false. Now genuinely the same function call, not merely the
        // same literal text kept in sync by hand.
        content: buildDossierUserMessageContent(normalizedDossierText)
      }
    ],
    maxCompletionTokens: EXTRACTION_OUTPUT_CAP_TOKENS,
    structuredOutput: { name: EXTRACTION_STRUCTURED_OUTPUT_NAME, schema: packageExtractionJsonSchema }
  });

  const startedAtMs = Date.now();
  let providerErrorCode: ExtractionHardFailureCode | null = null;
  let actualInputTokens: number | null = null;
  let actualOutputTokens: number | null = null;
  let actualCostUsd: string | null = null;
  let providerRequestId: string | null = null;
  let validatedResult: PackageExtractionResult | null = null;
  let terminalStatus: ExtractionHardFailureCode | "SUCCESS" | "EXTRACTION_INCOMPLETE" | "EXTRACTION_AMBIGUOUS";

  try {
    const result = await timedProvider.createChatCompletion(request);

    providerRequestId = result.raw.id ?? null;

    if (result.raw.usage) {
      actualInputTokens = result.raw.usage.prompt_tokens ?? null;
      actualOutputTokens = result.raw.usage.completion_tokens ?? null;
      actualCostUsd =
        result.raw.usage.cost !== undefined ? new Decimal(result.raw.usage.cost).toFixed() : null;
    }

    const content = result.raw.choices[0]?.message.content ?? null;

    if (content === null) {
      throw new ExtractionError("INVALID_STRUCTURED_OUTPUT", "Provider returned no content.");
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new ExtractionError("INVALID_STRUCTURED_OUTPUT", "Provider content was not valid JSON.");
    }

    const schemaResult = packageExtractionSchema.safeParse(parsedJson);

    if (!schemaResult.success) {
      throw new ExtractionError(
        "INVALID_STRUCTURED_OUTPUT",
        "Provider output failed schema validation."
      );
    }

    validatedResult = schemaResult.data;
    terminalStatus = deriveExtractionStatus(validatedResult.warnings) === "success"
      ? "SUCCESS"
      : deriveExtractionStatus(validatedResult.warnings) === "needs_review_incomplete"
        ? "EXTRACTION_INCOMPLETE"
        : "EXTRACTION_AMBIGUOUS";
  } catch (error) {
    if (error instanceof ExtractionError) {
      providerErrorCode = error.code;
      terminalStatus = error.code;
    } else if (error instanceof ProviderError) {
      const mapped = mapProviderErrorToExtractionFailure(error);

      providerErrorCode = mapped;
      terminalStatus = mapped;
    } else {
      providerErrorCode = "PROVIDER_UNAVAILABLE";
      terminalStatus = "PROVIDER_UNAVAILABLE";
    }
  }

  const latencyMs = Date.now() - startedAtMs;

  await deps.repository.terminalize({
    extractionId,
    attemptNumber,
    status: terminalStatus,
    actualInputTokens,
    actualOutputTokens,
    actualCostUsd,
    latencyMs,
    providerRequestId,
    errorCode: providerErrorCode,
    validatedResult
  });

  const attempt = await deps.repository.getAttempt(extractionId, attemptNumber);

  if (!attempt) {
    return blockedResponse(500, "INPUT_INVALID", "Attempt disappeared after terminalization.");
  }

  if (validatedResult) {
    return successResponse(validatedResult, attempt);
  }

  const message =
    isRetryableExtractionFailure(terminalStatus as ExtractionHardFailureCode)
      ? "The extraction attempt failed; a retry may be available."
      : "The extraction attempt failed.";

  return blockedResponse(400, terminalStatus, message, attemptSummary(attempt));
}

function mapProviderErrorToExtractionFailure(error: ProviderError): ExtractionHardFailureCode {
  if (error.category === "TIMEOUT") {
    return "TIMEOUT";
  }

  return "PROVIDER_UNAVAILABLE";
}

// ---------------------------------------------------------------------
// Retry endpoint (Decision 15/19/23).
// ---------------------------------------------------------------------

export async function submitExtractionRetry(
  extractionId: string,
  rawSource: unknown,
  deps: ExtractionSourceDeps
): Promise<ApiResult> {
  const idResult = extractionRequestIdSchema.safeParse(extractionId);

  if (!idResult.success) {
    return blockedResponse(400, "INPUT_INVALID", "extractionRequestId must be a valid UUID.");
  }

  // Corrected this pass (second independent pre-live re-audit, Section
  // 9): retry now shares the same authoritative Supabase-backed
  // admission RPC (Section 4/3), under its own bucket namespace and the
  // existing 10/180s threshold, instead of the process-local limiter
  // alone. Passing `extractionId` as the idempotency key means two
  // concurrent retry calls for the SAME extraction never consume two
  // slots either (the attempt-claim RPC is still what actually decides
  // whether a second provider call happens -- this only protects the
  // rate-limit bucket itself from the same double-count Section 3 fixed
  // for new-start).
  const admitted = await deps.repository.checkAndRecordAdmission(
    hashedAdmissionBucket("extraction-retry", deps.sourceIp),
    extractionId,
    EXTRACTION_RETRY_RATE_LIMIT.windowMs / 1000,
    EXTRACTION_RETRY_RATE_LIMIT.maxAcceptedRequests
  );

  if (!admitted) {
    return blockedResponse(429, "RATE_LIMITED", "Too many retry requests. Try again shortly.");
  }

  const source = validateDossierSource(rawSource);
  const extraction = await deps.repository.getExtraction(extractionId);

  if (!extraction) {
    return blockedResponse(400, "IDEMPOTENCY_CONFLICT", "No such extraction request.");
  }

  const deadline = new HandlerDeadline(deps.deadlineClock);
  let normalized;

  try {
    normalized = await resolveNormalizedDossier(source, deadline);
  } catch (error) {
    return toErrorResponse(error);
  }

  // Fingerprint recomputed from the STORED prompt_version/configured_model_id
  // (ADR Decision 15's "Frozen logical-call semantic identity") -- never
  // the current deployment configuration.
  const recomputedFingerprint = computeExtractionFingerprint({
    normalizedDossierText: normalized.normalizedText,
    promptVersion: extraction.promptVersion,
    configuredModelId: extraction.configuredModelId
  });

  if (recomputedFingerprint !== extraction.requestFingerprint) {
    return blockedResponse(
      409,
      "IDEMPOTENCY_CONFLICT",
      "A different dossier was submitted for this extraction request's retry."
    );
  }

  // If attempt #2 already exists (terminal or claimed), this is itself a
  // replay -- zero new provider calls.
  const existingAttemptTwo = await deps.repository.getAttempt(extractionId, 2);

  if (existingAttemptTwo) {
    return loadAttemptOutcome(extractionId, deps);
  }

  // Resolve the STORED historical prompt -- never the current one.
  const promptBuilder = getPackageExtractionPrompt(extraction.promptVersion);

  if (!promptBuilder) {
    // Corrected this pass (Section 4, same fix as submitInitialExtraction's
    // safeBlockOrConflict): this was previously an unguarded `.block()`
    // call -- ANY exception, including ExtractionIdempotencyConflictError,
    // would reject this whole function uncaught, and a transient
    // persistence failure would mask the real PROMPT_VERSION_UNAVAILABLE
    // outcome entirely instead of following the same best-effort
    // audit-write policy every other pre-claim block follows.
    return safeBlockOrConflict(
      deps,
      {
        extractionId,
        sourceType: deriveSourceType(normalized.sourceKind, normalized.sourceFilename),
        requestFingerprint: extraction.requestFingerprint,
        promptVersion: extraction.promptVersion,
        configuredModelId: extraction.configuredModelId,
        status: "PROMPT_VERSION_UNAVAILABLE",
        // Retry -- attempt #1 is GUARANTEED to already exist (that is
        // precisely why this is a retry); this call's own legitimate
        // re-block must stay allowed. Only attempt #2 already existing
        // (a concurrent retry that raced ahead) is the actually-stale
        // case (Section 5).
        expectedMaxAttemptNumber: 1
      },
      () =>
        blockedResponse(
          400,
          "PROMPT_VERSION_UNAVAILABLE",
          "The historical prompt for this extraction's stored version could not be resolved."
        )
    );
  }

  // Re-check eligibility for the SAME stored model -- never the current
  // deployment default. `deadline` passed through so metadata fetches
  // are bounded by the same handler-wide deadline (Section 6).
  let eligibility;

  try {
    eligibility = await evaluateExtractionEligibility(
      extraction.configuredModelId,
      normalized.normalizedText,
      {
        provider: deps.provider,
        deadline,
        createTimedMetadataProvider: deps.createTimedMetadataProvider,
        modelCache: deps.modelCache,
        endpointCache: deps.endpointCache,
        clock: deps.metadataClock
      }
    );
  } catch (error) {
    return toErrorResponse(error);
  }

  if (!eligibility.eligible || !eligibility.route) {
    const failureCode = mapReasonCodesToExtractionFailure(eligibility.blockedReasonCodes);

    return blockedResponse(
      400,
      failureCode,
      "The stored extraction model/route is no longer eligible."
    );
  }

  // Retry-budget guard: attempt #1's real (or conservative) spend + a
  // fresh PER-ATTEMPT conservative maximum for attempt #2 (Section 2 --
  // never a logical/both-attempts figure here). This TypeScript check is
  // a fast client-visible pre-check only -- the atomic claim RPC below
  // re-verifies the SAME formula server-authoritatively before ever
  // inserting attempt #2 (Section 3), so this check being skipped or
  // wrong can never itself authorize an over-budget claim.
  const attemptOne = await deps.repository.getAttempt(extractionId, 1);

  if (!attemptOne) {
    return blockedResponse(400, "IDEMPOTENCY_CONFLICT", "No attempt #1 exists to retry.");
  }

  const budget = evaluateRetryBudget({
    attemptOneActualCostUsd: attemptOne.actualCostUsd,
    attemptOnePerAttemptConservativeMaxCostUsd: attemptOne.conservativeMaxCostUsd,
    attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal(
      eligibility.perAttemptConservativeMaxCostUsd
    )
  });

  if (!budget.allowed) {
    return blockedResponse(400, "BLOCKED_BUDGET", "Retrying would exceed the extraction budget ceiling.");
  }

  try {
    deadline.assertMinimumWindow();
  } catch (error) {
    return toErrorResponse(error);
  }

  let claim;

  try {
    claim = await deps.repository.claimAttemptTwo({
      extractionId,
      requestFingerprint: extraction.requestFingerprint,
      canonicalModelId: eligibility.route.canonicalModelId,
      providerEndpointTag: eligibility.route.providerEndpointTag,
      perAttemptConservativeMaxCostUsd: eligibility.perAttemptConservativeMaxCostUsd,
      hardCeilingUsd: eligibility.hardCeilingUsd
    });
  } catch (error) {
    if (error instanceof ExtractionIdempotencyConflictError) {
      return blockedResponse(
        409,
        "IDEMPOTENCY_CONFLICT",
        "A different dossier was already submitted for this extraction request's retry."
      );
    }

    throw error;
  }

  if (!claim.wonClaim) {
    if (claim.blockReason === "ATTEMPT_ONE_NOT_TERMINAL") {
      return blockedResponse(400, "IDEMPOTENCY_CONFLICT", "Attempt #1 is still in progress.");
    }

    if (claim.blockReason === "ATTEMPT_ONE_NOT_RETRYABLE") {
      return blockedResponse(400, "IDEMPOTENCY_CONFLICT", "Attempt #1 is not retryable.");
    }

    // The atomic claim RPC's own authoritative retry-budget guard
    // (Section 3) rejected this claim -- reachable even when the
    // TypeScript pre-check above passed (e.g. a concurrent attempt #1
    // finalization changed its actual_cost_usd in the race window
    // between this request's own pre-check and its claim attempt).
    // Zero attempt #2 row was ever created.
    if (claim.blockReason === "BLOCKED_BUDGET") {
      return blockedResponse(400, "BLOCKED_BUDGET", "Retrying would exceed the extraction budget ceiling.");
    }

    return loadAttemptOutcome(extractionId, deps);
  }

  return runAttempt({
    extractionId,
    attemptNumber: 2,
    promptVersion: extraction.promptVersion,
    normalizedDossierText: normalized.normalizedText,
    route: eligibility.route,
    deadline,
    deps
  });
}

export { normalizeHttpFailure };
