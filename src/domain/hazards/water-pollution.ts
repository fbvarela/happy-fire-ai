import type { EnvironmentalContext } from '../environment'
import { averageMetricRisk, baseHazardResult, clamp, type HazardScoreResult } from './types'

// The provider already normalizes its classification to a 0–100 pollution index (higher =
// worse), so scoring is a clamp. Sources: EEA bathing-water quality (Excellent/Good/
// Sufficient/Poor) and EEA PFAS monitoring concentrations (ng/L, referenced to the EU
// 100 ng/L drinking-water limit for the sum of PFAS).
const indexRisk = (index: number) => clamp(index)

export function calculateWaterPollutionRisk(context: EnvironmentalContext): HazardScoreResult {
  const data = context.waterPollution
  const status = data?.status ?? 'missing'
  const source = data?.source ?? 'mock'
  const values = [data?.qualityIndex ?? null]
  const score = averageMetricRisk([
    data?.qualityIndex === null || data?.qualityIndex === undefined ? null : indexRisk(data.qualityIndex),
  ])
  return baseHazardResult('water-pollution', source, status, values, score)
}
