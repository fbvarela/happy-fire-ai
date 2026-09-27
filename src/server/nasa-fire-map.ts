import { clampDayRange } from './providers/firms'
import { createFetchWithRetry } from './http'

// FIRMS WMS proxy: the active-fire map image is rendered by NASA's WMS using the same
// MAP_KEY as the data feed. The key must never reach the client, so the browser asks this
// module (via /api/v1/nasa-fire-map) and we stream the PNG server-side. The image is
// display-only and never feeds the deterministic scorers.

export const fireMapRadiusLimitKm = 100
const defaultRadiusKm = 60
const fireMapWidth = 640
const fireMapHeight = 480
const fireMapRequestTimeoutMs = 15_000

// Day windows FIRMS exposes as WMS layers: 24 h / 48 h / 72 h / 7 days.
export type FireMapDayWindow = 1 | 2 | 3 | 7

const wmsLayerByDays: Record<FireMapDayWindow, string> = {
  1: 'fires_viirs_24',
  2: 'fires_viirs_48',
  3: 'fires_viirs_72',
  7: 'fires_viirs_7',
}

export const resolveFireMapDayWindow = (value: unknown): FireMapDayWindow => {
  const fallback: FireMapDayWindow = 3
  if (typeof value !== 'string' && typeof value !== 'number') return fallback
  const days = Number(value)
  if (days === 1 || days === 2 || days === 3 || days === 7) return days
  // FIRMS day-range clamp (1-5) would satisfy 4 and 5 with the 72 h layer.
  if (days === 4 || days === 5) return 3
  return fallback
}

export type FireMapBoundingBox = { west: number; south: number; east: number; north: number }

const clampBBox = ({ west, south, east, north }: FireMapBoundingBox): FireMapBoundingBox => ({
  west: Math.max(-180, west),
  south: Math.max(-90, south),
  east: Math.min(180, east),
  north: Math.min(90, north),
})

export const buildFireMapBoundingBox = (latitude: number, longitude: number, radiusKm: number): FireMapBoundingBox => {
  const latitudeDelta = radiusKm / 111.32
  const longitudeDelta = radiusKm / (111.32 * Math.max(Math.cos(latitude * Math.PI / 180), 0.01))
  return clampBBox({
    west: longitude - longitudeDelta,
    south: latitude - latitudeDelta,
    east: longitude + longitudeDelta,
    north: latitude + latitudeDelta,
  })
}

export const buildFireMapUrl = (
  mapKey: string,
  bounds: FireMapBoundingBox,
  days: FireMapDayWindow,
): string => {
  const { west, south, east, north } = clampBBox(bounds)
  const url = new URL(`https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/${mapKey}/`)
  url.search = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.1.1',
    LAYERS: wmsLayerByDays[days],
    FORMAT: 'image/png',
    WIDTH: String(fireMapWidth),
    HEIGHT: String(fireMapHeight),
    SRS: 'EPSG:4326',
    BBOX: `${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}`,
  }).toString()
  return url.toString()
}

export type FetchFireMapImageOptions = {
  mapKey: string
  bounds: FireMapBoundingBox
  days: FireMapDayWindow
  fetcher?: typeof fetch
  timeoutMs?: number
}

const isPng = (response: Response) => (response.headers.get('content-type') ?? '').startsWith('image/png')

export const fetchFireMapImage = async (options: FetchFireMapImageOptions): Promise<Uint8Array> => {
  const url = buildFireMapUrl(options.mapKey, options.bounds, options.days)
  const response = await (options.fetcher ?? fetch)(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? fireMapRequestTimeoutMs),
  })
  if (!response.ok) throw new Error(`FIRMS WMS request failed (${response.status})`)
  if (!isPng(response)) throw new Error('FIRMS WMS returned an unexpected content type')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('FIRMS WMS returned an invalid image')
  return bytes
}

export type FireMapImageResult = {
  status: 'available' | 'error' | 'unavailable'
  source: 'firms' | 'unavailable'
  image?: Uint8Array
  contentType?: string
  warning?: string
}

const fireMapCache = new Map<string, { result: FireMapImageResult; expiresAt: number }>()
const fireMapCacheTtlMs = 10 * 60 * 1000
const fireMapCacheMaxEntries = 16

export const clearFireMapCache = () => fireMapCache.clear()

export const resolveFireMapImage = async (
  latitude: number,
  longitude: number,
  options: { radiusKm?: number; days?: number; fetcher?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<FireMapImageResult> => {
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new Error('Enter a latitude between -90 and 90 and a longitude between -180 and 180.')
  }
  const radiusKm = Math.min(
    fireMapRadiusLimitKm,
    Math.max(1, Number.isFinite(options.radiusKm) ? (options.radiusKm as number) : defaultRadiusKm),
  )
  const env = options.env ?? process.env
  const days = resolveFireMapDayWindow(options.days ?? clampDayRange(env.FIRMS_DAY_RANGE))
  const mapKey = env.FIRMS_MAP_KEY

  // Cache key distinguishes disabled (no key) from live so state changes don't cross-contaminate.
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}|${radiusKm.toFixed(1)}|${days}|${mapKey ? 'live' : 'off'}`
  const now = Date.now()
  for (const [key, entry] of fireMapCache) {
    if (entry.expiresAt <= now) fireMapCache.delete(key)
  }
  const cached = fireMapCache.get(cacheKey)
  if (cached) return cached.result

  let result: FireMapImageResult
  if (!mapKey) {
    result = { status: 'unavailable', source: 'unavailable', warning: 'Live FIRMS map is not enabled; no map image is shown.' }
  } else {
    try {
      const image = await fetchFireMapImage({ mapKey, bounds: buildFireMapBoundingBox(latitude, longitude, radiusKm), days, fetcher: options.fetcher ?? createFetchWithRetry() })
      result = { status: 'available', source: 'firms', image, contentType: 'image/png' }
    } catch (error) {
      console.warn('[nasa] fire-map-fetch-failed', JSON.stringify({
        error: error instanceof Error ? error.message : 'unknown error',
      }))
      result = { status: 'error', source: 'unavailable', warning: 'The FIRMS active-fire map image is currently unavailable.' }
    }
  }

  if (fireMapCache.size >= fireMapCacheMaxEntries) {
    const oldestKey = fireMapCache.keys().next().value
    if (oldestKey !== undefined) fireMapCache.delete(oldestKey)
  }
  fireMapCache.set(cacheKey, { result, expiresAt: now + fireMapCacheTtlMs })
  return result
}

// WMS returns a tiny shuffled marker glyph set, not sensitive data, so the browser may
// cache the image briefly; the server cache remains the primary throttle.
export const fireMapResponseCacheControl = 'public, max-age=600'
