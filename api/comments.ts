import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCORS } from '../lib/cors'
import { fetchYouTubeComments } from '../lib/youtube'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCORS(req, res, 'GET, OPTIONS')) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const { videoId } = req.query
  if (!videoId || typeof videoId !== 'string') {
    return res.status(400).json({ error: 'videoId é obrigatório' })
  }

  try {
    const resultado = await fetchYouTubeComments(videoId, process.env.YOUTUBE_API_KEY ?? '')
    return res.status(200).json(resultado)
  } catch (error: any) {
    return res.status(502).json({ error: `Falha ao buscar comentários do YouTube: ${error.message}` })
  }
}
