export type DataStatus = 'available' | 'missing' | 'stale' | 'error'
export type DataSource = 'mock' | 'open-meteo'
export type CacheStatus = 'hit' | 'miss' | 'fallback'

export type EnvironmentalContext = {
  latitude: number
  longitude: number
  observedAt: string
  status: DataStatus
  source: DataSource
  cacheStatus: CacheStatus
  weather: {
    temperatureC: number | null
    humidity: number | null
    precipitationMm24h: number | null
    windKph: number | null
    windDirectionDeg: number | null
  }
  terrain: {
    slopeDeg: number | null
    elevationM: number | null
  }
  fuel: {
    vegetationDryness: number | null
  }
  exposure: {
    nearbyPeople: number | null
  }
  seasonWeatherProxy: number | null
}
