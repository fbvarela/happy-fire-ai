export type PopulationProvider = {
  getNearbyPeople(latitude: number, longitude: number): Promise<{
    nearbyPeople: number
    source: 'worldpop'
  }>
}

type WorldPopResponse = {
  status?: unknown
  error?: unknown
  taskid?: unknown
  data?: { total_population?: unknown }
}

const normalizeLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180
const clampLatitude = (latitude: number) => Math.max(-90, Math.min(90, latitude))
const isTaskId = (value: unknown): value is string | number =>
  (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isFinite(value))
const getPopulation = (payload: WorldPopResponse) => {
  const totalPopulation = payload.data?.total_population
  if (
    payload.status !== 'finished' || payload.error !== false ||
    typeof totalPopulation !== 'number' || !Number.isFinite(totalPopulation) || totalPopulation < 0
  ) {
    throw new Error('Invalid WorldPop response')
  }
  return totalPopulation
}

const polygonAround = (latitude: number, longitude: number) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) >= 89.5) {
    throw new Error('WorldPop local window is unavailable near the poles')
  }
  const boundedLatitude = clampLatitude(latitude)
  const boundedLongitude = normalizeLongitude(longitude)
  if (Math.abs(boundedLongitude) >= 179.5) {
    throw new Error('WorldPop local window is unavailable near the antimeridian')
  }
  const radiusKm = 1
  const metersPerDegree = 111_320
  const latitudeOffset = radiusKm * 1000 / metersPerDegree
  const longitudeOffset = radiusKm * 1000 / (metersPerDegree * Math.max(Math.abs(Math.cos(boundedLatitude * Math.PI / 180)), 1e-6))
  const coordinates = [
    [boundedLongitude - longitudeOffset, boundedLatitude - latitudeOffset],
    [boundedLongitude + longitudeOffset, boundedLatitude - latitudeOffset],
    [boundedLongitude + longitudeOffset, boundedLatitude + latitudeOffset],
    [boundedLongitude - longitudeOffset, boundedLatitude + latitudeOffset],
    [boundedLongitude - longitudeOffset, boundedLatitude - latitudeOffset],
  ].map(([pointLongitude, pointLatitude]) => [
    normalizeLongitude(pointLongitude),
    clampLatitude(pointLatitude),
  ])

  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }],
  }
}

export const createWorldPopPopulationProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
  apiKey = process.env.WORLDPOP_API_KEY,
  pollIntervalMs = 1_000,
  maxPollMs = 10_000,
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

    let payload = await response.json() as WorldPopResponse
    if (payload.status === 'finished') {
      return { nearbyPeople: getPopulation(payload), source: 'worldpop' }
    }
    if (payload.status !== 'created' || !isTaskId(payload.taskid)) throw new Error('Invalid WorldPop response')

    const deadline = Date.now() + maxPollMs
    while (true) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw new Error('WorldPop task polling timed out')
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)))
      const pollRemainingMs = deadline - Date.now()
      if (pollRemainingMs <= 0) throw new Error('WorldPop task polling timed out')

      const taskUrl = new URL(`https://api.worldpop.org/v1/tasks/${encodeURIComponent(String(payload.taskid))}`)
      if (apiKey) taskUrl.searchParams.set('key', apiKey)
      const taskResponse = await fetcher(taskUrl, { signal: AbortSignal.timeout(Math.min(timeoutMs, pollRemainingMs)) })
      if (!taskResponse.ok) throw new Error(`WorldPop request failed (${taskResponse.status})`)
      payload = await taskResponse.json() as WorldPopResponse
      if (payload.status === 'finished') {
        return { nearbyPeople: getPopulation(payload), source: 'worldpop' }
      }
      if (payload.status === 'failed' || payload.status === 'error') throw new Error('WorldPop task failed')
      if (payload.status !== 'created') throw new Error('Invalid WorldPop response')
    }
  },
})
