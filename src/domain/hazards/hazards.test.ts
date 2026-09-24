import { describe, expect, it } from 'vitest'
import type { EnvironmentalContext } from '../environment'
import { calculateAirQualityRisk } from './air-quality'
import { calculateFloodRisk } from './flood'
import { calculateRadonRisk } from './radon'
import { calculateRadioactivityRisk } from './radioactivity'
import { calculateWaterPollutionRisk } from './water-pollution'
import { calculateWildfireRisk } from './wildfire'

const baseContext: EnvironmentalContext = {
  latitude: 40,
  longitude: -3,
  observedAt: '2026-08-15T12:00:00.000Z',
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
  radioactivity: { doseRateUsvH: 0.55, status: 'available', source: 'mock', observedAt: '2026-08-15T12:00:00.000Z' },
  waterPollution: { qualityIndex: 30, qualityLabel: 'Good', status: 'available', source: 'mock', observedAt: '2026-08-15T12:00:00.000Z' },
  radon: { radonRiskIndex: 50, riskLabel: 'mock', status: 'available', source: 'mock', observedAt: '2026-08-15T12:00:00.000Z' },
  flood: { riverDischargeM3s: 4, baselineDischargeM3s: 2, status: 'available', source: 'mock', observedAt: '2026-08-15T12:00:00.000Z' },
  airQuality: {
    pm25: 37.5,
    pm10: 75,
    no2: 100,
    o3: 120,
    europeanAqi: 50,
    status: 'available',
    source: 'mock',
    observedAt: '2026-08-15T12:00:00.000Z',
  },
}

describe('calculateRadioactivityRisk', () => {
  it('scores dose rate from the 0.1-1.0 µSv/h scale', () => {
    expect(calculateRadioactivityRisk(baseContext).score).toBe(50)
  })

  it('caps the dose-rate contribution at 100', () => {
    const result = calculateRadioactivityRisk({
      ...baseContext,
      radioactivity: { ...baseContext.radioactivity!, doseRateUsvH: 5 },
    })
    expect(result.score).toBe(100)
    expect(result.level).toBe('high')
  })

  it('treats a missing hazard block as missing data at the neutral midpoint', () => {
    const result = calculateRadioactivityRisk({ ...baseContext, radioactivity: undefined })
    expect(result.score).toBe(50)
    expect(result.confidence).toBe(0)
    expect(result.status).toBe('missing')
  })

  it('collapses confidence on provider error', () => {
    const result = calculateRadioactivityRisk({
      ...baseContext,
      radioactivity: { ...baseContext.radioactivity!, status: 'error', warning: 'BfS failed' },
    })
    expect(result.confidence).toBe(0)
    expect(result.status).toBe('error')
  })
})

describe('calculateWaterPollutionRisk', () => {
  it('uses the normalized pollution index directly', () => {
    expect(calculateWaterPollutionRisk(baseContext).score).toBe(30)
    expect(calculateWaterPollutionRisk(baseContext).level).toBe('low')
  })

  it('clamps extreme pollution to the high band', () => {
    const result = calculateWaterPollutionRisk({
      ...baseContext,
      waterPollution: { ...baseContext.waterPollution!, qualityIndex: 90 },
    })
    expect(result.score).toBe(90)
    expect(result.level).toBe('high')
  })
})

describe('calculateRadonRisk', () => {
  it('uses the normalized radon risk index directly', () => {
    expect(calculateRadonRisk(baseContext).score).toBe(50)
  })

  it('saturates high risk', () => {
    const result = calculateRadonRisk({
      ...baseContext,
      radon: { ...baseContext.radon!, radonRiskIndex: 100 },
    })
    expect(result.score).toBe(100)
  })
})

describe('calculateFloodRisk', () => {
  it('scores the discharge anomaly against the baseline', () => {
    expect(calculateFloodRisk(baseContext).score).toBe(50)
  })

  it('saturates when discharge is 3x the baseline', () => {
    const result = calculateFloodRisk({
      ...baseContext,
      flood: { ...baseContext.flood!, riverDischargeM3s: 6, baselineDischargeM3s: 2 },
    })
    expect(result.score).toBe(100)
  })

  it('scores at or below baseline as low risk', () => {
    const result = calculateFloodRisk({
      ...baseContext,
      flood: { ...baseContext.flood!, riverDischargeM3s: 1, baselineDischargeM3s: 2 },
    })
    expect(result.score).toBe(0)
    expect(result.level).toBe('low')
  })

  it('treats an unusable baseline as unavailable data', () => {
    const result = calculateFloodRisk({
      ...baseContext,
      flood: { ...baseContext.flood!, baselineDischargeM3s: 0 },
    })
    expect(result.score).toBe(50)
    expect(result.confidence).toBe(80)
    expect(result.status).toBe('missing')
  })
})

describe('calculateAirQualityRisk', () => {
  it('averages the pollutant ceilings and AQI', () => {
    expect(calculateAirQualityRisk(baseContext).score).toBe(50)
    expect(calculateAirQualityRisk(baseContext).level).toBe('medium')
  })

  it('scores clean air at the bottom of the scale', () => {
    const result = calculateAirQualityRisk({
      ...baseContext,
      airQuality: { ...baseContext.airQuality!, pm25: 0, pm10: 0, no2: 0, o3: 0, europeanAqi: 0 },
    })
    expect(result.score).toBe(0)
    expect(result.level).toBe('low')
    expect(result.confidence).toBe(100)
  })
})

describe('calculateWildfireRisk', () => {
  it('re-uses the deterministic wildfire score and re-bands the level', () => {
    const result = calculateWildfireRisk(baseContext)
    expect(result.id).toBe('wildfire')
    expect(result.score).toBe(49.8)
    expect(result.level).toBe('medium')
  })
})
