import { describe, expect, it } from 'vitest'
import { getHazardProvidersFromEnv, getMockHazardContexts, resolveHazardContexts } from './hazard-environment'

describe('getHazardProvidersFromEnv', () => {
  it('enables only the providers named by known env values', () => {
    const providers = getHazardProvidersFromEnv({
      RADIOACTIVITY_PROVIDER: 'bfs',
      WATER_POLLUTION_PROVIDER: 'eea-pfas',
      RADON_PROVIDER: 'epa-ie',
      FLOOD_PROVIDER: 'open-meteo',
      AIR_QUALITY_PROVIDER: 'open-meteo',
    } as NodeJS.ProcessEnv)
    expect(Object.keys(providers).sort()).toEqual(['airQuality', 'flood', 'radioactivity', 'radon', 'waterPollution'])
  })

  it('ignores unknown env values', () => {
    const providers = getHazardProvidersFromEnv({
      RADIOACTIVITY_PROVIDER: 'made-up',
      AIR_QUALITY_PROVIDER: 'nope',
    } as NodeJS.ProcessEnv)
    expect(providers).toEqual({})
  })
})

describe('resolveHazardContexts', () => {
  it('returns deterministic mock data for every hazard when no provider is configured', async () => {
    const contexts = await resolveHazardContexts(40, -3, {})
    const expected = getMockHazardContexts(40, -3)
    expect(contexts).toEqual(expected)
    expect(contexts.airQuality?.source).toBe('mock')
  })

  it('uses a live provider result and its real observed timestamp', async () => {
    const observedAt = new Date().toISOString()
    const contexts = await resolveHazardContexts(40, -3, {
      airQuality: {
        getAirQuality: async () => ({
          pm25: 11,
          pm10: 20,
          no2: 30,
          o3: 40,
          europeanAqi: 25,
          source: 'open-meteo',
          observedAt,
        }),
      },
    })
    expect(contexts.airQuality).toMatchObject({
      pm25: 11,
      europeanAqi: 25,
      status: 'available',
      source: 'open-meteo',
      observedAt,
    })
    // Unconfigured hazards stay on the deterministic mock.
    expect(contexts.radon?.source).toBe('mock')
  })

  it('marks a live reading stale when it is older than the freshness threshold', async () => {
    const contexts = await resolveHazardContexts(40, -3, {
      airQuality: {
        getAirQuality: async () => ({
          pm25: 11,
          pm10: 20,
          no2: 30,
          o3: 40,
          europeanAqi: 25,
          source: 'open-meteo',
          observedAt: '2020-01-01T00:00:00.000Z',
        }),
      },
    })
    expect(contexts.airQuality?.status).toBe('stale')
  })

  it('degrades only the failing hazard to mock + error status + warning', async () => {
    const contexts = await resolveHazardContexts(40, -3, {
      radon: { getRadon: async () => { throw new Error('offline') } },
      flood: {
        getFlood: async () => ({
          riverDischargeM3s: 5,
          baselineDischargeM3s: 2,
          source: 'open-meteo',
          observedAt: new Date().toISOString(),
        }),
      },
    })
    expect(contexts.radon?.status).toBe('error')
    expect(contexts.radon?.warning).toContain('Radon')
    expect(contexts.radon?.source).toBe('mock')
    expect(contexts.flood?.status).toBe('available')
    expect(contexts.flood?.source).toBe('open-meteo')
  })
})
