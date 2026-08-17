import { createFileRoute } from '@tanstack/react-router'

import { handleRiskApiRequest } from '../../../server/api/risk'

export const Route = createFileRoute('/api/v1/risk')({
  server: {
    handlers: {
      GET: ({ request }) => handleRiskApiRequest(request),
      OPTIONS: ({ request }) => handleRiskApiRequest(request),
    },
  },
})
