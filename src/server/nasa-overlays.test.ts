import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFirmsProvider } from './providers/firms'
import { clearNasaOverlayCache, resolveNasaOverlays } from './nasa-overlays'

const validCsv = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
39.750,0.150,342.1,0.48,0.42,2026-09-27,530,Suomi-NPP,VIIRS,86,2.0,301.2,8.4,D
39.755,0.160,350.0,0.5,0.4,2026-09-27,1030,Suomi-NPP,VIIRS,70,2.0,300.0,6.0,D`

const lat = 39.7
const lon = 0.03

const restoreEnv = { ...process.env }

describe('NASA overlay resolution', () => {
  beforeEach(() => {
    clearNasaOverlayCache()
    delete process.env.FIRMS_MAP_KEY
    delete process.env.FIRMS_MIN_CONFIDENCE
    delete process.env.FIRMS_DAY_RANGE
  })
  afterEach(() => {
    process.env = { ...restoreEnv }
    clearNasaOverlayCache()
  })

  it('serves deterministic mock data when FIRMS_MAP_KEY is not set', async () => {
    const overlays = await resolveNasaOverlays(lat, lon)
    expect(overlays.firms.source).toBe('mock')
    expect(overlays.firms.status).toBe('available')
    expect(overlays.firms.detections.length).toBeGreaterThan(0)
    expect(overlays.firms.nearest).toBeNull()
    expect(overlays.firms.warning).toContain('not enabled')
  })

  it('resolves live FIRMS data with the nearest-detection context', async () => {
    let requestedUrl: URL | null = null
    const provider = createFirmsProvider({ mapKey: 'test-key' }, async (input) => {
      requestedUrl = new URL(input.toString())
      return new Response(validCsv)
    })
    const overlays = await resolveNasaOverlays(lat, lon, { provider })
    expect(overlays.firms.source).toBe('firms')
    expect(overlays.firms.status).toBe('available')
    expect(overlays.firms.detections).toHaveLength(2)
    expect(requestedUrl?.pathname.startsWith('/api/area/csv/test-key/')).toBe(true)
    // At least one detection was placed near the query point by the fixture.
    expect(overlays.firms.nearest).not.toBeNull()
    expect(overlays.firms.nearest?.distanceKm).toBeLessThan(30)
    expect(overlays.firms.nearest?.bearingDeg).toBeGreaterThanOrEqual(0)
    expect(overlays.firms.nearest?.confidence).toBe('high')
  })

  it('falls back to mock with status error and a warning when the live call fails', async () => {
    const provider = createFirmsProvider({ mapKey: 'test-key' }, async () =>
      new Response('nope', { status: 503 }))
    const overlays = await resolveNasaOverlays(lat, lon, { provider })
    expect(overlays.firms.status).toBe('error')
    expect(overlays.firms.source).toBe('mock')
    expect(overlays.firms.warning).toContain('NASA FIRMS data was unavailable')
  })

  it('marks detections older than 24 hours as stale', async () => {
    const staleCsv = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
39.750,0.150,342.1,0.48,0.42,2024-01-01,530,Suomi-NPP,VIIRS,86,2.0,301.2,8.4,D`
    const provider = createFirmsProvider({ mapKey: 'test-key' }, async () => new Response(staleCsv))
    const overlays = await resolveNasaOverlays(lat, lon, { provider })
    expect(overlays.firms.status).toBe('stale')
  })

  it('caches resolved overlays within the TTL', async () => {
    let fetchCount = 0
    const provider = createFirmsProvider({ mapKey: 'test-key' }, async () => {
      fetchCount += 1
      return new Response(validCsv)
    })
    const first = await resolveNasaOverlays(lat, lon, { provider })
    const second = await resolveNasaOverlays(lat, lon, { provider })
    expect(fetchCount).toBe(1)
    expect(second).toBe(first)
  })

  it('rejects invalid coordinates', async () => {
    await expect(resolveNasaOverlays(999, 0)).rejects.toThrow(/latitude/)
  })

  it('widens the bbox longitude span near the poles', async () => {
    let requestedUrl: URL | null = null
    const provider = createFirmsProvider({ mapKey: 'test-key' }, async (input) => {
      requestedUrl = new URL(input.toString())
      return new Response(validCsv)
    })
    await resolveNasaOverlays(88, 0, { provider })
    const parts = (requestedUrl?.pathname.split('/').at(-2) ?? '').split(',').map(Number)
    const [west, south, east, north] = parts
    expect(west).toBeLessThan(-DEFAULT_RADIUS_LONGITUDE_SPAN / 2)
    expect(east).toBeGreaterThan(DEFAULT_RADIUS_LONGITUDE_SPAN / 2)
    expect(south).toBeGreaterThan(80)
    expect(north).toBeLessThanOrEqual(90)
  })
})

const DEFAULT_RADIUS_LONGITUDE_SPAN = 2 * (25 / (111.32 * Math.cos(88 * Math.PI / 180)))
