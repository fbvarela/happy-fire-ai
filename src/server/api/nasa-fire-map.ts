import { resolveFireMapImage, fireMapResponseCacheControl, fireMapRadiusLimitKm } from '../nasa-fire-map'

const rateLimit = 30
const rateWindowMs = 60_000
// Process-local limit; use a shared store if public traffic grows across instances.
// Map-image requests also read from resolveFireMapImage's server cache.
const requestsByIp = new Map<string, { count: number; resetAt: number }>()
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': fireMapResponseCacheControl,
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'access-control-allow-origin': corsHeaders['access-control-allow-origin'], 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
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

export const resetFireMapApiRateLimit = () => requestsByIp.clear()

export async function handleFireMapApiRequest(request: Request): Promise<Response> {
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

    let radiusKm: number | undefined
    const radiusValue = url.searchParams.get('radiusKm')
    if (radiusValue !== null && radiusValue.trim() !== '') {
      radiusKm = Number(radiusValue)
      if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > fireMapRadiusLimitKm) {
        return json({ error: `Invalid radiusKm. Must be between 1 and ${fireMapRadiusLimitKm}.` }, 400)
      }
    }

    const retryAfter = isRateLimited(clientIp(request))
    if (retryAfter !== null) return json({ error: 'Rate limit exceeded.' }, 429, { 'retry-after': String(retryAfter) })

    const result = await resolveFireMapImage(latitude, longitude, { radiusKm })
    if (result.status === 'available' && result.image && result.contentType) {
      return new Response(result.image as unknown as BodyInit, {
        status: 200,
        headers: {
          ...corsHeaders,
          'content-type': result.contentType,
          'content-length': String(result.image.byteLength),
        },
      })
    }
    return json({ error: result.warning ?? 'Fire map image is unavailable.' }, result.status === 'unavailable' ? 404 : 502)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to retrieve fire map image.' }, 400)
  }
}
