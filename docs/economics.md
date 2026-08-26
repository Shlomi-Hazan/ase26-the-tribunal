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

V1 Tribunal requests are text-only, send no image content, and enable no
web-search or explicit prompt-caching feature. Every pricing dimension
and modifier is classified into exactly one of three buckets — nothing
current or future may pass eligibility unclassified:

1. **Impossible for the request to invoke**: `image`, `web_search` —
   excluded because no such plugin/content is ever sent.
2. **Can only ever reduce realized spend, never increase it, so it is
   safely ignored for the conservative bound**: provider *implicit*
   caching discounts, and a non-zero `pricing.discount` (which by its own
   documented definition multiplies price by `(1 − discount)` with
   `discount ∈ [0, 1]`, so it can only lower or hold equal the effective
   price — never raise it).
3. **Can increase or alter the effective price and is not representable
   by V1's estimator, so it blocks eligibility**
   (`PRICING_UNREPRESENTABLE`): a non-zero `internal_reasoning` rate
   (reasoning-token count is not bounded by V1's request contract), and a
   non-empty conditional `pricing.overrides` array — OpenRouter's
   top-level pricing fields "reflect the price that applies under default
   conditions" only, so a non-empty `overrides` means the true request
   price could differ from the default price the estimator would
   otherwise use; V1 does not implement a conditional-pricing evaluation
   engine, so any such route is blocked rather than mispriced.

Concretely: the conservative bound always includes prompt/completion
token cost; includes a non-zero flat request fee once per attempt
(reserved twice per logical call, since the retry attempt incurs it
again); excludes image/web-search pricing dimensions (bucket 1); ignores
implicit-caching discounts and `pricing.discount` (bucket 2 — safe,
since both can only make the actual cost lower than the bound, never
higher); and blocks any route with a non-zero `internal_reasoning` rate
or a non-empty `pricing.overrides` (bucket 3). A route's `FREE`
classification (§14.1) is always based on the **undiscounted** base
rate — a route that is merely discounted toward zero is never classified
`FREE`. See `docs/adr/0003-openrouter-infrastructure.md` Decisions 7 and
7A.

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
                   never inferred from name/marketing/history, and
                   computed from the UNDISCOUNTED base rate (a route
                   discounted toward zero is never FREE, see §5.2)
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
  conditional `pricing.overrides` (§5.2)
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

## 22. Future Smart Extraction Economics

`M7A - Smart Tribunal Package Extraction` may add one setup-time structured extraction model call for free-form full-document import after OpenRouter infrastructure exists.

That extraction call is not a Tribunal participant logical call. A successful Tribunal run still has:

```text
4 advocate logical calls
+ 3 judge logical calls
= 7 Tribunal logical calls
```

The extraction call occurs before run creation and must be displayed/accounted separately from the seven-call Tribunal run cost.

Before M7A can be implemented, this document must define:

- explicit maximum spend policy for document extraction
- token and output bounds
- model eligibility requirements
- usage/cost telemetry requirements
- failure and retry policy
- display treatment for extraction cost versus Tribunal-run cost

No unbounded extraction call is permitted. The existing `$5.00` ceiling remains the hard intentional model-spend policy for the seven-participant Tribunal run and must not be disguised by folding extraction into a fake seven-call count.
