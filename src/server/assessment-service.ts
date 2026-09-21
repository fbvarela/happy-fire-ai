import type { EnvironmentalContext } from '../domain/environment'
import type { RiskResult } from '../domain/risk'
import { applyJevCaution, buildRiskAssessment, type RiskAssessmentReport } from './assessment'
import { createJevProvider } from './providers/jev'

// Env-gated advisory service. When JEV_AI_ENABLED=true and JEV_API_KEY are set, a Jev
// assessment runs alongside the deterministic pipeline and attaches a display-only advisory
// to the risk assessment. AI output can only add caution; any Jev failure is swallowed and
// the assessment is returned without an advisory — never a fake success, never a changed score.
//
// The call is fire-and-forget: the deterministic result ships immediately, and if Jev answers
// within the timeout the advisory is cached and served with later requests for the same
// provider configuration. This keeps p95 latency of the risk endpoint identical to the
// non-AI path.

const advisoryCacheTtlMs = 10 * 60 * 1000
const advisoryCacheMaxEntries = 32

type CacheEntry = { report: RiskAssessmentReport; expiresAt: number }
const advisoryCache = new Map<string, CacheEntry>()

export const clearAssessmentCache = () => advisoryCache.clear()

const cacheKey = (
  latitude: number,
  longitude: number,
  risk: RiskResult,
  context: EnvironmentalContext,
) => [
  latitude,
  longitude,
  context.source,
  context.status,
  context.fuelSource,
  context.exposureSource,
  context.roadClosureSource ?? 'none',
  risk.score,
  risk.confidence,
].join(':')

const pruneCache = (now: number) => {
  for (const [key, entry] of advisoryCache) {
    if (entry.expiresAt <= now) advisoryCache.delete(key)
  }
}

const jevConfigured = () => process.env.JEV_AI_ENABLED === 'true' && !!process.env.JEV_API_KEY

export const getRiskAssessmentForRequest = async (
  latitude: number,
  longitude: number,
  context: EnvironmentalContext,
  risk: RiskResult,
): Promise<RiskAssessmentReport> => {
  const report = buildRiskAssessment(context, risk)
  if (!jevConfigured()) return report

  const key = cacheKey(latitude, longitude, risk, context)
  const now = Date.now()
  pruneCache(now)
  const cached = advisoryCache.get(key)
  if (cached && cached.expiresAt > now) return cached.report

  const provider = createJevProvider(process.env.JEV_API_KEY as string)
  try {
    const advisory = await provider.assess(context)
    const enriched = applyJevCaution(report, advisory)
    if (!advisoryCache.has(key) && advisoryCache.size >= advisoryCacheMaxEntries) {
      const oldestKey = advisoryCache.keys().next().value
      if (oldestKey !== undefined) advisoryCache.delete(oldestKey)
    }
    advisoryCache.set(key, { report: enriched, expiresAt: now + advisoryCacheTtlMs })
    return enriched
  } catch (error) {
    console.warn('[assessment] jev-assessment-failed', JSON.stringify({
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'unknown error',
    }))
    return report
  }
}
