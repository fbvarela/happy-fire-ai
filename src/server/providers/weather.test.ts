import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnvironmentalContext } from '../../domain/environment'
import { clearEnvironmentCache, getEnvironmentContext } from '../environment'
import { createOpenMeteoWeatherProvider, type WeatherProvider } from './weather'

const weather: EnvironmentalContext['weather'] = {
  temperatureC: 22,
  humidity: 48,
  precipitationMm24h: 1.2,
  windKph: 14,
  windDirectionDeg: 210,
}

const openMeteoResponse = (time = '2026-08-15T12:00') => new Response(JSON.stringify({
  current: {
    time,
    temperature_2m: 22,
    relative_humidity_2m: 48,
    wind_speed_10m: 14,
    wind_direction_10m: 210,
  },
  hourly: {
    time: [time],
    precipitation: [1.2],
  },
}))
const openMeteoTerrainResponse = () => new Response(JSON.stringify({ elevation: [100, 100, 100, 100, 100] }))
const openMeteoFetcher = async (input: Request | URL | string) =>
  new URL(input.toString()).pathname.endsWith('/elevation') ? openMeteoTerrainResponse() : openMeteoResponse()

describe('Open-Meteo weather provider', () => {
  it('maps rolling hourly precipitation into normalized weather', async () => {
    const provider = createOpenMeteoWeatherProvider(async (input) => {
      expect(new URL(input.toString()).searchParams.get('hourly')).toBe('precipitation')
      return new Response(JSON.stringify({
      current: {
        time: '2026-08-15T12:00',
        temperature_2m: 22,
        relative_humidity_2m: 48,
        wind_speed_10m: 14,
        wind_direction_10m: 210,
      },
      hourly: {
        time: ['2026-08-15T11:00', '2026-08-15T12:00'],
        precipitation: [1.2, 2.3],
      },
    }))
    })

    await expect(provider.getWeather(40, -3)).resolves.toEqual({ weather: { ...weather, precipitationMm24h: 3.5 } })
    expect(provider.sourceTimestamp).toBe('2026-08-15T12:00:00.000Z')
  })

  it('maps a five-point elevation neighborhood into terrain', async () => {
    const provider = createOpenMeteoWeatherProvider(async (input) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith('/elevation')) {
        expect(url.searchParams.get('latitude')?.split(',')).toHaveLength(5)
        expect(url.searchParams.get('longitude')?.split(',')).toHaveLength(5)
        return new Response(JSON.stringify({ elevation: [100, 120, 90, 110, 100] }))
      }

      return new Response(JSON.stringify({
        current: {
          time: '2026-08-15T12:00',
          temperature_2m: 22,
          relative_humidity_2m: 48,
          wind_speed_10m: 14,
          wind_direction_10m: 210,
        },
        hourly: { time: ['2026-08-15T12:00'], precipitation: [1] },
      }))
    })

    expect(provider.getTerrain).toBeDefined()
    await expect(provider.getTerrain!(40, -3)).resolves.toMatchObject({
      terrain: { elevationM: 100 },
    })
    const terrain = await provider.getTerrain?.(40, -3)
    expect(terrain?.terrain.slopeDeg).toBeGreaterThan(0)
  })

  it.each([
    [90, 179.999],
    [-90, -179.999],
    [0, 180],
    [0, -180],
  ])('keeps elevation neighborhoods safe at latitude %s longitude %s', async (latitude, longitude) => {
    const provider = createOpenMeteoWeatherProvider(async (input) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith('/elevation')) {
        for (const parameter of ['latitude', 'longitude']) {
          for (const value of url.searchParams.get(parameter)!.split(',').map(Number)) {
            expect(value).toBeGreaterThanOrEqual(parameter === 'latitude' ? -90 : -180)
            expect(value).toBeLessThanOrEqual(parameter === 'latitude' ? 90 : 180)
          }
        }
        return new Response(JSON.stringify({ elevation: [100, 120, 90, 110, 100] }))
      }
      return openMeteoResponse()
    })

    const result = await provider.getTerrain!(latitude, longitude)
    expect(Number.isFinite(result.terrain.slopeDeg)).toBe(true)
    expect(result.terrain.slopeDeg).toBeGreaterThanOrEqual(0)
    expect(result.terrain.slopeDeg).toBeLessThanOrEqual(90)
  })

  it('rejects malformed responses at the provider boundary', async () => {
    const provider = createOpenMeteoWeatherProvider(async () => new Response(JSON.stringify({ current: {} })))

    await expect(provider.getWeather(40, -3)).rejects.toThrow('Invalid Open-Meteo response')
  })

  it('rejects malformed terrain responses at the provider boundary', async () => {
    const provider = createOpenMeteoWeatherProvider(async (input) => {
      if (new URL(input.toString()).pathname.endsWith('/elevation')) {
        return new Response(JSON.stringify({ elevation: [100, 120, Number.NaN, 110, 100] }))
      }
      return openMeteoResponse()
    })

    await expect(provider.getTerrain!(40, -3)).rejects.toThrow('Invalid Open-Meteo terrain response')
  })

  it('rejects an invalid hourly timestamp instead of skipping it', async () => {
    const provider = createOpenMeteoWeatherProvider(async () => new Response(JSON.stringify({
      current: {
        time: '2026-08-15T12:00',
        temperature_2m: 22,
        relative_humidity_2m: 48,
        wind_speed_10m: 14,
        wind_direction_10m: 210,
      },
      hourly: {
        time: ['2026-08-15T11:00', 'not-a-timestamp'],
        precipitation: [1.2, 2.3],
      },
    })))

    await expect(provider.getWeather(40, -3)).rejects.toThrow('Invalid Open-Meteo response')
  })

  it.each([
    ['humidity', { relative_humidity_2m: 101 }],
    ['precipitation', { precipitation: [-1] }],
    ['wind speed', { wind_speed_10m: -1 }],
    ['wind direction', { wind_direction_10m: 361 }],
  ])('rejects out-of-range %s from Open-Meteo', async (_field, override) => {
    const provider = createOpenMeteoWeatherProvider(async () => new Response(JSON.stringify({
      current: {
        time: '2026-08-15T12:00',
        temperature_2m: 22,
        relative_humidity_2m: 48,
        wind_speed_10m: 14,
        wind_direction_10m: 210,
        ...('relative_humidity_2m' in override || 'wind_speed_10m' in override || 'wind_direction_10m' in override ? override : {}),
      },
      hourly: {
        time: ['2026-08-15T12:00'],
        precipitation: 'precipitation' in override ? override.precipitation : [1],
      },
    })))

    await expect(provider.getWeather(40, -3)).rejects.toThrow('Invalid Open-Meteo response')
  })

  it('bounds a hung request with a timeout', async () => {
    const provider = createOpenMeteoWeatherProvider(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }), 5)

    await expect(provider.getWeather(40, -3)).rejects.toThrow('aborted')
  })
})

describe('getEnvironmentContext', () => {
  beforeEach(() => {
    delete process.env.CDSE_ACCESS_TOKEN
    delete process.env.CDSE_CLIENT_ID
    delete process.env.CDSE_CLIENT_SECRET
    delete process.env.WORLDPOP_ENABLED
    delete process.env.WORLDPOP_API_KEY
  })

  afterEach(() => {
    clearEnvironmentCache()
    delete process.env.WEATHER_PROVIDER
    delete process.env.CDSE_ACCESS_TOKEN
    delete process.env.CDSE_CLIENT_ID
    delete process.env.CDSE_CLIENT_SECRET
    delete process.env.WORLDPOP_ENABLED
    delete process.env.WORLDPOP_API_KEY
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not share the default Open-Meteo cache with an injected provider', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    const fetcher = vi.fn(openMeteoFetcher)
    vi.stubGlobal('fetch', fetcher)
    await getEnvironmentContext(41, -4)

    let calls = 0
    const provider: WeatherProvider & { sourceTimestamp: string } = {
      sourceTimestamp: '2026-08-15T12:00:00.000Z',
      getWeather: async () => {
        calls += 1
        return { weather }
      },
    }

    const context = await getEnvironmentContext(41, -4, provider)

    expect(calls).toBe(1)
    expect(context.cacheStatus).toBe('miss')
    expect(context.weather).toEqual(weather)
  })

  it('isolates cached default Open-Meteo responses by coordinates', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    const fetcher = vi.fn(openMeteoFetcher)
    vi.stubGlobal('fetch', fetcher)

    const first = await getEnvironmentContext(41, -4)
    const second = await getEnvironmentContext(41, -5)

    expect(fetcher.mock.calls.filter(([input]) => !new URL(input.toString()).pathname.endsWith('/elevation'))).toHaveLength(2)
    expect(first.cacheStatus).toBe('miss')
    expect(second.cacheStatus).toBe('miss')
  })

  it('reports stale status and cache age on a cache hit', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    let now = Date.parse('2026-08-15T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetcher = vi.fn((input: Request | URL | string) =>
      new URL(input.toString()).pathname.endsWith('/elevation')
        ? Promise.resolve(openMeteoTerrainResponse())
        : Promise.resolve(openMeteoResponse('2026-08-15T10:00')))
    vi.stubGlobal('fetch', fetcher)
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await getEnvironmentContext(41, -4)
    now += 1_000
    const hit = await getEnvironmentContext(41, -4)

    expect(hit.cacheStatus).toBe('hit')
    expect(hit.status).toBe('stale')
    expect(fetcher.mock.calls.filter(([input]) => !new URL(input.toString()).pathname.endsWith('/elevation'))).toHaveLength(1)
    expect(logSpy).toHaveBeenCalledWith(
      '[environment] weather-cache-hit',
      expect.stringContaining('"ageMs":7201000'),
    )
    const fetchLog = logSpy.mock.calls.find(([event]) => event === '[environment] weather-fetch')
    const cacheLog = logSpy.mock.calls.find(([event]) => event === '[environment] weather-cache-hit')
    expect(JSON.parse(String(fetchLog?.[1]))).not.toHaveProperty('latitude')
    expect(JSON.parse(String(fetchLog?.[1]))).not.toHaveProperty('longitude')
    expect(JSON.parse(String(cacheLog?.[1]))).not.toHaveProperty('latitude')
    expect(JSON.parse(String(cacheLog?.[1]))).not.toHaveProperty('longitude')
  })

  it('restores cached provider terrain on a cache hit', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    const fetcher = vi.fn((input: Request | URL | string) =>
      new URL(input.toString()).pathname.endsWith('/elevation')
        ? Promise.resolve(new Response(JSON.stringify({ elevation: [900, 900, 900, 900, 900] })))
        : Promise.resolve(openMeteoResponse()))
    vi.stubGlobal('fetch', fetcher)

    const first = await getEnvironmentContext(41, -4)
    const second = await getEnvironmentContext(41, -4)

    expect(first.terrain).toEqual({ elevationM: 900, slopeDeg: 0 })
    expect(second.terrain).toEqual(first.terrain)
    expect(second.cacheStatus).toBe('hit')
    expect(fetcher.mock.calls.filter(([input]) => new URL(input.toString()).pathname.endsWith('/elevation'))).toHaveLength(1)
  })

  it('bounds the default Open-Meteo cache and evicts its oldest coordinate', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    const fetcher = vi.fn(openMeteoFetcher)
    vi.stubGlobal('fetch', fetcher)

    for (let latitude = 0; latitude < 33; latitude += 1) {
      await getEnvironmentContext(latitude, 0)
    }
    await getEnvironmentContext(0, 0)

    expect(fetcher.mock.calls.filter(([input]) => !new URL(input.toString()).pathname.endsWith('/elevation'))).toHaveLength(34)
  })

  it('refreshes an expired cache entry and falls back when refresh fails', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    let now = Date.parse('2026-08-15T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetcher = vi.fn((input: Request | URL | string) => {
      if (new URL(input.toString()).pathname.endsWith('/elevation')) return Promise.resolve(openMeteoTerrainResponse())
      return fetcher.mock.calls.length === 1
        ? Promise.resolve(openMeteoResponse())
        : Promise.reject(new Error('offline'))
    })
    vi.stubGlobal('fetch', fetcher)

    await getEnvironmentContext(42, -5)
    now += 10 * 60 * 1000 + 1
    const expired = await getEnvironmentContext(42, -5)

    expect(fetcher.mock.calls.filter(([input]) => !new URL(input.toString()).pathname.endsWith('/elevation'))).toHaveLength(2)
    expect(expired.cacheStatus).toBe('fallback')
    expect(expired.status).toBe('error')
  })

  it('falls back to deterministic mock weather when a provider is unavailable', async () => {
    const unavailableProvider: WeatherProvider = {
      getWeather: async () => { throw new Error('offline') },
    }

    const context = await getEnvironmentContext(40, -3, unavailableProvider)

    expect(context.status).toBe('error')
    expect(context.source).toBe('mock')
    expect(context.cacheStatus).toBe('fallback')
    expect(context.weather).toEqual({
      temperatureC: 18,
      humidity: 35,
      precipitationMm24h: 1,
      windKph: 8,
      windDirectionDeg: 177,
    })
  })

  it('keeps live weather and terrain when land-cover fuel fails', async () => {
    const provider: WeatherProvider & { sourceTimestamp: string } = {
      sourceTimestamp: new Date().toISOString(),
      getWeather: async () => ({ weather }),
      getTerrain: async () => ({ terrain: { elevationM: 900, slopeDeg: 12 } }),
    }
    const context = await getEnvironmentContext(43, -6, provider, {
      getVegetationDryness: async () => { throw new Error('land-cover offline') },
    })

    expect(context.weather).toEqual(weather)
    expect(context.terrain).toEqual({ elevationM: 900, slopeDeg: 12 })
    expect(context.fuelSource).toBe('mock')
    expect(context.fuelWarning).toContain('Copernicus')
    expect(context.status).toBe('available')
  })

  it('keeps live weather and fuel when WorldPop exposure fails', async () => {
    const provider: WeatherProvider & { sourceTimestamp: string } = {
      sourceTimestamp: new Date().toISOString(),
      getWeather: async () => ({ weather }),
    }
    const landCoverProvider = {
      getVegetationDryness: async () => ({ vegetationDryness: 73, source: 'copernicus' as const }),
    }
    const populationProvider = {
      getNearbyPeople: async () => { throw new Error('WorldPop offline') },
    }

    const context = await getEnvironmentContext(43, -6, provider, landCoverProvider, populationProvider)

    expect(context.weather).toEqual(weather)
    expect(context.fuelSource).toBe('copernicus')
    expect(context.exposureSource).toBe('mock')
    expect(context.exposureWarning).toContain('WorldPop')
  })

  it('caches population with live weather and fuel', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    const fetcher = vi.fn((input: Request | URL | string) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith('/elevation')) return Promise.resolve(openMeteoTerrainResponse())
      if (url.pathname.endsWith('/stats')) return Promise.resolve(new Response(JSON.stringify({
        status: 'finished', error: false, data: { total_population: 321 },
      })))
      return Promise.resolve(openMeteoResponse())
    })
    vi.stubGlobal('fetch', fetcher)
    process.env.WORLDPOP_ENABLED = 'true'
    const landCoverProvider = {
      getVegetationDryness: async () => ({ vegetationDryness: 73, source: 'copernicus' as const }),
    }

    const first = await getEnvironmentContext(41, -4, undefined, landCoverProvider)
    const second = await getEnvironmentContext(41, -4, undefined, landCoverProvider)

    expect(first.exposure).toEqual({ nearbyPeople: 321 })
    expect(second.exposure).toEqual(first.exposure)
    expect(second.exposureSource).toBe('worldpop')
    expect(second.cacheStatus).toBe('hit')
    expect(fetcher.mock.calls.filter(([input]) => new URL(input.toString()).pathname.endsWith('/stats'))).toHaveLength(1)
  })

  it('does not reuse mock cache entries when land-cover becomes configured', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    vi.stubGlobal('fetch', openMeteoFetcher)
    const first = await getEnvironmentContext(44, -7)
    const second = await getEnvironmentContext(44, -7, undefined, {
      getVegetationDryness: async () => ({ vegetationDryness: 88, source: 'copernicus' }),
    })

    expect(first.fuelSource).toBe('mock')
    expect(second.fuelSource).toBe('copernicus')
    expect(second.fuel.vegetationDryness).toBe(88)
  })

  it('caches Copernicus fuel together with default weather and terrain', async () => {
    process.env.WEATHER_PROVIDER = 'open-meteo'
    const fetcher = vi.fn((input: Request | URL | string) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith('/elevation')) return Promise.resolve(openMeteoTerrainResponse())
      return Promise.resolve(openMeteoResponse())
    })
    vi.stubGlobal('fetch', fetcher)
    let fuelCalls = 0
    const landCoverProvider = {
      getVegetationDryness: async () => {
        fuelCalls += 1
        return { vegetationDryness: 73, source: 'copernicus' as const }
      },
    }

    const first = await getEnvironmentContext(41, -4, undefined, landCoverProvider)
    const second = await getEnvironmentContext(41, -4, undefined, landCoverProvider)

    expect(first.fuelSource).toBe('copernicus')
    expect(first.fuel.vegetationDryness).toBe(73)
    expect(second.fuel).toEqual(first.fuel)
    expect(second.fuelSource).toBe('copernicus')
    expect(second.cacheStatus).toBe('hit')
    expect(fuelCalls).toBe(1)
  })

  it('uses provider terrain when available', async () => {
    const provider: WeatherProvider & { sourceTimestamp: string } = {
      sourceTimestamp: '2026-08-15T12:00:00.000Z',
      getWeather: async () => ({ weather }),
      getTerrain: async () => ({ terrain: { elevationM: 900, slopeDeg: 12 } }),
    }

    const context = await getEnvironmentContext(43, -6, provider)

    expect(context.terrain).toEqual({ elevationM: 900, slopeDeg: 12 })
  })

  it('falls back to deterministic mock terrain when provider terrain is unavailable', async () => {
    const provider: WeatherProvider & { sourceTimestamp: string } = {
      sourceTimestamp: '2026-08-15T12:00:00.000Z',
      getWeather: async () => ({ weather }),
      getTerrain: async () => { throw new Error('terrain offline') },
    }

    const context = await getEnvironmentContext(43, -6, provider)

    expect(context.terrain).toEqual({ slopeDeg: 0, elevationM: 120 })
    expect(context.weather).toEqual(weather)
  })

  it('marks a provider timestamp stale when it exceeds the freshness threshold', async () => {
    const staleProvider: WeatherProvider & { sourceTimestamp: string } = {
      sourceTimestamp: '2020-01-01T00:00:00.000Z',
      getWeather: async () => ({ weather }),
    }

    const context = await getEnvironmentContext(40, -3, staleProvider)

    expect(context.status).toBe('stale')
    expect(context.source).toBe('open-meteo')
    expect(context.observedAt).toBe('2020-01-01T00:00:00.000Z')
  })

  it('falls back when an injected provider returns malformed weather', async () => {
    const malformedProvider: WeatherProvider = {
      getWeather: async () => ({ weather: { temperatureC: 'not-a-number' } } as never),
    }

    const context = await getEnvironmentContext(40, -3, malformedProvider)

    expect(context.weather.temperatureC).toBe(18)
    expect(context.status).toBe('error')
    expect(context.source).toBe('mock')
  })

  it('rejects out-of-range values from an injected provider', async () => {
    const malformedProvider: WeatherProvider = {
      getWeather: async () => ({ weather: { ...weather, humidity: 101 } }),
    }

    const context = await getEnvironmentContext(40, -3, malformedProvider)

    expect(context.status).toBe('error')
    expect(context.source).toBe('mock')
  })
})
