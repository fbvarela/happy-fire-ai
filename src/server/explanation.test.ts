import { describe, expect, it } from 'vitest'

import { getExplanationForRisk } from './explanation'

const input = { score: 62, level: 'high' as const, factors: ['Weather', 'Fuel'] }

describe('risk explanation server boundary', () => {
  it('returns deterministic fallback without calling a missing-key provider', async () => {
    let calls = 0
    const provider = { explain: async () => { calls += 1; throw new Error('should not call') } }

    await expect(getExplanationForRisk(input, provider, '')).resolves.toEqual({
      summary: 'This estimate is based on the displayed risk score and drivers.',
      drivers: ['Review the displayed drivers for the estimate context.'],
      caveat: 'AI text is explanatory only and does not change the estimate or emergency guidance.',
      source: 'fallback',
    })
    expect(calls).toBe(0)
  })

  it('returns the same fallback when the provider fails', async () => {
    const provider = { explain: async () => { throw new Error('provider unavailable') } }

    await expect(getExplanationForRisk(input, provider, 'test-key')).resolves.toEqual({
      summary: 'This estimate is based on the displayed risk score and drivers.',
      drivers: ['Review the displayed drivers for the estimate context.'],
      caveat: 'AI text is explanatory only and does not change the estimate or emergency guidance.',
      source: 'fallback',
    })
  })
})
