import { buildHazardStatuses } from '../hazard-registry'
import { getEnvironmentContext } from '../environment'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': 'no-store',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'content-type': 'application/json' },
})

export async function handleHazardsApiRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)

  try {
    const url = new URL(request.url)
    const latitudeParam = url.searchParams.get('latitude')
    const longitudeParam = url.searchParams.get('longitude')
    let context
    if (latitudeParam !== null || longitudeParam !== null) {
      const latitude = Number(latitudeParam)
      const longitude = Number(longitudeParam)
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return json({ error: 'Invalid latitude.' }, 400)
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return json({ error: 'Invalid longitude.' }, 400)
      context = await getEnvironmentContext(latitude, longitude)
    }
    return json({
      data: {
        hazards: buildHazardStatuses(process.env, context),
        disclaimer: 'This is an informational estimate, not an official warning, prediction, or evacuation order.',
      },
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to retrieve hazard status.' }, 400)
  }
}
