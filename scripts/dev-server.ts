/**
 * Servidor HTTP local para rodar o handler serverless da Vercel sem o `vercel dev`
 * (que exige acesso de rede). Imita a invocação da Vercel: faz parse do body JSON
 * e adiciona os helpers `res.status()` / `res.json()` que o handler usa.
 *
 * Uso: node --env-file=.env -r ts-node/register scripts/dev-server.ts
 */
import { createServer } from 'http'
import handler from '../api/ask'

const PORT = Number(process.env.PORT ?? 3000)

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString()
    ;(req as any).body = raw ? JSON.parse(raw) : undefined
  } catch {
    ;(req as any).body = undefined
  }

  // Helpers no estilo VercelResponse
  ;(res as any).status = (code: number) => {
    res.statusCode = code
    return res
  }
  ;(res as any).json = (obj: unknown) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
    return res
  }

  try {
    await (handler as any)(req, res)
  } catch (err) {
    console.error('handler error:', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'erro interno' }))
    }
  }
})

server.listen(PORT, () => {
  console.log(`dev server (shim Vercel) ouvindo em http://localhost:${PORT}/api/ask`)
})
