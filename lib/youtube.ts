export interface YoutubeComment {
  id: string
  author: string
  text: string
  textOriginal: string
  likeCount: number
  publishedAt: string
  updatedAt: string
}

export interface FetchCommentsResult {
  comments: YoutubeComment[]
  totalComments: number
  pagesCollected: number
  limitReached: boolean
}

const MAX_COMMENTS = 500
const MAX_PAGES = 5

export async function fetchYouTubeComments(
  videoId: string,
  apiKey: string
): Promise<FetchCommentsResult> {
  const allComments: YoutubeComment[] = []
  let nextPageToken: string | null = null
  let pageCount = 0
  let totalCommentsCollected = 0

  do {
    pageCount++

    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
    url.searchParams.append('part', 'snippet')
    url.searchParams.append('videoId', videoId)
    url.searchParams.append('key', apiKey)
    url.searchParams.append('maxResults', '100')
    url.searchParams.append('order', 'relevance')
    if (nextPageToken) url.searchParams.append('pageToken', nextPageToken)

    const response = await fetch(url.toString())

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        `Erro na API do YouTube: ${response.status} - ${errorData.error?.message || 'Erro desconhecido'}`
      )
    }

    const data = await response.json()

    if (data.items && data.items.length > 0) {
      const comments: YoutubeComment[] = data.items.map((item: any) => {
        const snippet = item.snippet.topLevelComment.snippet
        return {
          id: item.id,
          author: snippet.authorDisplayName,
          text: snippet.textDisplay,
          textOriginal: snippet.textOriginal,
          likeCount: snippet.likeCount,
          publishedAt: snippet.publishedAt,
          updatedAt: snippet.updatedAt,
        }
      })
      allComments.push(...comments)
      totalCommentsCollected += comments.length
    }

    nextPageToken = data.nextPageToken || null

    if (totalCommentsCollected >= MAX_COMMENTS) break
    if (pageCount >= MAX_PAGES) break

    if (nextPageToken) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } while (nextPageToken)

  return {
    comments: allComments,
    totalComments: totalCommentsCollected,
    pagesCollected: pageCount,
    limitReached: totalCommentsCollected >= MAX_COMMENTS || pageCount >= MAX_PAGES,
  }
}
