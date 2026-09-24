import type { HazardGroupId, HazardId } from './environment'
import type { HazardScoreResult } from './hazards/types'

// Composite scoring: group scores are the average of their member hazard scores, and the
// overall score is the weighted average of all hazard scores. Everything here is pure and
// deterministic; weights come in parsed from the caller (env `RISK_WEIGHTS`).

export const hazardGroups: Record<HazardGroupId, HazardId[]> = {
  environmental: ['wildfire', 'air-quality', 'water-pollution'],
  geological: ['radon', 'flood'],
  radiation: ['radioactivity'],
}

export const hazardGroupLabels: Record<HazardGroupId, string> = {
  environmental: 'Environmental',
  geological: 'Geological',
  radiation: 'Radiation',
}

export const hazardLabels: Record<HazardId, string> = {
  wildfire: 'Wildfire',
  radioactivity: 'Radioactivity',
  'water-pollution': 'Water pollution',
  radon: 'Radon',
  flood: 'Flood',
  'air-quality': 'Air quality',
}

export const allHazardIds: HazardId[] = [
  'wildfire',
  'radioactivity',
  'water-pollution',
  'radon',
  'flood',
  'air-quality',
]

export const round = (value: number) => Math.round(value * 10) / 10

export const averageScores = (scores: number[]) =>
  scores.length === 0 ? 50 : scores.reduce((sum, score) => sum + score, 0) / scores.length

// Parses the RISK_WEIGHTS env JSON (e.g. {"wildfire":0.3,"radioactivity":0.2}). Returns
// null when unset/empty; throws on malformed input so a silently wrong weighting can
// never enter the pipeline.
export const parseRiskWeights = (raw: string | undefined | null): Partial<Record<HazardId, number>> | null => {
  if (raw === undefined || raw === null || raw.trim() === '') return null
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid RISK_WEIGHTS: expected a JSON object keyed by hazard id.')
  }
  const weights: Partial<Record<HazardId, number>> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(allHazardIds as string[]).includes(key)) {
      throw new Error(`Invalid RISK_WEIGHTS: unknown hazard "${key}".`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid RISK_WEIGHTS: weight for "${key}" must be a non-negative number.`)
    }
    weights[key as HazardId] = value
  }
  return weights
}

// Named hazards use their configured weight; unnamed hazards share the leftover
// (1 - sum of configured, clamped to >= 0) equally, so the weights always sum to 1
// and the spec example {"wildfire":0.3,"radioactivity":0.2} leaves the rest with the
// remaining 0.5. When nothing carries weight, everything falls back to equal weighting.
const resolveWeights = (
  hazards: HazardScoreResult[],
  configured: Partial<Record<HazardId, number>> | null,
): Record<HazardId, number> => {
  const weights = {} as Record<HazardId, number>
  const namedSum = hazards.reduce(
    (sum, hazard) => sum + (configured?.[hazard.id] ?? 0),
    0,
  )
  const namedHazardCount = hazards.filter((hazard) => configured?.[hazard.id] !== undefined).length
  const unnamedCount = hazards.length - namedHazardCount
  const unnamedWeight = unnamedCount > 0 ? Math.max(0, 1 - namedSum) / unnamedCount : 0
  for (const hazard of hazards) {
    const configuredWeight = configured?.[hazard.id]
    weights[hazard.id] = configuredWeight === undefined ? unnamedWeight : Math.max(0, configuredWeight)
  }
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) {
    for (const hazard of hazards) weights[hazard.id] = 1 / hazards.length
    return weights
  }
  for (const hazard of hazards) weights[hazard.id] = weights[hazard.id] / total
  return weights
}

export type CompositeScore = {
  hazards: HazardScoreResult[]
  groups: Record<HazardGroupId, { score: number; hazards: HazardScoreResult[] }>
  overall: number
  weights: Record<HazardId, number>
}

export const calculateComposite = (
  hazards: HazardScoreResult[],
  configuredWeights: Partial<Record<HazardId, number>> | null = null,
): CompositeScore => {
  const weights = resolveWeights(hazards, configuredWeights)
  const byId = new Map(hazards.map((hazard) => [hazard.id, hazard]))
  const groups = {} as CompositeScore['groups']
  for (const [groupId, memberIds] of Object.entries(hazardGroups) as Array<[HazardGroupId, HazardId[]]>) {
    const members = memberIds
      .map((id) => byId.get(id))
      .filter((hazard): hazard is HazardScoreResult => hazard !== undefined)
    groups[groupId] = {
      score: round(averageScores(members.map(({ score }) => score))),
      hazards: members,
    }
  }
  const overall = round(hazards.reduce((sum, hazard) => sum + hazard.score * weights[hazard.id], 0))
  return { hazards, groups, overall, weights }
}
