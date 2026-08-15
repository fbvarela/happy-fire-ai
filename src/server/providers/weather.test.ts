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
  it('maps a valid current response into normalized weather', async () => {
    const provider = createOpenMeteoWeatherProvider(async () => new Response(JSON.stringify({
      current: {
        time: '2026-08-15T12:00',
        temperature_2m: 22,
        relative_humidity_2m: 48,
        precipitation: 1.2,
        wind_speed_10m: 14,
        wind_direction_10m: 210,
      },
      daily: { precipitation_sum: [1.2] },
    })))

    await expect(provider.getWeather(40, -3)).resolves.toEqual({ weather })
    expect(provider.sourceTimestamp).toBe('2026-08-15T12:00:00.000Z')
  })

  it('rejects malformed responses at the provider boundary', async () => {
    const provider = createOpenMeteoWeatherProvider(async () => new Response(JSON.stringify({ current: {} })))

    await expect(provider.getWeather(40, -3)).rejects.toThrow('Invalid Open-Meteo response')
  })
})

describe('getEnvironmentContext', () => {
  it('falls back to deterministic mock weather when a provider is unavailable', async () => {
    const unavailableProvider: WeatherProvider = {
      getWeather: async () => { throw new Error('offline') },
    }

    const context = await getEnvironmentContext(40, -3, unavailableProvider)

    expect(context.status).toBe('available')
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
    expect(context.observedAt).toBe('2020-01-01T00:00:00.000Z')
  })
})
