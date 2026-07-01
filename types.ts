export interface Comment {
  id: string
  text: string
  likeCount: number
}

export interface AskRequest {
  pergunta: string
  comentarios: Comment[]
  method?: 'keyword' | 'semantic'
}

export interface AskResponse {
  resposta: string
  comentarios_fonte: Comment[]
}
