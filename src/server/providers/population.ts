export type PopulationProvider = {
  getNearbyPeople(latitude: number, longitude: number): Promise<{
    nearbyPeople: number
    source: 'worldpop'
  }>
}

type WorldPopResponse = {
  status?: unknown
  error?: unknown
  data?: { total_population?: unknown }
}

const normalizeLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180

const polygonAround = (latitude: number, longitude: number) => {
  const boundedLatitude = Math.max(-89.999, Math.min(89.999, latitude))
  const boundedLongitude = normalizeLongitude(longitude)
  const latitudeOffset = 0.01
  const longitudeOffset = 0.01 / Math.max(Math.cos(boundedLatitude * Math.PI / 180), 0.01)
  const coordinates = [
    [boundedLongitude - longitudeOffset, boundedLatitude - latitudeOffset],
    [boundedLongitude + longitudeOffset, boundedLatitude - latitudeOffset],
    [boundedLongitude + longitudeOffset, boundedLatitude + latitudeOffset],
    [boundedLongitude - longitudeOffset, boundedLatitude + latitudeOffset],
    [boundedLongitude - longitudeOffset, boundedLatitude - latitudeOffset],
  ]

  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }],
  }
}

export const createWorldPopPopulationProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
  apiKey = process.env.WORLDPOP_API_KEY,
): PopulationProvider => ({
  async getNearbyPeople(latitude, longitude) {
    const url = new URL('https://api.worldpop.org/v1/services/stats')
    url.search = new URLSearchParams({
      dataset: 'wpgppop',
      year: '2020',
      runasync: 'false',
      geojson: JSON.stringify(polygonAround(latitude, longitude)),
    }).toString()
    if (apiKey) url.searchParams.set('key', apiKey)

    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`WorldPop request failed (${response.status})`)

    const payload = await response.json() as WorldPopResponse
    const totalPopulation = payload.data?.total_population
    if (
      payload.status !== 'finished' || payload.error !== false ||
      typeof totalPopulation !== 'number' || !Number.isFinite(totalPopulation) || totalPopulation < 0
    ) {
      throw new Error('Invalid WorldPop response')
    }

    return { nearbyPeople: totalPopulation, source: 'worldpop' }
  },
})
