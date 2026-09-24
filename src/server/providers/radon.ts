// Radon from a national risk map exposed as OGC WFS. Open data, no key.
//  - Ireland EPA "Radon Risk Map of Ireland" (CC-BY), GeoServer WFS, GeoJSON output.
//    https://gis.epa.ie/geoserver/EPA/ows  layer: EPA:RadonRiskMapofIreland
// Other countries publish equivalent maps (e.g. BGS/UKHSA WMS for Great Britain); add
// adapters here and select them via RADON_PROVIDER.
export type RadonProvider = {
  getRadon(latitude: number, longitude: number): Promise<{
    radonRiskIndex: number
    riskLabel: string
    source: 'epa-ie'
    observedAt: string
  }>
}

export const radonRequestTimeoutMs = 15_000
// The Ireland EPA map was published 2022-05-05 and is a static classification.
const epaRadonObservedAt = '2022-05-05T00:00:00.000Z'
// "about 1 in N homes above the reference level": map the fraction to 0-100, saturating at
// 20% (a well-known high-risk threshold).
const maxRiskFraction = 0.2

type GeoJsonResponse = {
  features?: Array<{ properties?: { Risk?: unknown } }>
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value))

// Parses labels such as "About 1 in 10 homes in this area is likely to have high radon
// levels" or "less than 1 in 100 ...".
export const riskFractionFromLabel = (label: string): number | null => {
  const match = label.match(/1\s+in\s+(\d+)/i)
  if (!match) return null
  const denominator = Number(match[1])
  if (!Number.isFinite(denominator) || denominator <= 0) return null
  return 1 / denominator
}

const bboxAround = (latitude: number, longitude: number, delta = 0.25) => [
  Math.max(-180, longitude - delta),
  Math.max(-90, latitude - delta),
  Math.min(180, longitude + delta),
  Math.min(90, latitude + delta),
].join(',')

export const createEpaRadonProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = radonRequestTimeoutMs,
): RadonProvider => ({
  async getRadon(latitude, longitude) {
    const url = new URL('https://gis.epa.ie/geoserver/EPA/ows')
    url.search = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName: 'EPA:RadonRiskMapofIreland',
      outputFormat: 'application/json',
      count: '1',
      bbox: `${bboxAround(latitude, longitude)},EPSG:4326`,
    }).toString()
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`EPA radon request failed (${response.status})`)
    const payload = await response.json() as GeoJsonResponse
    const risk = payload.features?.[0]?.properties?.Risk
    if (typeof risk !== 'string') throw new Error('No EPA radon classification found for this location')
    const fraction = riskFractionFromLabel(risk)
    return {
      radonRiskIndex: fraction === null ? 50 : clamp(fraction / maxRiskFraction * 100),
      riskLabel: risk,
      source: 'epa-ie',
      observedAt: epaRadonObservedAt,
    }
  },
})
