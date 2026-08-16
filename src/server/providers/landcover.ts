import { fromArrayBuffer } from 'geotiff'

export interface LandCoverProvider {
  getVegetationDryness(latitude: number, longitude: number): Promise<{ vegetationDryness: number; source: 'copernicus' }>
}

type CopernicusOptions = {
  accessToken?: string
  clientId?: string
  clientSecret?: string
  fetcher?: typeof fetch
  timeoutMs?: number
  decoder?: LandCoverDecoder
}

type LandCoverDecoder = (buffer: ArrayBuffer) => Promise<number[]>

type TokenCacheEntry = { token: string; expiresAt: number }

const processUrl = 'https://sh.dataspace.copernicus.eu/api/v1/process'
const tokenUrl = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
export const COPERNICUS_LAND_COVER_PRODUCT_URL = 'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/clms/land-cover-and-land-use-mapping/global-dynamic-land-cover/lc_global_100m_yearly_v3.html'
export const COPERNICUS_LAND_COVER_COLLECTION = '35fecfec-8a73-4723-bb08-b775f283a535'
const collection = `byoc-${COPERNICUS_LAND_COVER_COLLECTION}`
const tokenCache = new Map<string, TokenCacheEntry>()

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
const validClassifications = new Set([
  20, 30, 40, 50, 60, 70, 80, 90, 100, 200,
  111, 112, 113, 114, 115, 116, 121, 122, 123, 124, 125, 126,
])
const isClassification = (value: unknown): value is number =>
  typeof value === 'number' && validClassifications.has(value)

const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ['Tree_Cover_Fraction', 'Shrub_Cover_Fraction', 'Grass_Cover_Fraction', 'Crops_Cover_Fraction', 'Bare_Cover_Fraction', 'Discrete_Classification'] }],
    output: { bands: 6, sampleType: 'UINT8' }
  }
}
function evaluatePixel(sample) {
  return [sample.Tree_Cover_Fraction, sample.Shrub_Cover_Fraction, sample.Grass_Cover_Fraction, sample.Crops_Cover_Fraction, sample.Bare_Cover_Fraction, sample.Discrete_Classification]
}`

const decodeGeoTiff: LandCoverDecoder = async (buffer) => {
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  const values = await image.readRasters({ interleave: true })
  return Array.from(values as ArrayLike<number>)
}

const drynessByClassification = (classification: number) => {
  if (classification >= 111 && classification <= 126) return 85
  if (classification === 20) return 75
  if (classification === 30) return 65
  if (classification === 40) return 55
  if (classification === 60) return 10
  if (classification === 90) return 20
  if (classification === 100) return 30
  return 0
}

const getToken = async (options: CopernicusOptions, fetcher: typeof fetch, timeoutMs: number) => {
  if (options.accessToken) return options.accessToken
  if (!options.clientId || !options.clientSecret) throw new Error('Copernicus credentials are missing')
  const cached = tokenCache.get(options.clientId)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const response = await fetcher(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: options.clientId, client_secret: options.clientSecret }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Copernicus token request failed (${response.status})`)
  const payload = await response.json() as { access_token?: unknown; expires_in?: unknown }
  if (typeof payload.access_token !== 'string' || !payload.access_token) throw new Error('Invalid Copernicus token response')
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) ? payload.expires_in : 300
  tokenCache.set(options.clientId, { token: payload.access_token, expiresAt: Date.now() + Math.max(1, expiresIn - 30) * 1000 })
  return payload.access_token
}

export const clearCopernicusTokenCache = () => tokenCache.clear()

export function createCopernicusLandCoverProvider(tokenOrOptions: string | CopernicusOptions = {}, fetcher: typeof fetch = fetch, timeoutMs = 10_000): LandCoverProvider {
  const options = typeof tokenOrOptions === 'string' ? { accessToken: tokenOrOptions } : tokenOrOptions
  const requestFetcher = options.fetcher ?? fetcher
  const requestTimeoutMs = options.timeoutMs ?? timeoutMs

  return {
    async getVegetationDryness(latitude, longitude) {
      const token = await getToken(options, requestFetcher, requestTimeoutMs)
      const requestProcess = (accessToken: string) => requestFetcher(processUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(requestTimeoutMs),
        body: JSON.stringify({
          input: {
            bounds: { bbox: [longitude - 0.0001, latitude - 0.0001, longitude + 0.0001, latitude + 0.0001] },
            data: [{ type: collection }],
          },
          output: { width: 1, height: 1, responses: [{ identifier: 'default', format: { type: 'image/tiff' } }] },
          evalscript,
        }),
      })
      let response = await requestProcess(token)
      if (response.status === 401 && !options.accessToken && options.clientId) {
        tokenCache.delete(options.clientId)
        response = await requestProcess(await getToken(options, requestFetcher, requestTimeoutMs))
      }
      if (!response.ok) throw new Error(`Copernicus process request failed (${response.status})`)
      const bands = await (options.decoder ?? decodeGeoTiff)(await response.arrayBuffer())
       const fractions = Array.isArray(bands) ? bands.slice(0, 5) : []
       const classification = Array.isArray(bands) ? bands[5] : undefined
       const total = fractions.reduce((sum, value) => sum + value, 0)
       if (fractions.length !== 5 || !fractions.every(isFraction) || !isClassification(classification) || total > 100) {
         throw new Error('Invalid Copernicus land-cover response')
       }
       if (total === 0) return { vegetationDryness: drynessByClassification(classification as number), source: 'copernicus' }
       const [tree, shrub, grass, crops, bare] = fractions
      // Dryness is a weighted fuel-potential score: tree .8, shrub .8, grass .9, crops .6, bare .1.
      const vegetationDryness = Math.round((tree * 0.8 + shrub * 0.8 + grass * 0.9 + crops * 0.6 + bare * 0.1) * 10) / 10
      return { vegetationDryness, source: 'copernicus' }
    },
  }
}
