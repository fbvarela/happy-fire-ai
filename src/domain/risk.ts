import type { DataStatus, EnvironmentalContext } from './environment'

export type RiskFactor = {
  id: string
  label: string
  contribution: number
  status: DataStatus
}

export type RiskResult = {
  score: number
  level: 'low' | 'moderate' | 'high' | 'extreme'
  confidence: number
  modelVersion: 'mvp-2'
  factors: RiskFactor[]
}

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value))

const round = (value: number) => Math.round(value * 10) / 10

const average = (values: Array<number | null>) => {
  const available = values.filter((value): value is number => value !== null)
  return available.length === 0
    ? 50
    : available.reduce((sum, value) => sum + value, 0) / available.length
}

const factorStatus = (contextStatus: DataStatus, values: Array<number | null>): DataStatus => {
  if (contextStatus !== 'available') return contextStatus
  return values.some((value) => value === null) ? 'missing' : 'available'
}

const riskLevel = (score: number): RiskResult['level'] => {
  if (score < 25) return 'low'
  if (score < 50) return 'moderate'
  if (score < 75) return 'high'
  return 'extreme'
}

export function calculateRisk(context: EnvironmentalContext): RiskResult {
  // Fixed MVP-2 weights: weather 30%, terrain 20%, fuel 20%, season/weather history 10%, exposure 10%, events 5%, maintenance 5%.
  const weatherValues = [
    context.weather.temperatureC,
    context.weather.humidity,
    context.weather.precipitationMm24h,
    context.weather.windKph,
    context.weather.windDirectionDeg,
  ]
  const terrainValues = [context.terrain.slopeDeg, context.terrain.elevationM]
  const fuelValues = [context.fuel.vegetationDryness]
  const seasonValues = [context.seasonWeatherProxy]
  const exposureValues = [context.exposure.nearbyPeople]
  const eventValues = [context.localFestivalPressure ?? null]
  const maintenanceValues = [context.roadsideMaintenance ?? null]
  const inputGroups = [weatherValues, terrainValues, fuelValues, seasonValues, exposureValues, eventValues, maintenanceValues]

  const weather = average([
    context.weather.temperatureC === null ? null : clamp((context.weather.temperatureC - 20) * 4),
    context.weather.humidity === null ? null : clamp(100 - context.weather.humidity),
    context.weather.precipitationMm24h === null
      ? null
      : clamp(100 - context.weather.precipitationMm24h * 2),
    context.weather.windKph === null ? null : clamp(context.weather.windKph * 1.25),
  ])
  const terrain = average([
    context.terrain.slopeDeg === null ? null : clamp(context.terrain.slopeDeg * (100 / 45)),
  ])
  const fuel = average([
    context.fuel.vegetationDryness === null ? null : clamp(context.fuel.vegetationDryness),
  ])
  const season = average([
    context.seasonWeatherProxy === null ? null : clamp(context.seasonWeatherProxy),
  ])
  const exposure = average([
    context.exposure.nearbyPeople === null
      ? null
      : clamp(context.exposure.nearbyPeople / 10),
  ])
  const events = average(eventValues.map((value) => value === null ? null : clamp(value)))
  const maintenance = average(maintenanceValues.map((value) => value === null ? null : clamp(100 - value)))

  const factors: RiskFactor[] = [
    {
      id: 'weather',
      label: 'Weather',
      contribution: round(weather * 0.3),
      status: factorStatus(context.status, weatherValues),
    },
    {
      id: 'terrain',
      label: 'Terrain',
      contribution: round(terrain * 0.2),
      status: factorStatus(context.status, terrainValues),
    },
    {
      id: 'fuel',
      label: 'Fuel',
      contribution: round(fuel * 0.2),
      status: factorStatus(context.status, fuelValues),
    },
    {
      id: 'season-weather',
      label: 'Season/weather history',
      contribution: round(season * 0.1),
      status: factorStatus(context.status, seasonValues),
    },
    {
      id: 'exposure',
      label: 'Exposure',
      contribution: round(exposure * 0.1),
      status: factorStatus(context.status, exposureValues),
    },
    {
      id: 'local-events',
      label: 'Local festivals/events',
      contribution: round(events * 0.05),
      status: factorStatus(context.status, eventValues),
    },
    {
      id: 'roadside-maintenance',
      label: 'Roadside maintenance',
      contribution: round(maintenance * 0.05),
      status: factorStatus(context.status, maintenanceValues),
    },
  ]

  const score = round(clamp(factors.reduce((sum, factor) => sum + factor.contribution, 0)))
  const totalInputs = inputGroups.reduce((count, values) => count + values.length, 0)
  const confidencePenalty =
    context.status === 'available'
      ? inputGroups.reduce(
          (penalty, values) =>
            penalty + values.filter((value) => value === null).length * 6,
          0,
        )
      : totalInputs * (context.status === 'missing' ? 6 : 10)
  const confidence = clamp(100 - confidencePenalty)

  return {
    score,
    level: riskLevel(score),
    confidence,
    modelVersion: 'mvp-2',
    factors,
  }
}
