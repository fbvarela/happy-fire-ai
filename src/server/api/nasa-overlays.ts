import { resolveNasaOverlays, overlayRadiusLimitKm, type NasaOverlays } from '../nasa-overlays'

const rateLimit = 60
const rateWindowMs = 60_000
// Process-local limit; use a shared store if public traffic grows across instances.
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

export const resetNasaOverlaysApiRateLimit = () => requestsByIp.clear()

export async function handleNasaOverlaysApiRequest(request: Request): Promise<Response> {
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

    const radiusValue = url.searchParams.get('radiusKm')
    let radiusKm: number | undefined
    if (radiusValue !== null && radiusValue.trim() !== '') {
      radiusKm = Number(radiusValue)
      if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > overlayRadiusLimitKm) {
        return json({ error: `Invalid radiusKm. Must be between 1 and ${overlayRadiusLimitKm}.` }, 400)
      }
    }

    const retryAfter = isRateLimited(clientIp(request))
    if (retryAfter !== null) return json({ error: 'Rate limit exceeded.' }, 429, { 'retry-after': String(retryAfter) })

    // Overlay data is display-only; it is additive to the risk pipeline and never feeds
    // the deterministic scorers.
    const overlays: NasaOverlays = await resolveNasaOverlays(latitude, longitude, { radiusKm })
    return json({
      data: {
        overlays,
        warnings: [overlays.firms.warning].filter((warning): warning is string => warning !== undefined),
        disclaimer: 'Satellite fire detections are informational observations. This is not an official warning, prediction, or evacuation order.',
      },
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to retrieve NASA overlay data.' }, 400)
  }
}
