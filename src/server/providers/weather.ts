import type { EnvironmentalContext } from '../../domain/environment'

export type WeatherProvider = {
  getWeather(latitude: number, longitude: number): Promise<Pick<EnvironmentalContext, 'weather'>>
  getTerrain?: (latitude: number, longitude: number) => Promise<Pick<EnvironmentalContext, 'terrain'>>
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
  hourly?: { time?: unknown; precipitation?: unknown }
  elevation?: unknown
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isHumidity = (value: unknown): value is number | null => value === null || (isNumber(value) && value >= 0 && value <= 100)
const isNonNegative = (value: unknown): value is number | null => value === null || (isNumber(value) && value >= 0)
const isWindDirection = (value: unknown): value is number | null => value === null || (isNumber(value) && value >= 0 && value <= 360)
const isElevation = (value: unknown): value is number => isNumber(value) && value >= -1000 && value <= 10000
const clampLatitude = (latitude: number) => Math.min(90, Math.max(-90, latitude))
const normalizeLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180
const parseUtcTimestamp = (value: string) => {
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export const createOpenMeteoWeatherProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): ProviderWithTimestamp => {
  const provider: ProviderWithTimestamp = {
    sourceTimestamp: undefined,
    async getWeather(latitude, longitude) {
      const url = new URL('https://api.open-meteo.com/v1/forecast')
      url.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m',
        hourly: 'precipitation',
        past_hours: '24',
        forecast_hours: '1',
        timezone: 'UTC',
      }).toString()

      const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status})`)

      const payload = await response.json() as OpenMeteoResponse
      const current = payload.current
      const hourlyTimes = payload.hourly?.time
      const hourlyPrecipitation = payload.hourly?.precipitation
      if (
        !current || typeof current.time !== 'string' || !isNumber(current.temperature_2m) ||
        !isHumidity(current.relative_humidity_2m) || !isNonNegative(current.wind_speed_10m) ||
        !isWindDirection(current.wind_direction_10m) || !Array.isArray(hourlyTimes) ||
        !Array.isArray(hourlyPrecipitation) || hourlyTimes.length !== hourlyPrecipitation.length ||
        !hourlyTimes.every((time): time is string => typeof time === 'string') ||
        !hourlyPrecipitation.every(isNonNegative)
      ) {
        throw new Error('Invalid Open-Meteo response')
      }

      const parsedTimestamp = parseUtcTimestamp(current.time)
      if (!parsedTimestamp) throw new Error('Invalid Open-Meteo response')
      const windowStart = parsedTimestamp.getTime() - 24 * 60 * 60 * 1000
      const parsedHours: Date[] = []
      for (const time of hourlyTimes) {
        const hour = parseUtcTimestamp(time)
        if (!hour) throw new Error('Invalid Open-Meteo response')
        parsedHours.push(hour)
      }
      const precipitationMm24h = parsedHours.reduce((total, hour, index) => {
        return hour.getTime() > windowStart && hour.getTime() <= parsedTimestamp.getTime()
          ? total + (hourlyPrecipitation[index] ?? 0)
          : total
      }, 0)
      const sourceTimestamp = parsedTimestamp.toISOString()
      provider.sourceTimestamp = sourceTimestamp
      return {
        weather: {
          temperatureC: current.temperature_2m,
          humidity: current.relative_humidity_2m,
          precipitationMm24h,
          windKph: current.wind_speed_10m,
          windDirectionDeg: current.wind_direction_10m,
        },
      }
    },
    async getTerrain(latitude, longitude) {
      const latitudeOffset = 0.01
      const boundedLatitude = clampLatitude(latitude)
      const boundedLongitude = normalizeLongitude(longitude)
      const latitudeFactor = Math.max(Math.cos(boundedLatitude * Math.PI / 180), 0.01)
      const longitudeOffset = 0.01 / latitudeFactor
      const northLatitude = clampLatitude(boundedLatitude + latitudeOffset)
      const southLatitude = clampLatitude(boundedLatitude - latitudeOffset)
      const eastLongitude = normalizeLongitude(boundedLongitude + longitudeOffset)
      const westLongitude = normalizeLongitude(boundedLongitude - longitudeOffset)
      const url = new URL('https://api.open-meteo.com/v1/elevation')
      url.search = new URLSearchParams({
        latitude: [boundedLatitude, northLatitude, southLatitude, boundedLatitude, boundedLatitude].join(','),
        longitude: [boundedLongitude, boundedLongitude, boundedLongitude, eastLongitude, westLongitude].join(','),
      }).toString()

      const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) throw new Error(`Open-Meteo terrain request failed (${response.status})`)
      const payload = await response.json() as OpenMeteoResponse
      if (!Array.isArray(payload.elevation) || payload.elevation.length !== 5 || !payload.elevation.every(isElevation)) {
        throw new Error('Invalid Open-Meteo terrain response')
      }

      const [center, north, south, east, west] = payload.elevation
      const metersPerLatitudeDegree = 111_320
      const northSouthDistance = 2 * latitudeOffset * metersPerLatitudeDegree
      const eastWestDistance = 2 * longitudeOffset * metersPerLatitudeDegree * latitudeFactor
      const northSouthGradient = (north - south) / northSouthDistance
      const eastWestGradient = (east - west) / eastWestDistance
      const slopeDeg = Math.min(90, Math.max(0, Math.atan(Math.hypot(northSouthGradient, eastWestGradient)) * 180 / Math.PI))

      return { terrain: { elevationM: center, slopeDeg } }
    },
  }

  return provider
}
