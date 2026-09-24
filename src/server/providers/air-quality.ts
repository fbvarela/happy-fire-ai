// Air quality via the Open-Meteo Air Quality API (Copernicus CAMS), no API key required.
// Docs: https://open-meteo.com/en/docs/air-quality-api
export type AirQualityProvider = {
  getAirQuality(latitude: number, longitude: number): Promise<{
    pm25: number | null
    pm10: number | null
    no2: number | null
    o3: number | null
    europeanAqi: number | null
    source: 'open-meteo'
    observedAt: string
  }>
}

type OpenMeteoAirQualityResponse = {
  current?: {
    time?: unknown
    pm2_5?: unknown
    pm10?: unknown
    nitrogen_dioxide?: unknown
    ozone?: unknown
    european_aqi?: unknown
  }
}

export const openMeteoAirQualityTimeoutMs = 15_000

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

export const createOpenMeteoAirQualityProvider = (
  fetcher: typeof fetch = fetch,
  timeoutMs = openMeteoAirQualityTimeoutMs,
): AirQualityProvider => ({
  async getAirQuality(latitude, longitude) {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality')
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'pm2_5,pm10,nitrogen_dioxide,ozone,european_aqi',
      timezone: 'GMT',
    }).toString()
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`Open-Meteo air-quality request failed (${response.status})`)
    const payload = await response.json() as OpenMeteoAirQualityResponse
    const current = payload.current
    if (!current || typeof current.time !== 'string' ||
        !isNullableNumber(current.pm2_5) || !isNullableNumber(current.pm10) ||
        !isNullableNumber(current.nitrogen_dioxide) || !isNullableNumber(current.ozone) ||
        !isNullableNumber(current.european_aqi)) {
      throw new Error('Invalid Open-Meteo air-quality response')
    }
    return {
      pm25: current.pm2_5,
      pm10: current.pm10,
      no2: current.nitrogen_dioxide,
      o3: current.ozone,
      europeanAqi: current.european_aqi,
      source: 'open-meteo',
      observedAt: new Date(`${current.time}Z`).toISOString(),
    }
  },
})
