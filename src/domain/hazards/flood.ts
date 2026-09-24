import type { EnvironmentalContext } from '../environment'
import { averageMetricRisk, baseHazardResult, clamp, type HazardScoreResult } from './types'

// Open-Meteo GloFAS supplies a daily river discharge (m³/s) plus a trailing baseline.
// Flood risk is the anomaly: discharge at or below baseline scores 0, and 3x the baseline
// saturates the scale. A missing baseline leaves the metric unavailable rather than
// pretending calm.
const anomalyRisk = (dischargeM3s: number, baselineM3s: number) => {
  if (baselineM3s <= 0) return null
  return clamp((dischargeM3s / baselineM3s - 1) * 50)
}

export function calculateFloodRisk(context: EnvironmentalContext): HazardScoreResult {
  const data = context.flood
  const status = data?.status ?? 'missing'
  const source = data?.source ?? 'mock'
  const discharge = data?.riverDischargeM3s ?? null
  const baseline = data?.baselineDischargeM3s ?? null
  const risk = discharge !== null && baseline !== null ? anomalyRisk(discharge, baseline) : null
  const score = averageMetricRisk([risk])
  return baseHazardResult('flood', source, status, [risk], score)
}
