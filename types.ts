export interface Comment {
  id: string
  text: string
  likeCount: number
}

export interface AskRequest {
  pergunta: string
  comentarios: Comment[]
  method?: 'keyword' | 'semantic'
  compare?: boolean
  videoId?: string
}

/** Resposta enviada ao cliente HTTP. Não expõe internos. */
export interface AskResponse {
  resposta: string
  comentarios_fonte: Comment[]
  aviso?: string
}

/** Saída de parseResponse: inclui os índices usados internamente pela persistência. */
export interface ParsedResponse extends AskResponse {
  /** Índices 0-based na lista de comentários passada a parseResponse. */
  indicesFonte: number[]
}

/** Saída de askGroq: acrescenta qual modelo Groq de fato respondeu. */
export interface GroqResult extends ParsedResponse {
  modelo: string
}
