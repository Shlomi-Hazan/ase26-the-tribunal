# The Tribunal — Cognified Software Economics

> **Purpose:** Define how model usage, pricing, cost, latency, and budget eligibility are measured and enforced.

## 1. Why Economics Is Part of the Product

A Tribunal run is not one model call. It contains seven logical participant calls and may include retries.

The user should be able to answer:

- Which models were used?
- How many tokens did each attempt consume?
- What did each attempt cost?
- What did advocates cost versus judges?
- How long did the run take?
- Why was this model configuration allowed to run?

Cost is therefore an architectural constraint and a user-visible output, not merely backend accounting.

---

## 2. Hard Policy

```text
MAX_RUN_COST_USD = 5.00
```

This is the maximum **intentional model-spend exposure for one run**, including retries.

Design target:

> Prefer free models where practical; otherwise operate far below $5.

No automatic fallback may silently move execution to a more expensive model/provider outside the accepted pricing bound.

---

## 3. Call Geometry

No-retry success:

```text
4 advocate logical calls
+ 3 judge logical calls
= 7 logical calls
```

Maximum retry exposure:

```text
7 initial attempts
+ at most 7 retries
= 14 provider attempts
```

The budget model must account for retries before execution; retry spend is not “outside” the run budget.

---

## 4. Output Caps

V1 maximum requested generation:

- Advocate attempt: **1000 output tokens**
- Judge attempt: **1200 output tokens**

These are both product controls and economic controls.

A model/provider that cannot honor the required bounded-output parameter is not eligible for the V1 execution path.

---

## 5. Pricing Source

Current model pricing is resolved server-side from OpenRouter model metadata immediately before/near authoritative preflight.

Do not permanently hard-code a list of prices into frontend code.

Historical price calculations use the **pricing snapshot stored at run time**, not today's current price.

Store enough information to audit at least:

- model ID
- observed pricing timestamp
- input/prompt rate
- output/completion rate
- request-level fee where applicable
- any other V1-supported billable dimension used in the bound

V1 should exclude models whose pricing model cannot be conservatively represented by the approved estimator without additional specification.

Pricing belongs to the exact resolved provider endpoint, never a model
family or model-level average — one OpenRouter model may be served by
several endpoints with different rates
(`docs/adr/0003-openrouter-infrastructure.md` Decisions 2, 4–5). The
"model ID" recorded in the audit trail above is the configured M6
`model_id` together with the resolved endpoint's provider-routing
identity, not the model ID alone.

### 5.1 Raw units and decimal-safe normalization

OpenRouter's catalog/endpoint pricing rate fields (prompt/completion/
request/etc.) are returned as **decimal strings**, specifically to avoid
floating-point precision loss — parse them directly into a decimal type,
never through a JS `Number()` round-trip. Authoritative preflight
pricing, tier classification, and the `$5.00` ceiling always use these
string rate fields, never a discounted or override-adjusted figure (see
§5.2 below).

A completed request's *actual* `usage.cost`, by contrast, is returned as
a JSON **number**, not a string. **Corrected wording (Milestone 7
planning, second correction pass):** the application converts this value
to the same decimal type exactly once, at receipt, and performs no
further authoritative binary-floating-point arithmetic on it afterward —
every subsequent comparison/aggregation uses only the converted decimal
value. This preserves *the provider-reported value as received*; it is
**not** a claim that the true underlying mathematical price is
reconstructed more exactly than OpenRouter's own protocol supplied it.
`usage.cost` is authoritative *audit/telemetry* of what was actually
charged; it never retroactively revises a preflight decision already made
from the string rate fields. All authoritative comparisons (including the
`$5.00` ceiling and the tier boundaries in §14 below) use the decimal
type — never `Number(...)` or ordinary binary floating point. See
`docs/adr/0003-openrouter-infrastructure.md` Decisions 9–10 for the exact
`PricingSnapshot` shape and the locked implementation choice (a small,
reviewed decimal-arithmetic dependency).

### 5.2 Billable dimensions actually representable by V1

V1 Tribunal requests are text-only, send no image/audio content, enable
no web-search plugin, and send no explicit cache-control request field
of any kind. Every pricing dimension and modifier is classified into
exactly one of three buckets — nothing current or future may pass
eligibility unclassified:

1. **Impossible for the request to invoke**: `image`, `image_output`,
   `image_token`, `audio`, `audio_output`, `input_audio_cache`,
   `web_search` — excluded because no such plugin/content is ever sent.
2. **Can only ever reduce realized spend, never increase it, so it is
   safely ignored for the conservative bound**: a non-zero
   `pricing.discount` within its documented `[0, 1]` range (which by its
   own definition multiplies price by `(1 − discount)`, so it can only
   lower or hold equal the effective price — never raise it). **Cache
   pricing is explicitly not in this bucket** (corrected — see §5.2.1).
3. **Can increase or alter the effective price and is not representable
   by V1's estimator, so it blocks eligibility**
   (`PRICING_UNREPRESENTABLE`): a non-zero `internal_reasoning` rate
   (reasoning-token count is not bounded by V1's request contract); a
   non-empty conditional `pricing.overrides` array — OpenRouter's
   top-level pricing fields "reflect the price that applies under default
   conditions" only, so a non-empty `overrides` means the true request
   price could differ from the default price the estimator would
   otherwise use, so V1 blocks rather than mispricing it; and a malformed
   `pricing.discount` (negative, greater than `1`, or non-finite) — never
   silently treated as `0`.

Concretely: the conservative bound always includes prompt/completion
token cost, computed using the **effective input price** (§5.2.1) rather
than the raw prompt rate alone; includes a non-zero flat request fee once
per attempt (reserved twice per logical call, since the retry attempt
incurs it again); excludes image/audio/web-search pricing dimensions
(bucket 1); ignores a validated in-range `pricing.discount` (bucket 2 —
safe, since it can only make the actual cost lower than the bound, never
higher); and blocks any route with a non-zero `internal_reasoning` rate,
a non-empty `pricing.overrides`, or a malformed `discount` (bucket 3). A
route's `FREE` classification (§14.1) is always based on the
**undiscounted, cache-write-inclusive** economics — a route that is
merely discounted toward zero, or that has a zero prompt rate but a
non-zero automatically-applicable cache-write rate, is never classified
`FREE`. See `docs/adr/0003-openrouter-infrastructure.md` Decisions 7,
7A, and 7B.

#### 5.2.1 Cache economics: effective input price (corrected this pass)

**Corrected claim:** a prior pass of this document assumed provider
implicit/prompt caching "can only reduce spend." **That is false and is
retracted.** OpenRouter's endpoint pricing metadata exposes a genuine
**cache-write** rate (`input_cache_write`, and a separately-priced
extended-TTL `input_cache_write_1h`) in addition to the cheaper
cache-*read* rate (`input_cache_read`). Provider documentation confirms
cache writes are billed at a **premium** over ordinary input — for
example, Anthropic's documented 1.25x (default 5-minute TTL) or 2x
(1-hour TTL) multipliers, and OpenAI's documented 1.25x multiplier for
its GPT-5.6+ family, triggerable "even with automatic caching — no
opt-in required." A cache write is therefore a dimension that **can**
increase cost above the raw prompt rate, not one that can only reduce
it.

**V1 policy — conservative effective input price:** for every resolved
route, the estimator computes

```text
effectiveInputPricePerToken = MAX(
  promptPricePerToken,
  cacheReadPricePerToken,     -- input_cache_read, when present
  cacheWritePricePerToken     -- input_cache_write (default/5-minute-
)                                equivalent rate), when present
```

using exact decimal arithmetic, and uses this value — never the raw
`promptPricePerToken` alone — everywhere input-token cost is estimated,
including the retry reserve (§10.4): the retry reserve never assumes a
warm cache, a cache-read discount, or any other reduced cost for the
retry attempt. This is deliberately an upper bound: overestimating is
acceptable (a real request may cache only a prefix, or hit no cache at
all); underestimating, because a cache write turned out to cost more
than ordinary input, is not.

`input_cache_write_1h` is excluded from this calculation — documented
precisely as **"impossible for the current request contract to
invoke"** (V1 never sends the explicit 1-hour cache-control request
field this rate requires), never as "cache pricing can only reduce
spend." A future, unclassifiable cache-related pricing field blocks the
endpoint (`PRICING_UNREPRESENTABLE`) rather than being assumed safe. See
`docs/adr/0003-openrouter-infrastructure.md` Decision 7B for the full
rule, including the pinnability-style "no silent assumption" reasoning
and the schema citations.

---

## 6. Successful Actual Usage — Source Precedence

For a successful OpenRouter response, use the returned `usage` information as authoritative runtime evidence.

Precedence:

1. **OpenRouter `usage.cost`** — actual amount charged for the response when present
2. **OpenRouter native token counts** — prompt/input, completion/output, total
3. **Stored price snapshot** — supports independent derived comparison/audit

The application may compute a derived expected token cost for audit comparison, but it must not overwrite or disguise the actual OpenRouter cost when that is supplied.

If the actual cost and simple derived token calculation differ because of caching/reasoning/request charges/provider billing details, retain the authoritative actual cost and the snapshot needed to explain the difference where available.

---

## 7. Failed Attempts

A failed request may end before OpenRouter returns token/cost telemetry.

Rules:

- unavailable token fields are `null`/unavailable, not zero
- unavailable cost is `null`/unavailable, not `$0.00`
- any returned usage/cost data is retained
- failure category is retained
- latency/attempt timestamps are retained where measurable

Zero means **known zero**, not “we do not know.”

---

## 8. Per-Attempt Cost Record

Conceptual audit record:

```text
Participant:        Judge 2
Model:              provider/model-id
Attempt:            1
Status:             SUCCESS
Input tokens:       4,820
Output tokens:      711
Total tokens:       5,531
Input price:        $X / 1M
Output price:       $Y / 1M
Actual cost:        $Z
Derived comparison: $Z2
Latency:            5,430 ms
Pricing observed:   timestamp
```

The UI may simplify display, but persistent audit data should remain available.

---

## 9. Derived Token Cost Formula

For models with ordinary per-token prompt/completion pricing:

```text
input_cost = input_tokens / 1,000,000 × input_price_per_million
output_cost = output_tokens / 1,000,000 × output_price_per_million
base_token_cost = input_cost + output_cost
```

**`input_price_per_million` is the cache-aware `effectiveInputPricePerToken`
(§5.2.1) expressed per million tokens, not the raw prompt rate alone** —
this is where the cache-write-safety correction actually takes effect;
every conservative bound computed by this formula automatically inherits
it.

Then add any V1-supported request-level/billable dimension represented by the pricing snapshot.

All money calculations use decimal-safe arithmetic. Do not use ordinary binary floating-point arithmetic for authoritative budget comparisons.

---

## 10. Conservative Preflight

Preflight decides whether a configuration is allowed to expose the project to spend.

It is intentionally conservative; it is not intended to predict exact final cost.

Milestone 7 builds the real preflight service implementing this section's
formulas, as a standalone read-only computation over a frozen run — see
`docs/adr/0003-openrouter-infrastructure.md`. It performs zero Tribunal
model calls itself. **Locked:** Milestone 7 does not wire this into `POST
/api/runs`'s write path and does not persist `BLOCKED_BUDGET` — that
execution-time integration is Milestone 8's, once real execution exists
to gate (ADR Decision 14).

### 10.1 Input estimate

For already-known prompt text, use a conservative tokenizer-independent estimate rather than an optimistic English-only character rule.

Approved baseline estimator:

```text
estimated_input_tokens = ceil(UTF8_byte_length / 2) + fixed_prompt_overhead
```

Why deliberately conservative:

- user input may be Hebrew or other non-English text
- tokenizers differ across models
- exact provider tokenizer may not be available locally

The implementation may later replace this with a model-aware tokenizer if verified to be at least as safe.

### 10.2 Advocate bound

For each advocate attempt, bound:

```text
base advocate prompt
+ side
+ personality
+ Charge Sheet
+ 1000 maximum output tokens
```

### 10.3 Judge bound before speeches exist

The judges' prompts are more expensive because they consume all four speeches.

Before advocates have run, preflight must reserve for the maximum speech exposure rather than assuming short actual outputs:

```text
base judge prompt
+ personality
+ Charge Sheet
+ up to 4 × 1000 advocate output tokens as input exposure
+ 1200 maximum judge output tokens
```

The exact conversion between reserved speech output tokens and downstream judge input pricing can use the conservative pricing/token approach defined by the implementation; it may not assume zero or average-length speeches.

### 10.4 Retry reserve

Initial V1 preflight reserves worst-case permitted retry exposure for all seven logical calls.

Conceptually:

```text
worst_case_run_bound
= 2 × sum(worst_case_bound_per_logical_call)
```

This is stricter than assuming retries are rare, but it guarantees the configured retry policy fits inside the same economic blast radius.

The retry reserve uses the same cache-aware `effectiveInputPricePerToken`
(§5.2.1) for both the initial attempt and its one permitted retry — a
retry is never assumed to land on a warm cache, receive a cache-read
discount, or otherwise cost less than the initial attempt's worst case.
The retry attempt may in reality happen after the cache expired, on a
cold cache, or without any usable cache hit at all; no cache discount
ever reduces the required reserve.

### 10.5 Safety factor

After the deterministic bound, apply a safety margin:

```text
BUDGET_SAFETY_FACTOR = 1.10
```

A configuration is eligible only if:

```text
conservative_bound × 1.10 <= $5.00
```

If later empirical evidence supports a different margin, change this document/spec first.

---

## 11. Runtime Budget Guard

Preflight is necessary but not sufficient.

Before every provider attempt:

1. calculate actual known spend already incurred
2. identify the conservative bound of the attempt about to start
3. reserve required remaining work according to the run policy
4. ensure intentional exposure still fits under `$5.00`

If it does not fit, do not make the attempt.

A retry therefore happens only when both:

- failure is retryable
- budget guard permits the retry

---

## 12. Concurrency and Budget

Advocates and judges run concurrently by phase, so several paid requests may be in flight at once.

The budget guard must reserve the whole concurrent batch **before** launching it. Do not launch one request and then discover that the rest of the required phase no longer fits.

For example, before the judge phase starts, ensure all three required judge logical calls (including the applicable retry policy reservation) fit the remaining budget policy.

---

## 13. OpenRouter Routing Controls

Where supported and useful, OpenRouter provider preferences should reinforce the application's economic policy:

- `order: [providerEndpointTag]` — the primary mechanism for pinning
  execution to the exact endpoint preflight priced, matching
  OpenRouter's own documented exact-endpoint-pin example; `only` may be
  set to the same value as an additional restriction, but a bare
  `provider.only` restriction is not by itself proof of an exact pin (an
  endpoint's routing tag can be a base provider slug matching several
  variants — see `docs/adr/0003-openrouter-infrastructure.md`
  Decision 4A)
- `require_parameters: true`
- `allow_fallbacks: false`
- price-oriented provider sorting
- `max_price` bound consistent with the accepted pricing snapshot

These are defense in depth. They do not replace application preflight/runtime accounting. The pinned tag itself must already have been proven **uniquely pinnable** by preflight (Decision 4A) before it is ever used for execution routing.

---

## 14. Free Models

A zero-price model is preferred when it satisfies V1 capability requirements.

“Free” is not treated as permanent metadata:

- model availability can change
- endpoint/provider availability can change
- pricing can change

Therefore a free model is still validated through the same current metadata and model eligibility flow.

A free model does not remove the need for token/latency audit evidence.

### 14.1 Model price tiers (discovery metadata, not budget authority)

The product must expose meaningful cost choice, not merely "the cheapest
model." Each eligible resolved route (§5.1, never a model-level average)
is assigned a discovery tier from its own conservative complete-Tribunal
cost estimate:

```text
FREE           == $0.00 exactly, authoritative provider metadata only --
                   never inferred from name/marketing/history, computed
                   from the UNDISCOUNTED base rate (a route discounted
                   toward zero is never FREE) AND from the cache-write-
                   inclusive effectiveInputPricePerToken (a route with a
                   zero prompt rate but a non-zero automatically-
                   applicable cache-write rate is never FREE, see §5.2/
                   §5.2.1)
BUDGET         >  $0.00  and <= $0.50
PREMIUM        >  $0.50  and <= $2.00
ABOVE_PREMIUM  >  $2.00  and <= $5.00
HARD_BLOCK     >  $5.00   -- ineligible
```

`$5.00` is the architectural safety ceiling (§2), not the normal target
price; `PREMIUM` must remain materially below it. `ABOVE_PREMIUM`
technically satisfies the hard budget but must not automatically appear
as a normal recommended V1 choice — surfacing it requires a separate
later product decision. **A tier label is discovery/display metadata
only and never replaces or bypasses the exact `$5.00` preflight
decision** — two provider endpoints for the same model can land in
different tiers because pricing belongs to the resolved route, not the
model family.

Shared Mode later lets a user compare FREE/BUDGET/PREMIUM options for the
one model applied to all seven participants. Separate Mode allows
independent per-participant tier choices; the final authoritative
preflight always evaluates the exact combined seven-participant
configuration — tier labels never independently grant eligibility. See
`docs/adr/0003-openrouter-infrastructure.md` Decision 12.

---

## 15. Model Eligibility for Economics

V1 execution should reject/exclude a model if any of these are true:

- required structured output cannot be enforced
- required max output parameter cannot be enforced
- context capacity is insufficient
- pricing cannot be represented conservatively, including a non-empty
  conditional `pricing.overrides`, a malformed `pricing.discount`, or an
  unclassifiable cache-related pricing field (§5.2/§5.2.1)
- the candidate endpoint is not uniquely pinnable (`ENDPOINT_NOT_PINNABLE`,
  `docs/adr/0003-openrouter-infrastructure.md` Decision 4A)
- successful usage/cost telemetry cannot be relied on for the required audit contract

This avoids a UI that offers configurations the backend must later treat as unauditable.

---

## 16. Historical Pricing Snapshot

Every attempt should retain the pricing observation used when the request was authorized.

Why:

A model can cost one amount today and another later. Past Cases must still explain historical cost without consulting current pricing.

Historical UI therefore reads the stored snapshot and actual usage/cost record; it does not recalculate old runs using today's price.

---

## 17. Run Totals

For a terminal run, aggregate deterministically:

```text
logical_calls
provider_attempts
input_tokens
output_tokens
total_tokens
advocate_cost_usd
judge_cost_usd
total_cost_usd
wall_clock_duration
```

A failed run may have partial totals. Label them as partial spend/usage, not as a completed-run total.

Do not derive run wall-clock duration by summing all concurrent attempt latencies; store/derive it from run start to terminal completion/failure.

---

## 18. UI Economics

### Review / before spend

Show:

- execution mode
- selected model(s)
- expected logical calls: `7`
- retry policy
- conservative maximum estimate
- hard budget: `$5.00`
- whether configuration is eligible

Do not describe the estimate as the amount that will definitely be charged.

### Completed result summary

Example hierarchy:

```text
7 LOGICAL CALLS
8 PROVIDER ATTEMPTS
18,420 TOKENS
$0.17 MODEL COST
7.4s WALL CLOCK
```

### Detailed audit

A table/expandable area includes each attempt's participant, attempt number, model, tokens, price snapshot, actual/derived cost, latency, and status.

### Failed run

Show **partial spend so far** when any money was consumed before failure.

A failed run does not hide its incurred cost.

---

## 19. Budget Failure States

### `BLOCKED_BUDGET`

Occurs before model execution when the selected configuration fails authoritative preflight.

UI explains:

- run did not start
- no verdict exists
- configuration exceeds/does not satisfy safe budget policy
- user can choose cheaper models/reduce allowed configuration only through supported controls

### Retry blocked by budget

If a retryable model failure occurs but the retry is not economically safe, the logical call fails terminally with a budget-related reason and the run follows normal failure rules.

### Unexpected provider overrun

If the actual returned charge unexpectedly causes total spend to cross `$5` despite conservative controls:

- stop any not-yet-started work
- mark an explicit budget anomaly/failure
- preserve actual spend evidence
- do not pretend the hard guarantee retroactively succeeded

This should be exceptional and investigated.

---

## 20. Economic Verification

Unit fixtures should prove:

- per-token decimal cost math
- totals across attempts
- retries included
- null failed telemetry does not become zero
- safety factor
- `$5.00` boundary cases
- free model
- mixed Shared/Separate model prices
- judge input reservation includes four maximum speeches
- request fees where V1 supports them

Integration tests should prove:

- preflight happens before paid execution
- unsafe run produces zero OpenRouter calls
- retry guard executes before retry
- current pricing snapshot is persisted
- successful response `usage.cost` is retained
- no hidden provider fallback changes configured economics

---

## 21. What This Document Does Not Do

It does not permanently choose specific OpenRouter model IDs or prices.

It does not promise that every model offered by OpenRouter is supported by The Tribunal.

It does not treat cost estimates as exact billing predictions.

It does not count OpenRouter credit-purchase fees as per-run inference cost; the product economics view focuses on model inference charges attributable to the run.

---

## 22. Smart Extraction Economics (Milestone 7A)

`M7A - Smart Tribunal Package Extraction` adds exactly one setup-time
structured extraction model call for free-form full-document import,
planned in full in `docs/adr/0004-smart-package-extraction.md`
(Decisions 9–11).

That extraction call is not a Tribunal participant logical call. A
successful Tribunal run still has:

```text
4 advocate logical calls
+ 3 judge logical calls
= 7 Tribunal logical calls
```

The extraction call occurs before run creation and is
displayed/accounted separately from the seven-call Tribunal run cost.

**Locked extraction economics policy (corrected by independent review —
see `docs/adr/0004-smart-package-extraction.md` for full detail):**

- **Maximum spend**: `EXTRACTION_HARD_CEILING_USD = "0.50"` per
  **logical extraction call, including both permitted provider
  attempts combined** — not per attempt. $0.50 happens to equal the
  existing `BUDGET` tier's upper bound (§14/`TIER_THRESHOLDS_USD`),
  reused only as a familiar number for product simplicity. **Extraction
  eligibility is never inferred from a route's Tribunal tier label** —
  the `FREE`/`BUDGET`/`PREMIUM` tiers are computed from
  complete-Tribunal (4 advocate + 3 judge) economics, a structurally
  different workload from one extraction call; a `PREMIUM`-Tribunal-tier
  route may still be extraction-eligible, and a `BUDGET`-Tribunal-tier
  route may still be extraction-ineligible. An extraction-specific
  conservative Decimal preflight is the sole authority. The existing
  `$5.00` ceiling remains the hard intentional model-spend policy for
  the seven-participant Tribunal run and is never disguised by folding
  extraction into a fake seven-call count.
- **Token/output bounds**: `EXTRACTION_OUTPUT_CAP_TOKENS = 65,000` — a
  bound covering the **canonical compact JSON serialization** of every
  schema-valid semantic extraction object (an exact, computed
  reference value of 55,942 conservative tokens for the maximum
  fixture, not an estimate), resting on a dedicated `safeExtractionText`
  character-class contract (excludes raw control characters other than
  newline/tab, DEL, and unpaired Unicode surrogates on every free-text
  field). This is a **semantic representability guarantee** — no valid
  content is structurally impossible to express within the cap when
  serialized without gratuitous escaping — not a claim that every
  possible way a provider might lexically encode that content (e.g.
  unnecessary `\uXXXX` escaping, which RFC 8259 permits) also fits; a
  provider choosing an inflated encoding is ordinary provider-output
  variance, handled by the existing `INVALID_STRUCTURED_OUTPUT` +
  one-retry policy, not a schema defect. Worst-case input bounded by
  `NORMALIZED_DOSSIER_TEXT_MAX_CHARS = 40,000` characters plus fixed
  prompt overhead, estimated with the same conservative `ceil(UTF-8
  bytes / 2)` proxy §7/§8 already use for the seven-call Tribunal — no
  new estimation methodology.
- **Model eligibility**: a dedicated, server-only-configured extraction
  model (`PACKAGE_EXTRACTION_MODEL_ID`, never chosen by dossier
  content), resolved through the existing M7 exact-endpoint/
  unique-pinnability/no-fallback contract with an extraction-specific
  bounded-output check substituted for the advocate/judge output caps.
- **Pre-spend confirmation**: a read-only, non-billable
  `POST /api/setup-extractions/preflight` quote (zero
  `createChatCompletion` calls) is available before the user commits to
  spend; the billable initial call always reruns the same
  authoritative eligibility/budget guard fresh immediately before any
  provider call — the browser's earlier quote is never trusted as
  authoritative.
- **Retry/timeout**: at most 2 provider attempts per logical extraction
  call, reusing the existing `RETRYABLE_CATEGORIES` plus a schema-invalid
  response or a stale-claim `UNKNOWN_OUTCOME` (below); a **new,
  extraction-specific** `PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS =
  45,000` (not M7's 60,000 ms Tribunal constant), bounded further by a
  **complete-Function soft deadline**
  (`PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS = 55,000`, 5s of
  margin below Netlify's reverified 60s hard limit). A retry is a
  separate, explicit endpoint call (resending the same dossier source,
  since nothing dossier-derived persists server-side) whose eligibility
  the server alone determines from persisted attempt state — never a
  client-declared attempt number. No provider call may begin before
  that specific attempt is atomically claimed in the database
  (claim-then-spend, never spend-then-claim), so concurrent duplicate
  requests can never both spend.
- **Corrected this pass (final independent review): the deadline is
  rechecked twice, not once, and a minimum provider start window is now
  locked.** `PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS = 5,000`. Two
  checks against freshly recomputed monotonic elapsed/remaining time:
  **pre-claim** (before the atomic claim is even attempted — if
  insufficient, fail with `INPUT_PROCESSING_TIMEOUT`, zero attempt rows
  created, zero spend) and **post-claim** (immediately before the
  provider fetch, recomputed fresh, since the claim operation itself
  consumes real time and can make the pre-claim value stale — if
  insufficient here, zero provider calls are made, but the
  already-claimed attempt row is terminalized to
  `INPUT_PROCESSING_TIMEOUT` rather than left stuck `CLAIMED`, with all
  actual telemetry `null`). Only past both checks is
  `effectiveProviderTimeoutMs = min(PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS,
  postClaimRemainingMs)` computed — always from the **post-claim** value,
  never the pre-claim one.
- **Unknown-cost retry economics**: the retry-budget guard is
  `(actual_cost_usd ?? conservative_max_cost_usd) +
  fresh_attempt2_conservative_max_cost_usd <=
  EXTRACTION_HARD_CEILING_USD` — attempt #1's real cost is used when
  known (and preferred over the stored conservative maximum if it
  turns out larger), but a `null` actual cost (e.g. after a timeout)
  falls back to the claim-time `conservative_max_cost_usd`, **never**
  `$0.00`. Guard failure → `BLOCKED_BUDGET`, zero attempt-#2 calls.
- **Stale-claim handling**: a provider attempt claimed but never
  finalized (e.g. a Function that died mid-attempt) is reconciled,
  opportunistically and race-safely, from `CLAIMED` to a terminal
  `UNKNOWN_OUTCOME` state after `STALE_EXTRACTION_CLAIM_AFTER_MS =
  120,000` — telemetry stays `null` unless real evidence exists, that
  attempt number never calls the provider again, and an
  `UNKNOWN_OUTCOME` on attempt #1 may still permit one retry (using the
  unknown-cost formula above); an `UNKNOWN_OUTCOME` on attempt #2 is
  final — the user may start an entirely new, separately billable
  logical extraction instead.
- **Idempotency**: a server-computed semantic fingerprint over the
  normalized dossier content plus the fixed extraction configuration
  (prompt version, configured model — deliberately excluding
  `source.kind`, which is audit metadata only) proves a replayed/retried
  request is the *same* logical extraction; a mismatch is rejected with
  zero provider calls, never silently treated as a new attempt of
  something else.
- **Corrected this pass (final independent review): a fingerprint match
  must actually recover the paid-for result, not merely confirm it
  once existed.** The validated, schema-shaped extraction result is now
  persisted (`validated_result`, bounded and re-validated on every
  read — never the raw provider response) so a lost HTTP response after
  a successful, billed extraction can be replayed with the same draft
  and warnings and **zero new provider calls** — a customer is never
  charged twice for the same successful extraction merely because the
  response never reached the browser.
- **Telemetry**: actual `usage.cost` decoded once, Decimal throughout,
  unknown telemetry stays `null` — never a fabricated zero, matching §9
  exactly; recorded per provider attempt (a logical call's two attempts
  remain independently auditable, never overwriting each other) —
  including whenever the provider itself supplied usage/cost data, even
  if the application later rejects that same response as
  `INVALID_STRUCTURED_OUTPUT`.
- **Display**: an estimated (pre-attempt) and an actual (post-attempt)
  extraction cost are both shown, visually and textually distinct from
  the Tribunal run's own cost figures — never summed into or mistaken
  for the $5.00 ceiling.

No unbounded extraction call is permitted.
