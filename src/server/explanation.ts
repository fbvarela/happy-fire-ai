import { createServerFn } from '@tanstack/react-start'

import { createCohereExplanationProvider, type Explanation, type ExplanationInput } from './providers/explanation'

const factorLabels = new Set(['Weather', 'Terrain', 'Fuel', 'Season/weather history', 'Exposure'])

export const fallbackExplanation: Explanation = {
  summary: 'This estimate is based on the displayed risk score and drivers.',
  drivers: ['Review the displayed drivers for the estimate context.'],
  caveat: 'AI text is explanatory only and does not change the estimate or emergency guidance.',
  source: 'fallback',
}

const validateInput = (value: unknown): ExplanationInput => {
  if (!value || typeof value !== 'object') throw new Error('Invalid explanation input')
  const input = value as Record<string, unknown>
  if (typeof input.score !== 'number' || !Number.isFinite(input.score) || input.score < 0 || input.score > 100 ||
      !['low', 'moderate', 'high', 'extreme'].includes(String(input.level)) ||
      !Array.isArray(input.factors) || input.factors.length > factorLabels.size ||
      !input.factors.every((factor) => typeof factor === 'string' && factorLabels.has(factor))) {
    throw new Error('Invalid explanation input')
  }
  return { score: input.score, level: input.level as ExplanationInput['level'], factors: input.factors as string[] }
}

type ExplanationProvider = { explain(input: ExplanationInput): Promise<Explanation> }

export const getExplanationForRisk = async (
  input: ExplanationInput,
  provider?: ExplanationProvider,
  apiKey = process.env.COHERE_API_KEY,
): Promise<Explanation> => {
  const verifiedInput = validateInput(input)
  if (!apiKey) return fallbackExplanation
  try {
    return await (provider ?? createCohereExplanationProvider(apiKey)).explain(verifiedInput)
  } catch {
    return fallbackExplanation
  }
}

export const getExplanation = createServerFn({ method: 'POST' })
  .validator(validateInput)
  .handler(({ data }) => getExplanationForRisk(data))
