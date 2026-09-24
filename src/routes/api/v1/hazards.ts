import { createFileRoute } from '@tanstack/react-router'

import { handleHazardsApiRequest } from '../../../server/api/hazards'

export const Route = createFileRoute('/api/v1/hazards')({
  server: {
    handlers: {
      GET: ({ request }) => handleHazardsApiRequest(request),
      OPTIONS: ({ request }) => handleHazardsApiRequest(request),
    },
  },
})
