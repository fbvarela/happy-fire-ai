import type { EnvironmentalContext } from '../environment'
import { averageMetricRisk, baseHazardResult, clamp, type HazardScoreResult } from './types'

// Ambient dose rate maps from a 0.1 µSv/h normal background floor to 1.0 µSv/h at the top
// of the scale. Sources: BfS ODL-Info (Germany, direct µSv/h) and Safecast (global, CPM
// converted to µSv/h).
const doseRateRisk = (doseRateUsvH: number) => clamp((doseRateUsvH - 0.1) * (100 / 0.9))

export function calculateRadioactivityRisk(context: EnvironmentalContext): HazardScoreResult {
  const data = context.radioactivity
  const status = data?.status ?? 'missing'
  const source = data?.source ?? 'mock'
  const values = [data?.doseRateUsvH ?? null]
  const score = averageMetricRisk([
    data?.doseRateUsvH === null || data?.doseRateUsvH === undefined ? null : doseRateRisk(data.doseRateUsvH),
  ])
  return baseHazardResult('radioactivity', source, status, values, score)
}
