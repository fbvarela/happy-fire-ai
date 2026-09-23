import { afterEach, describe, expect, it } from 'vitest'

import { handleRiskApiRequest, resetRiskApiRateLimit } from './risk'

const request = (query: string, ip = '203.0.113.10') => new Request(`https://happy-fire.example/api/v1/risk?${query}`, {
  headers: { 'x-forwarded-for': ip },
})

// A developer .env.local with JEV_AI_ENABLED=true must not leak into these tests: without
// the advisory the report is purely deterministic.
const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
})

describe('risk REST API', () => {
  it('returns the deterministic risk and environment for valid coordinates', async () => {
    delete process.env.JEV_AI_ENABLED
    delete process.env.JEV_API_KEY
    const response = await handleRiskApiRequest(request('latitude=40&longitude=-3&localFestivalPressure=80&roadsideMaintenance=20'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.risk.modelVersion).toBe('mvp-2')
    expect(body.data.assessment.interval).toEqual({ low: body.data.risk.score, high: body.data.risk.score })
    expect(body.data.assessment.confidenceLevel).toBeTypeOf('string')
    expect(body.data.assessment.advisory).toBeUndefined()
    expect(body.data.environment.latitude).toBe(40)
    expect(body.data.environment.localFestivalPressure).toBe(80)
    expect(body.data.environment.roadsideMaintenance).toBe(20)
    expect(body.data.sources.roadClosures).toBeNull()
    expect(body.data.disclaimer).toContain('informational')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('rejects invalid query values', async () => {
    const response = await handleRiskApiRequest(request('latitude=bad&longitude=-3'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid latitude.' })
  })

  it('requires both coordinates', async () => {
    const response = await handleRiskApiRequest(request('longitude=-3'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid latitude.' })
  })

  it('returns a deterministic assessment without AI output when Jev is disabled', async () => {
    delete process.env.JEV_AI_ENABLED
    const response = await handleRiskApiRequest(request('latitude=40&longitude=-3'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.assessment.advisory).toBeUndefined()
    expect(body.data.assessment.advisoryWarnings).toEqual([])
  })

  it('returns 429 after the public per-IP limit', async () => {
    resetRiskApiRateLimit()
    const responses = await Promise.all(Array.from({ length: 61 }, () => handleRiskApiRequest(request('latitude=40&longitude=-3', '203.0.113.11'))))

    expect(responses.at(-1)?.status).toBe(429)
    expect(responses.at(-1)?.headers.get('retry-after')).toBeTruthy()
  })
})
