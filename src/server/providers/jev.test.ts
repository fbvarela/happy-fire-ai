import { describe, expect, it } from 'vitest'

import type { EnvironmentalContext } from '../../domain/environment'
import { buildJevQuestions, buildProvenanceState, createJevProvider } from './jev'

const context: EnvironmentalContext = {
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
  localFestivalPressure: 70,
  roadsideMaintenance: 20,
}

const completeAnswers = {
  wind_fuel_interaction: { type: 'noul', noul: 0.9 },
  exposure_amplification: { type: 'noul', noul: 0.4 },
  terrain_fuel_interaction: { type: 'noul', noul: 0.75 },
  data_inconsistency: { type: 'noul', noul: 0.1 },
  provider_conflict: { type: 'noul', noul: 0.2 },
  data_sufficiency: { type: 'score', score: 3, confidence: 0.9 },
  reliability_weather: { type: 'score', score: 3, confidence: 0.85 },
  reliability_fuel: { type: 'score', score: 3, confidence: 0.8 },
  reliability_exposure: { type: 'score', score: 3, confidence: 0.9 },
}

const answersPayload = (overrides: Record<string, unknown> = {}) => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    Object.entries(completeAnswers).map(([id, answer]) => [id, { ...answer, ...overrides[id] }]),
  ),
})

const fetchWith = (payload: unknown, status = 200) => async () =>
  new Response(JSON.stringify(payload), { status })

describe('Jev provider', () => {
  it('builds a provenance state without coordinates or road geometry', () => {
    const state = buildProvenanceState(context)
    expect(state).toEqual({
      weather: { source: 'open-meteo', observedAt: context.observedAt, status: 'available' },
      fuel: { source: 'copernicus', warning: false },
      exposure: { source: 'worldpop', warning: false },
      roadClosures: { source: null, warning: false, count: 0 },
      missingInputCount: 0,
    })
    expect(JSON.stringify(state)).not.toContain('latitude')
  })

  it('sends state, questions, auth, and model in one request', async () => {
    let body: Record<string, unknown> = {}
    const provider = createJevProvider('test-key', async (input, init) => {
      expect(input.toString()).toBe('https://api.typesafe.ai/v1/systemone')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify(answersPayload()))
    })
    await provider.assess(context)
    expect(body.model).toBe('jev-latest')
    expect(Object.keys(body.questions as Record<string, unknown>)).toHaveLength(9)
    expect(Object.keys(body.state as Record<string, unknown>)).toEqual([
      'weather', 'fuel', 'exposure', 'roadClosures', 'missingInputCount',
    ])
  })

  it('composes a clean advisory from calibrated answers', async () => {
    const provider = createJevProvider('test-key', fetchWith(answersPayload()))
    const advisory = await provider.assess(context)
    expect(advisory.source).toBe('jev')
    expect(advisory.modelVersion).toBe('jev-1.13.0')
    expect(advisory.dataSufficiency).toEqual({ score: 3, confidence: 0.9, caution: false })
    expect(advisory.anomalies.map(({ id, severity }) => ({ id, severity }))).toEqual([
      { id: 'wind_fuel_interaction', severity: 'advisory' },
      { id: 'terrain_fuel_interaction', severity: 'watch' },
    ])
    expect(advisory.reliability).toEqual([
      { providerId: 'weather', level: 'fresh-and-complete' },
      { providerId: 'fuel', level: 'fresh-and-complete' },
      { providerId: 'exposure', level: 'fresh-and-complete' },
    ])
    expect(advisory.flags).toEqual({ dataInconsistency: false, providerConflict: false })
  })

  it('flags caution only below the sufficiency threshold', async () => {
    const cautionProvider = createJevProvider('test-key', fetchWith(answersPayload({
      data_sufficiency: { type: 'score', score: 1.4, confidence: 0.5 },
    })))
    await expect(cautionProvider.assess(context)).resolves.toMatchObject({
      dataSufficiency: { score: 1.4, caution: true },
    })
    const okProvider = createJevProvider('test-key', fetchWith(answersPayload()))
    await expect(okProvider.assess(context)).resolves.toMatchObject({
      dataSufficiency: { caution: false },
    })
  })

  it('rejects malformed responses', async () => {
    const provider = createJevProvider('test-key', fetchWith({ answers: { data_sufficiency: { type: 'score', score: 'high' } } }))
    await expect(provider.assess(context)).rejects.toThrow('Invalid Jev')
  })

  it('rejects out-of-range noul values', async () => {
    const provider = createJevProvider('test-key', fetchWith(answersPayload({ wind_fuel_interaction: { noul: 1.5 } })))
    await expect(provider.assess(context)).rejects.toThrow('Invalid Jev noul answer')
  })

  it('propagates HTTP failures for the caller to degrade gracefully', async () => {
    const provider = createJevProvider('test-key', fetchWith({ error: 'nope' }, 503))
    await expect(provider.assess(context)).rejects.toThrow('Jev request failed (503)')
  })

  it('keeps question wording atomic and never receives the risk score', () => {
    const state = buildProvenanceState(context)
    const questions = buildJevQuestions(state)
    expect(Object.keys(questions)).toHaveLength(9)
    for (const question of Object.values(questions)) {
      expect(question.instructions.endsWith('?')).toBe(true)
      expect(question.instructions).not.toContain('risk score')
    }
    // The provenance state carries no score, so questions cannot leak it either.
    expect(JSON.stringify(state)).not.toContain('score')
  })
})
