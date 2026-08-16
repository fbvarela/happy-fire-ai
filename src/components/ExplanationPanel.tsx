import { useEffect, useRef, useState } from 'react'

import type { RiskResult } from '../domain/risk'
import { getExplanation } from '../server/explanation'
import type { Explanation } from '../server/providers/explanation'

type ExplanationPanelProps = { result: RiskResult }

export function ExplanationPanel({ result }: ExplanationPanelProps) {
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const requestVersion = useRef(0)
  const resultKey = `${result.score}:${result.level}:${result.factors.map(({ label }) => label).join('|')}`

  useEffect(() => {
    requestVersion.current += 1
    setExplanation(null)
    setError(false)
    setLoading(false)
  }, [resultKey])

  const explain = async () => {
    const version = requestVersion.current + 1
    requestVersion.current = version
    setLoading(true)
    setError(false)
    try {
      const nextExplanation = await getExplanation({
        data: { score: result.score, level: result.level, factors: result.factors.map(({ label }) => label) },
      })
      if (version === requestVersion.current) setExplanation(nextExplanation)
    } catch {
      if (version === requestVersion.current) {
        setExplanation(null)
        setError(true)
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }

  return (
    <section className="explanation-panel" aria-labelledby="explanation-title" aria-busy={loading}>
      <div className="card-heading">
        <div>
          <p className="card-kicker">Optional context</p>
          <h2 id="explanation-title">Estimate explanation</h2>
        </div>
        {explanation && <span className="muted-label">{explanation.source === 'cohere' ? 'AI assisted' : 'Deterministic fallback'}</span>}
      </div>
      {!explanation && !error && <p className="muted-copy">Get a plain-language explanation of the displayed estimate.</p>}
      <p className="explanation-status" role="status" aria-live="polite">{loading ? 'Loading explanation...' : ''}</p>
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
