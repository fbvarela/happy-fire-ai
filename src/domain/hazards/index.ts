import type { EnvironmentalContext, HazardId } from '../environment'
import { calculateAirQualityRisk } from './air-quality'
import { calculateFloodRisk } from './flood'
import { calculateRadonRisk } from './radon'
import { calculateRadioactivityRisk } from './radioactivity'
import { calculateWaterPollutionRisk } from './water-pollution'
import type { HazardScoreResult } from './types'
import { calculateWildfireRisk } from './wildfire'

export { calculateWildfireRisk, calculateRisk } from './wildfire'
export type { RiskFactor, RiskResult } from './wildfire'
export type { HazardLevel, HazardScoreResult } from './types'

// Runs every deterministic hazard model against one context. A missing hazard block is
// treated as missing data (neutral score, collapsed confidence) — never as safe.
export const calculateHazardScores = (context: EnvironmentalContext): HazardScoreResult[] => [
  calculateWildfireRisk(context),
  calculateRadioactivityRisk(context),
  calculateWaterPollutionRisk(context),
  calculateRadonRisk(context),
  calculateFloodRisk(context),
  calculateAirQualityRisk(context),
]

export const hazardScoreById = (scores: HazardScoreResult[]) =>
  Object.fromEntries(scores.map((score) => [score.id, score])) as Record<HazardId, HazardScoreResult>
