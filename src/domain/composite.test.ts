import { describe, expect, it } from 'vitest'
import { calculateComposite, hazardGroups, parseRiskWeights } from './composite'
import type { HazardScoreResult } from './hazards/types'

const score = (id: HazardScoreResult['id'], value: number): HazardScoreResult => ({
  id,
  score: value,
  level: value <= 33 ? 'low' : value <= 66 ? 'medium' : 'high',
  confidence: 100,
  status: 'available',
  source: 'mock',
})

describe('hazardGroups', () => {
  it('covers every hazard exactly once', () => {
    const members = Object.values(hazardGroups).flat()
    expect(members.sort()).toEqual([
      'air-quality', 'flood', 'radioactivity', 'radon', 'water-pollution', 'wildfire',
    ])
  })
})

describe('parseRiskWeights', () => {
  it('returns null when unset or blank', () => {
    expect(parseRiskWeights(undefined)).toBeNull()
    expect(parseRiskWeights('')).toBeNull()
  })

  it('parses a valid JSON object of weights', () => {
    expect(parseRiskWeights('{"wildfire":0.3,"radioactivity":0.2}')).toEqual({
      wildfire: 0.3,
      radioactivity: 0.2,
    })
  })

  it.each([
    ['not json'],
    ['["wildfire"]'],
    ['{"unknown":0.5}'],
    ['{"wildfire":-1}'],
    ['{"wildfire":"high"}'],
  ])('throws on malformed weights %s', (raw) => {
    expect(() => parseRiskWeights(raw)).toThrow()
  })
})

describe('calculateComposite', () => {
  const hazards = [
    score('wildfire', 85),
    score('air-quality', 40),
    score('water-pollution', 15),
    score('radon', 60),
    score('flood', 30),
    score('radioactivity', 90),
  ]

  it('averages group scores over their members', () => {
    const result = calculateComposite(hazards)
    expect(result.groups.environmental.score).toBeCloseTo(46.7, 1)
    expect(result.groups.geological.score).toBe(45)
    expect(result.groups.radiation.score).toBe(90)
  })

  it('defaults to equal weights across all hazards', () => {
    const result = calculateComposite(hazards)
    expect(result.overall).toBe(53.3)
    expect(Object.values(result.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 5)
  })

  it('gives unnamed hazards an equal share of the leftover weight', () => {
    const result = calculateComposite(
      hazards,
      parseRiskWeights('{"radioactivity":0.5,"wildfire":0.25}'),
    )
    const weights = result.weights
    // Named sum 0.75 -> each of the four unnamed hazards gets 0.0625; the total is 1.
    expect(weights.radioactivity).toBeCloseTo(0.5, 5)
    expect(weights.wildfire).toBeCloseTo(0.25, 5)
    expect(weights['air-quality']).toBeCloseTo(0.0625, 5)
    expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 5)
  })

  it('excludes explicitly zero-weighted hazards from the overall score', () => {
    const result = calculateComposite(hazards, parseRiskWeights('{"radioactivity":0,"wildfire":0}'))
    expect(result.overall).toBe(36.3)
    expect(result.weights.radioactivity).toBe(0)
    expect(result.weights.wildfire).toBe(0)
  })

  it('handles a subset of hazards', () => {
    const result = calculateComposite([score('radioactivity', 90)])
    expect(result.overall).toBe(90)
    expect(result.groups.radiation.score).toBe(90)
    expect(result.groups.environmental.score).toBe(50)
  })
})
