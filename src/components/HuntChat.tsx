import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, MessageCircle, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'

type HuntMessage = { id: string; sender_name: string; sender_role: 'organizer' | 'participant'; body: string; created_at: string }

export default function HuntChat({ huntId, compact = false }: { huntId: string; compact?: boolean }) {
  const [messages, setMessages] = useState<HuntMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const loadMessages = useCallback(async () => {
    if (!supabase) return
    const { data, error: loadError } = await supabase.rpc('get_hunt_messages', { p_hunt_id: huntId, p_limit: 100 })
    if (loadError) { setError(loadError.message); setLoading(false); return }
    setMessages(Array.isArray(data) ? data as HuntMessage[] : [])
    setError(''); setLoading(false)
  }, [huntId])

  // Initializing the chat from its database-backed source is intentional.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadMessages() }, [loadMessages])
  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel(`hunt-chat-${huntId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hunt_messages', filter: `hunt_id=eq.${huntId}` }, () => void loadMessages())
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [huntId, loadMessages])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!supabase || !body || sending) return
    setSending(true); setError('')
    const { error: sendError } = await supabase.rpc('send_hunt_message', { p_hunt_id: huntId, p_body: body })
    if (sendError) setError(sendError.message)
    else { setDraft(''); await loadMessages() }
    setSending(false)
  }

  return <section className={`hunt-chat ${compact ? 'hunt-chat-compact' : ''}`} aria-label="Hunt chat"><div className="hunt-chat-heading"><div><span className="eyebrow"><MessageCircle size={14}/> HUNT CHAT</span><h2>Keep everyone in the loop</h2></div><span>{messages.length} {messages.length === 1 ? 'message' : 'messages'}</span></div><div className="hunt-chat-messages" aria-live="polite">{loading ? <div className="hunt-chat-empty"><LoaderCircle className="spin" size={17}/> Loading messages…</div> : messages.length ? messages.map(message => <article className={`hunt-chat-message ${message.sender_role === 'organizer' ? 'organizer-message' : ''}`} key={message.id}><div className="hunt-chat-message-meta"><b>{message.sender_name}</b><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{message.body}</p></article>) : <div className="hunt-chat-empty">No messages yet. Say hello to your teams.</div>}</div><form className="hunt-chat-form" onSubmit={send}><input maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message to the hunt…" aria-label="Message"/><button className="primary-button" type="submit" disabled={sending || !draft.trim()}>{sending ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>}<span className="sr-only">Send message</span></button></form>{error && <p className="hunt-chat-error" role="alert">{error}</p>}</section>
}
