import type { DataSource } from './environment'

export const formatContextValue = (value: number | null, unit: string) =>
  value === null ? 'Missing' : `${value} ${unit}`

export const formatObservedAt = (observedAt: string, source: DataSource) => {
  const formatted = new Date(observedAt).toLocaleString()
  return source === 'mock' ? `Synthetic mock timestamp: ${formatted}` : formatted
}

export const formatSource = (source: DataSource) =>
  source === 'mock' ? 'Deterministic mock (synthetic)' : 'Open-Meteo'
