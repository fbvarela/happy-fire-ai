import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleHazardsApiRequest } from './hazards'
import { clearEnvironmentCache } from '../environment'

const buildRequest = (query = '') => new Request(`https://example.test/api/v1/hazards${query}`)

beforeEach(() => {
  clearEnvironmentCache()
})

afterEach(() => {
  clearEnvironmentCache()
})

describe('hazards REST API', () => {
  it('lists all hazards with enablement status and env gates', async () => {
    const response = await handleHazardsApiRequest(buildRequest())
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { hazards: Array<{
      id: string
      envGates: string[]
      enabled: boolean
      dataQuality: string
      lastUpdate: string | null
      provider: string
    }> } }
    expect(body.data.hazards.map(({ id }) => id)).toEqual([
      'wildfire',
      'radioactivity',
      'water-pollution',
      'radon',
      'flood',
      'air-quality',
    ])
    for (const hazard of body.data.hazards) {
      expect(hazard.envGates.length).toBeGreaterThan(0)
      expect(typeof hazard.enabled).toBe('boolean')
      expect(hazard.dataQuality).toBe('unavailable')
      expect(hazard.lastUpdate).toBeNull()
    }
  })

  it('reports last update and data quality when coordinates are provided', async () => {
    const response = await handleHazardsApiRequest(buildRequest('?latitude=40&longitude=-3'))
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { hazards: Array<{
      dataQuality: string
      lastUpdate: string | null
      provider: string
    }> } }
    for (const hazard of body.data.hazards) {
      // No provider env set in the test process: everything resolves to deterministic mock.
      expect(hazard.dataQuality).toBe('fallback')
      expect(typeof hazard.lastUpdate).toBe('string')
      expect(hazard.provider).toBe('mock')
    }
  })

  it('rejects invalid coordinates', async () => {
    const response = await handleHazardsApiRequest(buildRequest('?latitude=200&longitude=-3'))
    expect(response.status).toBe(400)
  })

  it('answers OPTIONS preflight and rejects other methods', async () => {
    const options = await handleHazardsApiRequest(new Request('https://example.test/api/v1/hazards', { method: 'OPTIONS' }))
    expect(options.status).toBe(204)
    const post = await handleHazardsApiRequest(new Request('https://example.test/api/v1/hazards', { method: 'POST' }))
    expect(post.status).toBe(405)
  })
})
