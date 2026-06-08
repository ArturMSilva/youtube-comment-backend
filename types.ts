export interface Comment {
  id: string
  text: string
  likeCount: number
}

export interface AskRequest {
  pergunta: string
  comentarios: Comment[]
}

export interface AskResponse {
  resposta: string
  comentarios_fonte: Comment[]
}
