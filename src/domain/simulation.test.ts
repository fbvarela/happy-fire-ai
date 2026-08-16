import { describe, expect, it } from 'vitest'

import { describeSimulationAssumptions } from '../components/FireSimulation'
import type { EnvironmentalContext } from './environment'
import { stepSimulation, type SimulationGrid, type SimulationOptions } from './simulation'

const calmDryConditions: SimulationOptions = {
  windDirectionDeg: 0,
  windKph: 0,
  slopeDeg: 0,
  vegetationDryness: 70,
}

const dampConditions: SimulationOptions = { ...calmDryConditions, vegetationDryness: 0 }

describe('stepSimulation', () => {
  it('turns burning cells into burned cells', () => {
    const grid: SimulationGrid = [[0, 1, 0]]

    expect(stepSimulation(grid, dampConditions)).toEqual([[0, 2, 0]])
  })

  it('spreads burning to adjacent cells deterministically', () => {
    const grid: SimulationGrid = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]

    expect(stepSimulation(grid, calmDryConditions)).toEqual([
      [0, 1, 0],
      [1, 2, 1],
      [0, 1, 0],
    ])
  })

  it('does not mutate unrelated cells when wind is zero', () => {
    const grid: SimulationGrid = [
      [0, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 2],
      [0, 0, 0, 0],
    ]

    expect(stepSimulation(grid, calmDryConditions)).toEqual([
      [0, 1, 0, 0],
      [1, 2, 1, 0],
      [0, 1, 0, 2],
      [0, 0, 0, 0],
    ])
  })
})

describe('describeSimulationAssumptions', () => {
  it('names only missing fields while retaining available values', () => {
    const context: EnvironmentalContext = {
      latitude: 40,
      longitude: -3,
      observedAt: '2026-08-15T12:00:00.000Z',
      status: 'available',
      source: 'mock',
      weather: {
        temperatureC: 30,
        humidity: 40,
        precipitationMm24h: 0,
        windKph: 42,
        windDirectionDeg: null,
      },
      terrain: { slopeDeg: 18, elevationM: 800 },
      fuel: { vegetationDryness: null },
      exposure: { nearbyPeople: 100 },
      seasonWeatherProxy: 50,
    }

    expect(describeSimulationAssumptions(context)).toBe(
      'Fallback assumptions: wind direction north, vegetation dryness 60.',
    )
  })

  it('explicitly labels mock fallback assumptions after a provider error', () => {
    const context: EnvironmentalContext = {
      latitude: 40,
      longitude: -3,
      observedAt: '2026-01-01T00:00:00.000Z',
      status: 'error',
      source: 'mock',
      weather: { temperatureC: 20, humidity: 40, precipitationMm24h: 1, windKph: 10, windDirectionDeg: 180 },
      terrain: { slopeDeg: 10, elevationM: 500 },
      fuel: { vegetationDryness: 60 },
      exposure: { nearbyPeople: 100 },
      seasonWeatherProxy: 50,
    }

    expect(describeSimulationAssumptions(context)).toContain('Mock fallback assumptions are being used')
  })

  it('labels available context as selected context', () => {
    const context: EnvironmentalContext = {
      latitude: 40,
      longitude: -3,
      observedAt: '2026-01-01T00:00:00.000Z',
      status: 'available',
      source: 'open-meteo',
      weather: { temperatureC: 20, humidity: 40, precipitationMm24h: 1, windKph: 10, windDirectionDeg: 180 },
      terrain: { slopeDeg: 10, elevationM: 500 },
      fuel: { vegetationDryness: 60 },
      exposure: { nearbyPeople: 100 },
      seasonWeatherProxy: 50,
    }

    expect(describeSimulationAssumptions(context)).toContain('Using selected context')
  })
})
