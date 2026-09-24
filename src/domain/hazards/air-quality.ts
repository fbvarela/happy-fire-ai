import type { EnvironmentalContext } from '../environment'
import { averageMetricRisk, baseHazardResult, clamp, type HazardScoreResult } from './types'

// Pollutant ceilings follow typical European air-quality scales (µg/m³): PM2.5 75,
// PM10 150, NO₂ 200, O₃ 240. The European AQI is already 0–100+ (Open-Meteo/CAMS).
const pm25Risk = (pm25: number) => clamp(pm25 / 75 * 100)
const pm10Risk = (pm10: number) => clamp(pm10 / 150 * 100)
const no2Risk = (no2: number) => clamp(no2 / 200 * 100)
const o3Risk = (o3: number) => clamp(o3 / 240 * 100)
const aqiRisk = (aqi: number) => clamp(aqi)

export function calculateAirQualityRisk(context: EnvironmentalContext): HazardScoreResult {
  const data = context.airQuality
  const status = data?.status ?? 'missing'
  const source = data?.source ?? 'mock'
  const values = [
    data?.pm25 ?? null,
    data?.pm10 ?? null,
    data?.no2 ?? null,
    data?.o3 ?? null,
    data?.europeanAqi ?? null,
  ]
  const score = averageMetricRisk([
    data?.pm25 === null || data?.pm25 === undefined ? null : pm25Risk(data.pm25),
    data?.pm10 === null || data?.pm10 === undefined ? null : pm10Risk(data.pm10),
    data?.no2 === null || data?.no2 === undefined ? null : no2Risk(data.no2),
    data?.o3 === null || data?.o3 === undefined ? null : o3Risk(data.o3),
    data?.europeanAqi === null || data?.europeanAqi === undefined ? null : aqiRisk(data.europeanAqi),
  ])
  return baseHazardResult('air-quality', source, status, values, score)
}
