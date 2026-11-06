import { useCallback, useEffect, useState } from 'react'
import { Bug, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

type AuditEvent = { id: string; created_at: string; event_type: string; outcome: 'success' | 'failure' | 'notice'; source: 'client-reported' | 'server-authoritative'; details: Record<string, unknown> }

export default function HuntDiagnostics({ huntId }: { huntId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error: loadError } = await supabase.rpc('list_hunt_audit_events', { p_hunt_id: huntId, p_limit: 50 })
    if (loadError) setError('Could not load hunt diagnostics.')
    else { setEvents(Array.isArray(data) ? data as AuditEvent[] : []); setError('') }
  }, [huntId])
  // Load the owner-only operational history when the hunt panel opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  return <details className="hunt-diagnostics"><summary><Bug size={15}/> Troubleshooting log <button type="button" className="outline-button" onClick={event => { event.preventDefault(); void load() }}><RefreshCw size={13}/> Refresh</button></summary>{error && <p role="alert">{error}</p>}{events.length ? <ol>{events.map(event => <li key={event.id}><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time><b>{event.event_type.replaceAll('_',' ')}</b><span>{event.source === 'client-reported' ? 'Client reported' : 'Server authoritative'}</span><span className={`diagnostic-${event.outcome}`}>{event.outcome}</span>{typeof event.details.operation_id === 'string' && <code>Operation {event.details.operation_id}</code>}{typeof event.details.stage === 'string' && <span>{event.details.stage.replaceAll('_',' ')}</span>}</li>)}</ol> : !error && <p>No recorded events for this hunt yet.</p>}<small>Client reports are limited to a stage and operation ID; the log never stores photos, invitation tokens, signed links, or chat text. Events expire after 365 days.</small></details>
}
