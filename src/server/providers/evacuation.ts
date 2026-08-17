import type { RoadClosure } from '../../domain/environment'

export type RoadClosureProvider = {
  getNearbyClosures(latitude: number, longitude: number): Promise<{
    closures: RoadClosure[]
    source: 'dgt'
    sourceTimestamp: string
  }>
}

const dgtFeedUrl = 'https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml'
const maxDistanceKm = 10
const defaultMaxAgeMs = 5 * 60 * 1000
const closureTypes = new Set(['roadClosed', 'bridgeClosed', 'tunnelClosed'])

const firstTag = (xml: string, name: string) => {
  const match = xml.match(new RegExp(`<[^>]*:?${name}\\b[^>]*>([^<]*)</[^>]*:?${name}>`))
  return match?.[1]?.trim() ?? null
}

const parseFinite = (value: string | null) => {
  const parsed = value === null ? NaN : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const distanceKm = (latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) => {
  const radians = Math.PI / 180
  const latitudeDelta = (latitudeB - latitudeA) * radians
  const longitudeDelta = (longitudeB - longitudeA) * radians
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA * radians) * Math.cos(latitudeB * radians) * Math.sin(longitudeDelta / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const isoDate = (value: string | null, field: string) => {
  const timestamp = value === null ? NaN : Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error(`Invalid DGT ${field}`)
  return new Date(timestamp).toISOString()
}

export const parseDgtRoadClosures = (
  xml: string,
  latitude: number,
  longitude: number,
  now = Date.now(),
  maxAgeMs = defaultMaxAgeMs,
) => {
  const sourceTimestamp = isoDate(firstTag(xml, 'publicationTime'), 'publication time')
  const ageMs = now - Date.parse(sourceTimestamp)
  if (ageMs < -maxAgeMs || ageMs > maxAgeMs) throw new Error('DGT feed is stale')

  const closures: RoadClosure[] = []
  const records = xml.match(/<[^>]*:?situationRecord\b[^>]*>[\s\S]*?<\/[^>]*:?situationRecord>/g) ?? []
  for (const record of records) {
    const status = firstTag(record, 'validityStatus')
    const type = firstTag(record, 'roadOrCarriagewayOrLaneManagementType')
    const roadName = firstTag(record, 'roadName')
    const recordId = record.match(/\bid="([^"]+)"/)?.[1] ?? null
    const latitudeValue = parseFinite(firstTag(record, 'latitude'))
    const longitudeValue = parseFinite(firstTag(record, 'longitude'))
    if (status !== 'active' || !type || !closureTypes.has(type) || !roadName || !recordId || latitudeValue === null || longitudeValue === null) continue
    if (latitudeValue < -90 || latitudeValue > 90 || longitudeValue < -180 || longitudeValue > 180) continue
    if (distanceKm(latitude, longitude, latitudeValue, longitudeValue) > maxDistanceKm) continue

    closures.push({
      id: recordId,
      roadName,
      status: 'closed',
      latitude: latitudeValue,
      longitude: longitudeValue,
      validFrom: isoDate(firstTag(record, 'overallStartTime'), 'validity start time'),
    })
  }

  return { sourceTimestamp, closures }
}

export const createDgtRoadClosureProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): RoadClosureProvider => ({
  async getNearbyClosures(latitude, longitude) {
    const response = await fetcher(dgtFeedUrl, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`DGT request failed (${response.status})`)
    const parsed = parseDgtRoadClosures(await response.text(), latitude, longitude)
    return { ...parsed, source: 'dgt' }
  },
})
