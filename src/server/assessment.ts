import type { EnvironmentalContext } from '../domain/environment'
import type { RiskFactor, RiskResult } from '../domain/risk'
import type { JevAdvisory } from './providers/jev'

// Deterministic assessment layer. Everything in this file is pure and provider-free:
// the risk interval and data-quality report are computed from the EnvironmentalContext and
// RiskResult only. Jev output enters exclusively through applyJevCaution, which can only
// widen the interval upward and add display warnings — never narrow, lower, or re-score.

export type ProviderDataQuality = 'complete' | 'partial' | 'stale' | 'fallback' | 'unavailable' | 'error'

export type ProviderQuality = {
  quality: ProviderDataQuality
  /** Whether this provider feeds the deterministic score. Road data is display-only. */
  scoreImpact: boolean
  note: string
}

export type RiskAssessmentReport = {
  interval: { low: number; high: number }
  confidenceLevel: 'low' | 'medium' | 'high'
  dataQuality: {
    weather: ProviderQuality
    fuel: ProviderQuality
    exposure: ProviderQuality
    roadClosures: ProviderQuality
  }
  /** Warnings added by the optional AI advisory. Always display-only. */
  advisoryWarnings: string[]
  advisory?: JevAdvisory
}

const round = (value: number) => Math.round(value * 10) / 10
const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value))

const confidenceLevel = (confidence: number): RiskAssessmentReport['confidenceLevel'] => {
  if (confidence >= 70) return 'high'
  if (confidence >= 40) return 'medium'
  return 'low'
}

// A factor group with missing inputs is scored at a neutral 50 by the deterministic model,
// so its contribution (weight * 50) is exactly the allowance for how far the true score may
// sit on either side of the point estimate. Stale data halves that allowance; provider error
// is treated like stale data for the floor but gets a larger upward allowance. The upward
// side is then skewed by 1.25x: uncertainty extends further toward danger than toward calm,
// because understating risk is the worse error. The floor is never raised and the ceiling
// never lowered.
const factorAllowance = (factor: RiskFactor): { down: number; up: number } => {
  const contribution = factor.contribution
  switch (factor.status) {
    case 'available':
      return { down: 0, up: 0 }
    case 'missing':
      return { down: contribution, up: contribution }
    case 'stale':
      return { down: contribution / 2, up: contribution / 2 }
    case 'error':
      return { down: contribution / 2, up: contribution * 0.75 }
  }
}

export const buildRiskInterval = (context: EnvironmentalContext, risk: RiskResult): RiskAssessmentReport['interval'] => {
  let down = 0
  let up = 0
  for (const factor of risk.factors) {
    const allowance = factorAllowance(factor)
    down += allowance.down
    up += allowance.up
  }
  up = up * 1.25 + (context.status === 'error' ? 5 : 0)
  return {
    low: round(clamp(risk.score - down)),
    high: round(clamp(risk.score + up)),
  }
}

export const buildDataQuality = (context: EnvironmentalContext): RiskAssessmentReport['dataQuality'] => {
  const weatherMissing = [
    context.weather.temperatureC,
    context.weather.humidity,
    context.weather.precipitationMm24h,
    context.weather.windKph,
    context.weather.windDirectionDeg,
  ].filter((value) => value === null).length
  const weather: ProviderQuality =
    context.status === 'error'
      ? { quality: 'error', scoreImpact: true, note: 'Weather provider failed; deterministic mock fallback is shown.' }
      : context.status === 'stale'
        ? { quality: 'stale', scoreImpact: true, note: 'Weather data is older than the freshness threshold.' }
        : context.source === 'mock'
          ? { quality: 'fallback', scoreImpact: true, note: 'Weather is deterministic mock data, not live conditions.' }
          : weatherMissing > 0
            ? { quality: 'partial', scoreImpact: true, note: `Weather is missing ${weatherMissing} of 5 fields.` }
            : { quality: 'complete', scoreImpact: true, note: 'Live weather data is complete and current.' }

  const fuel: ProviderQuality =
    context.fuel.vegetationDryness === null
      ? { quality: 'partial', scoreImpact: true, note: 'Vegetation dryness is unavailable.' }
      : context.fuelSource === 'copernicus'
        ? { quality: 'complete', scoreImpact: true, note: 'Copernicus land-cover data is in use.' }
        : { quality: 'fallback', scoreImpact: true, note: 'Fuel is deterministic mock data, not satellite-derived.' }

  const exposure: ProviderQuality =
    context.exposure.nearbyPeople === null
      ? { quality: 'partial', scoreImpact: true, note: 'Nearby population is unavailable.' }
      : context.exposureSource === 'worldpop'
        ? { quality: 'complete', scoreImpact: true, note: 'WorldPop population data is in use.' }
        : { quality: 'fallback', scoreImpact: true, note: 'Exposure is deterministic mock data, not census-derived.' }

  // Road closures never feed the score; they are display-only.
  const roadClosures: ProviderQuality =
    context.roadClosureWarning !== undefined
      ? { quality: 'error', scoreImpact: false, note: 'Road-closure feed failed; closure list is unavailable.' }
      : context.roadClosureSource === 'dgt'
        ? { quality: 'complete', scoreImpact: false, note: 'DGT closure data is in use (display only).' }
        : { quality: 'unavailable', scoreImpact: false, note: 'Road-closure feed is not enabled.' }

  return { weather, fuel, exposure, roadClosures }
}

export const buildRiskAssessment = (context: EnvironmentalContext, risk: RiskResult): RiskAssessmentReport => ({
  interval: buildRiskInterval(context, risk),
  confidenceLevel: confidenceLevel(risk.confidence),
  dataQuality: buildDataQuality(context),
  advisoryWarnings: [],
})

const jevCautionWarning = 'The AI advisory flagged data-quality concerns; treat the upper bound with additional caution.'

// The only entry point for AI output into the assessment. It can widen the interval upward,
// append display warnings, and attach the advisory for rendering. It can never narrow the
// interval, change the score, or touch safety/emergency guidance.
export const applyJevCaution = (report: RiskAssessmentReport, advisory: JevAdvisory): RiskAssessmentReport => {
  const warnings: string[] = []
  let high = report.interval.high
  if (advisory.dataSufficiency.caution) {
    high = clamp(high + 5)
    warnings.push('AI advisory: data sufficiency is below the caution threshold.')
  }
  if (advisory.flags.dataInconsistency) warnings.push('AI advisory: inputs may be internally inconsistent.')
  if (advisory.flags.providerConflict) warnings.push('AI advisory: data sources may contradict each other.')
  if (advisory.anomalies.length > 0) {
    warnings.push(`AI advisory: ${advisory.anomalies.length} factor-combination anomaly notice(s) attached.`)
  }
  return {
    ...report,
    interval: { ...report.interval, high: round(high) },
    advisoryWarnings: warnings,
    advisory,
  }
}
