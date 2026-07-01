import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchYouTubeComments } from '../lib/youtube'

function makeItem(id: string, likeCount = 1) {
  return {
    id,
    snippet: {
      topLevelComment: {
        snippet: {
          authorDisplayName: 'Usuário',
          textDisplay: `texto ${id}`,
          textOriginal: `texto ${id}`,
          likeCount,
          publishedAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      },
    },
  }
}

function page(items: unknown[], nextPageToken: string | null = null) {
  return { ok: true, json: async () => ({ items, nextPageToken }) }
}

describe('fetchYouTubeComments', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('retorna comentários de uma única página', async () => {
    vi.mocked(fetch).mockResolvedValue(page([makeItem('c1', 5)]) as any)

    const result = await fetchYouTubeComments('abc123', 'fake-key')

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]).toEqual({
      id: 'c1',
      author: 'Usuário',
      text: 'texto c1',
      textOriginal: 'texto c1',
      likeCount: 5,
      publishedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.totalComments).toBe(1)
    expect(result.pagesCollected).toBe(1)
    expect(result.limitReached).toBe(false)
  })

  it('pagina até esgotar nextPageToken', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([makeItem('a')], 'token2') as any)
      .mockResolvedValueOnce(page([makeItem('b')], null) as any)

    const result = await fetchYouTubeComments('abc123', 'fake-key')

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.comments.map(c => c.id)).toEqual(['a', 'b'])
    expect(result.pagesCollected).toBe(2)
  })

  it('para em MAX_PAGES mesmo com nextPageToken disponível', async () => {
    vi.mocked(fetch).mockImplementation(async () => page([], 'sempre-tem-mais') as any)

    const result = await fetchYouTubeComments('abc123', 'fake-key')

    expect(fetch).toHaveBeenCalledTimes(5)
    expect(result.pagesCollected).toBe(5)
    expect(result.limitReached).toBe(true)
  }, 10000)

  it('lança erro explícito quando a API do YouTube responde com erro', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'quota excedida' } }),
    } as any)

    await expect(fetchYouTubeComments('abc123', 'bad-key')).rejects.toThrow('quota excedida')
  })
})
