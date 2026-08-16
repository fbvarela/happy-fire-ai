import { useState } from 'react'

import type { RiskResult } from '../domain/risk'
import { getExplanation } from '../server/explanation'
import type { Explanation } from '../server/providers/explanation'

type ExplanationPanelProps = { result: RiskResult }

export function ExplanationPanel({ result }: ExplanationPanelProps) {
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const explain = async () => {
    setLoading(true)
    setError(false)
    try {
      setExplanation(await getExplanation({
        data: { score: result.score, level: result.level, factors: result.factors.map(({ label }) => label) },
      }))
    } catch {
      setExplanation(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="explanation-panel" aria-labelledby="explanation-title">
      <div className="card-heading">
        <div>
          <p className="card-kicker">Optional context</p>
          <h2 id="explanation-title">Estimate explanation</h2>
        </div>
        {explanation && <span className="muted-label">{explanation.source === 'cohere' ? 'AI assisted' : 'Deterministic fallback'}</span>}
      </div>
      {!explanation && !error && <p className="muted-copy">Get a plain-language explanation of the displayed estimate.</p>}
      {error && <p className="explanation-error" role="alert">The explanation could not be loaded. The estimate above remains unchanged.</p>}
      {explanation && (
        <div className="explanation-copy" aria-live="polite">
          <p>{explanation.summary}</p>
          <ul>{explanation.drivers.map((driver) => <li key={driver}>{driver}</li>)}</ul>
          <p className="explanation-caveat">{explanation.caveat}</p>
        </div>
      )}
      <button className="secondary-button" type="button" onClick={explain} disabled={loading}>
        {loading ? 'Explaining...' : 'Explain this estimate'}
      </button>
    </section>
  )
}
