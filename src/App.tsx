import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, ChevronRight, Compass, ShieldCheck, Sparkles, Users } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { shouldRouteToOrganizerWorkspace } from './lib/appNavigation'
import './App.css'
import './theme.css'

const OrganizerWorkspace = lazy(() => import('./pages/admin/OrganizerWorkspace'))
const JoinGame = lazy(() => import('./pages/participant/JoinGame'))
const ParticipantGame = lazy(() => import('./pages/participant/ParticipantGame'))
const LocalPlayerPreview = lazy(() => import('./components/GameManager').then(module => ({ default: module.LocalPlayerPreview })))
const LocalDemoWorkspace = lazy(() => import('./pages/admin/LocalDemoWorkspace'))

function RouteLoading() {
  return <main className="participant-shell"><section className="participant-message"><p role="status">Loading your hunt…</p></section></main>
}

function App() {
  const collageUrl = `${import.meta.env.BASE_URL}adventure-collage.webp`
  const [homeMode, setHomeMode] = useState<'welcome' | 'player' | 'organizer' | 'development'>('welcome')
  const [email, setEmail] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [authError, setAuthError] = useState('')
  const [routeHash, setRouteHash] = useState(window.location.hash)
  const inviteFieldRef = useRef<HTMLInputElement>(null)
  const emailFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (homeMode === 'player') inviteFieldRef.current?.focus()
    if (homeMode === 'organizer') emailFieldRef.current?.focus()
  }, [homeMode])

  useEffect(() => {
    const onHashChange = () => setRouteHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false, receivedAuthEvent = false
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      receivedAuthEvent = true
      if (!cancelled) { setSession(nextSession); setAuthReady(true); setAuthError('') }
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled || receivedAuthEvent) return
      if (error) setAuthError('Could not restore your saved session. Check your connection and retry.')
      else setSession(data.session)
      setAuthReady(true)
    }).catch(() => {
      if (!cancelled && !receivedAuthEvent) { setAuthError('Could not restore your saved session. Check your connection and retry.'); setAuthReady(true) }
    })
    return () => { cancelled = true; listener.subscription.unsubscribe() }
  }, [])

  const joinMatch = routeHash.match(/^#\/join\/([0-9a-f]{64})$/i)
  const playMatch = routeHash.match(/^#\/play\/([0-9a-f-]{36})$/i)
  const manageMatch = routeHash.match(/^#\/manage\/([0-9a-f-]{36})$/i)

  if ((joinMatch || playMatch) && (!authReady || authError)) return <main className="participant-shell"><section className="participant-message"><h1>{authError ? 'Reconnect to your game' : 'Restoring your saved session'}</h1><p role={authError ? 'alert' : 'status'}>{authError || 'Checking your existing identity before opening the game…'}</p>{authError && <button className="outline-button" onClick={() => window.location.reload()}>Retry connection</button>}</section></main>
  if (joinMatch) return <Suspense fallback={<RouteLoading/>}><JoinGame token={joinMatch[1]} session={session} /></Suspense>
  if (playMatch && !session) return <main className="participant-shell"><section className="participant-message"><h1>Your saved game session is unavailable</h1><p>Return in the same browser and website address you used to join. Clearing site data, private browsing, signing out, or using a different device can lose guest access. Ask your organizer for help; your name alone cannot recover your identity.</p><a className="outline-button" href={window.location.pathname}>Return home</a></section></main>
  if (playMatch && session) return <Suspense fallback={<RouteLoading/>}><ParticipantGame huntId={playMatch[1]} session={session} /></Suspense>
  if (manageMatch && session && !session.user.is_anonymous) return <Suspense fallback={<RouteLoading/>}><OrganizerWorkspace session={session} onSignOut={() => supabase?.auth.signOut()} initialHuntId={manageMatch[1]} /></Suspense>
  const demoPlayerMatch = routeHash.match(/^#\/dev\/player\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)$/)
  if (import.meta.env.DEV && demoPlayerMatch) return <Suspense fallback={<RouteLoading/>}><LocalPlayerPreview key={`${demoPlayerMatch[1]}-${demoPlayerMatch[2]}`} gameId={demoPlayerMatch[1]} token={demoPlayerMatch[2]}/></Suspense>
  if (import.meta.env.DEV && routeHash.startsWith('#/dev/')) return <Suspense fallback={<RouteLoading/>}><LocalDemoWorkspace routeHash={routeHash} /></Suspense>
  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setLoading(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } })
      setMessage(error ? error.message : 'Check your email for a secure sign-in link.')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown connection error'
      setMessage(detail.toLowerCase().includes('fetch')
        ? 'Could not reach Supabase. Check the project connection and try again.'
        : `Sign-in could not be completed: ${detail}`)
    } finally {
      setLoading(false)
    }
  }

  function openInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = inviteInput.match(/[a-f0-9]{64}/i)?.[0]
    if (!token) {
      setInviteError('Enter the 64-character team code or paste your full invitation link.')
      return
    }
    window.location.hash = `/join/${token}`
  }

  if (session && shouldRouteToOrganizerWorkspace(session)) return <Suspense fallback={<RouteLoading/>}><OrganizerWorkspace session={session} onSignOut={() => supabase?.auth.signOut()} /></Suspense>

  return <main className="home-scene">
    <div className="home-scene-backdrop" style={{ backgroundImage: `url("${collageUrl}")` }} aria-hidden="true" />
    <section className="home-panel" aria-label="SnapQuest home">
      <div className="home-panel-photo" style={{ backgroundImage: `url("${collageUrl}")` }} aria-hidden="true" />
      <div className="home-panel-shade" aria-hidden="true" />
      <div className="home-content-layer">
        <header className="home-header">
          {homeMode === 'welcome'
            ? <span className="home-header-note"><Sparkles size={15}/> A little adventure awaits</span>
            : <button className="home-back-button" type="button" onClick={() => { setHomeMode('welcome'); setMessage(''); setInviteError('') }}><ArrowLeft size={17}/> Back</button>}
          <span className="home-header-trust"><ShieldCheck size={15}/> FAMILY FUN, CAPTURED</span>
        </header>

        {homeMode === 'welcome' && <section className="home-welcome">
          <div className="home-intro">
            <div className="home-wordmark" aria-label="SnapQuest photo scavenger hunt">
              <span className="home-camera-badge"><Camera size={32}/></span>
              <div className="home-word-snap">SNAP</div>
              <div className="home-word-quest"><Compass className="home-compass" size={48}/><span>QUEST</span></div>
              <div className="home-ribbon">PHOTO SCAVENGER HUNT</div>
            </div>
            <div className="home-paint-swipe"><span>EXPLORE&nbsp; • &nbsp;CAPTURE&nbsp; • &nbsp;COMPETE</span><strong>MAKE MEMORIES</strong></div>
            <p className="home-footnote"><ShieldCheck size={14}/> Join with your team link, or create a hunt for friends.</p>
          </div>
          <div className="home-actions" aria-label="Choose how to get started">
            <button className="home-action home-action-player" type="button" onClick={() => setHomeMode('player')}>
              <Camera className="home-action-icon" size={37}/>
              <span><strong>I’m a Player</strong><small>Join a game and start the adventure</small></span>
              <ChevronRight className="home-action-chevron" size={28}/>
            </button>
            <button className="home-action home-action-organizer" type="button" onClick={() => { if (import.meta.env.DEV) window.location.hash = '/dev/browse'; else setHomeMode('organizer') }}>
              <Users className="home-action-icon" size={36}/>
              <span><strong>{import.meta.env.DEV ? 'Open Organizer Preview' : 'Organizer Login'}</strong><small>{import.meta.env.DEV ? 'Explore locally without signing in' : 'Create and manage games'}</small></span>
              <ChevronRight className="home-action-chevron" size={28}/>
            </button>
          </div>
        </section>}

        {homeMode === 'player' && <section className="home-form-card">
          <div className="home-form-icon home-form-icon-player"><Camera size={27}/></div>
          <p className="home-form-kicker">PLAYER CHECK-IN</p>
          <h1>Ready for the hunt?</h1>
          <p className="home-form-description">Scan your team’s QR code with your phone camera, or paste the invitation link or team code here.</p>
          <form onSubmit={openInvite}>
            <label htmlFor="invite-link">Team invitation</label>
            <input ref={inviteFieldRef} id="invite-link" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} required placeholder="Paste your invite link or code" value={inviteInput} onChange={event => { setInviteInput(event.target.value); setInviteError('') }}/>
            {inviteError && <p className="home-form-error" role="alert">{inviteError}</p>}
            <button className="home-form-submit home-form-submit-player" type="submit">Join the hunt <ArrowRight size={17}/></button>
          </form>
          <p className="home-form-helper">Your organizer or teammate can share an invite with you.</p>
        </section>}

        {homeMode === 'organizer' && <section className="home-form-card">
          <div className="home-form-icon"><Users size={27}/></div>
          <p className="home-form-kicker">ORGANIZER LOGIN</p>
          <h1>Welcome back!</h1>
          <p className="home-form-description">Sign in to create a hunt and bring your crew together.</p>
          <form onSubmit={signIn}>
            <label htmlFor="email">Email address</label>
            <input ref={emailFieldRef} id="email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}/>
            <button className="home-form-submit" type="submit" disabled={!isSupabaseConfigured || loading}>{loading ? 'Sending link…' : <>Send me a sign-in link <ArrowRight size={17}/></>}</button>
            {message && <p className="home-form-message" role="status">{message}</p>}
          </form>
          {!isSupabaseConfigured && <p className="home-form-config">Add your Supabase project settings to <code>.env.local</code> to enable organizer sign-in.</p>}
          <div className="home-form-helper home-form-secure"><ShieldCheck size={15}/> Secure, password-free sign in</div>
        </section>}
      </div>
    </section>
  </main>
}

export default App
