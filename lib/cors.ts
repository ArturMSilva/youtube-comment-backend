import type { VercelRequest, VercelResponse } from '@vercel/node'

export function applyCORS(req: VercelRequest, res: VercelResponse, methods: string): boolean {
  const origin = (req.headers['origin'] as string) ?? ''

  // Permite apenas extensões Chrome e localhost
  if (origin.startsWith('chrome-extension://') || origin === 'http://localhost') {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true // preflight tratado, não continuar
  }
  return false
}
