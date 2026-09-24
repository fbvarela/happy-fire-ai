import type { DataStatus, HazardId } from '../environment'

// Per-hazard display bands. Deliberately different from the wildfire four-level scale:
// every hazard uses the same three bands so the grid reads consistently.
// low 0–33, medium 34–66, high 67–100.
export type HazardLevel = 'low' | 'medium' | 'high'

export type HazardScoreResult = {
  id: HazardId
  score: number
  level: HazardLevel
  confidence: number
  status: DataStatus
  source: string
}

export const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value))

export const round = (value: number) => Math.round(value * 10) / 10

export const hazardLevel = (score: number): HazardLevel => {
  if (score <= 33) return 'low'
  if (score <= 66) return 'medium'
  return 'high'
}

// Confidence collapses to zero whenever a hazard block is missing/stale/error, and drops
// 20 points per unavailable metric. Missing data is never treated as safe, so the
// deterministic mock score still stands but its confidence falls.
export const metricConfidence = (status: DataStatus, values: Array<number | null>) => {
  if (status !== 'available') return 0
  const missing = values.filter((value) => value === null).length
  return clamp(100 - missing * 20)
}

// Averages the risk mappings of the available metrics; when nothing is available the
// neutral midpoint is used and confidence collapses.
export const averageMetricRisk = (mappings: Array<number | null>) => {
  const available = mappings.filter((value): value is number => value !== null)
  if (available.length === 0) return 50
  return available.reduce((sum, value) => sum + value, 0) / available.length
}

export const baseHazardResult = (
  id: HazardId,
  source: string,
  status: DataStatus,
  values: Array<number | null>,
  score: number,
): HazardScoreResult => ({
  id,
  score: round(clamp(score)),
  level: hazardLevel(clamp(score)),
  confidence: metricConfidence(status, values),
  status: status === 'available' && values.some((value) => value === null) ? 'missing' : status,
  source,
})
