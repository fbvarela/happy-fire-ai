export type DataStatus = 'available' | 'missing' | 'stale' | 'error'
export type DataSource = 'mock' | 'open-meteo'
export type CacheStatus = 'hit' | 'miss' | 'fallback'
export type RoadClosure = {
  id: string
  roadName: string
  status: 'closed'
  latitude: number
  longitude: number
  validFrom: string
}

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
  fuelSource: 'mock' | 'copernicus'
  fuelWarning?: string
  exposureSource: 'mock' | 'worldpop'
  exposureWarning?: string
  exposure: {
    nearbyPeople: number | null
  }
  seasonWeatherProxy: number | null
  roadClosures?: RoadClosure[]
  roadClosureObservedAt?: string
  roadClosureWarning?: string
}
