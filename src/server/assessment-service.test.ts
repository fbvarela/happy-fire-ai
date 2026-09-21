import { afterEach, describe, expect, it } from 'vitest'

import type { EnvironmentalContext } from '../domain/environment'
import { calculateRisk } from '../domain/risk'
import type { JevAdvisory } from './providers/jev'
import { clearAssessmentCache, getRiskAssessmentForRequest } from './assessment-service'

const contextWithManualInputs: EnvironmentalContext = {
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
  localFestivalPressure: 10,
  roadsideMaintenance: 10,
}

const context = contextWithManualInputs

const jevAdvisory: JevAdvisory = {
  source: 'jev',
  modelVersion: 'jev-1.13.0',
  dataSufficiency: { score: 3, confidence: 0.95, caution: false },
  anomalies: [],
  reliability: [
    { providerId: 'weather', level: 'fresh-and-complete' },
    { providerId: 'fuel', level: 'fresh-and-complete' },
    { providerId: 'exposure', level: 'fresh-and-complete' },
  ],
  flags: { dataInconsistency: false, providerConflict: false },
}

const env = { ...process.env }

afterEach(() => {
  process.env = { ...env }
  clearAssessmentCache()
})

describe('assessment service', () => {
  it('returns a deterministic report with no advisory when Jev is not configured', async () => {
    const risk = calculateRisk(context)
    const report = await getRiskAssessmentForRequest(40, -3, context, risk)
    expect(report.advisory).toBeUndefined()
    expect(report.interval).toEqual({ low: risk.score, high: risk.score })
    expect(report.advisoryWarnings).toEqual([])
  })

  it('attaches a display-only advisory when Jev succeeds', async () => {
    process.env.JEV_AI_ENABLED = 'true'
    process.env.JEV_API_KEY = 'test-key'
    let called = 0
    // Patch global fetch just for this test; the provider defaults to it.
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      called += 1
      return new Response(JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          wind_fuel_interaction: { type: 'noul', noul: 0.1 },
          exposure_amplification: { type: 'noul', noul: 0.1 },
          terrain_fuel_interaction: { type: 'noul', noul: 0.1 },
          data_inconsistency: { type: 'noul', noul: 0.1 },
          provider_conflict: { type: 'noul', noul: 0.1 },
          data_sufficiency: { type: 'score', score: 3, confidence: 0.95 },
          reliability_weather: { type: 'score', score: 3, confidence: 0.95 },
          reliability_fuel: { type: 'score', score: 3, confidence: 0.95 },
          reliability_exposure: { type: 'score', score: 3, confidence: 0.95 },
        },
      })) as unknown as typeof fetch
    }) as typeof fetch
    try {
      const risk = calculateRisk(context)
      const report = await getRiskAssessmentForRequest(40, -3, context, risk)
      expect(called).toBe(1)
      expect(report.advisory).toEqual(jevAdvisory)
      expect(report.advisoryWarnings).toEqual([])
      expect(report.interval).toEqual({ low: risk.score, high: risk.score })

      const second = await getRiskAssessmentForRequest(40, -3, context, risk)
      expect(called).toBe(1)
      expect(second).toEqual(report)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('degrades to the deterministic report when Jev fails', async () => {
    process.env.JEV_AI_ENABLED = 'true'
    process.env.JEV_API_KEY = 'test-key'
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    try {
      const risk = calculateRisk(context)
      const report = await getRiskAssessmentForRequest(40, -3, context, risk)
      expect(report.advisory).toBeUndefined()
      expect(report.interval).toEqual({ low: risk.score, high: risk.score })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
