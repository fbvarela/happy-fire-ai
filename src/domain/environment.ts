export type DataStatus = 'available' | 'missing' | 'stale' | 'error'
export type DataSource = 'mock' | 'open-meteo'
export type CacheStatus = 'hit' | 'miss' | 'fallback'

export type HazardId = 'wildfire' | 'radioactivity' | 'water-pollution' | 'radon' | 'flood' | 'air-quality'
export type HazardGroupId = 'environmental' | 'geological' | 'radiation'

// Real data sources wired into the providers. `mock` is the deterministic fallback.
export type RadioactivitySource = 'mock' | 'bfs' | 'safecast'
export type WaterPollutionSource = 'mock' | 'eea-bathing' | 'eea-pfas'
export type RadonSource = 'mock' | 'epa-ie'
export type FloodSource = 'mock' | 'open-meteo'
export type AirQualitySource = 'mock' | 'open-meteo'

// Hazard-specific context blocks, shaped around the real metrics each provider exposes.
// All are optional so existing wildfire contexts remain valid; a missing block is treated
// exactly like missing data (never as safe).
export type RadioactivityContext = {
  /** Ambient gamma dose rate in µSv/h (BfS ODL network / Safecast). */
  doseRateUsvH: number | null
  status: DataStatus
  source: RadioactivitySource
  observedAt: string
  warning?: string
}
export type WaterPollutionContext = {
  /** Normalized 0–100 pollution index derived from the provider (higher = worse). */
  qualityIndex: number | null
  /** Provider classification label, e.g. "Excellent" (bathing water) or "PFOS 12 ng/L". */
  qualityLabel: string | null
  status: DataStatus
  source: WaterPollutionSource
  observedAt: string
  warning?: string
}
export type RadonContext = {
  /** Normalized 0–100 radon risk index derived from the national risk class (higher = worse). */
  radonRiskIndex: number | null
  /** Provider classification label, e.g. "About 1 in 10 homes ... high radon levels". */
  riskLabel: string | null
  status: DataStatus
  source: RadonSource
  observedAt: string
  warning?: string
}
export type FloodContext = {
  /** Daily river discharge in m³/s (Open-Meteo GloFAS). */
  riverDischargeM3s: number | null
  /** Baseline discharge (median of the trailing window) used to score the anomaly. */
  baselineDischargeM3s: number | null
  status: DataStatus
  source: FloodSource
  observedAt: string
  warning?: string
}
export type AirQualityContext = {
  pm25: number | null
  pm10: number | null
  no2: number | null
  o3: number | null
  /** European AQI (Open-Meteo/CAMS). */
  europeanAqi: number | null
  status: DataStatus
  source: AirQualitySource
  observedAt: string
  warning?: string
}
export type RoadClosure = {
  id: string
  roadName: string
  status: 'closed'
  latitude: number
  longitude: number
  validFrom: string
}
export type ManualRiskInputs = {
  localFestivalPressure?: number | null
  roadsideMaintenance?: number | null
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
  localFestivalPressure?: number | null
  roadsideMaintenance?: number | null
  roadClosures?: RoadClosure[]
  roadClosureSource?: 'dgt'
  roadClosureObservedAt?: string
  roadClosureWarning?: string
  radioactivity?: RadioactivityContext
  waterPollution?: WaterPollutionContext
  radon?: RadonContext
  flood?: FloodContext
  airQuality?: AirQualityContext
}
