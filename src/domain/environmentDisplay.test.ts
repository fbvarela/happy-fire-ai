import { describe, expect, it } from 'vitest'

import { formatContextValue, formatObservedAt, formatSource } from './environmentDisplay'

describe('environment display formatting', () => {
  it('formats values with units and labels missing values', () => {
    expect(formatContextValue(22, '°C')).toBe('22 °C')
    expect(formatContextValue(null, 'mm / 24h')).toBe('Missing')
  })

  it('labels the deterministic mock timestamp as synthetic', () => {
    expect(formatObservedAt('2026-01-01T00:00:00.000Z', 'mock')).toContain('Synthetic mock timestamp')
    expect(formatSource('mock')).toBe('Deterministic mock (synthetic)')
  })
})
