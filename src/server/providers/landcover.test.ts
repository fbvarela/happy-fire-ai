import { afterEach, describe, expect, it } from 'vitest'

import { clearCopernicusTokenCache, createCopernicusLandCoverProvider } from './landcover'

afterEach(() => clearCopernicusTokenCache())

const fakeDecoder = async () => [40, 20, 20, 10, 10]

describe('Copernicus land-cover provider', () => {
  it('requests the global land-cover BYOC and maps cover fractions to fuel dryness', async () => {
    const provider = createCopernicusLandCoverProvider({ accessToken: 'test-token', decoder: fakeDecoder }, async (input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        input: { bounds: { bbox: number[] }; data: Array<{ type: string }> }
        output: { responses: Array<{ format: { type: string } }> }
        evalscript: string
      }

      expect(input.toString()).toBe('https://sh.dataspace.copernicus.eu/api/v1/process')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
      expect(request.input.data[0]?.type).toBe('byoc-35fecfec-8a73-4723-bb08-b775f283a535')
      expect(request.input.bounds.bbox[0]).toBeLessThan(request.input.bounds.bbox[2] as number)
      expect(request.input.bounds.bbox[1]).toBeLessThan(request.input.bounds.bbox[3] as number)
      expect(request.evalscript).toContain('Tree_Cover_Fraction')
      expect(request.evalscript).toContain("sampleType: 'UINT8'")
      expect(request.output.responses[0]?.format.type).toBe('image/tiff')

      return new Response(new ArrayBuffer(0))
    })

    await expect(provider.getVegetationDryness(40, -3)).resolves.toEqual({
      vegetationDryness: 73,
      source: 'copernicus',
    })
  })

  it('rejects malformed or out-of-range land-cover samples', async () => {
    const provider = createCopernicusLandCoverProvider({ accessToken: 'test-token', decoder: async () => [40, 20, 20, 10, 101] }, async () => new Response(new ArrayBuffer(0)))

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('Invalid Copernicus land-cover response')
  })

  it('rejects individually valid fractions whose combined total exceeds 100', async () => {
    const provider = createCopernicusLandCoverProvider({ accessToken: 'test-token', decoder: async () => [30, 30, 30, 20, 0] }, async () => new Response(new ArrayBuffer(0)))

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('Invalid Copernicus land-cover response')
  })

  it('rejects an all-zero sample as missing land-cover data', async () => {
    const provider = createCopernicusLandCoverProvider({ accessToken: 'test-token', decoder: async () => [0, 0, 0, 0, 0] }, async () => new Response(new ArrayBuffer(0)))

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('Invalid Copernicus land-cover response')
  })

  it('maps a zero-fraction pixel from its discrete classification', async () => {
    const provider = createCopernicusLandCoverProvider({ accessToken: 'test-token', decoder: async () => [0, 0, 0, 0, 0, 50] }, async () => new Response(new ArrayBuffer(0)))

    await expect(provider.getVegetationDryness(40, -3)).resolves.toEqual({
      vegetationDryness: 0,
      source: 'copernicus',
    })
  })

  it('rejects unknown discrete classifications', async () => {
    const provider = createCopernicusLandCoverProvider({ accessToken: 'test-token', decoder: async () => [0, 0, 0, 0, 0, 999] }, async () => new Response(new ArrayBuffer(0)))

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('Invalid Copernicus land-cover response')
  })

  it('retrieves and reuses a short-lived client-credentials token', async () => {
    let tokenCalls = 0
    let processCalls = 0
    const fetcher = async (input: Request | URL | string) => {
      if (input.toString().includes('/token')) {
        tokenCalls += 1
        return new Response(JSON.stringify({ access_token: 'short-lived', expires_in: 300 }))
      }
      processCalls += 1
      return new Response(new ArrayBuffer(0))
    }
    const provider = createCopernicusLandCoverProvider({ clientId: 'id', clientSecret: 'secret', decoder: fakeDecoder }, fetcher)

    await provider.getVegetationDryness(40, -3)
    await provider.getVegetationDryness(40, -3)

    expect(tokenCalls).toBe(1)
    expect(processCalls).toBe(2)
  })

  it('refreshes the client token once after a process 401', async () => {
    let tokenCalls = 0
    const processTokens: string[] = []
    const fetcher = async (input: Request | URL | string, init?: RequestInit) => {
      if (input.toString().includes('/token')) {
        tokenCalls += 1
        return new Response(JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 300 }))
      }
      processTokens.push(String(init?.headers && new Headers(init.headers).get('Authorization')))
      return processTokens.length === 1
        ? new Response(null, { status: 401 })
        : new Response(new ArrayBuffer(0))
    }
    const provider = createCopernicusLandCoverProvider({ clientId: 'id', clientSecret: 'secret', decoder: fakeDecoder }, fetcher)

    await expect(provider.getVegetationDryness(40, -3)).resolves.toMatchObject({ source: 'copernicus' })
    expect(tokenCalls).toBe(2)
    expect(processTokens).toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  it('rejects client-credentials configuration without both credentials', async () => {
    const provider = createCopernicusLandCoverProvider({ clientId: 'id' }, async () => new Response())

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('Copernicus credentials are missing')
  })

  it('bounds process requests with a timeout', async () => {
    const provider = createCopernicusLandCoverProvider({ accessToken: 'test-token', decoder: fakeDecoder }, async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }), 5)

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('aborted')
  })
})
