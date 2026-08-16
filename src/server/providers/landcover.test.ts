import { afterEach, describe, expect, it } from 'vitest'

import { clearCopernicusTokenCache, createCopernicusLandCoverProvider } from './landcover'

afterEach(() => clearCopernicusTokenCache())

describe('Copernicus land-cover provider', () => {
  it('requests the global land-cover BYOC and maps cover fractions to fuel dryness', async () => {
    const provider = createCopernicusLandCoverProvider('test-token', async (input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        input: { data: Array<{ type: string }> }
        evalscript: string
      }

      expect(input.toString()).toBe('https://sh.dataspace.copernicus.eu/api/v1/process')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
      expect(request.input.data[0]?.type).toBe('byoc-35fecfec-8a73-4723-bb08-b775f283a535')
      expect(request.evalscript).toContain('Tree_Cover_Fraction')

      return new Response(JSON.stringify({
        data: [{ bands: [40, 20, 20, 10, 10] }],
      }))
    })

    await expect(provider.getVegetationDryness(40, -3)).resolves.toEqual({
      vegetationDryness: 73,
      source: 'copernicus',
    })
  })

  it('rejects malformed or out-of-range land-cover samples', async () => {
    const provider = createCopernicusLandCoverProvider('test-token', async () => new Response(JSON.stringify({
      data: [{ bands: [40, 20, 20, 10, 101] }],
    })))

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
      return new Response(JSON.stringify({ data: [{ bands: [40, 20, 20, 10, 10] }] }))
    }
    const provider = createCopernicusLandCoverProvider({ clientId: 'id', clientSecret: 'secret' }, fetcher)

    await provider.getVegetationDryness(40, -3)
    await provider.getVegetationDryness(40, -3)

    expect(tokenCalls).toBe(1)
    expect(processCalls).toBe(2)
  })

  it('rejects client-credentials configuration without both credentials', async () => {
    const provider = createCopernicusLandCoverProvider({ clientId: 'id' }, async () => new Response())

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('Copernicus credentials are missing')
  })

  it('bounds process requests with a timeout', async () => {
    const provider = createCopernicusLandCoverProvider('test-token', async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }), 5)

    await expect(provider.getVegetationDryness(40, -3)).rejects.toThrow('aborted')
  })
})
