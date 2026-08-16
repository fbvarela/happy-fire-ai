import { describe, expect, it } from 'vitest'

import { createCohereExplanationProvider } from './explanation'

describe('Cohere explanation provider', () => {
  it('requests a constrained explanation from verified risk data', async () => {
    const provider = createCohereExplanationProvider('test-key', async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; response_format: unknown; messages: Array<{ content: string }> }

      expect(input.toString()).toBe('https://api.cohere.com/v2/chat')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
      expect(body.model).toBe('command-a-03-2025')
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.messages[0]?.content).toContain('numeric score is authoritative')

      return new Response(JSON.stringify({
        message: { content: [{ type: 'text', text: JSON.stringify({
          summary: 'Dry and windy conditions increase the estimate.',
          drivers: ['Low humidity', 'Strong wind'],
          caveat: 'This is not an official warning.',
        }) }] },
      }))
    })

    await expect(provider.explain({ score: 62, level: 'high', factors: ['Weather', 'Fuel'] })).resolves.toEqual({
      summary: 'Dry and windy conditions increase the estimate.',
      drivers: ['Low humidity', 'Strong wind'],
      caveat: 'This is not an official warning.',
      source: 'cohere',
    })
  })

  it('rejects malformed model output', async () => {
    const provider = createCohereExplanationProvider('test-key', async () => new Response(JSON.stringify({
      message: { content: [{ type: 'text', text: '{"summary":"missing fields"}' }] },
    })))

    await expect(provider.explain({ score: 10, level: 'low', factors: [] })).rejects.toThrow('Invalid Cohere explanation')
  })
})
