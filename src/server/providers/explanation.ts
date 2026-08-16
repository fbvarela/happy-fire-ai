export type ExplanationInput = {
  score: number
  level: 'low' | 'moderate' | 'high' | 'extreme'
  factors: string[]
}

export type Explanation = {
  summary: string
  drivers: string[]
  caveat: string
  source: 'cohere' | 'fallback'
}

type CohereResponse = {
  message?: { content?: Array<{ type?: unknown; text?: unknown }> }
}

const endpoint = 'https://api.cohere.com/v2/chat'
const model = 'command-a-03-2025'

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const parseExplanation = (value: unknown): Omit<Explanation, 'source'> => {
  if (!value || typeof value !== 'object') throw new Error('Invalid Cohere explanation')
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'caveat,drivers,summary') throw new Error('Invalid Cohere explanation')
  if (!isText(record.summary) || !isText(record.caveat) || !Array.isArray(record.drivers) ||
      !record.drivers.every(isText)) throw new Error('Invalid Cohere explanation')
  return { summary: record.summary, drivers: record.drivers, caveat: record.caveat }
}

export const createCohereExplanationProvider = (
  apiKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
) => ({
  async explain(input: ExplanationInput): Promise<Explanation> {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: `Explain this verified wildfire risk estimate. The numeric score is authoritative and must not be changed. Score: ${input.score}. Level: ${input.level}. Factor labels: ${input.factors.join(', ')}. Return only JSON with summary, drivers, and caveat.`,
        }],
      }),
    })
    if (!response.ok) throw new Error(`Cohere request failed (${response.status})`)
    const payload = await response.json() as CohereResponse
    const text = payload.message?.content?.find((part) => part.type === 'text')?.text
    if (!isText(text)) throw new Error('Invalid Cohere explanation')
    try {
      return { ...parseExplanation(JSON.parse(text)), source: 'cohere' }
    } catch {
      throw new Error('Invalid Cohere explanation')
    }
  },
})
