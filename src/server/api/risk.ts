import type { ManualRiskInputs } from '../../domain/environment'
import { calculateRisk } from '../../domain/risk'
import { getRiskAssessmentForRequest } from '../assessment-service'
import { getEnvironmentContext } from '../environment'

const rateLimit = 60
const rateWindowMs = 60_000
// ponytail: process-local limit; use a shared store if public traffic grows across instances.
const requestsByIp = new Map<string, { count: number; resetAt: number }>()
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': 'no-store',
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'content-type': 'application/json', ...headers },
})

const parseScore = (value: string | null, label: string) => {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error(`Invalid ${label}.`)
  return parsed
}

const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

const isRateLimited = (ip: string, now = Date.now()) => {
  const current = requestsByIp.get(ip)
  if (!current || current.resetAt <= now) {
    requestsByIp.set(ip, { count: 1, resetAt: now + rateWindowMs })
    return null
  }
  current.count += 1
  return current.count > rateLimit ? Math.ceil((current.resetAt - now) / 1000) : null
}

export const resetRiskApiRateLimit = () => requestsByIp.clear()

export async function handleRiskApiRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, OPTIONS' })

  try {
    const url = new URL(request.url)
    const latitudeValue = url.searchParams.get('latitude')
    const longitudeValue = url.searchParams.get('longitude')
    const latitude = Number(latitudeValue)
    const longitude = Number(longitudeValue)
    if (latitudeValue === null || latitudeValue.trim() === '' || !Number.isFinite(latitude)) return json({ error: 'Invalid latitude.' }, 400)
    if (longitudeValue === null || longitudeValue.trim() === '' || !Number.isFinite(longitude)) return json({ error: 'Invalid longitude.' }, 400)
    if (latitude < -90 || latitude > 90) return json({ error: 'Invalid latitude.' }, 400)
    if (longitude < -180 || longitude > 180) return json({ error: 'Invalid longitude.' }, 400)

    const manualInputs: ManualRiskInputs = {
      localFestivalPressure: parseScore(url.searchParams.get('localFestivalPressure'), 'localFestivalPressure'),
      roadsideMaintenance: parseScore(url.searchParams.get('roadsideMaintenance'), 'roadsideMaintenance'),
    }
    const retryAfter = isRateLimited(clientIp(request))
    if (retryAfter !== null) return json({ error: 'Rate limit exceeded.' }, 429, { 'retry-after': String(retryAfter) })

    const environment = {
      ...await getEnvironmentContext(latitude, longitude),
      ...manualInputs,
    }
    const risk = calculateRisk(environment)
    // Optional env-gated assessment (risk interval, data quality, and — when JEV_AI_ENABLED —
    // a display-only Jev advisory). Additive fields only; `risk` is unchanged.
    const assessment = await getRiskAssessmentForRequest(latitude, longitude, environment, risk)
    return json({
      data: {
        risk,
        assessment,
        environment,
        sources: {
          weather: environment.source,
          fuel: environment.fuelSource,
          exposure: environment.exposureSource,
          roadClosures: environment.roadClosureSource ?? null,
        },
        disclaimer: 'This is an informational estimate, not an official warning, prediction, or evacuation order.',
      },
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to retrieve risk data.' }, 400)
  }
}
