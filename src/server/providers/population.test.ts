import { describe, expect, it } from 'vitest'

import { createWorldPopPopulationProvider, worldPopRequestTimeoutMs } from './population'

describe('WorldPop population provider', () => {
  it('allows the documented synchronous WorldPop request window', () => {
    expect(worldPopRequestTimeoutMs).toBe(30_000)
  })

  it('queries a local polygon and returns total population', async () => {
    const provider = createWorldPopPopulationProvider(async (input) => {
      const url = new URL(input.toString())
       const geometry = JSON.parse(url.searchParams.get('geojson') ?? '{}') as {
         type?: string
         features?: Array<{ geometry?: { coordinates?: number[][][] } }>
       }

      expect(url.pathname).toBe('/v1/services/stats')
      expect(url.searchParams.get('dataset')).toBe('wpgppop')
      expect(url.searchParams.get('year')).toBe('2020')
       expect(url.searchParams.get('runasync')).toBe('false')
       expect(geometry.type).toBe('FeatureCollection')
       const coordinates = geometry.features?.[0]?.geometry?.coordinates?.[0] ?? []
       expect(coordinates).toHaveLength(5)
       expect(coordinates[0]).toEqual(coordinates[4])
       for (const [longitude, latitude] of coordinates) {
         expect(longitude).toBeGreaterThanOrEqual(-180)
         expect(longitude).toBeLessThanOrEqual(180)
         expect(latitude).toBeGreaterThanOrEqual(-90)
         expect(latitude).toBeLessThanOrEqual(90)
       }

      return new Response(JSON.stringify({
        status: 'finished',
        error: false,
        data: { total_population: 1234.5 },
      }))
    })

    await expect(provider.getNearbyPeople(43.35, -2.84)).resolves.toEqual({
      nearbyPeople: 1234.5,
      source: 'worldpop',
    })
  })

  it('rejects malformed or negative population results', async () => {
    const provider = createWorldPopPopulationProvider(async () => new Response(JSON.stringify({
      status: 'finished',
      error: false,
      data: { total_population: -1 },
    })))

    await expect(provider.getNearbyPeople(43.35, -2.84)).rejects.toThrow('Invalid WorldPop response')
  })

  it('rejects failed HTTP responses and includes a configured API key only in the request', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.get('key')).toBe('secret')
      return new Response('nope', { status: 503 })
    }
    const provider = createWorldPopPopulationProvider(fetcher, 1000, 'secret')

    await expect(provider.getNearbyPeople(43.35, -2.84)).rejects.toThrow('WorldPop request failed (503)')
  })

  it('times out requests', async () => {
    const provider = createWorldPopPopulationProvider((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    }), 1)

    await expect(provider.getNearbyPeople(43.35, -2.84)).rejects.toThrow()
  })

  it('polls a created task until it finishes', async () => {
    const requests: URL[] = []
    const provider = createWorldPopPopulationProvider(async (input) => {
      const url = new URL(input.toString())
      requests.push(url)
      return requests.length === 1
        ? new Response(JSON.stringify({ status: 'created', taskid: 'task-123' }))
        : new Response(JSON.stringify({ status: 'finished', error: false, data: { total_population: 42 } }))
    }, 1000, undefined, 1, 100)

    await expect(provider.getNearbyPeople(43.35, -2.84)).resolves.toEqual({ nearbyPeople: 42, source: 'worldpop' })
    expect(requests[1]?.pathname).toBe('/v1/tasks/task-123')
  })

  it('rejects a failed task', async () => {
    const provider = createWorldPopPopulationProvider(async (input) =>
      new Response(JSON.stringify(new URL(input.toString()).pathname.endsWith('/stats')
        ? { status: 'created', taskid: 'task-123' }
        : { status: 'failed', error: true })), 1000, undefined, 1, 100)

    await expect(provider.getNearbyPeople(43.35, -2.84)).rejects.toThrow('WorldPop task failed')
  })

  it('bounds task polling time', async () => {
    const provider = createWorldPopPopulationProvider(async () =>
      new Response(JSON.stringify({ status: 'created', taskid: 'task-123' })), 1000, undefined, 1, 2)

    await expect(provider.getNearbyPeople(43.35, -2.84)).rejects.toThrow('WorldPop task polling timed out')
  })

  it('keeps polygon coordinates valid at poles and across the dateline', async () => {
    const geometries: Array<{ coordinates: number[][][] }> = []
    const provider = createWorldPopPopulationProvider(async (input) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith('/stats')) {
        const geometry = JSON.parse(url.searchParams.get('geojson') ?? '{}') as { features: Array<{ geometry: { coordinates: number[][][] } }> }
        geometries.push(geometry.features[0].geometry)
      }
      return new Response(JSON.stringify({ status: 'finished', error: false, data: { total_population: 1 } }))
    })

    await provider.getNearbyPeople(89.4, 170)
    await provider.getNearbyPeople(-89.4, -170)

    for (const geometry of geometries) {
      for (const [longitude, latitude] of geometry.coordinates[0]) {
        expect(longitude).toBeGreaterThanOrEqual(-180)
        expect(longitude).toBeLessThanOrEqual(180)
        expect(latitude).toBeGreaterThanOrEqual(-90)
        expect(latitude).toBeLessThanOrEqual(90)
      }
    }
  })

  it('rejects locations too close to the poles before requesting a local window', async () => {
    let calls = 0
    const provider = createWorldPopPopulationProvider(async () => {
      calls += 1
      return new Response(JSON.stringify({ status: 'finished', error: false, data: { total_population: 1 } }))
    })

    await expect(provider.getNearbyPeople(89.5, 0)).rejects.toThrow('WorldPop local window is unavailable near the poles')
    await expect(provider.getNearbyPeople(-90, 0)).rejects.toThrow('WorldPop local window is unavailable near the poles')
    expect(calls).toBe(0)
  })

  it('rejects locations too close to the antimeridian before requesting a wrapping window', async () => {
    let calls = 0
    const provider = createWorldPopPopulationProvider(async () => {
      calls += 1
      return new Response(JSON.stringify({ status: 'finished', error: false, data: { total_population: 1 } }))
    })

    await expect(provider.getNearbyPeople(43, 179.5)).rejects.toThrow('WorldPop local window is unavailable near the antimeridian')
    await expect(provider.getNearbyPeople(43, -179.5)).rejects.toThrow('WorldPop local window is unavailable near the antimeridian')
    await expect(provider.getNearbyPeople(43, 180)).rejects.toThrow('WorldPop local window is unavailable near the antimeridian')
    expect(calls).toBe(0)
  })

  it('rejects a near-pole window whose calculated offset crosses the antimeridian', async () => {
    const provider = createWorldPopPopulationProvider(async () =>
      new Response(JSON.stringify({ status: 'finished', error: false, data: { total_population: 1 } })))

    await expect(provider.getNearbyPeople(89.4, 179.2)).rejects.toThrow('WorldPop local window is unavailable near the antimeridian')
  })
})
