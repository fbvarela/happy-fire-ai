import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildFireMapBoundingBox,
  buildFireMapUrl,
  fetchFireMapImage,
  resolveFireMapDayWindow,
  resolveFireMapImage,
  clearFireMapCache,
} from './nasa-fire-map'

const pngResponse = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), {
  headers: { 'content-type': 'image/png' },
})

const restoreEnv = { ...process.env }

describe('FIRMS WMS fire map', () => {
  beforeEach(() => {
    clearFireMapCache()
    delete process.env.FIRMS_MAP_KEY
  })
  afterEach(() => {
    process.env = { ...restoreEnv }
    clearFireMapCache()
  })

  it('builds a documented WMS GetMap URL with the key kept in the path', () => {
    const url = buildFireMapUrl('secret-key', { west: -119, south: 33.5, east: -117.6, north: 34.6 }, 1)
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/secret-key/')
    expect(parsed.searchParams.get('LAYERS')).toBe('fires_viirs_24')
    expect(parsed.searchParams.get('BBOX')).toBe('-119.0000,33.5000,-117.6000,34.6000')
    expect(parsed.searchParams.get('SRS')).toBe('EPSG:4326')
    expect(parsed.searchParams.get('FORMAT')).toBe('image/png')
  })

  it('uses the 72h layer for day windows 3-5 and the 7-day layer for 7', () => {
    expect(new URL(buildFireMapUrl('k', { west: 0, south: 0, east: 1, north: 1 }, 3)).searchParams.get('LAYERS')).toBe('fires_viirs_72')
    expect(new URL(buildFireMapUrl('k', { west: 0, south: 0, east: 1, north: 1 }, 7)).searchParams.get('LAYERS')).toBe('fires_viirs_7')
    expect(resolveFireMapDayWindow('4')).toBe(3)
    expect(resolveFireMapDayWindow(undefined)).toBe(3)
  })

  it('builds a bounded bbox around the point, clamped to valid ranges', () => {
    const bounds = buildFireMapBoundingBox(88, 0, 60)
    expect(bounds.west).toBeLessThan(0)
    expect(bounds.east).toBeGreaterThan(0)
    expect(bounds.south).toBeGreaterThan(80)
    expect(bounds.north).toBeLessThanOrEqual(90)
    const equator = buildFireMapBoundingBox(0, 0, 111.32)
    expect(equator.south).toBeCloseTo(-1, 5)
    expect(equator.north).toBeCloseTo(1, 5)
  })

  it('fetches and validates PNG bytes', async () => {
    const bytes = await fetchFireMapImage({ mapKey: 'k', bounds: { west: 0, south: 0, east: 1, north: 1 }, days: 1, fetcher: async (input) => {
      const url = new URL(input.toString())
      expect(url.searchParams.get('LAYERS')).toBe('fires_viirs_24')
      return pngResponse()
    } })
    expect(bytes[1]).toBe(0x50)
  })

  it('rejects non-PNG and HTTP failures', async () => {
    await expect(fetchFireMapImage({ mapKey: 'k', bounds: { west: 0, south: 0, east: 1, north: 1 }, days: 1, fetcher: async () => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }) }))
      .rejects.toThrow('unexpected content type')
    await expect(fetchFireMapImage({ mapKey: 'k', bounds: { west: 0, south: 0, east: 1, north: 1 }, days: 1, fetcher: async () => new Response('nope', { status: 503 }) }))
      .rejects.toThrow('FIRMS WMS request failed (503)')
  })

  it('resolves a map image through a fetcher, cached on repeat', async () => {
    let fetchCount = 0
    const result1 = await resolveFireMapImage(34.06, -118.25, { fetcher: async () => { fetchCount += 1; return pngResponse() }, env: { FIRMS_MAP_KEY: 'k' } })
    const result2 = await resolveFireMapImage(34.06, -118.25, { fetcher: async () => { fetchCount += 1; return pngResponse() }, env: { FIRMS_MAP_KEY: 'k' } })
    expect(result1.status).toBe('available')
    expect(result2).toBe(result1)
    expect(fetchCount).toBe(1)
  })

  it('falls back to unavailable with a warning when disabled or failing', async () => {
    const disabled = await resolveFireMapImage(34.06, -118.25, { env: {} })
    expect(disabled.status).toBe('unavailable')
    expect(disabled.warning).toContain('not enabled')

    const failing = await resolveFireMapImage(34.06, -118.25, { fetcher: async () => new Response('err', { status: 503 }), env: { FIRMS_MAP_KEY: 'k' } })
    expect(failing.status).toBe('error')
    expect(failing.warning).toContain('unavailable')
  })

  it('rejects invalid coordinates', async () => {
    await expect(resolveFireMapImage(999, 0, { env: {} })).rejects.toThrow(/latitude/)
  })
})
