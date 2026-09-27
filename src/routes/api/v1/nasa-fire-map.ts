import { createFileRoute } from '@tanstack/react-router'

import { handleFireMapApiRequest } from '../../../server/api/nasa-fire-map'

export const Route = createFileRoute('/api/v1/nasa-fire-map')({
  server: {
    handlers: {
      GET: ({ request }) => handleFireMapApiRequest(request),
      OPTIONS: ({ request }) => handleFireMapApiRequest(request),
    },
  },
})
