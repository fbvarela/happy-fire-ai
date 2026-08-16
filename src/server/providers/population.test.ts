import { describe, expect, it } from 'vitest'

import { createWorldPopPopulationProvider } from './population'

describe('WorldPop population provider', () => {
  it('queries a local polygon and returns total population', async () => {
    const provider = createWorldPopPopulationProvider(async (input) => {
      const url = new URL(input.toString())
      const geometry = JSON.parse(url.searchParams.get('geojson') ?? '{}') as { type?: string }

      expect(url.pathname).toBe('/v1/services/stats')
      expect(url.searchParams.get('dataset')).toBe('wpgppop')
      expect(url.searchParams.get('year')).toBe('2020')
      expect(url.searchParams.get('runasync')).toBe('false')
      expect(geometry.type).toBe('FeatureCollection')

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
})
