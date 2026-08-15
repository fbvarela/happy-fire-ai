import { createServerFn } from '@tanstack/react-start'

import type { EnvironmentalContext } from '../domain/environment'
import { createOpenMeteoWeatherProvider, type WeatherProvider } from './providers/weather'

type Coordinates = {
  latitude: number
  longitude: number
}

const observedAt = '2026-01-01T00:00:00.000Z'
const freshnessThresholdMs = 90 * 60 * 1000

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

  try {
    const result = await weatherProvider.getWeather(latitude, longitude)
    const sourceTimestamp = weatherProvider.sourceTimestamp ?? new Date().toISOString()
    const sourceTime = Date.parse(sourceTimestamp)
    if (Number.isNaN(sourceTime)) throw new Error('Invalid provider timestamp')
    const status = Date.now() - sourceTime > freshnessThresholdMs ? 'stale' : 'available'
    return { ...fallback, ...result, observedAt: sourceTimestamp, status }
  } catch {
    return fallback
  }
}

export const getEnvironment = createServerFn({ method: 'GET' })
  .validator(validateCoordinates)
  .handler(({ data }) => getEnvironmentContext(data.latitude, data.longitude))
