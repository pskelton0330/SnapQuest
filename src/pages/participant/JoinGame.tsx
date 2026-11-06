import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Camera, CircleHelp, LoaderCircle, MapPin, ShieldCheck, Users } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { joinInvitation, resumeInvitation } from '../../lib/participantSession'

type JoinGameProps = { token: string; session: Session | null }
type InvitePreview = { title: string; venue: string; team_name: string; start_at: string; duration_minutes: number }

export default function JoinGame({ token, session }: JoinGameProps) {
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [joining, setJoining] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [resumeFailed, setResumeFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [preview, setPreview] = useState<InvitePreview | null>(null)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void supabase.rpc('preview_invitation', { p_token: token }).then(({ data }) => {
      if (!cancelled && data) setPreview(data as InvitePreview)
    })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    let cancelled = false
    async function resume() {
      setCheckingSession(true); setResumeFailed(false); setMessage('')
      try {
        if (!supabase) throw new Error('The game connection is not configured.')
        const result = await resumeInvitation(supabase, token)
        if (cancelled) return
        // Replace the stale invite entry so browser Back does not immediately
        // reopen this route and push the participant forward into another loop.
        if (result) window.location.replace(`${window.location.pathname}${window.location.search}#/play/${result.hunt_id}`)
      } catch (error) {
        if (!cancelled) {
          setResumeFailed(true)
          setMessage(error instanceof Error ? error.message : 'Could not restore your game. Check your connection and try again.')
        }
      } finally { if (!cancelled) setCheckingSession(false) }
    }
    void resume()
    return () => { cancelled = true }
  }, [session?.user.id, token, retry])

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setJoining(true); setMessage('')
    try {
      const result = await joinInvitation(supabase, token, displayName)
      window.location.replace(`${window.location.pathname}${window.location.search}#/play/${result.hunt_id}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not join this hunt.'
      setMessage(detail.toLowerCase().includes('anonymous') || detail.toLowerCase().includes('provider')
        ? 'Participant sign-in is not enabled for this Supabase project yet. Ask the organizer to enable anonymous sign-ins, then try this link again.'
        : detail)
    } finally { setJoining(false) }
  }

  if (checkingSession) return <main className="participant-shell"><div className="participant-loading"><LoaderCircle size={24}/> Checking your saved participant session…</div></main>

  return <main className="participant-shell">
    <header className="participant-topbar"><a className="brand" href="#"><span className="brand-icon"><Camera size={19}/></span> SnapQuest</a><span className="nav-note"><ShieldCheck size={15}/> Private game invitation</span></header>
    <section className="join-card">
      <span className="join-icon"><MapPin size={24}/></span>
      <p className="card-kicker">YOU’RE INVITED</p>
      <h1>{preview?.title || 'Join the photo hunt'}</h1>
      {preview && <div className="join-preview"><span><MapPin size={14}/>{preview.venue}</span><span><Users size={14}/>{preview.team_name}</span></div>}
      <p className="join-description">Add your name to meet your team and get ready to play.</p>
      {resumeFailed ? <div className="participant-error" role="alert"><p>{message}</p><p>Your saved identity has not been replaced. Retry before joining.</p><button className="outline-button" onClick={() => setRetry(value => value + 1)}>Retry connection</button></div> : <form onSubmit={join}>
        <label htmlFor="participant-name">What should your team call you?</label>
        <input id="participant-name" autoComplete="nickname" required minLength={1} maxLength={40} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Your name"/>
        {message && <div className="participant-error" role="alert"><CircleHelp size={15}/>{message}</div>}
        <button className="primary-button" type="submit" disabled={joining || !supabase}>{joining ? <><LoaderCircle className="spin" size={16}/> Joining…</> : <>Join the hunt <ArrowRight size={16}/></>}</button>
      </form>}
      <div className="secure-note"><Users size={15}/> No email or password needed</div>
    </section>
    <footer className="participant-footer">SnapQuest <i>•</i> Make memories. Find the fun.</footer>
  </main>
}
