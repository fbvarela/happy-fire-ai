// Geocoding via OpenStreetMap Nominatim, no API key required.
// Docs: https://nominatim.org/release-docs/latest/api/Search/
// Usage policy requires a descriptive User-Agent and light request rates.
export type GeocodingResult = {
  latitude: number
  longitude: number
  label: string
  source: 'nominatim' | 'mock'
}

export type GeocodingProvider = {
  search(query: string): Promise<GeocodingResult[]>
}

type NominatimSearchResponse = Array<{
  lat?: unknown
  lon?: unknown
  display_name?: unknown
}>

export const nominatimGeocodingTimeoutMs = 15_000

const toCoordinate = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

export const createNominatimGeocodingProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = nominatimGeocodingTimeoutMs,
): GeocodingProvider => ({
  async search(query) {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.search = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '5',
    }).toString()
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'happy-fire-ai risk dashboard (location search)' },
    })
    if (!response.ok) throw new Error(`Nominatim geocoding request failed (${response.status})`)
    const payload = await response.json() as NominatimSearchResponse
    if (!Array.isArray(payload)) throw new Error('Invalid Nominatim geocoding response')
    const results: GeocodingResult[] = []
    for (const entry of payload) {
      const latitude = toCoordinate(entry.lat)
      const longitude = toCoordinate(entry.lon)
      if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new Error('Invalid Nominatim geocoding response')
      }
      if (typeof entry.display_name !== 'string' || entry.display_name.trim() === '') {
        throw new Error('Invalid Nominatim geocoding response')
      }
      results.push({ latitude, longitude, label: entry.display_name, source: 'nominatim' })
    }
    return results
  },
})

// Deterministic stand-in so the feature works without any provider configured.
// Results are clearly labelled as mock; coordinates are stable for a given query.
export const createMockGeocodingProvider = (): GeocodingProvider => ({
  async search(query) {
    let hash = 0
    for (let index = 0; index < query.length; index += 1) {
      hash = (hash * 31 + query.charCodeAt(index)) % 100_000_000
    }
    const latitude = Math.round(((hash % 16_000) / 16_000 * 170 - 85) * 10_000) / 10_000
    const longitude = Math.round(((Math.floor(hash / 16_000) % 35_000) / 35_000 * 360 - 180) * 10_000) / 10_000
    return [{ latitude, longitude, label: `${query} (deterministic mock match)`, source: 'mock' }]
  },
})
