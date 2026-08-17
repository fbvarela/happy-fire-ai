import { createServerFn } from '@tanstack/react-start'

import type { EnvironmentalContext, ManualRiskInputs } from '../domain/environment'
import { createCopernicusLandCoverProvider, type LandCoverProvider } from './providers/landcover'
import { createOpenMeteoWeatherProvider, type WeatherProvider } from './providers/weather'
import { createWorldPopPopulationProvider, type PopulationProvider } from './providers/population'
import { createDgtRoadClosureProvider, type RoadClosureProvider } from './providers/evacuation'

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
  terrain: EnvironmentalContext['terrain']
  fuel: EnvironmentalContext['fuel']
  fuelSource: EnvironmentalContext['fuelSource']
  fuelWarning?: string
  exposure: EnvironmentalContext['exposure']
  exposureSource: EnvironmentalContext['exposureSource']
  exposureWarning?: string
  roadClosures: EnvironmentalContext['roadClosures']
  roadClosureSource?: EnvironmentalContext['roadClosureSource']
  roadClosureObservedAt?: string
  roadClosureWarning?: string
  source: EnvironmentalContext['source']
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
const isTerrainResult = (value: unknown): value is Pick<EnvironmentalContext, 'terrain'> => {
  if (!value || typeof value !== 'object' || !('terrain' in value)) return false
  const terrain = value.terrain
  if (!terrain || typeof terrain !== 'object') return false
  const fields = terrain as Record<string, unknown>
  return typeof fields.elevationM === 'number' && Number.isFinite(fields.elevationM) && fields.elevationM >= -1000 && fields.elevationM <= 10000 &&
    typeof fields.slopeDeg === 'number' && Number.isFinite(fields.slopeDeg) && fields.slopeDeg >= 0 && fields.slopeDeg <= 90
}

const getFreshnessStatus = (sourceTimestamp: string) =>
  Date.now() - Date.parse(sourceTimestamp) > freshnessThresholdMs ? 'stale' : 'available'

const getCacheKey = (
  latitude: number,
  longitude: number,
  weatherEnabled: boolean,
  landCoverEnabled: boolean,
  populationEnabled: boolean,
  roadClosuresEnabled: boolean,
) => `${latitude},${longitude}:${weatherEnabled ? 'live' : 'mock'}:${landCoverEnabled ? 'live' : 'mock'}:${populationEnabled ? 'live' : 'mock'}:${roadClosuresEnabled ? 'live' : 'mock'}`

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

const validateRequest = (request: Coordinates & ManualRiskInputs) => {
  validateCoordinates(request)
  for (const [label, value] of [
    ['local festival pressure', request.localFestivalPressure],
    ['roadside maintenance', request.roadsideMaintenance],
  ] as const) {
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      throw new Error(`${label} must be between 0 and 100.`)
    }
  }
  return request
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
    fuelSource: 'mock',
    exposureSource: 'mock',
    exposure: {
      nearbyPeople: 400 + Math.round(longitudeSignal * 4000),
    },
    seasonWeatherProxy: Math.round((40 + longitudeSignal * 45) * 10) / 10,
    roadClosures: [],
  }
}

export const getEnvironmentContext = async (
  latitude: number,
  longitude: number,
  provider?: WeatherProvider & { sourceTimestamp?: string },
  landCoverProvider?: LandCoverProvider,
  populationProvider?: PopulationProvider,
  roadClosureProvider?: RoadClosureProvider,
): Promise<EnvironmentalContext> => {
  validateCoordinates({ latitude, longitude })
  const fallback = getMockContext(latitude, longitude)
  const weatherProvider = provider ?? (process.env.WEATHER_PROVIDER === 'open-meteo'
    ? createOpenMeteoWeatherProvider()
    : undefined)
  const configuredLandCover = landCoverProvider ?? (
    process.env.CDSE_ACCESS_TOKEN || (process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET)
      ? createCopernicusLandCoverProvider({
          accessToken: process.env.CDSE_ACCESS_TOKEN,
          clientId: process.env.CDSE_CLIENT_ID,
          clientSecret: process.env.CDSE_CLIENT_SECRET,
        })
      : undefined
  )
  const configuredPopulation = populationProvider ?? (
    process.env.WORLDPOP_ENABLED === 'true' || process.env.WORLDPOP_API_KEY
      ? createWorldPopPopulationProvider()
      : undefined
  )
  const configuredRoadClosures = roadClosureProvider ?? (
    process.env.DGT_ROAD_CLOSURES_ENABLED === 'true' ? createDgtRoadClosureProvider() : undefined
  )
  if (!weatherProvider && !configuredLandCover && !configuredPopulation && !configuredRoadClosures) return fallback

  const cacheEnabled = provider === undefined
  const cacheKey = getCacheKey(
    latitude,
    longitude,
    weatherProvider !== undefined,
    configuredLandCover !== undefined,
    configuredPopulation !== undefined,
    configuredRoadClosures !== undefined,
  )
  const startedAt = Date.now()
  if (cacheEnabled) {
    pruneWeatherCache(startedAt)
    const cached = weatherCache.get(cacheKey)
    if (cached) {
      logWeatherEvent('weather-cache-hit', {
        ageMs: Math.max(0, startedAt - Date.parse(cached.sourceTimestamp)),
        expiresAt: new Date(cached.expiresAt).toISOString(),
        expiresInMs: Math.max(0, cached.expiresAt - startedAt),
        sourceTimestamp: cached.sourceTimestamp,
        source: cached.source,
        status: getFreshnessStatus(cached.sourceTimestamp),
        durationMs: Date.now() - startedAt,
      })
      return {
        ...fallback,
        weather: cached.weather,
        terrain: cached.terrain,
        fuel: cached.fuel,
        fuelSource: cached.fuelSource,
        fuelWarning: cached.fuelWarning,
        exposure: cached.exposure,
        exposureSource: cached.exposureSource,
        exposureWarning: cached.exposureWarning,
        roadClosures: cached.roadClosures,
        roadClosureSource: cached.roadClosureSource,
        roadClosureObservedAt: cached.roadClosureObservedAt,
        roadClosureWarning: cached.roadClosureWarning,
        observedAt: cached.sourceTimestamp,
        status: getFreshnessStatus(cached.sourceTimestamp),
        source: cached.source,
        cacheStatus: 'hit',
      }
    }
  }

  try {
    const result: unknown = weatherProvider
      ? await weatherProvider.getWeather(latitude, longitude)
      : { weather: fallback.weather }
    if (!isWeatherResult(result)) throw new Error('Invalid provider weather')
    let terrain = fallback.terrain
    if (weatherProvider?.getTerrain) {
      const terrainStartedAt = Date.now()
      try {
        const terrainResult: unknown = await weatherProvider.getTerrain(latitude, longitude)
        if (isTerrainResult(terrainResult)) terrain = terrainResult.terrain
      } catch (error) {
        console.warn('[environment] terrain-fetch-failed', JSON.stringify({
          durationMs: Date.now() - terrainStartedAt,
          source: 'open-meteo',
          status: 'fallback',
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    }
    let fuel = fallback.fuel
    let fuelSource: EnvironmentalContext['fuelSource'] = 'mock'
    let fuelWarning: string | undefined
    if (configuredLandCover) {
      const fuelStartedAt = Date.now()
      try {
        const fuelResult = await configuredLandCover.getVegetationDryness(latitude, longitude)
        if (fuelResult.source !== 'copernicus' || !isNumber(fuelResult.vegetationDryness) || fuelResult.vegetationDryness < 0 || fuelResult.vegetationDryness > 100) {
          throw new Error('Invalid provider fuel')
        }
        fuel = { vegetationDryness: fuelResult.vegetationDryness }
        fuelSource = 'copernicus'
      } catch (error) {
        fuelWarning = 'Copernicus land-cover data was unavailable; deterministic mock fuel is shown.'
        console.warn('[environment] landcover-fetch-failed', JSON.stringify({
          durationMs: Date.now() - fuelStartedAt,
          source: 'copernicus',
          status: 'fallback',
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    }
    let exposure = fallback.exposure
    let exposureSource: EnvironmentalContext['exposureSource'] = 'mock'
    let exposureWarning: string | undefined
    if (configuredPopulation) {
      const populationStartedAt = Date.now()
      try {
        const populationResult = await configuredPopulation.getNearbyPeople(latitude, longitude)
        if (populationResult.source !== 'worldpop' || !isNumber(populationResult.nearbyPeople) || populationResult.nearbyPeople < 0) {
          throw new Error('Invalid provider population')
        }
        exposure = { nearbyPeople: populationResult.nearbyPeople }
        exposureSource = 'worldpop'
        console.info('[environment] population-fetch', JSON.stringify({
          status: 'worldpop',
          durationMs: Date.now() - populationStartedAt,
        }))
      } catch (error) {
        exposureWarning = 'WorldPop population data was unavailable; deterministic mock exposure is shown.'
        console.warn('[environment] population-fetch-failed', JSON.stringify({
          status: 'fallback',
          durationMs: Date.now() - populationStartedAt,
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    }
    let roadClosures: EnvironmentalContext['roadClosures'] = []
    let roadClosureSource: EnvironmentalContext['roadClosureSource']
    let roadClosureObservedAt: string | undefined
    let roadClosureWarning: string | undefined
    if (configuredRoadClosures) {
      try {
        const closureResult = await configuredRoadClosures.getNearbyClosures(latitude, longitude)
        if (closureResult.source !== 'dgt' || !Array.isArray(closureResult.closures)) throw new Error('Invalid DGT road closure response')
        roadClosures = closureResult.closures
        roadClosureSource = closureResult.source
        roadClosureObservedAt = closureResult.sourceTimestamp
      } catch (error) {
        roadClosureWarning = 'DGT road-closure data was unavailable; no route recommendation is shown.'
        console.warn('[environment] dgt-road-closures-fetch-failed', JSON.stringify({
          status: 'unavailable',
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    }
    const sourceTimestamp = weatherProvider?.sourceTimestamp ?? new Date().toISOString()
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
        terrain,
        fuel,
        fuelSource,
        fuelWarning,
        exposure,
        exposureSource,
        exposureWarning,
        roadClosures,
        roadClosureSource,
        roadClosureObservedAt,
        roadClosureWarning,
        source: weatherProvider ? 'open-meteo' : 'mock',
        sourceTimestamp,
        expiresAt: now + cacheTtlMs,
      })
    }
    logWeatherEvent('weather-fetch', {
      durationMs: Date.now() - startedAt,
      source: weatherProvider ? 'open-meteo' : 'mock',
      status: getFreshnessStatus(sourceTimestamp),
    })
    return {
      ...fallback,
      weather: result.weather,
      terrain,
      fuel,
      fuelSource,
      fuelWarning,
      exposure,
      exposureSource,
      exposureWarning,
      roadClosures,
      roadClosureSource,
      roadClosureObservedAt,
      roadClosureWarning,
      observedAt: sourceTimestamp,
      status: getFreshnessStatus(sourceTimestamp),
      source: weatherProvider ? 'open-meteo' : 'mock',
      cacheStatus: 'miss',
    }
  } catch (error) {
    console.warn('[environment] weather-fetch-failed', JSON.stringify({
      durationMs: Date.now() - startedAt,
      source: weatherProvider ? 'open-meteo' : 'mock',
      status: 'error',
      error: error instanceof Error ? error.message : 'unknown error',
    }))
    return { ...fallback, status: 'error', cacheStatus: 'fallback' }
  }
}

export const getEnvironment = createServerFn({ method: 'GET' })
  .validator(validateRequest)
  .handler(({ data }) => getEnvironmentContext(data.latitude, data.longitude).then((context) => ({
    ...context,
    localFestivalPressure: data.localFestivalPressure ?? null,
    roadsideMaintenance: data.roadsideMaintenance ?? null,
  })))
