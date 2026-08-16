import { createServerFn } from '@tanstack/react-start'

import type { EnvironmentalContext } from '../domain/environment'
import { createOpenMeteoWeatherProvider, type WeatherProvider } from './providers/weather'

type Coordinates = {
  latitude: number
  longitude: number
}

const observedAt = '2026-01-01T00:00:00.000Z'
const freshnessThresholdMs = 90 * 60 * 1000
const cacheTtlMs = 10 * 60 * 1000
// Keep the process-local cache bounded; use durable/shared caching if this needs to scale.
const cacheMaxEntries = 32
const weatherCache = new Map<string, {
  weather: EnvironmentalContext['weather']
  sourceTimestamp: string
  expiresAt: number
}>()
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isHumidity = (value: unknown): value is number | null => value === null || (isNumber(value) && value >= 0 && value <= 100)
const isNonNegative = (value: unknown): value is number | null => value === null || (isNumber(value) && value >= 0)
const isWindDirection = (value: unknown): value is number | null => value === null || (isNumber(value) && value >= 0 && value <= 360)
const isWeatherResult = (value: unknown): value is Pick<EnvironmentalContext, 'weather'> => {
  if (!value || typeof value !== 'object' || !('weather' in value)) return false
  const weather = value.weather
  if (!weather || typeof weather !== 'object') return false
  const fields = weather as Record<string, unknown>
  return (fields.temperatureC === null || isNumber(fields.temperatureC)) &&
    isHumidity(fields.humidity) && isNonNegative(fields.precipitationMm24h) &&
    isNonNegative(fields.windKph) && isWindDirection(fields.windDirectionDeg)
}

const getFreshnessStatus = (sourceTimestamp: string) =>
  Date.now() - Date.parse(sourceTimestamp) > freshnessThresholdMs ? 'stale' : 'available'

const getCacheKey = (latitude: number, longitude: number) => `${latitude},${longitude}`

const pruneWeatherCache = (now: number) => {
  for (const [key, entry] of weatherCache) {
    if (entry.expiresAt <= now) weatherCache.delete(key)
  }
}

const logWeatherEvent = (event: string, details: Record<string, unknown>) => {
  console.info(`[environment] ${event}`, JSON.stringify(details))
}

export const clearEnvironmentCache = () => weatherCache.clear()

const validateCoordinates = (coordinates: Coordinates) => {
  if (
    !Number.isFinite(coordinates.latitude) ||
    coordinates.latitude < -90 ||
    coordinates.latitude > 90 ||
    !Number.isFinite(coordinates.longitude) ||
    coordinates.longitude < -180 ||
    coordinates.longitude > 180
  ) {
    throw new Error('Enter a latitude between -90 and 90 and a longitude between -180 and 180.')
  }

  return coordinates
}

const getMockContext = (latitude: number, longitude: number): EnvironmentalContext => {
  const latitudeSignal = Math.abs(latitude) % 1
  const longitudeSignal = Math.abs(longitude) % 1

  return {
    latitude,
    longitude,
    observedAt,
    status: 'available',
    source: 'mock',
    cacheStatus: 'fallback',
    weather: {
      temperatureC: 18 + Math.round(latitudeSignal * 12),
      humidity: 35 + Math.round(longitudeSignal * 40),
      precipitationMm24h: Math.round((1 + latitudeSignal * 8) * 10) / 10,
      windKph: 8 + Math.round(longitudeSignal * 18),
      windDirectionDeg: Math.round((longitude + 180) % 360),
    },
    terrain: {
      slopeDeg: Math.round((latitudeSignal * 25 + longitudeSignal * 10) * 10) / 10,
      elevationM: 120 + Math.round((latitudeSignal + longitudeSignal) * 900),
    },
    fuel: {
      vegetationDryness: Math.round((35 + latitudeSignal * 55) * 10) / 10,
    },
    exposure: {
      nearbyPeople: 400 + Math.round(longitudeSignal * 4000),
    },
    seasonWeatherProxy: Math.round((40 + longitudeSignal * 45) * 10) / 10,
  }
}

export const getEnvironmentContext = async (
  latitude: number,
  longitude: number,
  provider?: WeatherProvider & { sourceTimestamp?: string },
): Promise<EnvironmentalContext> => {
  validateCoordinates({ latitude, longitude })
  const fallback = getMockContext(latitude, longitude)
  const weatherProvider = provider ?? (process.env.WEATHER_PROVIDER === 'open-meteo'
    ? createOpenMeteoWeatherProvider()
    : undefined)
  if (!weatherProvider) return fallback

  const cacheEnabled = provider === undefined
  const cacheKey = getCacheKey(latitude, longitude)
  const startedAt = Date.now()
  if (cacheEnabled) {
    pruneWeatherCache(startedAt)
    const cached = weatherCache.get(cacheKey)
    if (cached) {
      logWeatherEvent('weather-cache-hit', {
        latitude,
        longitude,
        ageMs: Math.max(0, startedAt - Date.parse(cached.sourceTimestamp)),
        expiresAt: new Date(cached.expiresAt).toISOString(),
        expiresInMs: Math.max(0, cached.expiresAt - startedAt),
        sourceTimestamp: cached.sourceTimestamp,
        durationMs: Date.now() - startedAt,
      })
      return {
        ...fallback,
        weather: cached.weather,
        observedAt: cached.sourceTimestamp,
        status: getFreshnessStatus(cached.sourceTimestamp),
        source: 'open-meteo',
        cacheStatus: 'hit',
      }
    }
  }

  try {
    const result: unknown = await weatherProvider.getWeather(latitude, longitude)
    if (!isWeatherResult(result)) throw new Error('Invalid provider weather')
    const sourceTimestamp = weatherProvider.sourceTimestamp ?? new Date().toISOString()
    const sourceTime = Date.parse(sourceTimestamp)
    if (Number.isNaN(sourceTime)) throw new Error('Invalid provider timestamp')
    if (cacheEnabled) {
      const now = Date.now()
      pruneWeatherCache(now)
      if (!weatherCache.has(cacheKey) && weatherCache.size >= cacheMaxEntries) {
        const oldestKey = weatherCache.keys().next().value
        if (oldestKey !== undefined) weatherCache.delete(oldestKey)
      }
      weatherCache.set(cacheKey, {
        weather: result.weather,
        sourceTimestamp,
        expiresAt: now + cacheTtlMs,
      })
    }
    logWeatherEvent('weather-fetch', {
      latitude,
      longitude,
      durationMs: Date.now() - startedAt,
      source: 'open-meteo',
    })
    return {
      ...fallback,
      weather: result.weather,
      observedAt: sourceTimestamp,
      status: getFreshnessStatus(sourceTimestamp),
      source: 'open-meteo',
      cacheStatus: 'miss',
    }
  } catch (error) {
    console.warn('[environment] weather-fetch-failed', JSON.stringify({
      latitude,
      longitude,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown error',
    }))
    return { ...fallback, status: 'error', cacheStatus: 'fallback' }
  }
}

export const getEnvironment = createServerFn({ method: 'GET' })
  .validator(validateCoordinates)
  .handler(({ data }) => getEnvironmentContext(data.latitude, data.longitude))
