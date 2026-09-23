export type ExplanationInput = {
  score: number
  level: 'low' | 'moderate' | 'high' | 'extreme'
  factors: string[]
  /** Confidence-gated routing (spec Idea 3): set from the Jev advisory's explanationGate. */
  gate?: { warranted: boolean; emphasis?: 'weather' | 'fuel' | 'terrain' | 'exposure' }
}

export type Explanation = {
  summary: string
  drivers: string[]
  caveat: string
  source: 'cohere' | 'fallback' | 'skipped'
}

type CohereResponse = {
  message?: { content?: Array<{ type?: unknown; text?: unknown }> }
}

const endpoint = 'https://api.cohere.com/v2/chat'
const model = 'command-a-03-2025'
const maxTextLength = 500
// The model echoes the whitelisted factor labels as drivers, so the cap must cover the
// full canonical label set (currently 7) rather than an arbitrary small number.
const maxDrivers = 10

const isBoundedText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxTextLength

// The model sometimes returns drivers as {label, impact} objects even when asked for plain
// strings; flatten those into display text so a valid explanation is not discarded.
const normalizeDriver = (driver: unknown): unknown => {
  if (driver && typeof driver === 'object' && !Array.isArray(driver)) {
    const record = driver as Record<string, unknown>
    if (isBoundedText(record.label) && isBoundedText(record.impact)) return `${record.label}: ${record.impact}`
  }
  return driver
}

const parseExplanation = (value: unknown): Omit<Explanation, 'source'> => {
  if (!value || typeof value !== 'object') throw new Error('Invalid Cohere explanation')
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'caveat,drivers,summary') throw new Error('Invalid Cohere explanation')
  const drivers = Array.isArray(record.drivers) ? record.drivers.map(normalizeDriver) : record.drivers
  if (!isBoundedText(record.summary) || !isBoundedText(record.caveat) || !Array.isArray(drivers) ||
      drivers.length === 0 || drivers.length > maxDrivers ||
      !drivers.every(isBoundedText)) throw new Error('Invalid Cohere explanation')
  return { summary: record.summary, drivers, caveat: record.caveat }
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
          content: `Explain this verified wildfire risk estimate. The numeric score is authoritative and must not be changed. Score: ${input.score}. Level: ${input.level}. Factor labels: ${input.factors.join(', ')}.${input.gate?.emphasis ? ` Give particular narrative emphasis to the ${input.gate.emphasis} factor.` : ''} Return only JSON with summary (string), drivers (array of strings), and caveat (string).`,
        }],
      }),
    })
    if (!response.ok) throw new Error(`Cohere request failed (${response.status})`)
    const payload = await response.json() as CohereResponse
    const text = payload.message?.content?.find((part) => part.type === 'text')?.text
    if (typeof text !== 'string' || text.trim().length === 0) throw new Error('Invalid Cohere explanation')
    try {
      return { ...parseExplanation(JSON.parse(text)), source: 'cohere' }
    } catch {
      throw new Error('Invalid Cohere explanation')
    }
  },
})
