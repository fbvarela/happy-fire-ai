import { createServerFn } from '@tanstack/react-start'

import type { DataStatus } from '../domain/environment'
import {
  clampDayRange,
  createFirmsProvider,
  haversineDistanceKm,
  initialBearingDeg,
  resolveFirmsSource,
  type ConfidenceBand,
  type FireDetection,
  type FirmsBoundingBox,
  type FirmsProvider,
} from './providers/firms'

// NASA FIRMS overlay resolution. Env-gated like the hazard providers: when `FIRMS_MAP_KEY`
// is unset (or the live call fails), deterministic mock detections are returned and a
// warning marks the fallback — never a silent success. Overlay data is display-only and
// never feeds `src/domain/` scorers.

export type NearestFireDetection = {
  distanceKm: number
  bearingDeg: number
  ageHours: number
  confidence: ConfidenceBand
}

export type FirmsOverlay = {
  status: DataStatus
  source: 'firms' | 'mock'
  observedAt: string
  dayRange: number
  detections: FireDetection[]
  nearest: NearestFireDetection | null
  warning?: string
}

export type NasaOverlays = {
  firms: FirmsOverlay
}

export const overlayRadiusLimitKm = 100
const defaultRadiusKm = 25
const cacheTtlMs = 10 * 60 * 1000
const cacheMaxEntries = 32
const staleAfterMs = 24 * 60 * 60 * 1000

// Shares the fixed synthetic timestamp with the other mock contexts so mock data is
// never reported as fresh relative to wall-clock time.
const mockObservedAt = '2026-01-01T00:00:00.000Z'

const overlayCache = new Map<string, { result: NasaOverlays; expiresAt: number }>()

export const clearNasaOverlayCache = () => overlayCache.clear()

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const mockConfidenceFor = (index: number): ConfidenceBand => (['high', 'nominal', 'low'] as const)[index % 3]

// Deterministic synthetic detections around the requested point, following the same
// coordinate-signal style as the mock hazard contexts.
export const getMockFirmsOverlay = (
  latitude: number,
  longitude: number,
  dayRange: number,
): FirmsOverlay => {
  const latitudeSignal = Math.abs(latitude) % 1
  const longitudeSignal = Math.abs(longitude) % 1
  const count = 1 + Math.floor(latitudeSignal * 3)
  const offsetsKm = [2.5, 8.4, 17.9, 31.6]
  const bearingsDeg = [40, 150, 250, 320]
  const nauticalMileKm = 1.852
  const detections: FireDetection[] = Array.from({ length: count }, (_, index) => ({
    latitude: round(latitude + offsetsKm[index] * Math.sin(bearingsDeg[index] * Math.PI / 180) / 111.32, 4),
    longitude: round(
      longitude + offsetsKm[index] * Math.cos(bearingsDeg[index] * Math.PI / 180) *
        (111.32 * Math.max(Math.cos(latitude * Math.PI / 180), 0.01)) ** -1,
      4,
    ),
    brightnessK: 310 + Math.round(longitudeSignal * 90) + index,
    scan: 0.5,
    track: 0.5,
    acquiredAt: mockObservedAt,
    satellite: 'Synthetic mock satellite',
    instrument: index % 2 === 0 ? 'Synthetic VIIRS' : 'Synthetic MODIS',
    confidence: mockConfidenceFor(index),
    frp: round(5 + latitudeSignal * 60 + index * nauticalMileKm, 1),
    dayNight: index % 2 === 0 ? 'day' : 'night',
  }))
  return {
    status: 'available',
    source: 'mock',
    observedAt: mockObservedAt,
    dayRange,
    detections,
    nearest: null,
  }
}

const buildBoundingBox = (latitude: number, longitude: number, radiusKm: number): FirmsBoundingBox => {
  const latitudeDelta = radiusKm / 111.32
  const longitudeDelta = radiusKm / (111.32 * Math.max(Math.cos(latitude * Math.PI / 180), 0.01))
  return {
    west: longitude - longitudeDelta,
    south: latitude - latitudeDelta,
    east: longitude + longitudeDelta,
    north: latitude + latitudeDelta,
  }
}

const withFreshness = (observedAt: string): DataStatus =>
  Date.now() - Date.parse(observedAt) > staleAfterMs ? 'stale' : 'available'

const computeNearest = (
  latitude: number,
  longitude: number,
  detections: FireDetection[],
): NearestFireDetection | null => {
  let nearest: { detection: FireDetection; distanceKm: number } | null = null
  for (const detection of detections) {
    const distanceKm = haversineDistanceKm({ latitude, longitude }, detection)
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { detection, distanceKm }
  }
  if (!nearest) return null
  return {
    distanceKm: round(nearest.distanceKm),
    bearingDeg: Math.round(initialBearingDeg({ latitude, longitude }, nearest.detection)),
    ageHours: round(Math.max(0, (Date.now() - Date.parse(nearest.detection.acquiredAt)) / (60 * 60 * 1000))),
    confidence: nearest.detection.confidence,
  }
}

export type ResolveNasaOverlaysOptions = {
  radiusKm?: number
  dayRange?: number
  provider?: FirmsProvider
  env?: NodeJS.ProcessEnv
}

export const resolveNasaOverlays = async (
  latitude: number,
  longitude: number,
  options: ResolveNasaOverlaysOptions = {},
): Promise<NasaOverlays> => {
  if (
    !isNumber(latitude) || latitude < -90 || latitude > 90 ||
    !isNumber(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new Error('Enter a latitude between -90 and 90 and a longitude between -180 and 180.')
  }
  const radiusKm = Math.min(
    overlayRadiusLimitKm,
    Math.max(1, isNumber(options.radiusKm) ? options.radiusKm : defaultRadiusKm),
  )
  const env = options.env ?? process.env
  const dayRange = clampDayRange(env.FIRMS_DAY_RANGE)
  const enabled = env.FIRMS_MAP_KEY !== undefined && env.FIRMS_MAP_KEY !== ''
  const minConfidence = env.FIRMS_MIN_CONFIDENCE === 'low' || env.FIRMS_MIN_CONFIDENCE === 'nominal' || env.FIRMS_MIN_CONFIDENCE === 'high'
    ? env.FIRMS_MIN_CONFIDENCE
    : undefined

  const provider = options.provider ?? (
    enabled
      ? createFirmsProvider({
          mapKey: env.FIRMS_MAP_KEY as string,
          source: resolveFirmsSource(env.FIRMS_SOURCE),
          minConfidence,
        })
      : undefined
  )

  const cacheKey = [
    round(latitude, 4),
    round(longitude, 4),
    round(radiusKm, 2),
    dayRange,
    enabled ? 'live' : 'mock',
    minConfidence ?? 'all',
  ].join(':')
  const now = Date.now()
  for (const [key, entry] of overlayCache) {
    if (entry.expiresAt <= now) overlayCache.delete(key)
  }
  const cached = overlayCache.get(cacheKey)
  if (cached) return cached.result

  const fallback = getMockFirmsOverlay(latitude, longitude, dayRange)
  let result: NasaOverlays
  if (!provider) {
    result = { firms: { ...fallback, warning: 'Live NASA FIRMS data is not enabled; no real fire detections are shown.' } }
  } else {
    try {
      const { detections, observedAt } = await provider.getFireDetections(
        buildBoundingBox(latitude, longitude, radiusKm),
        dayRange,
      )
      result = {
        firms: {
          status: withFreshness(observedAt),
          source: 'firms',
          observedAt,
          dayRange,
          detections,
          nearest: computeNearest(latitude, longitude, detections),
        },
      }
    } catch (error) {
      console.warn('[nasa] firms-fetch-failed', JSON.stringify({
        error: error instanceof Error ? error.message : 'unknown error',
      }))
      result = {
        firms: {
          ...fallback,
          status: 'error',
          warning: 'NASA FIRMS data was unavailable; deterministic mock fire detections are shown.',
        },
      }
    }
  }

  if (overlayCache.size >= cacheMaxEntries) {
    const oldestKey = overlayCache.keys().next().value
    if (oldestKey !== undefined) overlayCache.delete(oldestKey)
  }
  overlayCache.set(cacheKey, { result, expiresAt: now + cacheTtlMs })
  return result
}

const overlayValidator = (input: { latitude: number; longitude: number }) => {
  if (
    input === null || typeof input !== 'object' ||
    typeof (input as { latitude?: unknown }).latitude !== 'number' ||
    typeof (input as { longitude?: unknown }).longitude !== 'number'
  ) {
    throw new Error('Enter a latitude and longitude.')
  }
  return input as { latitude: number; longitude: number }
}

export const getNasaOverlays = createServerFn({ method: 'GET' })
  .validator(overlayValidator)
  .handler(({ data }) => resolveNasaOverlays(data.latitude, data.longitude))
