import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockGeocodingProvider, createNominatimGeocodingProvider } from './geocoding'
import { searchLocations } from '../geocoding'

const nominatimResponse = () => new Response(JSON.stringify([
  { lat: '-33.0463', lon: '-71.6203', display_name: 'Valparaíso, Chile' },
  { lat: '41.3874', lon: '2.1686', display_name: 'Barcelona, Spain' },
]))

describe('Nominatim geocoding provider', () => {
  it('maps Nominatim results into typed coordinates and labels', async () => {
    const provider = createNominatimGeocodingProvider(async (input) => {
      const url = new URL(input.toString())
      expect(url.searchParams.get('q')).toBe('valparaiso')
      expect(url.searchParams.get('format')).toBe('jsonv2')
      return nominatimResponse()
    })

    await expect(provider.search('valparaiso')).resolves.toEqual([
      { latitude: -33.0463, longitude: -71.6203, label: 'Valparaíso, Chile', source: 'nominatim' },
      { latitude: 41.3874, longitude: 2.1686, label: 'Barcelona, Spain', source: 'nominatim' },
    ])
  })

  it('rejects a non-ok response', async () => {
    const provider = createNominatimGeocodingProvider(async () => new Response('', { status: 503 }))

    await expect(provider.search('valparaiso')).rejects.toThrow('Nominatim geocoding request failed (503)')
  })

  it('rejects malformed responses at the provider boundary', async () => {
    const provider = createNominatimGeocodingProvider(async () => new Response(JSON.stringify({ results: [] })))

    await expect(provider.search('valparaiso')).rejects.toThrow('Invalid Nominatim geocoding response')
  })

  it('rejects out-of-range coordinates from the response', async () => {
    const provider = createNominatimGeocodingProvider(async () => new Response(JSON.stringify([
      { lat: '95', lon: '0', display_name: 'Impossible' },
    ])))

    await expect(provider.search('valparaiso')).rejects.toThrow('Invalid Nominatim geocoding response')
  })

  it('rejects a missing label', async () => {
    const provider = createNominatimGeocodingProvider(async () => new Response(JSON.stringify([
      { lat: '10', lon: '10' },
    ])))

    await expect(provider.search('valparaiso')).rejects.toThrow('Invalid Nominatim geocoding response')
  })

  it('bounds a hung request with a timeout', async () => {
    const provider = createNominatimGeocodingProvider(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }), 5)

    await expect(provider.search('valparaiso')).rejects.toThrow('aborted')
  })
})

describe('mock geocoding provider', () => {
  it('returns a stable deterministic result for a query', async () => {
    const provider = createMockGeocodingProvider()

    const first = await provider.search('Cascadia ridge')
    const second = await provider.search('Cascadia ridge')

    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
    expect(first[0].source).toBe('mock')
    expect(first[0].latitude).toBeGreaterThanOrEqual(-90)
    expect(first[0].latitude).toBeLessThanOrEqual(90)
    expect(first[0].longitude).toBeGreaterThanOrEqual(-180)
    expect(first[0].longitude).toBeLessThanOrEqual(180)
    expect(first[0].label).toContain('Cascadia ridge')
  })
})

describe('searchLocations', () => {
  beforeEach(() => {
    delete process.env.GEOCODING_PROVIDER
  })

  afterEach(() => {
    delete process.env.GEOCODING_PROVIDER
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects queries that are too short or too long', async () => {
    await expect(searchLocations('a')).rejects.toThrow('Enter at least 2 characters')
    await expect(searchLocations('x'.repeat(121))).rejects.toThrow('limited to 120 characters')
  })

  it('runs the deterministic mock when no provider is configured', async () => {
    const results = await searchLocations('somewhere')

    expect(results).toHaveLength(1)
    expect(results[0].source).toBe('mock')
    expect(results[0].warning).toContain('deterministic mock mode')
  })

  it('uses Nominatim when configured and returns results without a warning', async () => {
    process.env.GEOCODING_PROVIDER = 'nominatim'
    vi.stubGlobal('fetch', async () => nominatimResponse())

    const results = await searchLocations('valparaiso')

    expect(results[0]).toMatchObject({ latitude: -33.0463, source: 'nominatim' })
    expect(results[0].warning).toBeUndefined()
  })

  it('falls back to labelled mock results when Nominatim fails', async () => {
    const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.GEOCODING_PROVIDER = 'nominatim'
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }))

    const results = await searchLocations('valparaiso')

    expect(results[0].source).toBe('mock')
    expect(results[0].warning).toContain('deterministic mock mode')
    expect(logSpy).toHaveBeenCalledWith('[geocoding] search-failed', expect.stringContaining('"status":"fallback"'))
  })

  it('uses an injected provider directly without env gating', async () => {
    const results = await searchLocations('valparaiso', {
      search: async () => [{ latitude: 10, longitude: 20, label: 'Injected', source: 'nominatim' }],
    })

    expect(results[0].label).toBe('Injected')
    expect(results[0].warning).toBeUndefined()
  })
})
