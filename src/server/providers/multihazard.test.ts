import { describe, expect, it } from 'vitest'
import { createOpenMeteoAirQualityProvider } from './air-quality'
import { createOpenMeteoFloodProvider } from './flood'
import { createEpaRadonProvider, riskFractionFromLabel } from './radon'
import { createBfsRadioactivityProvider, createSafecastRadioactivityProvider } from './radioactivity'
import { createEeaBathingWaterProvider, createEeaPfasProvider } from './water-pollution'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createOpenMeteoAirQualityProvider', () => {
  it('maps the Open-Meteo current air-quality fields', async () => {
    const provider = createOpenMeteoAirQualityProvider(async () => jsonResponse({
      current: { time: '2026-09-24T19:00', pm2_5: 10.6, pm10: 16.5, nitrogen_dioxide: 54.6, ozone: 52, european_aqi: 57 },
    }))
    const result = await provider.getAirQuality(40.4, -3.7)
    expect(result).toEqual({
      pm25: 10.6,
      pm10: 16.5,
      no2: 54.6,
      o3: 52,
      europeanAqi: 57,
      source: 'open-meteo',
      observedAt: '2026-09-24T19:00:00.000Z',
    })
  })

  it('rejects malformed responses so the caller can fall back to mock', async () => {
    const provider = createOpenMeteoAirQualityProvider(async () => jsonResponse({ current: { time: '2026-09-24T19:00' } }))
    await expect(provider.getAirQuality(40.4, -3.7)).rejects.toThrow('Invalid Open-Meteo air-quality response')
  })

  it('throws on HTTP failure', async () => {
    const provider = createOpenMeteoAirQualityProvider(async () => jsonResponse({}, 503))
    await expect(provider.getAirQuality(40.4, -3.7)).rejects.toThrow('Open-Meteo air-quality request failed (503)')
  })
})

describe('createOpenMeteoFloodProvider', () => {
  it('uses the latest discharge and the median of the trailing window', async () => {
    const time = Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`)
    const discharge = [...Array(30).fill(1), 4]
    const provider = createOpenMeteoFloodProvider(async () => jsonResponse({ daily: { time, river_discharge: discharge } }))
    const result = await provider.getFlood(40.4, -3.7)
    expect(result.riverDischargeM3s).toBe(4)
    expect(result.baselineDischargeM3s).toBe(1)
    expect(result.source).toBe('open-meteo')
  })

  it('rejects mismatched series lengths', async () => {
    const provider = createOpenMeteoFloodProvider(async () => jsonResponse({ daily: { time: ['a', 'b'], river_discharge: [1] } }))
    await expect(provider.getFlood(40.4, -3.7)).rejects.toThrow('Invalid Open-Meteo flood response')
  })
})

describe('createBfsRadioactivityProvider', () => {
  it('picks the nearest BfS ODL station', async () => {
    const provider = createBfsRadioactivityProvider(async () => jsonResponse({
      features: [
        { geometry: { coordinates: [13.58, 52.6] }, properties: { value: 0.099, end_measure: '2026-09-24T19:00:00Z' } },
        { geometry: { coordinates: [13.15, 52.47] }, properties: { value: 0.093, end_measure: '2026-09-24T19:00:00Z' } },
      ],
    }))
    const result = await provider.getRadioactivity(52.47, 13.15)
    expect(result.doseRateUsvH).toBe(0.093)
    expect(result.source).toBe('bfs')
    expect(result.observedAt).toBe('2026-09-24T19:00:00.000Z')
  })

  it('fails when no station is in range', async () => {
    const provider = createBfsRadioactivityProvider(async () => jsonResponse({ features: [] }))
    await expect(provider.getRadioactivity(40.4, -3.7)).rejects.toThrow('No BfS ODL station found')
  })
})

describe('createSafecastRadioactivityProvider', () => {
  it('converts the most recent CPM reading to µSv/h', async () => {
    const provider = createSafecastRadioactivityProvider(async () => jsonResponse([
      { value: 40, unit: 'cpm', captured_at: '2024-01-01T10:00:00.000Z' },
      { value: 35, unit: 'cpm', captured_at: '2024-05-01T10:00:00.000Z' },
    ]))
    const result = await provider.getRadioactivity(48.85, 2.35)
    expect(result.doseRateUsvH).toBe(0.1)
    expect(result.source).toBe('safecast')
    expect(result.observedAt).toBe('2024-05-01T10:00:00.000Z')
  })

  it('rejects readings that are not in CPM', async () => {
    const provider = createSafecastRadioactivityProvider(async () => jsonResponse([
      { value: 35, unit: 'µSv/h', captured_at: '2024-05-01T10:00:00.000Z' },
    ]))
    await expect(provider.getRadioactivity(48.85, 2.35)).rejects.toThrow('No recent Safecast measurement found')
  })
})

describe('createEeaBathingWaterProvider', () => {
  it('maps the bathing-water classification to a pollution index', async () => {
    const provider = createEeaBathingWaterProvider(async () => jsonResponse({
      features: [{ attributes: { bathingWaterName: 'PLAYA DE LA PATACONA PM1', qualityStatus: 'Good' } }],
    }))
    const result = await provider.getWaterPollution(39.46, -0.32)
    expect(result.qualityIndex).toBe(25)
    expect(result.qualityLabel).toContain('Good')
    expect(result.source).toBe('eea-bathing')
  })

  it('fails when no bathing water is in range', async () => {
    const provider = createEeaBathingWaterProvider(async () => jsonResponse({ features: [] }))
    await expect(provider.getWaterPollution(40.4, -3.7)).rejects.toThrow('No EEA bathing-water site found')
  })
})

describe('createEeaPfasProvider', () => {
  it('normalizes µg/L to ng/L and scores against the 100 ng/L reference', async () => {
    const provider = createEeaPfasProvider(async () => jsonResponse({
      features: [
        { attributes: { resultObservedValue: 0.02, resultUom: 'µg/l', phenomenonTimeSamplingDate: '2023-06-01', observedPropertyDeterminandCode: 'PFOS' } },
        { attributes: { resultObservedValue: 10, resultUom: 'ng/l', phenomenonTimeSamplingDate: '2023-06-01', observedPropertyDeterminandCode: 'PFOA' } },
      ],
    }))
    const result = await provider.getWaterPollution(52.1, 5.3)
    // 0.02 µg/L -> 20 ng/L, which is the max, scored 20/100.
    expect(result.qualityIndex).toBe(20)
    expect(result.qualityLabel).toContain('PFOS')
    expect(result.source).toBe('eea-pfas')
  })
})

describe('createEpaRadonProvider', () => {
  it('derives a risk index from the EPA classification text', async () => {
    const provider = createEpaRadonProvider(async () => jsonResponse({
      features: [{ properties: { Risk: 'About 1 in 10 homes in this area is likely to have high radon levels' } }],
    }))
    const result = await provider.getRadon(53.35, -6.26)
    // 1 in 10 = 10% -> 50 on a 20% scale.
    expect(result.radonRiskIndex).toBe(50)
    expect(result.source).toBe('epa-ie')
  })

  it('fails when no classification covers the point', async () => {
    const provider = createEpaRadonProvider(async () => jsonResponse({ features: [] }))
    await expect(provider.getRadon(40.4, -3.7)).rejects.toThrow('No EPA radon classification found')
  })
})

describe('riskFractionFromLabel', () => {
  it.each([
    ['About 1 in 10 homes', 0.1],
    ['less than 1 in 100 homes', 0.01],
    ['no numeric class', null],
  ])('parses %s', (label, expected) => {
    expect(riskFractionFromLabel(label)).toBe(expected)
  })
})
