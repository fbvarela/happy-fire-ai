// Flood via the Open-Meteo Flood API (Copernicus GloFAS river discharge), no API key
// required. Docs: https://open-meteo.com/en/docs/flood-api
export type FloodProvider = {
  getFlood(latitude: number, longitude: number): Promise<{
    riverDischargeM3s: number
    baselineDischargeM3s: number | null
    source: 'open-meteo'
    observedAt: string
  }>
}

type OpenMeteoFloodResponse = {
  daily?: {
    time?: unknown
    river_discharge?: unknown
  }
}

export const openMeteoFloodTimeoutMs = 15_000
const pastDays = 30

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

const median = (values: number[]) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export const createOpenMeteoFloodProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = openMeteoFloodTimeoutMs,
): FloodProvider => ({
  async getFlood(latitude, longitude) {
    const url = new URL('https://flood-api.open-meteo.com/v1/flood')
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: 'river_discharge',
      past_days: String(pastDays),
      forecast_days: '1',
    }).toString()
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`Open-Meteo flood request failed (${response.status})`)
    const payload = await response.json() as OpenMeteoFloodResponse
    const time = payload.daily?.time
    const discharge = payload.daily?.river_discharge
    if (!Array.isArray(time) || !Array.isArray(discharge) || time.length !== discharge.length || time.length < 2 ||
        !discharge.every(isNullableNumber)) {
      throw new Error('Invalid Open-Meteo flood response')
    }
    const current = discharge[discharge.length - 1]
    if (current === null) throw new Error('Open-Meteo flood response has no current discharge')
    const baseline = median(discharge.slice(0, -1).filter((value): value is number => value !== null))
    return {
      riverDischargeM3s: current,
      baselineDischargeM3s: baseline,
      source: 'open-meteo',
      observedAt: new Date(`${String(time[time.length - 1])}T00:00:00Z`).toISOString(),
    }
  },
})
