import type { DataStatus } from '../../domain/environment'
import { createFetchWithRetry } from '../http'

// NASA FIRMS Area API adapter (https://firms.modaps.eosdis.nasa.gov/api/area/).
// CSV is the only stable machine format for the NRT area endpoint; rows are validated
// per-line so a malformed row never fails the whole request. An injected fetcher keeps
// tests deterministic and network-free.

export type ConfidenceBand = 'low' | 'nominal' | 'high'

export type FireDetection = {
  latitude: number
  longitude: number
  brightnessK: number
  scan: number
  track: number
  acquiredAt: string
  satellite: string
  instrument: string
  confidence: ConfidenceBand
  frp: number | null
  dayNight: 'day' | 'night'
}

export type FirmsBoundingBox = { west: number; south: number; east: number; north: number }

export type FirmsResult = {
  detections: FireDetection[]
  observedAt: string
}

export type FirmsProvider = {
  getFireDetections(bounds: FirmsBoundingBox, dayRange?: number): Promise<FirmsResult>
}

export const firmsRequestTimeoutMs = 10_000
export const minDayRange = 1
export const maxDayRange = 5
// Valid FIRMS Area API SOURCE ids (per the official docs page). The historical 375m/1km
// names are not accepted by the API.
export const validFirmsSources = [
  'LANDSAT_NRT',
  'MODIS_NRT',
  'MODIS_SP',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA20_SP',
  'VIIRS_NOAA21_NRT',
  'VIIRS_SNPP_NRT',
  'VIIRS_SNPP_SP',
] as const
export const defaultFirmsSource = 'VIIRS_SNPP_NRT'
export type FirmsSource = typeof validFirmsSources[number]

export const resolveFirmsSource = (value: unknown): FirmsSource =>
  validFirmsSources.find((source) => source === value) ?? defaultFirmsSource

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const clampDayRange = (value: unknown, fallback = 2): number => {
  if (!isNumber(value)) return fallback
  return Math.min(maxDayRange, Math.max(minDayRange, Math.round(value)))
}

const confidenceRank: Record<ConfidenceBand, number> = { low: 0, nominal: 1, high: 2 }

// MODIS confidence is l/n/h; VIIRS is 0-100 (occasionally l/n/h). Unrecognised values
// degrade to nominal rather than dropping the detection.
export const classifyConfidence = (raw: string): ConfidenceBand => {
  const value = raw.trim().toLowerCase()
  if (value === 'l' || value === 'low') return 'low'
  if (value === 'h' || value === 'high') return 'high'
  if (value === '' || value === 'n' || value === 'nominal') return 'nominal'
  const numeric = Number(value)
  if (Number.isFinite(numeric) && value !== '') {
    if (numeric >= 75) return 'high'
    return numeric >= 35 ? 'nominal' : 'low'
  }
  return 'nominal'
}

export const atLeastConfidence = (band: ConfidenceBand, minimum?: ConfidenceBand) =>
  minimum === undefined || confidenceRank[band] >= confidenceRank[minimum]

const parseAcqTimestamp = (date: string, time: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  if (!/^\d{2,4}$/.test(time)) return undefined
  const padded = time.padStart(4, '0')
  const iso = `${date}T${padded.slice(0, 2)}:${padded.slice(2, 4)}:00Z`
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? undefined : iso
}

export const haversineDistanceKm = (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) => {
  const earthRadiusKm = 6371
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const deltaLatitude = toRadians(to.latitude - from.latitude)
  const deltaLongitude = toRadians(to.longitude - from.longitude)
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)))
}

export const initialBearingDeg = (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) => {
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const toDegrees = (radians: number) => (radians * 180 / Math.PI + 360) % 360
  const fromLatitude = toRadians(from.latitude)
  const toLatitude = toRadians(to.latitude)
  const deltaLongitude = toRadians(to.longitude - from.longitude)
  const y = Math.sin(deltaLongitude) * Math.cos(toLatitude)
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude) - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(deltaLongitude)
  return toDegrees(Math.atan2(y, x))
}

const parseFiniteNumber = (raw: string) => ({ value: Number(raw), ok: /^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw.trim()) })

const parseRow = (headers: string[], row: string[], bounds: FirmsBoundingBox): FireDetection | undefined => {
  if (row.length !== headers.length) return undefined
  const byName = Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() ?? '']))

  const latitudeSource = parseFiniteNumber(byName.latitude ?? '')
  const longitudeSource = parseFiniteNumber(byName.longitude ?? '')
  const brightnessSource = parseFiniteNumber(byName.bright_ti4 ?? byName.brightness ?? '')
  if (!latitudeSource.ok || !longitudeSource.ok || !brightnessSource.ok) return undefined

  const latitude = latitudeSource.value
  const longitude = longitudeSource.value
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined
  if (latitude < bounds.south || latitude > bounds.north || longitude < bounds.west || longitude > bounds.east) return undefined

  const acquiredAt = parseAcqTimestamp(byName.acq_date ?? '', byName.acq_time ?? '')
  if (!acquiredAt) return undefined

  const scanSource = parseFiniteNumber(byName.scan ?? '')
  const trackSource = parseFiniteNumber(byName.track ?? '')
  const scan = scanSource.ok ? scanSource.value : 0
  const track = trackSource.ok ? trackSource.value : 0

  const frpSource = parseFiniteNumber(byName.frp ?? '')
  const frp = frpSource.ok ? frpSource.value : null

  return {
    latitude,
    longitude,
    brightnessK: brightnessSource.value,
    scan,
    track,
    acquiredAt,
    satellite: byName.satellite !== '' ? byName.satellite : 'unknown',
    instrument: byName.instrument !== '' ? byName.instrument : 'unknown',
    confidence: classifyConfidence(byName.confidence ?? ''),
    frp,
    dayNight: (byName.daynight ?? '').toUpperCase() === 'N' ? 'night' : 'day',
  }
}

export const parseFirmsCsv = (
  payload: string,
  bounds: FirmsBoundingBox,
): { detections: FireDetection[]; observedAt: string } => {
  const [headerLine, ...bodyLines] = payload.split(/\r?\n/).filter((line) => line.trim() !== '')
  const headers = (headerLine ?? '').split(',').map((header) => header.trim())
  if (!headers.includes('latitude') || !headers.includes('longitude')) throw new Error('Invalid FIRMS response')

  const detections: FireDetection[] = []
  let observedAt = ''
  for (const line of bodyLines) {
    const detection = parseRow(headers, line.split(','), bounds)
    if (!detection) continue
    detections.push(detection)
    if (detection.acquiredAt > observedAt) observedAt = detection.acquiredAt
  }
  if (detections.length === 0) return { detections, observedAt: '' }
  return { detections, observedAt }
}

export const createFirmsProvider = (
  options: { mapKey: string; source?: string; minConfidence?: ConfidenceBand },
  fetcher: typeof fetch = createFetchWithRetry(),
  timeoutMs = firmsRequestTimeoutMs,
): FirmsProvider => ({
  async getFireDetections(bounds, requestedDayRange) {
    const dayRange = clampDayRange(requestedDayRange)
    const coordinates = [bounds.west, bounds.south, bounds.east, bounds.north]
      .map((value) => value.toFixed(6))
      .join(',')
    const source = options.source ?? defaultFirmsSource
    const url = new URL(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${options.mapKey}/${source}/${coordinates}/${dayRange}`)

    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`FIRMS request failed (${response.status})`)
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      throw new Error('Empty FIRMS response')
    }

    const payload = await response.text()
    const { detections, observedAt } = parseFirmsCsv(payload, bounds)
    const filtered = detections
      .filter((detection) => atLeastConfidence(detection.confidence, options.minConfidence))
      .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt))
    return {
      // Zero detections is a valid "no active fires" result, not an error; a request
      // timestamp stands in for the observation time so the overlay can still be fresh.
      detections: filtered,
      observedAt: observedAt || new Date().toISOString(),
    }
  },
})
