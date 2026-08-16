import { describe, expect, it } from 'vitest'

import type { EnvironmentalContext } from '../../domain/environment'
import { getEnvironmentContext } from '../environment'
import { createOpenMeteoWeatherProvider, type WeatherProvider } from './weather'

const weather: EnvironmentalContext['weather'] = {
  temperatureC: 22,
  humidity: 48,
  precipitationMm24h: 1.2,
  windKph: 14,
  windDirectionDeg: 210,
}

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

  it('rejects malformed responses at the provider boundary', async () => {
    const provider = createOpenMeteoWeatherProvider(async () => new Response(JSON.stringify({ current: {} })))

    await expect(provider.getWeather(40, -3)).rejects.toThrow('Invalid Open-Meteo response')
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
  it('falls back to deterministic mock weather when a provider is unavailable', async () => {
    const unavailableProvider: WeatherProvider = {
      getWeather: async () => { throw new Error('offline') },
    }

    const context = await getEnvironmentContext(40, -3, unavailableProvider)

    expect(context.status).toBe('error')
    expect(context.source).toBe('mock')
    expect(context.weather).toEqual({
      temperatureC: 18,
      humidity: 35,
      precipitationMm24h: 1,
      windKph: 8,
      windDirectionDeg: 177,
    })
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
