import type {
  AirQualityContext,
  DataStatus,
  EnvironmentalContext,
  FloodContext,
  RadonContext,
  RadioactivityContext,
  WaterPollutionContext,
} from '../domain/environment'
import { createOpenMeteoAirQualityProvider, type AirQualityProvider } from './providers/air-quality'
import { createOpenMeteoFloodProvider, type FloodProvider } from './providers/flood'
import { createEpaRadonProvider, type RadonProvider } from './providers/radon'
import {
  createBfsRadioactivityProvider,
  createSafecastRadioactivityProvider,
  type RadioactivityProvider,
} from './providers/radioactivity'
import {
  createEeaBathingWaterProvider,
  createEeaPfasProvider,
  type WaterPollutionProvider,
} from './providers/water-pollution'

// Multi-hazard context resolution. Each hazard is env-gated; when the provider is unset
// or fails, a deterministic mock context is used and a `*Warning` marks the fallback —
// never a silent success. Missing/stale/error data lowers confidence and is never
// treated as safe.

export type HazardProviderConfig = {
  radioactivity?: RadioactivityProvider
  waterPollution?: WaterPollutionProvider
  radon?: RadonProvider
  flood?: FloodProvider
  airQuality?: AirQualityProvider
}

export const hazardEnvGates = {
  radioactivity: 'RADIOACTIVITY_PROVIDER',
  'water-pollution': 'WATER_POLLUTION_PROVIDER',
  radon: 'RADON_PROVIDER',
  flood: 'FLOOD_PROVIDER',
  'air-quality': 'AIR_QUALITY_PROVIDER',
} as const

// Selects the concrete provider for each hazard from its env value. Unknown values fall
// back to the deterministic mock (handled by resolveHazardContexts when no provider is
// returned here).
export const getHazardProvidersFromEnv = (env: NodeJS.ProcessEnv = process.env): HazardProviderConfig => ({
  ...(env.RADIOACTIVITY_PROVIDER === 'bfs' ? { radioactivity: createBfsRadioactivityProvider() }
    : env.RADIOACTIVITY_PROVIDER === 'safecast' ? { radioactivity: createSafecastRadioactivityProvider() }
    : {}),
  ...(env.WATER_POLLUTION_PROVIDER === 'eea-bathing' ? { waterPollution: createEeaBathingWaterProvider() }
    : env.WATER_POLLUTION_PROVIDER === 'eea-pfas' ? { waterPollution: createEeaPfasProvider() }
    : {}),
  ...(env.RADON_PROVIDER === 'epa-ie' ? { radon: createEpaRadonProvider() } : {}),
  ...(env.FLOOD_PROVIDER === 'open-meteo' ? { flood: createOpenMeteoFloodProvider() } : {}),
  ...(env.AIR_QUALITY_PROVIDER === 'open-meteo' ? { airQuality: createOpenMeteoAirQualityProvider() } : {}),
})

// Mock hazard data shares the same fixed synthetic timestamp as the mock weather context,
// so the UI never reports mock data as "fresh" relative to wall-clock time.
const mockObservedAt = '2026-01-01T00:00:00.000Z'

export const getMockHazardContexts = (latitude: number, longitude: number) => {
  const latitudeSignal = Math.abs(latitude) % 1
  const longitudeSignal = Math.abs(longitude) % 1
  const timestamp = mockObservedAt

  const radioactivity: RadioactivityContext = {
    doseRateUsvH: Math.round((0.08 + latitudeSignal * 0.3) * 100) / 100,
    status: 'available',
    source: 'mock',
    observedAt: timestamp,
  }
  const waterPollution: WaterPollutionContext = {
    qualityIndex: Math.round((10 + latitudeSignal * 70) * 10) / 10,
    qualityLabel: 'Synthetic mock pollution index',
    status: 'available',
    source: 'mock',
    observedAt: timestamp,
  }
  const radon: RadonContext = {
    radonRiskIndex: Math.round((5 + longitudeSignal * 80) * 10) / 10,
    riskLabel: 'Synthetic mock radon risk',
    status: 'available',
    source: 'mock',
    observedAt: timestamp,
  }
  const baselineDischargeM3s = Math.round((2 + latitudeSignal * 3) * 100) / 100
  const flood: FloodContext = {
    riverDischargeM3s: Math.round(baselineDischargeM3s * (1 + longitudeSignal * 0.8) * 100) / 100,
    baselineDischargeM3s,
    status: 'available',
    source: 'mock',
    observedAt: timestamp,
  }
  const airQuality: AirQualityContext = {
    pm25: Math.round((5 + longitudeSignal * 60) * 10) / 10,
    pm10: Math.round((8 + latitudeSignal * 70) * 10) / 10,
    no2: Math.round((10 + longitudeSignal * 90) * 10) / 10,
    o3: Math.round((15 + latitudeSignal * 110) * 10) / 10,
    europeanAqi: Math.round((15 + longitudeSignal * 70) * 10) / 10,
    status: 'available',
    source: 'mock',
    observedAt: timestamp,
  }
  return { radioactivity, waterPollution, radon, flood, airQuality }
}

const fallbackWarning = (label: string, provider: string) =>
  `${provider} ${label} data was unavailable; deterministic mock data is shown.`

// Real-time feeds are marked stale when their observation is older than the threshold;
// annual/static maps (water classification, radon risk) are exempt because their vintage
// is inherent, not a feed failure.
const staleAfterMs: Partial<Record<'radioactivity' | 'flood' | 'air-quality', number>> = {
  radioactivity: 30 * 24 * 60 * 60 * 1000,
  flood: 3 * 24 * 60 * 60 * 1000,
  'air-quality': 2 * 24 * 60 * 60 * 1000,
}

const withFreshness = (
  hazard: 'radioactivity' | 'flood' | 'air-quality',
  observedAt: string,
): DataStatus => {
  const threshold = staleAfterMs[hazard]
  if (threshold === undefined) return 'available'
  const age = Date.now() - Date.parse(observedAt)
  return Number.isFinite(age) && age > threshold ? 'stale' : 'available'
}

type HazardContexts = Pick<EnvironmentalContext, 'radioactivity' | 'waterPollution' | 'radon' | 'flood' | 'airQuality'>

// Resolves each hazard in parallel. Any provider failure degrades that hazard only:
// mock data plus a warning and `status: 'error'` — the other hazards are unaffected.
export const resolveHazardContexts = async (
  latitude: number,
  longitude: number,
  providers: HazardProviderConfig,
): Promise<HazardContexts> => {
  const fallback = getMockHazardContexts(latitude, longitude)
  const results: HazardContexts = { ...fallback }
  await Promise.all([
    (async () => {
      if (!providers.radioactivity) return
      try {
        const result = await providers.radioactivity.getRadioactivity(latitude, longitude)
        results.radioactivity = {
          doseRateUsvH: result.doseRateUsvH,
          status: withFreshness('radioactivity', result.observedAt),
          source: result.source,
          observedAt: result.observedAt,
        }
      } catch (error) {
        results.radioactivity = {
          ...fallback.radioactivity,
          status: 'error',
          warning: fallbackWarning('radiation-monitoring', 'Radioactivity'),
        }
        console.warn('[hazards] radioactivity-fetch-failed', JSON.stringify({
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    })(),
    (async () => {
      if (!providers.waterPollution) return
      try {
        const result = await providers.waterPollution.getWaterPollution(latitude, longitude)
        results.waterPollution = {
          qualityIndex: result.qualityIndex,
          qualityLabel: result.qualityLabel,
          status: 'available',
          source: result.source,
          observedAt: result.observedAt,
        }
      } catch (error) {
        results.waterPollution = {
          ...fallback.waterPollution,
          status: 'error',
          warning: fallbackWarning('water-quality', 'Water pollution'),
        }
        console.warn('[hazards] water-pollution-fetch-failed', JSON.stringify({
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    })(),
    (async () => {
      if (!providers.radon) return
      try {
        const result = await providers.radon.getRadon(latitude, longitude)
        results.radon = {
          radonRiskIndex: result.radonRiskIndex,
          riskLabel: result.riskLabel,
          status: 'available',
          source: result.source,
          observedAt: result.observedAt,
        }
      } catch (error) {
        results.radon = {
          ...fallback.radon,
          status: 'error',
          warning: fallbackWarning('radon-map', 'Radon'),
        }
        console.warn('[hazards] radon-fetch-failed', JSON.stringify({
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    })(),
    (async () => {
      if (!providers.flood) return
      try {
        const result = await providers.flood.getFlood(latitude, longitude)
        results.flood = {
          riverDischargeM3s: result.riverDischargeM3s,
          baselineDischargeM3s: result.baselineDischargeM3s,
          status: withFreshness('flood', result.observedAt),
          source: result.source,
          observedAt: result.observedAt,
        }
      } catch (error) {
        results.flood = {
          ...fallback.flood,
          status: 'error',
          warning: fallbackWarning('hydrological', 'Flood'),
        }
        console.warn('[hazards] flood-fetch-failed', JSON.stringify({
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    })(),
    (async () => {
      if (!providers.airQuality) return
      try {
        const result = await providers.airQuality.getAirQuality(latitude, longitude)
        results.airQuality = {
          pm25: result.pm25,
          pm10: result.pm10,
          no2: result.no2,
          o3: result.o3,
          europeanAqi: result.europeanAqi,
          status: withFreshness('air-quality', result.observedAt),
          source: result.source,
          observedAt: result.observedAt,
        }
      } catch (error) {
        results.airQuality = {
          ...fallback.airQuality,
          status: 'error',
          warning: fallbackWarning('air-quality', 'Air quality'),
        }
        console.warn('[hazards] air-quality-fetch-failed', JSON.stringify({
          error: error instanceof Error ? error.message : 'unknown error',
        }))
      }
    })(),
  ])
  return results
}
