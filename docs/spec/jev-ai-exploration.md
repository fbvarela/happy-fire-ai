# Exploring Jev AI Integration for happy-fire-ai

## Context

The current risk scoring pipeline in `src/domain/risk.ts` is fully deterministic (`modelVersion: 'mvp-2'`). External providers (weather, land cover, population, road closures) feed structured data into the calculation, and AI explanations are optional via Cohere. The goal is to explore whether **Jev AI** (TypeSafe's "System One" model, https://docs.typesafe.ai/introduction) can add value beyond the current deterministic approach.

> Status of this document: revised after reviewing the actual Jev docs (Introduction, Primitives, Confidence, Patterns) and a technical deep dive. Some of the original proposals were based on the assumption that Jev is a text-generating LLM. It is not, and several ideas changed shape as a result. Original assumptions are kept as ~~strikethrough~~ where they were wrong, so the reasoning trail stays visible.

## What Jev actually is

Jev is **not** a chat model and produces **no prose**. You send it a `state` (a JSON object) plus a set of typed **questions**, and it returns one typed answer per question, evaluated in parallel and independently against the same state:

| Question type | Answers                     | Returns                                  |
| ------------- | --------------------------- | ---------------------------------------- |
| `Choice`      | Which of these options?     | `choice`, `probabilities`, `confidence`  |
| `Score`       | Which level on my spectrum? | `score`, `legend`, `probabilities`, `confidence` |
| `Noul`        | Is this statement true?     | `noul` (0–1, no separate confidence)     |

Key properties that matter for this project:

- **Constrained answers.** An answer can never fall outside the options/levels you define. No schema recovery from generated prose — the entire `parseExplanation`-style validation layer in `explanation.ts` exists because Cohere generates text; Jev's shape is structural.
- **Calibrated probabilities.** Trained with RLCD: a 90% probability should be right ~90% of the time. Per-judgment `confidence` (0–1) is derived from the probability distribution and is designed to be thresholded in code.
- **Fast and cheap.** ~70–500 ms per request, ~$0.042/M input tokens, output unmetered. Adding questions to the same request barely changes latency or cost — the docs call this *speculative fan-out*: ask every question you might need and let code ignore the irrelevant answers.
- **Atomic judgments.** One well-scoped yes/no or level question per judgment; multi-factor decisions are decomposed into several questions and **combined in your code** (weights are yours, in code, not in a prompt).
- **Text-only state.** String or JSON; no images/audio. State + all questions share ~64k tokens. Choice supports up to 255 options; Score 2–10 levels. Model IDs: `jev-latest` (stable), `jev-preview`; responses report the exact version (e.g. `jev-1.13.0`) — log it.

## Research Questions (answered)

1. **Confidence Intervals**: Can Jev produce statistically meaningful confidence intervals around the risk score?
   **Partially — not directly.** Jev does not emit numeric CIs and can never see or reproduce `calculateRisk`'s arithmetic. What it does emit is a *calibrated* 0–1 confidence per judgment. The viable design is **hybrid**: compute the interval deterministically from data-quality signals (statuses, warnings, source freshness — all already in `EnvironmentalContext`), and use Jev confidence as a cross-check/annotation on top. See revised Idea 1.
2. **Feature Expansion**: What new features could Jev enable?
   **Yes/no and level judgments over the context**: anomaly screening on factor combinations, per-provider data-quality assessment, and routing decisions (e.g. *whether* the Cohere explanation call is worth making). It cannot generate narratives or replace the explanation layer.
3. **Type Safety**: Does Jev's TypeScript-native approach align with the project?
   **Yes, strongly.** Typed answers constrained to our definitions mean no free-text parsing, which is the exact pain point of the current Cohere provider. It also fits the injected-`fetcher` factory pattern used by every provider in `src/server/providers/`.
4. **Integration Fit**: Can it be added without violating the "AI must never change the score, factors, safety notice, or emergency guidance" constraint?
   **Yes**, as a server-only *annotation* layer, env-gated, with Jev outputs stored in a separate advisory report that is structurally incapable of reaching `RiskResult`.

## Proposed Ideas (revised)

### Idea 1: Confidence-Weighted Risk Intervals — hybrid, Jev does NOT compute the interval

~~Jev AI would map data quality signals to uncertainty bounds~~. Jev cannot do arithmetic on the context and its output would be an unauditable number around a safety-relevant score. Instead:

- **Deterministic layer (in `src/server/`, pure logic, unit-tested):** derive `[low, high]` from signals already present — `context.status`, per-factor `status`, `*Warning` fields, `cacheStatus`, `observedAt` staleness. Every degradation widens the interval **upward only** (asymmetric: uncertainty can never make the floor look safer — "missing data is never treated as safe").
- **Jev layer (advisory):** ask Jev atomic questions over the serialized context, e.g.
  - `noul data_quality_concern`: "Given this environment state, is the data too incomplete to characterize fire risk at this location?"
  - `score data_sufficiency`: "How well does this data characterize the fire environment?" (levels: `insufficient / partial / adequate / strong`)

  If Jev's `data_sufficiency` score disagrees with the deterministic confidence (e.g. Jev says `insufficient` while our pipeline reports high confidence), surface that as a warning and widen the interval per the cautionary reading. Jev may only make the system *more* cautious, never less.

**Output contract (advisory, separate from `RiskResult`):**

```ts
type RiskAssessmentReport = {
  interval: { low: number; high: number }        // deterministic
  confidenceLevel: 'low' | 'medium' | 'high'     // deterministic
  dataQualityReport: DataQualityReport           // deterministic
  advisory?: JevAdvisory                          // env-gated, display-only
}
```

**Fit:** ✅ Score and factors stay deterministic; Jev only annotates and can only add caution.

### Idea 2: Anomaly Detection on Factor Combinations — good fit for Noul fan-out

The deterministic model weights factors independently (fixed MVP-2 weights), so it can underweight dangerous *combinations* (e.g. moderate wind + very dry fuel + high exposure). Jev is a good screening tool for this, using the **speculative fan-out** pattern — one request, all questions, ~100 ms:

```ts
const questions = {
  wind_fuel_interaction: noul("Does `fuel.vegetationDryness` combined with `weather.windKph` suggest unusually fast fire spread potential?"),
  exposure_amplification: noul("Does `exposure.nearbyPeople` combined with the fuel and weather state describe a situation where moderate fire risk is still dangerous to people?"),
  terrain_fuel_interaction: noul("Does `terrain.slopeDeg` combined with `fuel.vegetationDryness` suggest fire behaviour more severe than the individual values indicate?"),
  // speculative: answered for free in the same call
  data_inconsistency: noul("Are any values in this state internally inconsistent with each other?"),
}
```

Then compose in code: any `noul > threshold` becomes `{ anomalyId, severity: 'watch' | 'advisory', description }` in a display-only `anomalyReport`. Never adjust the score.

~~Output would include `adjustedConfidence`~~ — removed: Jev's answers may not feed back into the score or confidence computation except through the cautious-only path defined in Idea 1.

**Fit:** ⚠️→✅ Display-only, batched in a single call, fully typed.

### Idea 3: ~~Structured Natural Language Summaries~~ → Confidence-Gated Explanation (Jev decides, Cohere writes)

**The original idea is not implementable as stated**: Jev cannot produce narrative text — it emits only choices, scores, and probabilities. ~~Replace or augment the Cohere-based explanation layer~~ is therefore rejected; the Cohere provider stays as the sole source of prose.

The valuable replacement is **intent routing**: use Jev to decide *whether and how* to spend a Cohere call:

- `noul explanation_warranted`: "Does this risk result and context contain anything a non-expert would need explained beyond the standard safety notice?" — if no, skip Cohere entirely (cost + ~10 s timeout avoided on low-value responses).
- `choice emphasis_area`: which factor deserves narrative focus (`weather / fuel / terrain / exposure`), passed as a *hint* to the Cohere prompt. It biases prose, not the score.

This matches TypeSafe's documented "Jev decides, the LLM writes" architecture and the Confidence-Gated Routing pattern.

**Fit:** ✅ Fully server-only, no score impact, reduces Cohere usage.

### Idea 4: Provider Reliability Scoring — good fit, feeds Idea 1

Jev assesses each provider's data as a set of atomic questions in **one** batched request over a compact "data provenance" state (per-provider: source, observedAt age, warning presence, which fields are null):

- `score reliability_<provider>` per provider (levels: `unusable / degraded / acceptable / fresh-and-complete`)
- `noul provider_conflict`: "Do any two data sources in this state contradict each other?"

Compose in code: map Jev levels onto display warnings ("Land cover data is 4h stale — confidence reduced") and into the deterministic interval-widening table from Idea 1. The mapping table lives in our code and is unit-tested; Jev's role is judgment over messy combined signals, the policy remains ours.

**Fit:** ✅ Display-only, enhances transparency, one request for all providers.

## Architecture sketch

```
src/server/providers/jev.ts        # createJevProvider({ apiKey, fetcher, timeoutMs })
                                   #   .assess(state, questions) -> typed answers
src/server/assessment.ts           # pure compositors: interval calc, anomaly/risk composition
                                   #   + warning strings (no React, unit-testable)
src/server/environment.ts          # after context assembly: if JEV_AI_ENABLED, build
                                   #   provenance state, call assess(), attach advisory
                                   #   report; on any Jev failure -> omit advisory,
                                   #   keep deterministic result untouched
```

- **Provider factory** mirrors `createCohereExplanationProvider`: injected `fetcher`, `AbortSignal.timeout`, strict response validation, and a discriminated-union answer parser (`type: 'noul' | 'choice' | 'score'`).
- **Env gates:** `JEV_AI_ENABLED=true` + `JEV_API_KEY`; unset = current behavior exactly. Jev is the first *optional layer over the whole pipeline*, not a data provider — it never substitutes a provider and never enters the mock fallback path.
- **Caching:** Jev calls can be cached in-process keyed by the same cache key as weather (advisory text is cheap to recompute but the API call isn't needed per-keystroke); reuse the existing 10-min TTL pattern.
- **API/UI contract:** advisory report is additive fields on the response, not changes to `RiskResult`. The UI renders it under an explicit "AI advisory — does not affect the risk score" label.

## Technical considerations

- Jev is TypeScript-native with typed answers constrained to our definitions — a materially better fit than `response_format: json_object` + hand-rolled validation (the current Cohere approach).
- Every question must be **atomic**: one judgment each, composition and weighting in our code. Never ask Jev to "rate the fire risk" — that's the deterministic model's job and would be both unauditable and a policy violation.
- Jev reads text only: the state is a **serialized, redacted view** of the `EnvironmentalContext` (no need to send road closure geometry; nothing user-identifiable exists in this context anyway).
- Latency budget: one fan-out request (~70–500 ms) covers Ideas 2+4 (and the Idea 3 gate) in a single call — questions are evaluated in parallel and independently.
- Log the returned model version per response for auditability.
- Costs are negligible at dashboard scale ($0.042/M input tokens), but still gate behind the env var per project convention.

## Suggested next steps

1. Prototype `src/server/providers/jev.ts` (factory + typed response parsing) with unit tests using an injected fake fetcher — mirrors `explanation.test.ts`.
2. Prototype the deterministic interval + data-quality report (`src/server/assessment.ts`) **first, with no Jev dependency** — it stands alone even if Jev is never adopted.
3. Wire the Idea 2+4 fan-out behind `JEV_AI_ENABLED`; validate calibration by comparing Jev's `data_sufficiency`/reliability answers against the deterministic data-quality report across the existing test fixtures.
4. Add the Idea 3 confidence gate in front of the Cohere call and measure how many explanations it skips.
5. Decide whether to pursue one or multiple ideas; ship UI labeling that keeps advisory output visually and semantically separate from the score.

## Constraints (from AGENTS.md)

- AI must never change the score, factors, safety notice, or emergency guidance — Jev answers live in an advisory report and can only *add caution*, never reduce it.
- Missing/stale/error data lowers confidence and is never treated as safe — the deterministic interval widens upward only.
- Road data is display-only, never a route recommendation — unchanged; Jev is never asked routing questions.
- All AI logic must be server-only and env-gated.
