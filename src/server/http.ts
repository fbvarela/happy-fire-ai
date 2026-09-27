// Shared fetch wrapper with bounded retries. Side services (notably FIRMS) intermittently
// drop TCP connects from some hosts; one retry usually succeeds, while a single failed
// fetch otherwise degrades the whole overlay to mock data.

export type FetchWithRetryOptions = {
  attempts?: number
  backoffMs?: number
}

export const createFetchWithRetry = (
  fetcher: typeof fetch = fetch,
  { attempts = 3, backoffMs = 250 }: FetchWithRetryOptions = {},
): typeof fetch => {
  return async (input, init) => {
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt))
      }
      try {
        return await fetcher(input, init)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
}
