import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, MessageCircle, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { reportOperation } from '../lib/operationLog'
import type { OperationApp } from '../lib/operationLog'
import { countNewMessages } from '../lib/chatMessages'

type HuntMessage = { id: string; sender_name: string; sender_role: 'organizer' | 'participant'; body: string; created_at: string }

export default function HuntChat({ huntId, compact = false, readOnly = false, app = 'participant_web' }: { huntId: string; compact?: boolean; readOnly?: boolean; app?: OperationApp }) {
  const [messages, setMessages] = useState<HuntMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [errorAction, setErrorAction] = useState<'load' | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'live' | 'reconnecting' | 'offline'>(() => navigator.onLine ? 'connecting' : 'offline')
  const [atLatest, setAtLatest] = useState(true)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const messagesRef = useRef<HTMLDivElement>(null)
  const knownMessageIds = useRef(new Set<string>())
  const atLatestRef = useRef(true)
  const requestId = useRef(0)
  const preserveScroll = useRef(false)
  const loadedHuntId = useRef<string | null>(null)
  const legacyPagingHuntId = useRef<string | null>(null)

  const loadMessages = useCallback(async (before?: Pick<HuntMessage, 'created_at' | 'id'>, older = false) => {
    if (!supabase) return
    const id = ++requestId.current
    if (older) setLoadingOlder(true)
    let usingLegacyPaging = legacyPagingHuntId.current === huntId
    let result = usingLegacyPaging
      ? await supabase.rpc('get_hunt_messages', { p_hunt_id: huntId, p_limit: 100, p_before: before?.created_at ?? null })
      : await supabase.rpc('get_hunt_messages', { p_hunt_id: huntId, p_limit: 101, p_before: before?.created_at ?? null, p_before_id: before?.id ?? null })
    if (!usingLegacyPaging && result.error?.code === 'PGRST202') {
      // Production may still have the timestamp-only RPC until migration 024 is applied.
      legacyPagingHuntId.current = huntId
      usingLegacyPaging = true
      result = await supabase.rpc('get_hunt_messages', { p_hunt_id: huntId, p_limit: 100, p_before: before?.created_at ?? null })
    }
    const { data, error: loadError } = result
    if (id !== requestId.current) return
    if (loadError) { void reportOperation(huntId, crypto.randomUUID(), 'chat_load_failed', 'failure', app); setError('Messages could not be refreshed. Check your connection and retry.'); setErrorAction('load'); setLoading(false); setLoadingOlder(false); return }
    const rows = Array.isArray(data) ? data as HuntMessage[] : []
    const page = older ? (rows.length > 100 ? rows.slice(1) : rows) : rows.slice(-100)
    const newHunt = !older && loadedHuntId.current !== huntId
    if (older) {
      for (const message of page) knownMessageIds.current.add(message.id)
      setMessages(current => [...page.filter(row => !current.some(existing => existing.id === row.id)), ...current])
    } else {
      const unread = countNewMessages(knownMessageIds.current, page)
      if (newHunt || atLatestRef.current) setNewMessageCount(0)
      else if (unread > 0) setNewMessageCount(current => current + unread)
      knownMessageIds.current = new Set(page.map(message => message.id))
      setMessages(current => {
        if (newHunt) return page
        const merged = new Map(current.map(message => [message.id, message]))
        for (const message of page) merged.set(message.id, message)
        return [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      })
    }
    if (older || newHunt) setHasOlder(usingLegacyPaging ? rows.length === 100 : rows.length > 100)
    if (!older) loadedHuntId.current = huntId
    setError(''); setErrorAction(null); setLoading(false); setLoadingOlder(false)
  }, [app, huntId])

  // Chat loads from its database-backed source on mount and when the user returns online.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void loadMessages() }, [loadMessages])
  useEffect(() => {
    if (!supabase) return
    const requestCounter = requestId
    const markOffline = () => setConnection('offline')
    const markOnline = () => { setConnection('reconnecting'); if (document.visibilityState === 'visible') void loadMessages() }
    let replicationReady = false
    const channel = supabase.channel(`hunt-chat-${huntId}`, { config: { broadcast: { replication_ready: true } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hunt_messages', filter: `hunt_id=eq.${huntId}` }, () => void loadMessages())
      .on('system', {}, payload => {
        if (payload.extension !== 'system') return
        if (payload.status === 'ok') { replicationReady = true; setConnection(navigator.onLine ? 'live' : 'offline') }
        else if (payload.status === 'error') { replicationReady = false; setConnection(navigator.onLine ? 'reconnecting' : 'offline') }
      })
      .subscribe(status => {
        if (!navigator.onLine) setConnection('offline')
        else if (status === 'SUBSCRIBED') setConnection(replicationReady ? 'live' : 'connected')
        else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { replicationReady = false; setConnection('reconnecting') }
        else setConnection('connecting')
      })
    const fallback = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMessages() }, 15_000)
    const reconcile = () => { if (document.visibilityState === 'visible') void loadMessages() }
    window.addEventListener('online', markOnline)
    window.addEventListener('offline', markOffline)
    window.addEventListener('focus', reconcile)
    return () => { ++requestCounter.current; window.clearInterval(fallback); window.removeEventListener('online', markOnline); window.removeEventListener('offline', markOffline); window.removeEventListener('focus', reconcile); void supabase?.removeChannel(channel) }
  }, [huntId, loadMessages])
  useEffect(() => {
    if (loadingOlder) return
    if (preserveScroll.current) { preserveScroll.current = false; return }
    if (atLatestRef.current && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages, loadingOlder, atLatest])

  async function sendMessage(body: string) {
    if (!supabase || !body || sending || readOnly) return
    const operationId = crypto.randomUUID()
    setSending(true); setError(''); setErrorAction(null)
    const { error: sendError } = await supabase.rpc('send_hunt_message', { p_hunt_id: huntId, p_body: body })
    if (sendError) { setError('Message could not be confirmed. Check the chat for your message before trying again; your draft is still here.'); void reportOperation(huntId, operationId, 'chat_send_failed', 'failure', app) }
    else { setDraft(''); setErrorAction(null); await loadMessages() }
    setSending(false)
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendMessage(draft.trim())
  }

  const oldest = messages[0]
  return <section className={`hunt-chat ${compact ? 'hunt-chat-compact' : ''}`} aria-label="Hunt chat">
    <div className="hunt-chat-heading"><div><span className="eyebrow"><MessageCircle size={14}/> HUNT CHAT</span><h2>Keep everyone in the loop</h2></div><span aria-live="polite">{connection === 'offline' ? 'Offline' : connection === 'live' ? 'Live' : connection === 'connected' ? 'Connected' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span></div>
    {connection === 'offline' && <p className="hunt-chat-error" role="status">You are offline. New messages will refresh when you reconnect.</p>}
    <div className="hunt-chat-messages" aria-live="polite" ref={messagesRef} onScroll={event => { const element = event.currentTarget; const latest = element.scrollHeight - element.scrollTop - element.clientHeight < 48; atLatestRef.current = latest; setAtLatest(latest); if (latest) setNewMessageCount(0) }}>
      {hasOlder && oldest && <button className="outline-button" type="button" disabled={loadingOlder} onClick={() => { preserveScroll.current = true; void loadMessages(oldest, true) }}>{loadingOlder ? 'Loading…' : 'Load older messages'}</button>}
      {loading ? <div className="hunt-chat-empty"><LoaderCircle className="spin" size={17}/> Loading messages…</div> : messages.length ? messages.map(message => <article className={`hunt-chat-message ${message.sender_role === 'organizer' ? 'organizer-message' : ''}`} key={message.id}><div className="hunt-chat-message-meta"><b>{message.sender_name}</b><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{message.body}</p></article>) : <div className="hunt-chat-empty">No messages yet. Say hello to your teams.</div>}
    </div>
    {!atLatest && <button type="button" className="outline-button" onClick={() => { atLatestRef.current = true; setAtLatest(true); setNewMessageCount(0); messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }) }}>Jump to latest{newMessageCount > 0 ? ` · ${newMessageCount} new` : ''}</button>}
    {readOnly ? <p className="hunt-chat-empty">This hunt is closed. Messages are available to read.</p> : <form className="hunt-chat-form" onSubmit={send}><input maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message to the hunt…" aria-label="Message"/><button className="primary-button" type="submit" disabled={sending || !draft.trim()}>{sending ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>}<span className="sr-only">Send message</span></button></form>}
    {error && <p className="hunt-chat-error" role="alert">{error}{errorAction === 'load' && <> <button className="outline-button" type="button" onClick={() => void loadMessages()}>Retry</button></>}</p>}
  </section>
}
