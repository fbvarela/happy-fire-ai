import type { EnvironmentalContext } from '../environment'
import { averageMetricRisk, baseHazardResult, clamp, type HazardScoreResult } from './types'

// The provider derives a 0–100 radon risk index from the national risk classification
// (e.g. Ireland EPA: "about 1 in N homes above the reference level"). Higher = worse.
const indexRisk = (index: number) => clamp(index)

export function calculateRadonRisk(context: EnvironmentalContext): HazardScoreResult {
  const data = context.radon
  const status = data?.status ?? 'missing'
  const source = data?.source ?? 'mock'
  const values = [data?.radonRiskIndex ?? null]
  const score = averageMetricRisk([
    data?.radonRiskIndex === null || data?.radonRiskIndex === undefined ? null : indexRisk(data.radonRiskIndex),
  ])
  return baseHazardResult('radon', source, status, values, score)
}
