import type { EnvironmentalContext } from '../../domain/environment'

// Jev (TypeSafe) adapter: https://docs.typesafe.ai/introduction
// Jev is a "System One" decision model: state + typed questions in, typed probabilistic answers
// out. It never generates prose and never sees the risk score. Its answers are advisory-only and
// can only add caution to the display; they can never change the deterministic score, factors,
// safety notice, or emergency guidance.

const endpoint = 'https://api.typesafe.ai/v1/systemone'
const model = 'jev-latest'

const anomalyWatchThreshold = 0.7
const anomalyAdvisoryThreshold = 0.85
const conflictThreshold = 0.7
const sufficiencyCautionBelow = 2 // below "Adequate" on the 0-3 data_sufficiency scale
const explanationWarrantedBelow = 0.5 // below this noul, skip the Cohere call entirely

export type JevProvenanceState = {
  weather: {
    source: EnvironmentalContext['source']
    observedAt: string
    status: EnvironmentalContext['status']
  }
  fuel: { source: EnvironmentalContext['fuelSource']; warning: boolean }
  exposure: { source: EnvironmentalContext['exposureSource']; warning: boolean }
  roadClosures: {
    source: EnvironmentalContext['roadClosureSource']
    warning: boolean
    count: number
  }
  missingInputCount: number
}

export type JevAnomaly = {
  id: string
  severity: 'watch' | 'advisory'
  description: string
}

export type JevReliabilityLevel = 'unusable' | 'degraded' | 'acceptable' | 'fresh-and-complete'

export type JevReliability = {
  providerId: 'weather' | 'fuel' | 'exposure'
  level: JevReliabilityLevel
}

export type JevEmphasisArea = 'weather' | 'fuel' | 'terrain' | 'exposure'

export type JevAdvisory = {
  source: 'jev'
  modelVersion?: string
  dataSufficiency: {
    score: number
    confidence: number
    caution: boolean
  }
  anomalies: JevAnomaly[]
  reliability: JevReliability[]
  flags: {
    dataInconsistency: boolean
    providerConflict: boolean
  }
  /** Confidence-gated explanation routing (spec Idea 3): decides whether and how to spend a Cohere call. */
  explanationGate: {
    warranted: boolean
    confidence: number
    emphasis?: JevEmphasisArea
  }
}

export type JevAnswer =
  | { id: string; type: 'noul'; noul: number }
  | { id: string; type: 'choice'; choice: string; confidence: number }
  | { id: string; type: 'score'; score: number; confidence: number }

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

const reliabilityCriteria = [
  'Unusable: wrong, contradictory, or effectively missing.',
  'Degraded: stale, fallback, or flagged by a provider warning.',
  'Acceptable: current but incomplete.',
  'Fresh and complete: current with no gaps or warnings.',
]

const countMissingInputs = (context: EnvironmentalContext): number => {
  const values: Array<number | null | undefined> = [
    context.weather.temperatureC,
    context.weather.humidity,
    context.weather.precipitationMm24h,
    context.weather.windKph,
    context.weather.windDirectionDeg,
    context.terrain.slopeDeg,
    context.terrain.elevationM,
    context.fuel.vegetationDryness,
    context.exposure.nearbyPeople,
    context.seasonWeatherProxy,
  ]
  return values.filter((value) => value == null).length
}

export const buildProvenanceState = (context: EnvironmentalContext): JevProvenanceState => ({
  weather: {
    source: context.source,
    observedAt: context.observedAt,
    status: context.status,
  },
  fuel: { source: context.fuelSource, warning: context.fuelWarning !== undefined },
  exposure: { source: context.exposureSource, warning: context.exposureWarning !== undefined },
  roadClosures: {
    source: context.roadClosureSource ?? null,
    warning: context.roadClosureWarning !== undefined,
    count: context.roadClosures?.length ?? 0,
  },
  missingInputCount: countMissingInputs(context),
})

export const buildJevQuestions = (state: JevProvenanceState): Record<string, JevQuestion> => ({
  wind_fuel_interaction: {
    type: 'noul',
    instructions:
      'Given `weather` wind speed and `fuel.vegetationDryness` in the state, does the combination suggest unusually fast wildfire spread potential compared with what each value alone would indicate?',
  },
  exposure_amplification: {
    type: 'noul',
    instructions:
      'Given `exposure` nearby-people count together with the weather and fuel state, does this combination describe a situation where even a moderate fire risk would still be dangerous to people?',
  },
  terrain_fuel_interaction: {
    type: 'noul',
    instructions:
      'Given `terrain` slope and `fuel.vegetationDryness` in the state, does the combination suggest fire behaviour more severe than the individual values indicate?',
  },
  data_inconsistency: {
    type: 'noul',
    instructions:
      'Are any values in this state internally inconsistent or implausible when considered together?',
  },
  provider_conflict: {
    type: 'noul',
    instructions:
      'Do any two data sources in this state (weather, fuel, exposure, road closures) contradict each other about conditions at the same location and time?',
  },
  data_sufficiency: {
    type: 'score',
    instructions:
      'How well does the data in this state characterize the fire environment at this location?',
    criteria: [
      'Insufficient: too many gaps to characterize the fire environment.',
      'Partial: broad picture with important gaps.',
      'Adequate: most key dimensions present and current.',
      'Strong: complete and current with no warnings.',
    ],
  },
  reliability_weather: {
    type: 'score',
    instructions: `How reliable is the weather data from \`weather\` (source ${state.weather.source}, status ${state.weather.status}, observed ${state.weather.observedAt})?`,
    criteria: reliabilityCriteria,
  },
  reliability_fuel: {
    type: 'score',
    instructions: `How reliable is the fuel/land-cover data from \`fuel\` (source ${state.fuel.source}${state.fuel.warning ? ', provider warning present' : ''})?`,
    criteria: reliabilityCriteria,
  },
  reliability_exposure: {
    type: 'score',
    instructions: `How reliable is the population/exposure data from \`exposure\` (source ${state.exposure.source}${state.exposure.warning ? ', provider warning present' : ''})?`,
    criteria: reliabilityCriteria,
  },
  // Speculative: answered for free in the same fan-out call (spec Idea 3).
  explanation_warranted: {
    type: 'noul',
    instructions:
      'Given the data quality, staleness, and gaps in this state, is there anything here a non-expert would need explained beyond the standard safety notice — for example confusing provider fallbacks, stale inputs, or contradictions between sources?',
  },
  emphasis_area: {
    type: 'choice',
    instructions:
      'Which factor area in this state most deserves narrative focus for a non-expert, given its data quality and warnings?',
    criteria: {
      weather: 'The weather data, its staleness, or its provider fallback.',
      fuel: 'The vegetation/land-cover data quality or fallback.',
      terrain: 'The terrain data quality.',
      exposure: 'The population/exposure data quality or fallback.',
    },
  },
})

type JevResponse = { model?: unknown; answers?: unknown }

const isBoundedUnit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

const parseJevAnswers = (payload: unknown): { modelVersion?: string; answers: Record<string, JevAnswer> } => {
  if (!payload || typeof payload !== 'object' || !('answers' in payload)) throw new Error('Invalid Jev response')
  const record = payload.answers
  if (!record || typeof record !== 'object') throw new Error('Invalid Jev response')
  const answers: Record<string, JevAnswer> = {}
  for (const [id, value] of Object.entries(record as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') throw new Error('Invalid Jev answer')
    const answer = value as Record<string, unknown>
    if (answer.type === 'noul') {
      if (!isBoundedUnit(answer.noul)) throw new Error('Invalid Jev noul answer')
      answers[id] = { id, type: 'noul', noul: answer.noul }
    } else if (answer.type === 'choice') {
      if (typeof answer.choice !== 'string' || !isBoundedUnit(answer.confidence)) throw new Error('Invalid Jev choice answer')
      answers[id] = { id, type: 'choice', choice: answer.choice, confidence: answer.confidence }
    } else if (answer.type === 'score') {
      if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || !isBoundedUnit(answer.confidence)) {
        throw new Error('Invalid Jev score answer')
      }
      answers[id] = { id, type: 'score', score: answer.score, confidence: answer.confidence }
    } else {
      throw new Error('Invalid Jev answer type')
    }
  }
  const modelVersion = typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : undefined
  return { modelVersion, answers }
}

const requireNoul = (answers: Record<string, JevAnswer>, id: string): number => {
  const answer = answers[id]
  if (!answer || answer.type !== 'noul') throw new Error(`Invalid Jev response: missing ${id}`)
  return answer.noul
}

const requireScore = (answers: Record<string, JevAnswer>, id: string): { score: number; confidence: number } => {
  const answer = answers[id]
  if (!answer || answer.type !== 'score') throw new Error(`Invalid Jev response: missing ${id}`)
  return { score: answer.score, confidence: answer.confidence }
}

const requireChoice = (answers: Record<string, JevAnswer>, id: string): { choice: string; confidence: number } => {
  const answer = answers[id]
  if (!answer || answer.type !== 'choice') throw new Error(`Invalid Jev response: missing ${id}`)
  return { choice: answer.choice, confidence: answer.confidence }
}

const reliabilityLevels: JevReliabilityLevel[] = ['unusable', 'degraded', 'acceptable', 'fresh-and-complete']

const toReliability = (providerId: JevReliability['providerId'], score: number): JevReliability => ({
  providerId,
  level: reliabilityLevels[Math.min(reliabilityLevels.length - 1, Math.max(0, Math.round(score)))],
})

const anomalyDescriptions: Record<string, string> = {
  wind_fuel_interaction: 'Wind and vegetation dryness together may support faster fire spread than either factor alone suggests.',
  exposure_amplification: 'Even a moderate fire risk could be dangerous for the nearby population in these conditions.',
  terrain_fuel_interaction: 'Slope and vegetation dryness together may drive more severe fire behaviour than either factor alone suggests.',
}

export const buildJevAdvisory = (
  state: JevProvenanceState,
  answers: Record<string, JevAnswer>,
  modelVersion?: string,
): JevAdvisory => {
  const sufficiency = requireScore(answers, 'data_sufficiency')
  const warrantedAnswer = requireNoul(answers, 'explanation_warranted')
  const emphasisAnswer = requireChoice(answers, 'emphasis_area')
  const emphasis = emphasisAnswer.confidence > 0 &&
    ['weather', 'fuel', 'terrain', 'exposure'].includes(emphasisAnswer.choice)
      ? emphasisAnswer.choice as JevEmphasisArea
      : undefined
  const anomalies: JevAnomaly[] = []
  for (const id of ['wind_fuel_interaction', 'exposure_amplification', 'terrain_fuel_interaction'] as const) {
    const noul = requireNoul(answers, id)
    if (noul >= anomalyWatchThreshold) {
      anomalies.push({
        id,
        severity: noul >= anomalyAdvisoryThreshold ? 'advisory' : 'watch',
        description: anomalyDescriptions[id],
      })
    }
  }
  return {
    source: 'jev',
    modelVersion,
    dataSufficiency: {
      score: sufficiency.score,
      confidence: sufficiency.confidence,
      caution: sufficiency.score < sufficiencyCautionBelow,
    },
    anomalies,
    reliability: [
      toReliability('weather', requireScore(answers, 'reliability_weather').score),
      toReliability('fuel', requireScore(answers, 'reliability_fuel').score),
      toReliability('exposure', requireScore(answers, 'reliability_exposure').score),
    ],
    flags: {
      dataInconsistency: requireNoul(answers, 'data_inconsistency') >= conflictThreshold,
      providerConflict: requireNoul(answers, 'provider_conflict') >= conflictThreshold,
    },
    explanationGate: {
      warranted: warrantedAnswer >= explanationWarrantedBelow,
      confidence: emphasisAnswer.confidence,
      emphasis,
    },
  }
}

export type JevClient = { assess(context: EnvironmentalContext): Promise<JevAdvisory> }

export const createJevProvider = (
  apiKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): JevClient => ({
  async assess(context: EnvironmentalContext): Promise<JevAdvisory> {
    const state = buildProvenanceState(context)
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, state, questions: buildJevQuestions(state) }),
    })
    if (!response.ok) throw new Error(`Jev request failed (${response.status})`)
    const parsed = parseJevAnswers(await response.json())
    return buildJevAdvisory(state, parsed.answers, parsed.modelVersion)
  },
})
