import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, ChevronRight, Compass, QrCode, ShieldCheck, Sparkles, Users } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { shouldRouteToOrganizerWorkspace } from './lib/appNavigation'
import QrInviteScanner from './components/QrInviteScanner'
import './App.css'
import './theme.css'

const OrganizerWorkspace = lazy(() => import('./pages/admin/OrganizerWorkspace'))
const SystemAdminWorkspace = lazy(() => import('./pages/admin/SystemAdminWorkspace'))
const JoinGame = lazy(() => import('./pages/participant/JoinGame'))
const ParticipantGame = lazy(() => import('./pages/participant/ParticipantGame'))
const LocalPlayerPreview = lazy(() => import('./components/GameManager').then(module => ({ default: module.LocalPlayerPreview })))
const LocalDemoWorkspace = lazy(() => import('./pages/admin/LocalDemoWorkspace'))

function RouteLoading() {
  return <main className="participant-shell"><section className="participant-message"><p role="status">Loading your hunt…</p></section></main>
}

function isPasswordRecoveryRedirect() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  return fragment.get('type') === 'recovery' || query.get('type') === 'recovery'
}

function isExpiredEmailLink() {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  return fragment.get('error_code') === 'otp_expired' || query.get('error_code') === 'otp_expired'
}

function App() {
  const collageUrl = `${import.meta.env.BASE_URL}adventure-collage.webp`
  const [homeMode, setHomeMode] = useState<'welcome' | 'player' | 'organizer' | 'development'>(() => isPasswordRecoveryRedirect() || isExpiredEmailLink() ? 'organizer' : 'welcome')
  const [email, setEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'confirm'>('signin')
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryRedirect)
  const [inviteInput, setInviteInput] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [message, setMessage] = useState(() => isExpiredEmailLink() ? 'This email link has expired. Request a fresh link below.' : '')
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
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      receivedAuthEvent = true
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        setHomeMode('organizer')
        setAuthMode('signin')
        setMessage('')
      }
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
  const systemAdminMatch = routeHash === '#/system-admin'

  if (systemAdminMatch && !authReady) return <RouteLoading/>
  if (systemAdminMatch && session && !session.user.is_anonymous) return <Suspense fallback={<RouteLoading/>}><SystemAdminWorkspace session={session} onSignOut={() => supabase?.auth.signOut()} /></Suspense>
  if (systemAdminMatch) return <main className="participant-shell"><section className="participant-message"><h1>Organizer sign-in required</h1><p>Sign in with the verified account that has the SnapQuest system administrator role.</p><button className="outline-button" onClick={() => { window.location.hash = ''; setHomeMode('organizer') }}>Go to organizer login</button></section></main>
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
      const redirectTo = `${window.location.origin}${window.location.pathname}`
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: authPassword, options: { emailRedirectTo: redirectTo } })
        if (error) setMessage(error.message)
        else if (!data.session) {
          setAuthPassword('')
          setAuthMode('confirm')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: authPassword })
        if (error?.code === 'email_not_confirmed') {
          setAuthPassword('')
          setAuthMode('confirm')
        } else setMessage(error ? error.message : 'Signing you in...')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown connection error'
      setMessage(detail.toLowerCase().includes('fetch')
        ? 'Could not reach Supabase. Check the project connection and try again.'
        : `Sign-in could not be completed: ${detail}`)
    } finally {
      setLoading(false)
    }
  }

  async function resendOrganizerConfirmation() {
    if (!supabase || !email.trim()) return
    setLoading(true); setMessage('')
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
      })
      setMessage(error?.status === 429
        ? 'Please wait a minute before asking for another email.'
        : (error?.status ?? 0) >= 500
          ? 'Email is temporarily unavailable. Try again shortly.'
          : 'If this address is awaiting confirmation, a new link is on its way.')
    } catch {
      setMessage('Could not send the confirmation. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function sendOrganizerSignInLink() {
    if (!supabase || !email.trim()) { setMessage('Enter your email address first.'); return }
    setLoading(true); setMessage('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}`, shouldCreateUser: false } })
      setMessage(error ? error.message : 'Check your email for a secure sign-in link.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send a sign-in link.')
    } finally { setLoading(false) }
  }

  async function requestPasswordReset() {
    if (!supabase || !email.trim()) { setMessage('Enter your email address first.'); return }
    setLoading(true); setMessage('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${window.location.pathname}` })
      setMessage(error ? error.message : 'If an account uses that email, a password recovery link is on its way.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not request password recovery.')
    } finally { setLoading(false) }
  }

  async function updateRecoveredPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || newPassword.length < 8) { setMessage('Choose a password with at least 8 characters.'); return }
    setLoading(true); setMessage('')
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) setMessage(error.message)
      else {
        setNewPassword('')
        setPasswordRecovery(false)
        setMessage('Your password has been updated.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update your password.')
    } finally { setLoading(false) }
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

  function acceptScannedInvite(value: string) {
    const token = value.match(/[a-f0-9]{64}/i)?.[0]
    setScannerOpen(false)
    if (!token) {
      setInviteError('That QR code is not a SnapQuest team invitation. Scan your team’s code or enter it below.')
      return
    }
    setInviteInput(token.toLowerCase())
    setInviteError('')
    window.location.hash = `/join/${token.toLowerCase()}`
  }

  if (session && shouldRouteToOrganizerWorkspace(session) && !passwordRecovery) return <Suspense fallback={<RouteLoading/>}><OrganizerWorkspace session={session} onSignOut={() => supabase?.auth.signOut()} /></Suspense>

  return <main className="home-scene">
    <div className="home-scene-backdrop" style={{ backgroundImage: `url("${collageUrl}")` }} aria-hidden="true" />
    <section className="home-panel" aria-label="SnapQuest home">
      <div className="home-panel-photo" style={{ backgroundImage: `url("${collageUrl}")` }} aria-hidden="true" />
      <div className="home-panel-shade" aria-hidden="true" />
      <div className="home-content-layer">
        <header className="home-header">
          {homeMode === 'welcome'
            ? <span className="home-header-note"><Sparkles size={15}/> A little adventure awaits</span>
            : <button className="home-back-button" type="button" disabled={passwordRecovery} onClick={() => { setHomeMode('welcome'); setMessage(''); setInviteError('') }}><ArrowLeft size={17}/> Back</button>}
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
            <button className="home-action home-action-organizer" type="button" onClick={() => setHomeMode('organizer')}>
              <Users className="home-action-icon" size={36}/>
              <span><strong>Organizer Login</strong><small>Create and manage games</small></span>
              <ChevronRight className="home-action-chevron" size={28}/>
            </button>
          </div>
        </section>}

        {homeMode === 'player' && <section className="home-form-card">
          <div className="home-form-icon home-form-icon-player"><Camera size={27}/></div>
          <p className="home-form-kicker">PLAYER CHECK-IN</p>
          <h1>Ready for the hunt?</h1>
          <p className="home-form-description">SnapQuest is a team photo scavenger hunt. Scan the QR code your organizer gave your team, or paste the invitation link or 64-character team code here.</p>
          <button type="button" className="home-scan-button" onClick={() => { setInviteError(''); setScannerOpen(true) }}><QrCode size={19}/> Scan a QR code <span>Use your camera</span></button>
          <div className="home-form-divider"><span>OR ENTER YOUR INVITE</span></div>
          <form onSubmit={openInvite}>
            <label htmlFor="invite-link">Team invitation</label>
            <input ref={inviteFieldRef} id="invite-link" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} required placeholder="Paste the team invitation link or code" value={inviteInput} onChange={event => { setInviteInput(event.target.value); setInviteError('') }}/>
            {inviteError && <p className="home-form-error" role="alert">{inviteError}</p>}
            <button className="home-form-submit home-form-submit-player" type="submit">Join the hunt <ArrowRight size={17}/></button>
          </form>
          <p className="home-form-helper">Your organizer or teammate can share an invite with you.</p>
        </section>}

        {homeMode === 'organizer' && <section className="home-form-card">
          <div className="home-form-icon"><Users size={27}/></div>
          <p className="home-form-kicker">ORGANIZER ACCOUNT</p>
          <h1>{passwordRecovery ? 'Choose a new password' : authMode === 'confirm' ? 'Check your email' : authMode === 'signup' ? 'Create your account' : 'Welcome back!'}</h1>
          {passwordRecovery ? <>
            {!authReady ? <p className="home-form-message" role="status">Verifying your password recovery link...</p> : session ? <>
              <p className="home-form-description">Use at least 8 characters. After saving, you will return to your organizer workspace.</p>
              <form onSubmit={updateRecoveredPassword}>
                <label htmlFor="recovered-password">New password</label>
                <input id="recovered-password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)}/>
                <button className="home-form-submit" type="submit" disabled={!isSupabaseConfigured || loading}>{loading ? 'Saving...' : <>Save new password <ArrowRight size={17}/></>}</button>
                {message && <p className="home-form-message" role="status">{message}</p>}
              </form>
            </> : <>
              <p className="home-form-message" role="alert">This recovery link is expired or unavailable. Return to sign in and request a new password reset.</p>
              <button type="button" className="text-button" onClick={() => { setPasswordRecovery(false); setMessage('') }}>Return to sign in</button>
            </>}
          </> : authMode === 'confirm' ? <>
            <p className="home-form-description">If you just created an account, look for a confirmation link for <strong>{email.trim().slice(0, 1)}•••@{email.trim().split('@').pop()}</strong>. Check spam or junk if it hasn’t arrived.</p>
            <button className="home-form-submit" type="button" disabled={loading} onClick={() => void resendOrganizerConfirmation()}>{loading ? 'Sending…' : 'Resend confirmation email'}</button>
            {message && <p className="home-form-message" role="status">{message}</p>}
            <div className="home-form-auth-options">
              <button type="button" className="text-button" disabled={loading} onClick={() => { setAuthMode('signup'); setMessage('') }}>Change email address</button>
              <button type="button" className="text-button" disabled={loading} onClick={() => { setAuthMode('signin'); setMessage('') }}>Return to sign in</button>
            </div>
          </> : <>
            <p className="home-form-description">Use your email as your login. If you used SnapQuest's earlier passwordless login, use the sign-in link below. Players can still join a hunt with a team invite and no account.</p>
            <form onSubmit={signIn}>
              <label htmlFor="email">Email address</label>
              <input ref={emailFieldRef} id="email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}/>
              <label htmlFor="organizer-password">Password</label>
              <input id="organizer-password" type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} minLength={authMode === 'signup' ? 8 : undefined} required value={authPassword} onChange={event => setAuthPassword(event.target.value)}/>
              <button className="home-form-submit" type="submit" disabled={!isSupabaseConfigured || loading}>{loading ? 'Please wait...' : authMode === 'signup' ? <>Create organizer account <ArrowRight size={17}/></> : <>Sign in <ArrowRight size={17}/></>}</button>
              {message && <p className="home-form-message" role="status">{message}</p>}
            </form>
            {!isSupabaseConfigured && <p className="home-form-config">Add your Supabase project settings to <code>.env.local</code> to enable organizer sign-in.</p>}
            <div className="home-form-helper home-form-secure"><ShieldCheck size={15}/> Email is your private login; your display name is public.</div>
            <div className="home-form-auth-options">
              <button type="button" className="text-button" onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setMessage('') }}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'Create an organizer account'}</button>
              {authMode === 'signin' && <><button type="button" className="text-button" disabled={loading} onClick={() => void sendOrganizerSignInLink()}>Email me a sign-in link</button><button type="button" className="text-button" disabled={loading} onClick={() => void requestPasswordReset()}>Forgot password?</button><button type="button" className="text-button" disabled={loading} onClick={() => {
                if (!email.trim() || !emailFieldRef.current?.checkValidity()) {
                  setMessage('Enter your email address first.')
                  emailFieldRef.current?.focus()
                  return
                }
                setAuthMode('confirm')
                void resendOrganizerConfirmation()
              }}>Resend account confirmation</button></>}
            </div>
          </>}
        </section>}
      </div>
    </section>
    {scannerOpen && <QrInviteScanner onDetected={acceptScannedInvite} onClose={() => setScannerOpen(false)}/>}
  </main>
}

export default App
