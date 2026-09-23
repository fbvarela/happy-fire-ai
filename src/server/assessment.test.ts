import { describe, expect, it } from 'vitest'

import type { EnvironmentalContext } from '../domain/environment'
import { calculateRisk } from '../domain/risk'
import { applyJevCaution, buildDataQuality, buildRiskAssessment, buildRiskInterval } from './assessment'
import type { JevAdvisory } from './providers/jev'

const baseContext: EnvironmentalContext = {
  latitude: 40,
  longitude: -3,
  observedAt: '2026-01-01T00:00:00.000Z',
  status: 'available',
  source: 'open-meteo',
  cacheStatus: 'miss',
  weather: {
    temperatureC: 40,
    humidity: 12,
    precipitationMm24h: 0,
    windKph: 55,
    windDirectionDeg: 180,
  },
  terrain: { slopeDeg: 25, elevationM: 600 },
  fuel: { vegetationDryness: 90 },
  fuelSource: 'copernicus',
  exposureSource: 'worldpop',
  exposure: { nearbyPeople: 4000 },
  seasonWeatherProxy: 80,
}

const risk = calculateRisk(baseContext)

describe('risk interval', () => {
  it('is a point interval when every factor is available', () => {
    const complete: EnvironmentalContext = {
      ...baseContext,
      localFestivalPressure: 10,
      roadsideMaintenance: 10,
    }
    const completeRisk = calculateRisk(complete)
    expect(buildRiskInterval(complete, completeRisk)).toEqual({ low: completeRisk.score, high: completeRisk.score })
  })

  it('widens on both sides when inputs are missing', () => {
    const missing: EnvironmentalContext = {
      ...baseContext,
      status: 'available',
      weather: { ...baseContext.weather, windKph: null, windDirectionDeg: null },
    }
    const missingRisk = calculateRisk(missing)
    const interval = buildRiskInterval(missing, missingRisk)
    expect(interval.low).toBeLessThan(missingRisk.score)
    expect(interval.high).toBeGreaterThan(missingRisk.score)
  })

  it('skews the upper bound upward on a low score, where the clamp does not bite', () => {
    const calm: EnvironmentalContext = {
      ...baseContext,
      weather: { temperatureC: 5, humidity: 90, precipitationMm24h: 20, windKph: null, windDirectionDeg: null },
      terrain: { slopeDeg: 5, elevationM: 200 },
      fuel: { vegetationDryness: 20 },
      seasonWeatherProxy: 20,
      exposure: { nearbyPeople: 100 },
    }
    const calmRisk = calculateRisk(calm)
    const interval = buildRiskInterval(calm, calmRisk)
    expect(interval.high - calmRisk.score).toBeGreaterThan(calmRisk.score - interval.low)
  })

  it('never extends below the score when only manual inputs are absent', () => {
    const missing: EnvironmentalContext = {
      ...baseContext,
      localFestivalPressure: null,
      roadsideMaintenance: null,
    }
    const missingRisk = calculateRisk(missing)
    const interval = buildRiskInterval(missing, missingRisk)
    expect(interval.low).toBeLessThan(missingRisk.score)
    expect(interval.high).toBeGreaterThan(missingRisk.score)
  })

  it('never lets the interval contradict the point estimate', () => {
    const missing: EnvironmentalContext = {
      ...baseContext,
      weather: { temperatureC: null, humidity: null, precipitationMm24h: null, windKph: null, windDirectionDeg: null },
      seasonWeatherProxy: null,
    }
    const interval = buildRiskInterval(missing, calculateRisk(missing))
    expect(interval.low).toBeLessThanOrEqual(interval.high)
    expect(interval.low).toBeGreaterThanOrEqual(0)
    expect(interval.high).toBeLessThanOrEqual(100)
  })

  it('adds an error premium when the context is in error status', () => {
    const failing: EnvironmentalContext = { ...baseContext, status: 'error' }
    const interval = buildRiskInterval(failing, calculateRisk(failing))
    expect(interval.high).toBeGreaterThanOrEqual(calculateRisk(failing).score)
  })
})

describe('data quality report', () => {
  it('classifies a fully live context as complete', () => {
    const quality = buildDataQuality(baseContext)
    expect(quality.weather).toMatchObject({ quality: 'complete', scoreImpact: true })
    expect(quality.fuel).toMatchObject({ quality: 'complete', scoreImpact: true })
    expect(quality.exposure).toMatchObject({ quality: 'complete', scoreImpact: true })
    expect(quality.roadClosures).toMatchObject({ quality: 'unavailable', scoreImpact: false })
  })

  it('marks mock fallbacks and keeps road data display-only', () => {
    const quality = buildDataQuality({
      ...baseContext,
      status: 'error',
      fuelSource: 'mock',
      exposureSource: 'mock',
      roadClosureWarning: 'DGT unavailable',
    })
    expect(quality.weather).toMatchObject({ quality: 'error' })
    expect(quality.fuel).toMatchObject({ quality: 'fallback' })
    expect(quality.exposure).toMatchObject({ quality: 'fallback' })
    expect(quality.roadClosures).toMatchObject({ quality: 'error', scoreImpact: false })
  })
})

describe('assessment assembly', () => {
  it('builds a report without advisory when Jev is not used', () => {
    const report = buildRiskAssessment(baseContext, risk)
    expect(report.confidenceLevel).toBe('high')
    expect(report.advisory).toBeUndefined()
    expect(report.advisoryWarnings).toEqual([])
  })
})

describe('Jev caution application', () => {
  const advisory: JevAdvisory = {
    source: 'jev',
    modelVersion: 'jev-1.13.0',
    dataSufficiency: { score: 1.4, confidence: 0.6, caution: true },
    anomalies: [{ id: 'wind_fuel_interaction', severity: 'advisory', description: 'x' }],
    reliability: [{ providerId: 'weather', level: 'degraded' }],
    flags: { dataInconsistency: true, providerConflict: true },
  }

  it('only ever widens the interval upward', () => {
    const report = buildRiskAssessment(baseContext, risk)
    const cautioned = applyJevCaution(report, advisory)
    expect(cautioned.interval.low).toBe(report.interval.low)
    expect(cautioned.interval.high).toBeGreaterThan(report.interval.high)
    expect(cautioned.advisoryWarnings.length).toBeGreaterThan(0)
    expect(cautioned.advisory).toEqual(advisory)
  })

  it('adds no warnings for a clean advisory and leaves the interval alone', () => {
    const report = buildRiskAssessment(baseContext, risk)
    const clean: JevAdvisory = {
      ...advisory,
      dataSufficiency: { score: 3, confidence: 0.95, caution: false },
      anomalies: [],
      flags: { dataInconsistency: false, providerConflict: false },
      // Reliability judgments that agree with the deterministic data-quality report.
      reliability: [{ providerId: 'weather', level: 'fresh-and-complete' }],
    }
    const cautioned = applyJevCaution(report, clean)
    expect(cautioned.interval).toEqual(report.interval)
    expect(cautioned.advisoryWarnings).toEqual([])
    expect(cautioned.advisory).toEqual(clean)
  })

  it('surfaces a reliability judgment more pessimistic than the pipeline', () => {
    const report = buildRiskAssessment(baseContext, risk)
    const pessimistic: JevAdvisory = {
      ...advisory,
      dataSufficiency: { score: 3, confidence: 0.95, caution: false },
      anomalies: [],
      flags: { dataInconsistency: false, providerConflict: false },
    }
    const cautioned = applyJevCaution(report, pessimistic)
    expect(cautioned.interval).toEqual(report.interval)
    expect(cautioned.advisoryWarnings).toEqual(['AI advisory rates weather data as degraded.'])
  })

  it('never exceeds the 0-100 score range', () => {
    const report = buildRiskAssessment(baseContext, risk)
    expect(applyJevCaution(report, advisory).interval.high).toBeLessThanOrEqual(100)
  })
})
