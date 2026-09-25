import { createServerFn } from '@tanstack/react-start'

import { createMockGeocodingProvider, createNominatimGeocodingProvider, type GeocodingProvider, type GeocodingResult } from './providers/geocoding'

const maxQueryLength = 120
const maxResults = 5

export type LocationSearchResult = GeocodingResult & { warning?: string }

const getMockResults = async (query: string): Promise<LocationSearchResult[]> =>
  (await createMockGeocodingProvider().search(query)).map((result) => ({
    ...result,
    warning: 'Location search is running in deterministic mock mode; the result may not match the real place.',
  }))

export const searchLocations = async (
  query: string,
  provider?: GeocodingProvider,
): Promise<LocationSearchResult[]> => {
  const trimmed = query.trim()
  if (trimmed.length < 2) throw new Error('Enter at least 2 characters to search for a location.')
  if (trimmed.length > maxQueryLength) throw new Error(`Location search is limited to ${maxQueryLength} characters.`)

  if (provider) return provider.search(trimmed)

  if (process.env.GEOCODING_PROVIDER !== 'nominatim') return getMockResults(trimmed)

  try {
    return await createNominatimGeocodingProvider().search(trimmed)
  } catch (error) {
    console.warn('[geocoding] search-failed', JSON.stringify({
      status: 'fallback',
      error: error instanceof Error ? error.message : 'unknown error',
    }))
    return getMockResults(trimmed)
  }
}

const validateSearchRequest = (request: { query: unknown }) => {
  if (typeof request.query !== 'string') throw new Error('Enter a location name to search for.')
  return request
}

export const searchLocationsFn = createServerFn({ method: 'GET' })
  .validator(validateSearchRequest)
  .handler(async ({ data }) => {
    const results = await searchLocations(data.query)
    return {
      results: results.slice(0, maxResults),
      source: results[0]?.source ?? 'mock',
      warning: results[0]?.warning,
    }
  })
