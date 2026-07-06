export interface WaMessage {
  id: string
  wa_message_id?: string | null
  direction: 'inbound' | 'outbound'
  type: string
  content: string | null
  media_url: string | null
  media_mime_type: string | null
  template_name: string | null
  status: string
  created_at: string
  sent_by: string | null
  reply_to_wa_message_id?: string | null
}

export interface WaTemplate {
  id: string
  name: string
  content: string
  category: 'custom' | 'meta_api'
  template_name: string | null
  language: string | null
  variable_order?: string[]
}

export interface WaQuickReply {
  id: string
  shortcut: string
  content: string
}

export type InputMode = 'text' | 'note'
