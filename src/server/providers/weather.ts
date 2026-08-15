import type { EnvironmentalContext } from '../../domain/environment'

export type WeatherProvider = {
  getWeather(latitude: number, longitude: number): Promise<Pick<EnvironmentalContext, 'weather'>>
}

type ProviderWithTimestamp = WeatherProvider & { sourceTimestamp?: string }

type OpenMeteoResponse = {
  current?: {
    time?: unknown
    temperature_2m?: unknown
    relative_humidity_2m?: unknown
    wind_speed_10m?: unknown
    wind_direction_10m?: unknown
  }
  daily?: { precipitation_sum?: unknown }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const createOpenMeteoWeatherProvider = (
  fetcher: typeof fetch = fetch,
): ProviderWithTimestamp => {
  const provider: ProviderWithTimestamp = {
    sourceTimestamp: undefined,
    async getWeather(latitude, longitude) {
      const url = new URL('https://api.open-meteo.com/v1/forecast')
      url.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m',
        daily: 'precipitation_sum',
        timezone: 'UTC',
      }).toString()

      const response = await fetcher(url)
      if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status})`)

      const payload = await response.json() as OpenMeteoResponse
      const current = payload.current
      const precipitation = payload.daily?.precipitation_sum
      if (
        !current || typeof current.time !== 'string' || !isNumber(current.temperature_2m) ||
        !isNumber(current.relative_humidity_2m) || !isNumber(precipitation && Array.isArray(precipitation) ? precipitation[0] : undefined) ||
        !isNumber(current.wind_speed_10m) || !isNumber(current.wind_direction_10m)
      ) {
        throw new Error('Invalid Open-Meteo response')
      }

      const parsedTimestamp = new Date(current.time.endsWith('Z') ? current.time : `${current.time}Z`)
      if (Number.isNaN(parsedTimestamp.getTime())) throw new Error('Invalid Open-Meteo response')
      const sourceTimestamp = parsedTimestamp.toISOString()
      provider.sourceTimestamp = sourceTimestamp
      return {
        weather: {
          temperatureC: current.temperature_2m,
          humidity: current.relative_humidity_2m,
          precipitationMm24h: precipitation[0],
          windKph: current.wind_speed_10m,
          windDirectionDeg: current.wind_direction_10m,
        },
      }
    },
  }

  return provider
}
