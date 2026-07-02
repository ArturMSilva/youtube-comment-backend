/**
 * Servidor HTTP local para rodar os handlers serverless da Vercel sem o `vercel dev`
 * (que exige acesso de rede). Imita a invocação da Vercel: roteia por pathname, faz
 * parse do body JSON e adiciona os helpers `res.status()` / `res.json()` que os
 * handlers usam.
 *
 * Uso: node --env-file=.env -r ts-node/register scripts/dev-server.ts
 */
import { createServer } from 'http'
import askHandler from '../api/ask'
import commentsHandler from '../api/comments'

const PORT = Number(process.env.PORT ?? 3000)

const routes: Record<string, any> = {
  '/api/ask': askHandler,
  '/api/comments': commentsHandler,
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname
  const handler = routes[pathname]

  if (!handler) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'rota não encontrada no dev server' }))
    return
  }

  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString()
    ;(req as any).body = raw ? JSON.parse(raw) : undefined
  } catch {
    ;(req as any).body = undefined
  }
  ;(req as any).query = Object.fromEntries(
    new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams
  )

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
    await handler(req, res)
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
  console.log(`dev server (shim Vercel) ouvindo em http://localhost:${PORT}`)
  console.log(`  POST   /api/ask`)
  console.log(`  GET    /api/comments`)
})
