import { describe, expect, it } from 'vitest'
import type { EnvironmentalContext } from './environment'
import { calculateRisk } from './risk'

const completeContext: EnvironmentalContext = {
  latitude: 40,
  longitude: -3,
  observedAt: '2026-08-15T12:00:00.000Z',
  status: 'available',
  source: 'mock',
  cacheStatus: 'fallback',
  fuelSource: 'mock',
  exposureSource: 'mock',
  weather: {
    temperatureC: 30,
    humidity: 40,
    precipitationMm24h: 0,
    windKph: 40,
    windDirectionDeg: 180,
  },
  terrain: { slopeDeg: 18, elevationM: 800 },
  fuel: { vegetationDryness: 60 },
  exposure: { nearbyPeople: 100 },
  seasonWeatherProxy: 50,
  localFestivalPressure: 50,
  roadsideMaintenance: 50,
}

describe('calculateRisk', () => {
  const boundaryBase = {
    ...completeContext,
    weather: { temperatureC: null, humidity: null, precipitationMm24h: null, windKph: null, windDirectionDeg: null },
    terrain: { slopeDeg: null, elevationM: null },
    fuel: { vegetationDryness: null },
    seasonWeatherProxy: null,
    exposure: { nearbyPeople: null },
  }

  it('calculates weighted contributions for a complete context', () => {
    const result = calculateRisk(completeContext)

    expect(result).toEqual({
       score: 49.8,
       level: 'moderate',
       confidence: 100,
       modelVersion: 'mvp-2',
       factors: [
         { id: 'weather', label: 'Weather', contribution: 18.8, status: 'available' },
         { id: 'terrain', label: 'Terrain', contribution: 8, status: 'available' },
         { id: 'fuel', label: 'Fuel', contribution: 12, status: 'available' },
         { id: 'season-weather', label: 'Season/weather history', contribution: 5, status: 'available' },
         { id: 'exposure', label: 'Exposure', contribution: 1, status: 'available' },
         { id: 'local-events', label: 'Local festivals/events', contribution: 2.5, status: 'available' },
         { id: 'roadside-maintenance', label: 'Roadside maintenance', contribution: 2.5, status: 'available' },
      ],
    })
  })

  it('clamps maximum-risk inputs to an extreme score', () => {
    const result = calculateRisk({
      ...completeContext,
      weather: {
        temperatureC: 45,
        humidity: 0,
        precipitationMm24h: 0,
        windKph: 80,
        windDirectionDeg: 0,
      },
      terrain: { slopeDeg: 45, elevationM: 3000 },
      fuel: { vegetationDryness: 100 },
      exposure: { nearbyPeople: 1000 },
      seasonWeatherProxy: 100,
      localFestivalPressure: 100,
      roadsideMaintenance: 0,
    })

    expect(result.score).toBe(100)
    expect(result.level).toBe('extreme')
  })

  it('reduces confidence for each missing input within one factor', () => {
    const result = calculateRisk({
      ...completeContext,
      weather: { ...completeContext.weather, humidity: null, windKph: null },
    })

    expect(result.confidence).toBe(88)
    expect(result.factors.map(({ id, status }) => [id, status])).toEqual([
      ['weather', 'missing'],
      ['terrain', 'available'],
      ['fuel', 'available'],
      ['season-weather', 'available'],
      ['exposure', 'available'],
      ['local-events', 'available'],
      ['roadside-maintenance', 'available'],
    ])
  })

  it('marks a stale context and reduces confidence', () => {
    const result = calculateRisk({ ...completeContext, status: 'stale' })

    expect(result.confidence).toBe(0)
    expect(result.factors.every(({ status }) => status === 'stale')).toBe(true)
  })

  it('treats provider errors as unavailable data', () => {
    const result = calculateRisk({ ...completeContext, status: 'error' })

    expect(result.confidence).toBe(0)
    expect(result.factors.every(({ status }) => status === 'error')).toBe(true)
  })

  it('raises risk for local festivals and lowers it for maintained roadside ditches', () => {
    const baseline = calculateRisk({ ...completeContext, localFestivalPressure: 0, roadsideMaintenance: 100 })
    const elevated = calculateRisk({ ...completeContext, localFestivalPressure: 100, roadsideMaintenance: 0 })

    expect(elevated.score).toBeGreaterThan(baseline.score)
    expect(elevated.factors.find(({ id }) => id === 'local-events')?.contribution).toBe(5)
    expect(elevated.factors.find(({ id }) => id === 'roadside-maintenance')?.contribution).toBe(5)
  })

  it.each([
    [24.2, 'low', { weather: { temperatureC: 0, humidity: 100, precipitationMm24h: 50, windKph: 0, windDirectionDeg: 0 }, terrain: { slopeDeg: 0, elevationM: null }, fuel: { vegetationDryness: 96 }, seasonWeatherProxy: 0, exposure: { nearbyPeople: 0 } }],
    [25, 'moderate', { weather: { temperatureC: 0, humidity: 100, precipitationMm24h: 50, windKph: 0, windDirectionDeg: 0 }, terrain: { slopeDeg: 0, elevationM: null }, fuel: { vegetationDryness: 100 }, seasonWeatherProxy: 0, exposure: { nearbyPeople: 0 } }],
    [51.2, 'high', { fuel: { vegetationDryness: 6 }, seasonWeatherProxy: 100, exposure: { nearbyPeople: 1000 } }],
    [52, 'high', { fuel: { vegetationDryness: 10 }, seasonWeatherProxy: 100, exposure: { nearbyPeople: 1000 } }],
    [73.2, 'high', { fuel: { vegetationDryness: 66 }, terrain: { slopeDeg: 45, elevationM: null }, seasonWeatherProxy: 100, exposure: { nearbyPeople: 1000 } }],
    [74, 'high', { fuel: { vegetationDryness: 70 }, terrain: { slopeDeg: 45, elevationM: null }, seasonWeatherProxy: 100, exposure: { nearbyPeople: 1000 } }],
  ] as const)('classifies score boundary %s as %s', (targetScore, level, overrides) => {
    const result = calculateRisk({
      ...boundaryBase,
      ...overrides,
    })

    expect(result.score).toBe(targetScore)
    expect(result.level).toBe(level)
  })
})
