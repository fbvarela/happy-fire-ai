import { describe, expect, it } from 'vitest'

import { calculateRisk } from '../domain/risk'
import { getExplanationForRisk } from './explanation'

const input = { score: 62, level: 'high' as const, factors: ['Weather', 'Fuel'] }

describe('risk explanation server boundary', () => {
  it('returns deterministic fallback without calling a missing-key provider', async () => {
    let calls = 0
    const provider = { explain: async () => { calls += 1; throw new Error('should not call') } }

    await expect(getExplanationForRisk(input, provider, '')).resolves.toEqual({
      summary: 'This estimate is based on the displayed risk score and drivers.',
      drivers: ['Review the displayed drivers for the estimate context.'],
      caveat: 'AI text is explanatory only and does not change the estimate or emergency guidance.',
      source: 'fallback',
    })
    expect(calls).toBe(0)
  })

  it('returns the same fallback when the provider fails', async () => {
    const provider = { explain: async () => { throw new Error('provider unavailable') } }

    await expect(getExplanationForRisk(input, provider, 'test-key')).resolves.toEqual({
      summary: 'This estimate is based on the displayed risk score and drivers.',
      drivers: ['Review the displayed drivers for the estimate context.'],
      caveat: 'AI text is explanatory only and does not change the estimate or emergency guidance.',
      source: 'fallback',
    })
  })

  it('accepts the full factor list the UI sends from a calculated result', async () => {
    const result = calculateRisk({
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
    })
    const uiPayload = {
      score: result.score,
      level: result.level,
      factors: result.factors.map(({ label }) => label),
    }

    await expect(getExplanationForRisk(uiPayload, { explain: async () => {
      throw new Error('provider should not be reached for a valid payload')
    } }, '')).resolves.toMatchObject({ source: 'fallback' })
  })
})
