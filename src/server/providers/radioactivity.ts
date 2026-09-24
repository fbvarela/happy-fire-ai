// Radioactivity from real ambient gamma dose-rate networks. Two selectable providers:
//  - BfS ODL-Info (Germany): WFS GeoJSON, dose rate already in µSv/h, no key.
//    https://odlinfo.bfs.de  (endpoint: https://www.imis.bfs.de/ogc/opendata/ows)
//  - Safecast (global citizen-science): REST JSON in CPM, no key.
//    https://api.safecast.org
export type RadioactivityProvider = {
  getRadioactivity(latitude: number, longitude: number): Promise<{
    doseRateUsvH: number
    source: 'bfs' | 'safecast'
    observedAt: string
  }>
}

export const radioactivityRequestTimeoutMs = 15_000
// Safecast reports counts per minute; bGeigie-class sensors are calibrated at roughly
// 350 CPM per µSv/h.
export const safecastCpmPerUsvH = 350

type BfsFeatureCollection = {
  features?: Array<{
    geometry?: { coordinates?: unknown }
    properties?: { value?: unknown; end_measure?: unknown }
  }>
}

type SafecastMeasurement = {
  value?: unknown
  unit?: unknown
  captured_at?: unknown
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const nearest = <T extends { geometry?: { coordinates?: unknown } }>(
  features: T[],
  latitude: number,
  longitude: number,
): T | undefined => {
  let best: T | undefined
  let bestDistance = Infinity
  for (const feature of features) {
    const coordinates = feature.geometry?.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue
    const [featureLongitude, featureLatitude] = coordinates
    if (!isFiniteNumber(featureLongitude) || !isFiniteNumber(featureLatitude)) continue
    const distance = (featureLongitude - longitude) ** 2 + (featureLatitude - latitude) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = feature
    }
  }
  return best
}

const bboxAround = (latitude: number, longitude: number, delta = 0.5) => [
  Math.max(-180, longitude - delta),
  Math.max(-90, latitude - delta),
  Math.min(180, longitude + delta),
  Math.min(90, latitude + delta),
].join(',')

export const createBfsRadioactivityProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = radioactivityRequestTimeoutMs,
): RadioactivityProvider => ({
  async getRadioactivity(latitude, longitude) {
    const url = new URL('https://www.imis.bfs.de/ogc/opendata/ows')
    url.search = new URLSearchParams({
      service: 'WFS',
      version: '1.1.0',
      request: 'GetFeature',
      typeName: 'opendata:odlinfo_odl_1h_latest',
      outputFormat: 'application/json',
      bbox: `${bboxAround(latitude, longitude)},EPSG:4326`,
      maxFeatures: '25',
    }).toString()
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`BfS ODL request failed (${response.status})`)
    const payload = await response.json() as BfsFeatureCollection
    const feature = nearest(payload.features ?? [], latitude, longitude)
    const value = feature?.properties?.value
    const endMeasure = feature?.properties?.end_measure
    if (!isFiniteNumber(value) || value < 0 || value > 100 || typeof endMeasure !== 'string') {
      throw new Error('No BfS ODL station found for this location')
    }
    return {
      doseRateUsvH: value,
      source: 'bfs',
      observedAt: new Date(endMeasure).toISOString(),
    }
  },
})

export const createSafecastRadioactivityProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = radioactivityRequestTimeoutMs,
  radiusMeters = 100_000,
  windowDays = 730,
): RadioactivityProvider => ({
  async getRadioactivity(latitude, longitude) {
    const url = new URL('https://api.safecast.org/measurements.json')
    // Safecast's `distance` is in meters; `captured_after` biases the page toward recent
    // readings (the API does not support server-side ordering).
    const capturedAfter = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      distance: String(radiusMeters),
      captured_after: capturedAfter,
      per_page: '100',
    }).toString()
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`Safecast request failed (${response.status})`)
    const payload = await response.json() as SafecastMeasurement[]
    if (!Array.isArray(payload)) throw new Error('Invalid Safecast response')
    const measurements = payload
      .filter((entry): entry is { value: number; unit: string; captured_at: string } =>
        isFiniteNumber(entry.value) && entry.value >= 0 && entry.unit === 'cpm' && typeof entry.captured_at === 'string')
      .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at))
    const measurement = measurements[0]
    if (!measurement) throw new Error('No recent Safecast measurement found for this location')
    return {
      doseRateUsvH: Math.round(measurement.value / safecastCpmPerUsvH * 1000) / 1000,
      source: 'safecast',
      observedAt: new Date(measurement.captured_at).toISOString(),
    }
  },
})
