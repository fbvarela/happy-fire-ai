import { hazardLabels } from '../domain/composite'
import type { DataStatus, EnvironmentalContext, HazardGroupId, HazardId } from '../domain/environment'

// Static registry of every supported hazard: its display name, group, and the env gates
// that enable live provider data. Used by GET /api/v1/hazards.

export type HazardRegistryEntry = {
  id: HazardId
  name: string
  groupId: HazardGroupId
  envGates: string[]
  providerName: string
  isEnabled: (env: NodeJS.ProcessEnv) => boolean
}

export const hazardRegistry: HazardRegistryEntry[] = [
  {
    id: 'wildfire',
    name: hazardLabels.wildfire,
    groupId: 'environmental',
    envGates: ['WEATHER_PROVIDER', 'CDSE_CLIENT_ID', 'CDSE_CLIENT_SECRET', 'CDSE_ACCESS_TOKEN', 'WORLDPOP_ENABLED'],
    providerName: 'open-meteo',
    isEnabled: (env) => env.WEATHER_PROVIDER === 'open-meteo' ||
      !!env.CDSE_ACCESS_TOKEN || !!(env.CDSE_CLIENT_ID && env.CDSE_CLIENT_SECRET),
  },
  {
    id: 'radioactivity',
    name: hazardLabels.radioactivity,
    groupId: 'radiation',
    envGates: ['RADIOACTIVITY_PROVIDER'],
    providerName: 'bfs',
    isEnabled: (env) => env.RADIOACTIVITY_PROVIDER === 'bfs' || env.RADIOACTIVITY_PROVIDER === 'safecast',
  },
  {
    id: 'water-pollution',
    name: hazardLabels['water-pollution'],
    groupId: 'environmental',
    envGates: ['WATER_POLLUTION_PROVIDER'],
    providerName: 'eea-bathing',
    isEnabled: (env) => env.WATER_POLLUTION_PROVIDER === 'eea-bathing' || env.WATER_POLLUTION_PROVIDER === 'eea-pfas',
  },
  {
    id: 'radon',
    name: hazardLabels.radon,
    groupId: 'geological',
    envGates: ['RADON_PROVIDER'],
    providerName: 'epa-ie',
    isEnabled: (env) => env.RADON_PROVIDER === 'epa-ie',
  },
  {
    id: 'flood',
    name: hazardLabels.flood,
    groupId: 'geological',
    envGates: ['FLOOD_PROVIDER'],
    providerName: 'open-meteo',
    isEnabled: (env) => env.FLOOD_PROVIDER === 'open-meteo',
  },
  {
    id: 'air-quality',
    name: hazardLabels['air-quality'],
    groupId: 'environmental',
    envGates: ['AIR_QUALITY_PROVIDER'],
    providerName: 'open-meteo',
    isEnabled: (env) => env.AIR_QUALITY_PROVIDER === 'open-meteo',
  },
]

export type HazardDataQuality = 'complete' | 'fallback' | 'stale' | 'error' | 'unavailable'

const qualityFor = (data: {
  status: DataStatus
  source: string
  observedAt: string
  warning?: string
} | undefined): { quality: HazardDataQuality; lastUpdate: string | null } => {
  if (!data) return { quality: 'unavailable', lastUpdate: null }
  const { status, source, observedAt } = data
  const quality: HazardDataQuality = status === 'error'
    ? 'error'
    : status === 'stale'
      ? 'stale'
      : status === 'available' && source !== 'mock'
        ? 'complete'
        : status === 'available'
          ? 'fallback'
          : 'unavailable'
  return { quality, lastUpdate: observedAt }
}

type HazardStatusReport = {
  id: HazardId
  name: string
  group: HazardGroupId
  envGates: string[]
  enabled: boolean
  provider: string
  lastUpdate: string | null
  dataQuality: HazardDataQuality
  warning: string | null
}

export const buildHazardStatuses = (
  env: NodeJS.ProcessEnv,
  context?: EnvironmentalContext,
): HazardStatusReport[] => {
  const contextData: Record<HazardId, EnvironmentalContext['radioactivity' | 'waterPollution' | 'radon' | 'flood' | 'airQuality']> = {
    wildfire: undefined,
    radioactivity: context?.radioactivity,
    'water-pollution': context?.waterPollution,
    radon: context?.radon,
    flood: context?.flood,
    'air-quality': context?.airQuality,
  }
  return hazardRegistry.map((entry) => {
    if (entry.id === 'wildfire') {
      const hasWeatherContext = context !== undefined
      const quality: HazardDataQuality = !hasWeatherContext
        ? 'unavailable'
        : context.status === 'error'
          ? 'error'
          : context.status === 'stale'
            ? 'stale'
            : context.source === 'mock'
              ? 'fallback'
              : 'complete'
      return {
        id: entry.id,
        name: entry.name,
        group: entry.groupId,
        envGates: entry.envGates,
        enabled: entry.isEnabled(env),
        provider: context ? context.source : entry.providerName,
        lastUpdate: context?.observedAt ?? null,
        dataQuality: quality,
        warning: null,
      }
    }
    const { quality, lastUpdate } = qualityFor(contextData[entry.id])
    const data = contextData[entry.id] as { warning?: string; source: string; status: DataStatus } | undefined
    return {
      id: entry.id,
      name: entry.name,
      group: entry.groupId,
      envGates: entry.envGates,
      enabled: entry.isEnabled(env),
      provider: data?.source ?? entry.providerName,
      lastUpdate,
      dataQuality: quality,
      warning: data?.warning ?? null,
    }
  })
}
