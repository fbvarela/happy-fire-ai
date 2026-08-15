import { describe, expect, it } from 'vitest'

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
