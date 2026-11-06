import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, MessageCircle, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { reportOperation } from '../lib/operationLog'
import { countNewMessages } from '../lib/chatMessages'

type HuntMessage = { id: string; sender_name: string; sender_role: 'organizer' | 'participant'; body: string; created_at: string }

export default function HuntChat({ huntId, compact = false, readOnly = false }: { huntId: string; compact?: boolean; readOnly?: boolean }) {
  const [messages, setMessages] = useState<HuntMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [atLatest, setAtLatest] = useState(true)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const messagesRef = useRef<HTMLDivElement>(null)
  const knownMessageIds = useRef(new Set<string>())
  const atLatestRef = useRef(true)
  const requestId = useRef(0)
  const preserveScroll = useRef(false)

  const loadMessages = useCallback(async (before?: string, older = false) => {
    if (!supabase) return
    const id = ++requestId.current
    if (older) setLoadingOlder(true)
    const { data, error: loadError } = await supabase.rpc('get_hunt_messages', { p_hunt_id: huntId, p_limit: 100, p_before: before ?? null })
    if (id !== requestId.current) return
    if (loadError) { void reportOperation(huntId, crypto.randomUUID(), 'chat_load_failed', 'failure'); setError('Messages could not be refreshed. Check your connection and retry.'); setLoading(false); setLoadingOlder(false); return }
    const page = Array.isArray(data) ? data as HuntMessage[] : []
    if (older) {
      for (const message of page) knownMessageIds.current.add(message.id)
      setMessages(current => [...page.filter(row => !current.some(existing => existing.id === row.id)), ...current])
    } else {
      if (atLatestRef.current) setNewMessageCount(0)
      else setNewMessageCount(current => current + countNewMessages(knownMessageIds.current, page))
      knownMessageIds.current = new Set(page.map(message => message.id))
      setMessages(page)
    }
    setHasOlder(page.length === 100)
    setError(''); setLoading(false); setLoadingOlder(false)
  }, [huntId])

  // Chat loads from its database-backed source on mount and when the user returns online.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void loadMessages() }, [loadMessages])
  useEffect(() => {
    if (!supabase) return
    const requestCounter = requestId
    const channel = supabase.channel(`hunt-chat-${huntId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hunt_messages', filter: `hunt_id=eq.${huntId}` }, () => void loadMessages())
      .subscribe(status => setConnection(status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'reconnecting' : 'connecting'))
    const fallback = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMessages() }, 15_000)
    const reconcile = () => { if (document.visibilityState === 'visible') void loadMessages() }
    window.addEventListener('online', reconcile)
    window.addEventListener('focus', reconcile)
    return () => { ++requestCounter.current; window.clearInterval(fallback); window.removeEventListener('online', reconcile); window.removeEventListener('focus', reconcile); void supabase?.removeChannel(channel) }
  }, [huntId, loadMessages])
  useEffect(() => {
    if (loadingOlder) return
    if (preserveScroll.current) { preserveScroll.current = false; return }
    if (atLatest) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loadingOlder, atLatest])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!supabase || !body || sending || readOnly) return
    const operationId = crypto.randomUUID()
    setSending(true); setError('')
    const { error: sendError } = await supabase.rpc('send_hunt_message', { p_hunt_id: huntId, p_body: body })
    if (sendError) { setError(sendError.message); void reportOperation(huntId, operationId, 'chat_send_failed', 'failure') }
    else { setDraft(''); await loadMessages() }
    setSending(false)
  }

  const oldest = messages[0]?.created_at
  return <section className={`hunt-chat ${compact ? 'hunt-chat-compact' : ''}`} aria-label="Hunt chat">
    <div className="hunt-chat-heading"><div><span className="eyebrow"><MessageCircle size={14}/> HUNT CHAT</span><h2>Keep everyone in the loop</h2></div><span>{connection === 'live' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span></div>
    <div className="hunt-chat-messages" aria-live="polite" ref={messagesRef} onScroll={event => { const element = event.currentTarget; const latest = element.scrollHeight - element.scrollTop - element.clientHeight < 48; atLatestRef.current = latest; setAtLatest(latest); if (latest) setNewMessageCount(0) }}>
      {hasOlder && oldest && <button className="outline-button" type="button" disabled={loadingOlder} onClick={() => { preserveScroll.current = true; void loadMessages(oldest, true) }}>{loadingOlder ? 'Loading…' : 'Load older messages'}</button>}
      {loading ? <div className="hunt-chat-empty"><LoaderCircle className="spin" size={17}/> Loading messages…</div> : messages.length ? messages.map(message => <article className={`hunt-chat-message ${message.sender_role === 'organizer' ? 'organizer-message' : ''}`} key={message.id}><div className="hunt-chat-message-meta"><b>{message.sender_name}</b><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{message.body}</p></article>) : <div className="hunt-chat-empty">No messages yet. Say hello to your teams.</div>}
    </div>
    {!atLatest && <button type="button" className="outline-button" onClick={() => { atLatestRef.current = true; setAtLatest(true); setNewMessageCount(0); messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }) }}>Jump to latest{newMessageCount > 0 ? ` · ${newMessageCount} new` : ''}</button>}
    {readOnly ? <p className="hunt-chat-empty">This hunt is closed. Messages are available to read.</p> : <form className="hunt-chat-form" onSubmit={send}><input maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message to the hunt…" aria-label="Message"/><button className="primary-button" type="submit" disabled={sending || !draft.trim()}>{sending ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>}<span className="sr-only">Send message</span></button></form>}
    {error && <p className="hunt-chat-error" role="alert">{error} <button className="outline-button" type="button" onClick={() => void loadMessages()}>Retry</button></p>}
  </section>
}
