import { createServerFn } from '@tanstack/react-start'

import { factorLabels } from '../domain/risk'
import { createCohereExplanationProvider, type Explanation, type ExplanationInput } from './providers/explanation'

// Accept exactly the canonical factor labels emitted by calculateRisk; this whitelist used to
// omit the two manual-input factors, which rejected every real payload with
// "Invalid explanation input" before the provider was ever called.
const validFactorLabels = new Set<string>(factorLabels)

export const fallbackExplanation: Explanation = {
  summary: 'This estimate is based on the displayed risk score and drivers.',
  drivers: ['Review the displayed drivers for the estimate context.'],
  caveat: 'AI text is explanatory only and does not change the estimate or emergency guidance.',
  source: 'fallback',
}

// Returned when the Jev confidence gate (spec Idea 3) judged that the standard safety notice
// already covers the estimate, so no Cohere call is spent.
export const gateSkippedExplanation: Explanation = {
  summary: 'The available data adds nothing beyond the standard safety notice, so no AI explanation was generated for this estimate.',
  drivers: ['The displayed drivers and the safety notice cover what the available data supports.'],
  caveat: 'AI routing is explanatory only and does not change the estimate or emergency guidance.',
  source: 'skipped',
}

const validEmphasisAreas = new Set(['weather', 'fuel', 'terrain', 'exposure'])

const validateInput = (value: unknown): ExplanationInput => {
  if (!value || typeof value !== 'object') throw new Error('Invalid explanation input')
  const input = value as Record<string, unknown>
  if (typeof input.score !== 'number' || !Number.isFinite(input.score) || input.score < 0 || input.score > 100 ||
      !['low', 'moderate', 'high', 'extreme'].includes(String(input.level)) ||
      !Array.isArray(input.factors) || input.factors.length > validFactorLabels.size ||
      !input.factors.every((factor) => typeof factor === 'string' && validFactorLabels.has(factor))) {
    throw new Error('Invalid explanation input')
  }
  const gate = input.gate as { warranted?: unknown; emphasis?: unknown } | undefined
  if (gate !== undefined &&
      (typeof gate !== 'object' || typeof gate.warranted !== 'boolean' ||
        (gate.emphasis !== undefined && !(typeof gate.emphasis === 'string' && validEmphasisAreas.has(gate.emphasis))))) {
    throw new Error('Invalid explanation input')
  }
  return {
    score: input.score,
    level: input.level as ExplanationInput['level'],
    factors: input.factors as string[],
    gate: gate === undefined ? undefined : {
      warranted: gate.warranted,
      emphasis: typeof gate.emphasis === 'string' ? gate.emphasis as NonNullable<ExplanationInput['gate']>['emphasis'] : undefined,
    },
  }
}

type ExplanationProvider = { explain(input: ExplanationInput): Promise<Explanation> }

export const getExplanationForRisk = async (
  input: ExplanationInput,
  provider?: ExplanationProvider,
  apiKey = process.env.COHERE_API_KEY,
): Promise<Explanation> => {
  const verifiedInput = validateInput(input)
  if (verifiedInput.gate?.warranted === false) {
    // Confidence-gated routing (spec Idea 3): Jev judged that the standard safety notice
    // already covers this estimate, so the Cohere call is skipped entirely. The returned
    // text is deterministic and display-only, exactly like the fallback path.
    console.info('[explanation] gate-skipped', JSON.stringify({ status: 'skipped' }))
    return gateSkippedExplanation
  }
  if (!apiKey) {
    console.warn('[explanation] key-missing', JSON.stringify({ status: 'fallback' }))
    return fallbackExplanation
  }
  try {
    return await (provider ?? createCohereExplanationProvider(apiKey)).explain(verifiedInput)
  } catch (error) {
    console.warn('[explanation] provider-failed', JSON.stringify({
      status: 'fallback',
      error: error instanceof Error ? error.message : 'unknown error',
    }))
    return fallbackExplanation
  }
}

export const getExplanation = createServerFn({ method: 'POST' })
  .validator(validateInput)
  .handler(({ data }) => getExplanationForRisk(data))
