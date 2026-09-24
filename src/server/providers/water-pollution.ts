// Water pollution from the EEA "Discomap" OGC/ArcGIS services, no key required.
//  - Bathing-water quality (Europe-wide, 20k+ sites): annual classification.
//    https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM/MapServer
//  - PFAS monitoring concentrations (sparser, station points, ng/L or µg/L).
//    https://water.discomap.eea.europa.eu/arcgis/rest/services/PFAS/PFAS_all/MapServer
export type WaterPollutionProvider = {
  getWaterPollution(latitude: number, longitude: number): Promise<{
    qualityIndex: number
    qualityLabel: string
    source: 'eea-bathing' | 'eea-pfas'
    observedAt: string
  }>
}

export const eeaWaterRequestTimeoutMs = 15_000
const bathingSearchRadiusM = 50_000
const pfasSearchRadiusM = 100_000
// EU classification -> 0-100 pollution index (higher = worse).
const bathingQualityIndex: Record<string, number> = {
  excellent: 0,
  good: 25,
  sufficient: 55,
  poor: 100,
}
// EU Drinking Water Directive limit for the sum of PFAS is 100 ng/L; a single compound at
// that level saturates the scale.
const pfasReferenceNgL = 100

type ArcGisResponse = {
  features?: Array<{ attributes?: Record<string, unknown> }>
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value))

const pointGeometry = (latitude: number, longitude: number) =>
  JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } })

export const createEeaBathingWaterProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = eeaWaterRequestTimeoutMs,
): WaterPollutionProvider => ({
  async getWaterPollution(latitude, longitude) {
    const url = new URL('https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM/MapServer/0/query')
    url.search = new URLSearchParams({
      geometry: pointGeometry(latitude, longitude),
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      distance: String(bathingSearchRadiusM),
      units: 'esriSRUnit_Meter',
      outFields: 'bathingWaterName,qualityStatus',
      returnGeometry: 'false',
      resultRecordCount: '1',
      f: 'json',
    }).toString()
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`EEA bathing-water request failed (${response.status})`)
    const payload = await response.json() as ArcGisResponse
    const attributes = payload.features?.[0]?.attributes
    const qualityStatus = typeof attributes?.qualityStatus === 'string' ? attributes.qualityStatus : null
    if (!qualityStatus) throw new Error('No EEA bathing-water site found for this location')
    const index = bathingQualityIndex[qualityStatus.toLowerCase()] ?? 50
    const name = typeof attributes?.bathingWaterName === 'string' ? attributes.bathingWaterName : 'Bathing water'
    return {
      qualityIndex: index,
      qualityLabel: `${name}: ${qualityStatus}`,
      source: 'eea-bathing',
      // Bathing-water quality is an annual classification; anchor freshness to the year.
      observedAt: `${new Date().getUTCFullYear()}-01-01T00:00:00.000Z`,
    }
  },
})

export const createEeaPfasProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = eeaWaterRequestTimeoutMs,
): WaterPollutionProvider => ({
  async getWaterPollution(latitude, longitude) {
    const url = new URL('https://water.discomap.eea.europa.eu/arcgis/rest/services/PFAS/PFAS_all/MapServer/0/query')
    url.search = new URLSearchParams({
      geometry: pointGeometry(latitude, longitude),
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      distance: String(pfasSearchRadiusM),
      units: 'esriSRUnit_Meter',
      outFields: 'resultObservedValue,resultUom,phenomenonTimeSamplingDate,observedPropertyDeterminandCode',
      returnGeometry: 'false',
      resultRecordCount: '10',
      f: 'json',
    }).toString()
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`EEA PFAS request failed (${response.status})`)
    const payload = await response.json() as ArcGisResponse
    const features = payload.features ?? []
    let best: { concentrationNgL: number; label: string; observedAt: string } | null = null
    for (const { attributes } of features) {
      const value = attributes?.resultObservedValue
      const unit = attributes?.resultUom
      const sampled = attributes?.phenomenonTimeSamplingDate
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || typeof unit !== 'string') continue
      const concentrationNgL = unit === 'ug/l' || unit === 'µg/l' ? value * 1000 : value
      const code = typeof attributes?.observedPropertyDeterminandCode === 'string'
        ? attributes.observedPropertyDeterminandCode
        : 'PFAS'
      if (!best || concentrationNgL > best.concentrationNgL) {
        best = {
          concentrationNgL,
          label: `${code} ${value} ${unit}`,
          observedAt: typeof sampled === 'string' ? new Date(sampled).toISOString() : `${new Date().getUTCFullYear()}-01-01T00:00:00.000Z`,
        }
      }
    }
    if (!best) throw new Error('No EEA PFAS monitoring result found for this location')
    return {
      qualityIndex: clamp(best.concentrationNgL / pfasReferenceNgL * 100),
      qualityLabel: best.label,
      source: 'eea-pfas',
      observedAt: best.observedAt,
    }
  },
})
