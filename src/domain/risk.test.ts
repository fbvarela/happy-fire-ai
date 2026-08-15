import { describe, expect, it } from 'vitest'
import type { EnvironmentalContext } from './environment'
import { calculateRisk } from './risk'

const completeContext: EnvironmentalContext = {
  latitude: 40,
  longitude: -3,
  observedAt: '2026-08-15T12:00:00.000Z',
  status: 'available',
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
}

describe('calculateRisk', () => {
  it('calculates weighted contributions for a complete context', () => {
    const result = calculateRisk(completeContext)

    expect(result).toEqual({
      score: 50.9,
      level: 'high',
      confidence: 100,
      modelVersion: 'mvp-1',
      factors: [
        { id: 'weather', label: 'Weather', contribution: 21.9, status: 'available' },
        { id: 'terrain', label: 'Terrain', contribution: 8, status: 'available' },
        { id: 'fuel', label: 'Fuel', contribution: 15, status: 'available' },
        { id: 'season-weather', label: 'Season/weather history', contribution: 5, status: 'available' },
        { id: 'exposure', label: 'Exposure', contribution: 1, status: 'available' },
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
    ])
  })

  it('marks a stale context and reduces confidence', () => {
    const result = calculateRisk({ ...completeContext, status: 'stale' })

    expect(result.confidence).toBe(0)
    expect(result.factors.every(({ status }) => status === 'stale')).toBe(true)
  })
})
