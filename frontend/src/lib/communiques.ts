// Comunicados del admin (ADR 0030): tipos, etiquetas y el enlace de WhatsApp.
export type Audience = 'all' | 'members' | 'trainers'
export type Channel = 'app' | 'email' | 'whatsapp'
export type Communique = {
  id: string
  title: string
  body: string
  audience: Audience
  discipline_ids: string[] | null
  channels: Channel[]
  app_count: number
  email_count: number
  seen: number
  created_at: string
  withdrawn_at: string | null
}
export type PendingCommunique = Pick<Communique, 'id' | 'title' | 'body' | 'created_at'>

export const AUDIENCE_LABEL: Record<Audience, string> = {
  all: 'Todos',
  members: 'Alumnos con cuota en vigor',
  trainers: 'Profesores',
}
export const CHANNEL_NAME: Record<Channel, string> = { app: 'En la app', email: 'Email', whatsapp: 'WhatsApp' }
export const TITLE_MAX = 80
export const BODY_MAX = 1000

// WhatsApp no tiene API para grupos: wa.me abre WhatsApp con el texto escrito y el admin elige el grupo de anuncios.
export const whatsappUrl = (c: Pick<Communique, 'title' | 'body'>): string =>
  `https://wa.me/?text=${encodeURIComponent(`*${c.title.trim()}*\n\n${c.body.trim()}`)}`
