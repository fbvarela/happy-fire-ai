import { createFileRoute } from '@tanstack/react-router'

import { handleNasaOverlaysApiRequest } from '../../../server/api/nasa-overlays'

export const Route = createFileRoute('/api/v1/nasa-overlays')({
  server: {
    handlers: {
      GET: ({ request }) => handleNasaOverlaysApiRequest(request),
      OPTIONS: ({ request }) => handleNasaOverlaysApiRequest(request),
    },
  },
})
