import { NextRequest } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

// Fetches a Cloud Run identity token from the GCP metadata server.
// Returns null when running locally (metadata server unreachable).
async function getIdentityToken(audience: string): Promise<string | null> {
  try {
    const res = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
      { headers: { 'Metadata-Flavor': 'Google' } }
    )
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  const token = await getIdentityToken(BACKEND_URL)
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    return new Response('Backend error', { status: res.status })
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
