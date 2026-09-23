import { describe, expect, it } from 'vitest'

import type { EnvironmentalContext } from '../domain/environment'
import type { RiskResult } from '../domain/risk'
import { applyJevCaution, buildRiskAssessment, calibrationMismatches, type RiskAssessmentReport } from './assessment'
import type { JevAdvisory, JevReliability, JevReliabilityLevel } from './providers/jev'

// Calibration validation (spec, next-step 3): Jev's data_sufficiency / reliability judgments
// are compared against the deterministic data-quality report across context fixtures. The
// composed advisory may only ever add caution — never narrow the interval or touch the score.

const baseContext: EnvironmentalContext = {
  latitude: 40,
  longitude: -3,
  observedAt: '2026-01-01T00:00:00.000Z',
  status: 'available',
  source: 'mock',
  cacheStatus: 'fallback',
  fuelSource: 'mock',
  exposureSource: 'mock',
  weather: { temperatureC: 30, humidity: 40, precipitationMm24h: 0, windKph: 40, windDirectionDeg: 180 },
  terrain: { slopeDeg: 18, elevationM: 800 },
  fuel: { vegetationDryness: 60 },
  exposure: { nearbyPeople: 100 },
  seasonWeatherProxy: 50,
  localFestivalPressure: 50,
  roadsideMaintenance: 50,
}

const fixtures: Array<{ name: string; context: EnvironmentalContext }> = [
  { name: 'mock fallback (default UX)', context: baseContext },
  {
    name: 'live complete data',
    context: { ...baseContext, source: 'open-meteo', fuelSource: 'copernicus', exposureSource: 'worldpop' },
  },
  {
    name: 'stale weather',
    context: { ...baseContext, source: 'open-meteo', status: 'stale' },
  },
  {
    name: 'weather provider error',
    context: { ...baseContext, source: 'open-meteo', status: 'error' },
  },
  {
    name: 'missing fuel and exposure',
    context: {
      ...baseContext,
      fuel: { vegetationDryness: null },
      exposure: { nearbyPeople: null },
    },
  },
]

const risk: RiskResult = {
  score: 54.1,
  level: 'high',
  confidence: 82,
  modelVersion: 'mvp-2',
  factors: [],
}

const jevLevelFor = (quality: RiskAssessmentReport['dataQuality']['weather']['quality']): JevReliabilityLevel =>
  ({ complete: 'fresh-and-complete', partial: 'acceptable', stale: 'degraded', fallback: 'degraded', unavailable: 'unusable', error: 'unusable' })[quality]

// A Jev whose answers agree with the deterministic data-quality report.
const calibratedAdvisory = (report: RiskAssessmentReport): JevAdvisory => ({
  source: 'jev',
  modelVersion: 'jev-1.13.0',
  dataSufficiency: {
    score: report.confidenceLevel === 'low' ? 1 : 3,
    confidence: 0.9,
    caution: report.confidenceLevel === 'low',
  },
  anomalies: [],
  reliability: (['weather', 'fuel', 'exposure'] as const).map((providerId) => ({
    providerId,
    level: jevLevelFor(report.dataQuality[providerId].quality),
  })),
  flags: { dataInconsistency: false, providerConflict: false },
  explanationGate: { warranted: true, confidence: 0.8, emphasis: 'weather' },
})

describe('Jev vs deterministic calibration across fixtures', () => {
  for (const { name, context } of fixtures) {
    it(`${name}: a calibrated advisory agrees with the deterministic report and adds no mismatches`, () => {
      const report = buildRiskAssessment(context, risk)
      const advisory = calibratedAdvisory(report)

      expect(calibrationMismatches(report, advisory)).toEqual([])

      const cautioned = applyJevCaution(report, advisory)
      expect(cautioned.interval.low).toBe(report.interval.low)
      expect(cautioned.interval.high).toBeGreaterThanOrEqual(report.interval.high)
      expect(cautioned.confidenceLevel).toBe(report.confidenceLevel)
      expect(cautioned.advisory).toEqual(advisory)
    })

    it(`${name}: an over-optimistic advisory is surfaced, never trusted`, () => {
      const report = buildRiskAssessment(context, risk)
      const advisory: JevAdvisory = {
        ...calibratedAdvisory(report),
        reliability: (['weather', 'fuel', 'exposure'] as const).map((providerId) => ({
          providerId,
          level: 'fresh-and-complete' as const,
        })),
      }
      const cautioned = applyJevCaution(report, advisory)

      // Every provider the pipeline reports as degraded/fallback must be flagged as a
      // calibration mismatch; providers that genuinely are complete legitimately agree.
      const degradedProviders = (['weather', 'fuel', 'exposure'] as const)
        .filter((providerId) => report.dataQuality[providerId].quality !== 'complete')
      expect(calibrationMismatches(report, advisory).length).toBe(degradedProviders.length)
      if (degradedProviders.length > 0) {
        expect(cautioned.advisoryWarnings.some((warning) => /pipeline reports it as/.test(warning))).toBe(true)
      }
      // The interval can only move toward caution: the floor never rises and the ceiling
      // never falls below the deterministic high.
      expect(cautioned.interval.low).toBe(report.interval.low)
      expect(cautioned.interval.high).toBeGreaterThanOrEqual(report.interval.high)
    })

    it(`${name}: a pessimistic advisory only widens the upper bound and appends warnings`, () => {
      const report = buildRiskAssessment(context, risk)
      const advisory: JevAdvisory = {
        ...calibratedAdvisory(report),
        dataSufficiency: { score: 0.5, confidence: 0.9, caution: true },
        reliability: (['weather', 'fuel', 'exposure'] as const).map((providerId) => ({
          providerId,
          level: 'unusable' as const,
        })),
        flags: { dataInconsistency: true, providerConflict: true },
      }
      const cautioned = applyJevCaution(report, advisory)

      expect(calibrationMismatches(report, advisory)).toEqual([])
      expect(cautioned.interval.high).toBeGreaterThan(report.interval.high)
      expect(cautioned.interval.low).toBe(report.interval.low)
      expect(cautioned.advisoryWarnings.length).toBeGreaterThan(0)
    })
  }

  it('flags Jev sufficiency optimism against low deterministic confidence', () => {
    const lowConfidence = { ...risk, confidence: 10 }
    const report = buildRiskAssessment(fixtures[1].context, lowConfidence)
    const advisory: JevAdvisory = {
      ...calibratedAdvisory(report),
      dataSufficiency: { score: 3, confidence: 0.9, caution: false },
    }

    expect(report.confidenceLevel).toBe('low')
    expect(calibrationMismatches(report, advisory)).toEqual([
      'AI advisory rates data sufficiency as adequate while the deterministic confidence is low.',
    ])
  })
})
