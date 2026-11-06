import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Camera, Check, CircleHelp, Clock3, LoaderCircle, MapPin, ShieldCheck, Trophy, Users, RefreshCw, Image as ImageIcon, Settings2 } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { optimizePhoto } from '../../lib/photo'
import { completePhotoCleanup, pendingPhotoCleanup, queuePhotoCleanup } from '../../lib/photoCleanup'
import HuntChat from '../../components/HuntChat'

type ParticipantGameProps = { huntId: string; session: Session }
type TeamMate = { id: string; display_name: string }
type TeamSelfie = { storage_path: string; submitted_by: string; submitted_at: string }
type HuntContext = {
  participant_id: string; hunt_id: string; title: string; venue: string; rules: string[]; status: string
  runtime_state: 'waiting' | 'active' | 'ended' | 'review' | 'completed'; start_at: string | null; ends_at: string | null; duration_minutes: number
  server_now: string; team: { id: string; name: string; display_color: string; selfie: TeamSelfie | null }; participant: TeamMate; teammates: TeamMate[]
}
type HuntItem = { id: string; title_snapshot: string; description_snapshot: string | null; point_value: number; display_order: number }
type TeamProgress = { team_id: string; team_name: string; display_color: string; accepted_count: number; total_items: number }
type PhotoSubmission = { id: string; hunt_item_id: string; team_id: string; participant_id: string; storage_path: string; submitted_at: string; approval_status: string; photoUrl: string }
type ReviewGallery = { voting_enabled: boolean; voting_bonus_points: number; status: string; final_scores: {team_id:string;team_name:string;base_points:number;voting_bonus:number;total:number;rank:number}[]; teams: {id:string;name:string;display_color:string}[]; items: {id:string;title:string;points:number;display_order:number}[]; submissions: {id:string;item_id:string;team_id:string;storage_path:string;status:string;photo_url?:string}[]; votes: {item_id:string;voting_team_id:string;selected_team_id:string}[] }

function clockLabel(seconds: number) {
  if (seconds < 0) return 'WAITING'
  const safe = Math.max(0, seconds)
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`
}

export default function ParticipantGame({ huntId, session }: ParticipantGameProps) {
  const [context, setContext] = useState<HuntContext | null>(null)
  const [items, setItems] = useState<HuntItem[]>([])
  const [submissions, setSubmissions] = useState<Record<string, PhotoSubmission>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({})
  const [reviewGallery, setReviewGallery] = useState<ReviewGallery | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [serverNow, setServerNow] = useState(0)
  const [teamProgress, setTeamProgress] = useState<TeamProgress[]>([])
  const [teamNameDraft, setTeamNameDraft] = useState('')
  const [teamNameDirty, setTeamNameDirty] = useState(false)
  const [teamIdentityBusy, setTeamIdentityBusy] = useState(false)
  const [teamIdentityError, setTeamIdentityError] = useState('')
  const [selfieUrl, setSelfieUrl] = useState('')

  const flushPhotoCleanup = useCallback(async () => {
    if (!supabase || !context || typeof window === 'undefined') return
    const storage = window.localStorage
    for (const path of pendingPhotoCleanup(storage, huntId, context.team.id)) {
      const { error: cleanupError } = await supabase.storage.from('hunt-photos').remove([path])
      if (!cleanupError) completePhotoCleanup(storage, huntId, context.team.id, path)
    }
  }, [context, huntId])

  const loadContext = useCallback(async () => {
    if (!supabase) return
    const { data, error: contextError } = await supabase.rpc('get_participant_context', { p_hunt_id: huntId })
    if (contextError) { setError(contextError.message); setLoading(false); return }
    const next = data as HuntContext
    setContext(next)
    if (!teamNameDirty) setTeamNameDraft(next.team.name)
    setServerNow(new Date(next.server_now).getTime())
    const { data: progress, error: progressError } = await supabase.rpc('get_hunt_progress', { p_hunt_id: huntId })
    if (!progressError && Array.isArray(progress)) setTeamProgress(progress as TeamProgress[])
    setError('')
    setLoading(false)
  }, [huntId, teamNameDirty])

  useEffect(() => {
    let cancelled = false
    // The preview mirrors the external signed-URL resource for the current team.
    // eslint-disable-next-line react/set-state-in-effect
    setSelfieUrl('')
    if (!supabase || !context?.team.selfie) return
    void supabase.storage.from('hunt-photos').createSignedUrl(context.team.selfie.storage_path, 300).then(({ data }) => {
      if (!cancelled) setSelfieUrl(data?.signedUrl ?? '')
    })
    return () => { cancelled = true }
  }, [context])

  // Initial load synchronizes this screen with the authoritative participant session.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadContext() }, [loadContext])
  useEffect(() => {
    const reconcile = () => { if (document.visibilityState === 'visible') void loadContext() }
    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('online', reconcile)
    window.addEventListener('focus', reconcile)
    return () => {
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('online', reconcile)
      window.removeEventListener('focus', reconcile)
    }
  }, [loadContext])
  useEffect(() => {
    if (!context) return
    const retry = () => { if (document.visibilityState === 'visible') void flushPhotoCleanup() }
    void flushPhotoCleanup()
    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
    return () => { window.removeEventListener('online', retry); window.removeEventListener('focus', retry) }
  }, [context, flushPhotoCleanup])
  useEffect(() => {
    const tick = window.setInterval(() => setServerNow(value => value ? value + 1000 : 0), 1000)
    const refresh = window.setInterval(() => void loadContext(), 15_000)
    return () => { window.clearInterval(tick); window.clearInterval(refresh) }
  }, [loadContext])
  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel(`participant-hunt-${huntId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `hunt_id=eq.${huntId}` }, () => void loadContext())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `hunt_id=eq.${huntId}` }, () => void loadContext())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hunts', filter: `id=eq.${huntId}` }, () => void loadContext())
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [huntId, loadContext])

  const runtimeState = useMemo(() => {
    if (!context) return 'waiting'
    if (context.status === 'completed') return 'completed'
    if (context.status === 'review') return 'review'
    if (!context.start_at) return 'waiting'
    if (context.ends_at && serverNow >= new Date(context.ends_at).getTime()) return 'ended'
    if (serverNow < new Date(context.start_at).getTime()) return 'waiting'
    return 'active'
  }, [serverNow, context])

  useEffect(() => {
    if (!supabase || !context || !['active', 'review', 'completed'].includes(runtimeState)) return
    let cancelled = false
    async function loadItems() {
      const [itemResult, submissionResult] = await Promise.all([
        supabase!.from('hunt_items').select('id,title_snapshot,description_snapshot,point_value,display_order').eq('hunt_id', huntId).order('display_order'),
        supabase!.from('submissions').select('id,hunt_item_id,team_id,participant_id,storage_path,submitted_at,approval_status').eq('hunt_id', huntId),
      ])
      if (cancelled) return
      if (itemResult.error) { setError(itemResult.error.message); return }
      if (submissionResult.error) { setError(submissionResult.error.message); return }
      setItems(itemResult.data ?? [])
      const photoRows = (submissionResult.data ?? []) as Omit<PhotoSubmission, 'photoUrl'>[]
      const signed = await Promise.all(photoRows.map(async row => {
        const { data: urlData, error: urlError } = await supabase!.storage.from('hunt-photos').createSignedUrl(row.storage_path, 300)
        return urlData && !urlError ? { ...row, photoUrl: urlData.signedUrl } : null
      }))
      if (!cancelled) setSubmissions(Object.fromEntries(signed.filter((row): row is PhotoSubmission => row !== null).map(row => [row.hunt_item_id, row])))
    }
    void loadItems()
    return () => { cancelled = true }
  }, [context, huntId, runtimeState])

  useEffect(() => {
    if (!supabase || !['review','completed'].includes(runtimeState)) return
    let cancelled = false
    async function loadReviewGallery() {
      const { data, error: galleryError } = await supabase!.rpc('get_hunt_review_gallery', { p_hunt_id: huntId })
      if (galleryError) { if (!cancelled) setError(galleryError.message); return }
      const result = data as ReviewGallery
      const signed = await Promise.all(result.submissions.map(async photo => {
        const { data: url } = await supabase!.storage.from('hunt-photos').createSignedUrl(photo.storage_path, 300)
        return { ...photo, photo_url: url?.signedUrl }
      }))
      if (!cancelled) setReviewGallery({ ...result, submissions: signed })
    }
    void loadReviewGallery()
    return () => { cancelled = true }
  }, [huntId, runtimeState])

  const remainingSeconds = context?.ends_at ? Math.ceil((new Date(context.ends_at).getTime() - serverNow) / 1000) : 0
  const untilStart = context?.start_at ? Math.ceil((new Date(context.start_at).getTime() - serverNow) / 1000) : -1

  async function saveTeamName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !context) return
    const name = teamNameDraft.trim()
    if (!name || name.toLowerCase() === context.team.name.toLowerCase()) { setTeamNameDirty(false); setTeamNameDraft(context.team.name); return }
    setTeamIdentityBusy(true); setTeamIdentityError('')
    const { error: nameError } = await supabase.rpc('set_team_name', { p_hunt_id: huntId, p_team_id: context.team.id, p_name: name })
    if (nameError) setTeamIdentityError(nameError.message)
    else {
      setTeamNameDirty(false)
      setContext(current => current ? { ...current, team: { ...current.team, name } } : current)
    }
    setTeamIdentityBusy(false)
  }

  async function submitTeamSelfie(file?: File) {
    if (!supabase || !context || !file) return
    setTeamIdentityBusy(true); setTeamIdentityError('')
    let storagePath = ''
    try {
      const compressed = await optimizePhoto(file)
      storagePath = `${huntId}/${context.team.id}/selfie/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await supabase.storage.from('hunt-photos').upload(storagePath, compressed, { cacheControl: '3600', contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError
      const { data, error: submitError } = await supabase.rpc('submit_team_selfie', { p_hunt_id: huntId, p_team_id: context.team.id, p_storage_path: storagePath })
      if (submitError) throw submitError
      const result = data as { submitted_at: string; previous_storage_path: string | null; submitted_by: string }
      if (result.previous_storage_path) {
        const { error: cleanupError } = await supabase.storage.from('hunt-photos').remove([result.previous_storage_path])
        if (cleanupError && typeof window !== 'undefined') queuePhotoCleanup(window.localStorage, huntId, context.team.id, result.previous_storage_path)
      }
      const { data: signed, error: signedError } = await supabase.storage.from('hunt-photos').createSignedUrl(storagePath, 300)
      if (signedError) throw signedError
      setSelfieUrl(signed?.signedUrl ?? '')
      setContext(current => current ? { ...current, team: { ...current.team, selfie: { storage_path: storagePath, submitted_by: result.submitted_by, submitted_at: result.submitted_at } } } : current)
    } catch (uploadError) {
      if (storagePath) await supabase.storage.from('hunt-photos').remove([storagePath])
      setTeamIdentityError(uploadError instanceof Error ? uploadError.message : 'The team selfie could not be saved.')
    } finally { setTeamIdentityBusy(false) }
  }

  async function submitPhoto(item: HuntItem, file?: File) {
    if (!supabase || !context || !file) return
    setUploading(current => ({ ...current, [item.id]: true }))
    setUploadErrors(current => ({ ...current, [item.id]: '' }))
    let storagePath = ''
    let accepted = false
    let uncertain = false
    try {
      const compressed = await optimizePhoto(file)
      storagePath = `${huntId}/${context.team.id}/${item.id}/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await supabase.storage.from('hunt-photos').upload(storagePath, compressed, {
        cacheControl: '3600', contentType: 'image/jpeg', upsert: false,
      })
      if (uploadError) throw uploadError
      const firstAttempt = await supabase.rpc('submit_hunt_photo', {
        p_hunt_item_id: item.id, p_storage_path: storagePath,
      })
      let result = firstAttempt.data as { accepted: boolean; submitted_at: string; previous_storage_path: string | null } | null
      let displayPath = storagePath
      let reconciledRow: Omit<PhotoSubmission, 'photoUrl'> | null = null
      if (firstAttempt.error) {
        const reconciliation = await supabase.from('submissions')
          .select('id,hunt_item_id,team_id,participant_id,storage_path,submitted_at,approval_status')
          .eq('hunt_id', huntId).eq('hunt_item_id', item.id).eq('team_id', context.team.id).maybeSingle()
        if (!reconciliation.error && reconciliation.data) {
          reconciledRow = reconciliation.data as Omit<PhotoSubmission, 'photoUrl'>
          displayPath = reconciledRow.storage_path
          result = { accepted: true, submitted_at: reconciledRow.submitted_at, previous_storage_path: null }
          if (displayPath !== storagePath) {
            const { error: orphanError } = await supabase.storage.from('hunt-photos').remove([storagePath])
            if (orphanError && typeof window !== 'undefined') queuePhotoCleanup(window.localStorage, huntId, context.team.id, storagePath)
          }
        } else {
          const retry = await supabase.rpc('submit_hunt_photo', { p_hunt_item_id: item.id, p_storage_path: storagePath })
          if (retry.error) {
            uncertain = Boolean(reconciliation.error)
            throw new Error(uncertain ? 'The photo upload completed, but its status could not be confirmed. Check your connection and try again.' : firstAttempt.error.message)
          }
          result = retry.data as { accepted: boolean; submitted_at: string; previous_storage_path: string | null }
        }
      }
      if (!result) throw new Error('The photo submission could not be confirmed.')
      accepted = true
      if (result.previous_storage_path) {
        const { error: cleanupError } = await supabase.storage.from('hunt-photos').remove([result.previous_storage_path])
        if (cleanupError && typeof window !== 'undefined') queuePhotoCleanup(window.localStorage, huntId, context.team.id, result.previous_storage_path)
        else if (typeof window !== 'undefined') completePhotoCleanup(window.localStorage, huntId, context.team.id, result.previous_storage_path)
      }
      const { data: signed, error: signedError } = await supabase.storage.from('hunt-photos').createSignedUrl(displayPath, 300)
      setSubmissions(current => ({ ...current, [item.id]: {
        id: reconciledRow?.id ?? current[item.id]?.id ?? crypto.randomUUID(), hunt_item_id: item.id, team_id: context.team.id,
        participant_id: reconciledRow?.participant_id ?? context.participant.id, storage_path: displayPath, submitted_at: result.submitted_at,
        approval_status: 'pending', photoUrl: signed?.signedUrl ?? '',
      } }))
      if (signedError) setUploadErrors(current => ({ ...current, [item.id]: 'Submitted successfully, but the preview could not load yet.' }))
    } catch (uploadError) {
      if (storagePath && !accepted && !uncertain) await supabase.storage.from('hunt-photos').remove([storagePath])
      const detail = uploadError instanceof Error ? uploadError.message : 'The photo could not be submitted.'
      setUploadErrors(current => ({ ...current, [item.id]: detail }))
    } finally { setUploading(current => ({ ...current, [item.id]: false })) }
  }

  async function vote(itemId: string, selectedTeamId: string) {
    if (!supabase) return
    setError('')
    const { error: voteError } = await supabase.rpc('cast_hunt_vote', { p_hunt_id: huntId, p_hunt_item_id: itemId, p_selected_team_id: selectedTeamId })
    if (voteError) setError(voteError.message)
    else {
      const { data } = await supabase.rpc('get_hunt_review_gallery', { p_hunt_id: huntId })
      if (data) {
        const result = data as ReviewGallery
        const signed = await Promise.all(result.submissions.map(async photo => {
          const { data: url } = await supabase!.storage.from('hunt-photos').createSignedUrl(photo.storage_path, 300)
          return { ...photo, photo_url: url?.signedUrl }
        }))
        setReviewGallery({ ...result, submissions: signed })
      }
    }
  }

  return <main className={`participant-shell game-shell ${!context?.start_at && runtimeState === 'waiting' ? 'manual-start-lobby' : ''}`}>
    <header className="participant-topbar"><a className="brand" href="#"><span className="brand-icon"><Camera size={19}/></span> SnapQuest</a><span className="nav-note"><ShieldCheck size={15}/> {context ? context.team.name : 'Participant space'} {!session.user.is_anonymous && <a className="outline-button" href={`#/manage/${huntId}`}><Settings2 size={14}/> Organizer menu</a>}</span></header>
    {loading ? <div className="participant-loading"><LoaderCircle className="spin" size={24}/> Loading your hunt…</div> : error && !context ? <section className="participant-message"><CircleHelp size={24}/><h1>We couldn’t open this hunt</h1><p>{error}</p><button className="outline-button" onClick={() => { setLoading(true); setError(''); void loadContext() }}>Try again</button></section> : context ? <>
      <section className="participant-game-heading"><div><div className="eyebrow"><MapPin size={14}/> {context.venue}</div><h1>{context.title}</h1><p>You’re playing as <b>{context.participant.display_name}</b> on <span className="team-name-pill" style={{color:context.team.display_color}}>{context.team.name}</span></p></div>{runtimeState === 'active' && <div className="game-clock"><Clock3 size={19}/><span>{clockLabel(remainingSeconds)}</span><small>TIME LEFT</small></div>}</section>
      {runtimeState === 'active' && <section className="participant-live-status" aria-label="Live hunt progress"><div className="live-time-progress"><div className="live-status-heading"><b>Time remaining</b><span>{clockLabel(remainingSeconds)}</span></div><div className="live-progress-track" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(100, remainingSeconds / (context.duration_minutes * 60) * 100)))}><span className="live-time-fill" style={{width: `${Math.max(0, Math.min(100, remainingSeconds / (context.duration_minutes * 60) * 100))}%`}}/></div></div>{teamProgress.length > 0 && <div className="live-team-progress"><div className="live-status-heading"><b>Team progress</b><span>Accepted photos</span></div>{teamProgress.map(team => <div className="live-team-row" key={team.team_id}><span className="team-swatch" style={{backgroundColor: team.display_color}}/><b>{team.team_name}</b><span>{team.accepted_count}/{team.total_items}</span><div className="live-progress-track" role="progressbar" aria-label={`${team.team_name} accepted photos`} aria-valuemin={0} aria-valuemax={team.total_items} aria-valuenow={team.accepted_count}><span style={{width: `${team.total_items ? Math.min(100, team.accepted_count / team.total_items * 100) : 0}%`}}/></div></div>)}</div>}</section>}
      {error && <div className="participant-error game-error"><CircleHelp size={15}/>{error}</div>}
      {['waiting','active'].includes(runtimeState) && <HuntChat huntId={huntId} />}
      {runtimeState === 'waiting' ? <section className="waiting-card"><span className="waiting-icon"><Clock3 size={26}/></span><p className="card-kicker">GET READY, {context.team.name.toUpperCase()}</p><h2>The hunt starts in</h2><div className="waiting-countdown">{clockLabel(untilStart)}</div><p className="waiting-copy">Your photo list will appear when the countdown reaches zero. Stay with your team and get ready to explore <b>{context.venue}</b>.</p><div className="teammate-panel"><div><Users size={17}/><b>{context.team.name}</b><span>{context.teammates.length} {context.teammates.length === 1 ? 'player' : 'players'}</span></div><ul>{context.teammates.map(person => <li key={person.id}><span className="participant-avatar">{person.display_name.slice(0,1).toUpperCase()}</span>{person.display_name}</li>)}</ul></div><section className="team-identity-panel" aria-label="Team identity"><b>Make your team yours</b><p>Choose a team name and add one private team selfie before the hunt starts.</p><form onSubmit={event => void saveTeamName(event)}><label>Team name<input maxLength={40} value={teamNameDraft} onChange={event => { setTeamNameDirty(true); setTeamNameDraft(event.target.value) }}/></label><button className="outline-button" disabled={teamIdentityBusy || !teamNameDraft.trim()}>Save name</button></form>{selfieUrl && <img className="team-selfie-preview" src={selfieUrl} alt={`${context.team.name} team selfie`}/>}<label className={`photo-upload-button ${teamIdentityBusy ? 'uploading' : ''}`}><input type="file" accept="image/*" capture="environment" disabled={teamIdentityBusy} onChange={event => { const file = event.currentTarget.files?.[0]; void submitTeamSelfie(file); event.currentTarget.value = '' }}/>{teamIdentityBusy ? <><LoaderCircle className="spin" size={16}/> Saving team identity…</> : <><Camera size={16}/> {selfieUrl ? 'Replace team selfie' : 'Add team selfie'}</>}</label>{teamIdentityError && <p className="photo-upload-error" role="alert">{teamIdentityError}</p>}</section>{context.rules?.length > 0 && <div className="waiting-rules"><b>Remember</b>{context.rules.map(rule => <span key={rule}><Check size={14}/>{rule}</span>)}</div>}</section> : runtimeState === 'active' ? <section className="active-game-content">{teamProgress.length > 0 && <section className="team-progress-panel" aria-label="All team photo progress"><div className="active-game-intro"><div><b>Team progress</b><p>Accepted photo slots · team photos remain private.</p></div></div><div className="team-progress-list">{teamProgress.map(team => <div className="team-progress-row" key={team.team_id}><div className="team-progress-label"><span className="team-swatch" style={{backgroundColor: team.display_color}}/><b>{team.team_name}</b><span>{team.accepted_count}/{team.total_items}</span></div><div className="team-progress-track" role="progressbar" aria-label={`${team.team_name} photo progress`} aria-valuemin={0} aria-valuemax={team.total_items} aria-valuenow={team.accepted_count}><span style={{width: `${team.total_items ? Math.min(100, team.accepted_count / team.total_items * 100) : 0}%`}}/></div></div>)}</div></section>}<div className="active-game-intro"><div><b>Your photo list</b><p>Find each item and take a photo with your team.</p></div><span>{Object.keys(submissions).length}/{items.length} complete</span></div>{items.length ? <div className="participant-item-list">{items.map((item,index) => { const submission = submissions[item.id]; return <article className={`participant-item-card ${submission ? 'has-submission' : ''}`} key={item.id}><span className="participant-item-number">{index+1}</span><div className="participant-item-detail"><h2>{item.title_snapshot}</h2>{item.description_snapshot && <p>{item.description_snapshot}</p>}<small><Trophy size={12}/> {item.point_value} {item.point_value === 1 ? 'point' : 'points'}</small>{submission?.photoUrl && <img className="submission-preview" src={submission.photoUrl} alt={`Team photo for ${item.title_snapshot}`}/>}<div className="photo-submission-status">{submission ? <><Check size={13}/> Photo submitted · {submission.approval_status === 'pending' ? 'awaiting review' : submission.approval_status}</> : <><ImageIcon size={13}/> No photo yet</>}</div>{uploadErrors[item.id] && <p className="photo-upload-error" role="status">{uploadErrors[item.id]}</p>}<label className={`photo-upload-button ${uploading[item.id] ? 'uploading' : ''}`}><input type="file" accept="image/*" capture="environment" disabled={uploading[item.id] || remainingSeconds <= 0} onChange={event => { const file = event.currentTarget.files?.[0]; void submitPhoto(item,file); event.currentTarget.value = '' }}/>{uploading[item.id] ? <><LoaderCircle className="spin" size={16}/> Preparing photo…</> : submission ? <><RefreshCw size={15}/> Replace photo</> : <><Camera size={16}/> Take or choose photo</>}</label></div></article>})}</div> : <div className="waiting-card"><LoaderCircle className="spin" size={22}/> Loading the photo list…</div>}<p className="photo-next-note"><ShieldCheck size={14}/> Photos are private to your team until the hunt ends. Stay together and within the venue.</p></section> : <section className="waiting-card ended-card"><span className="waiting-icon"><Check size={26}/></span><p className="card-kicker">NICE WORK, {context.team.name.toUpperCase()}</p><h2>{runtimeState === 'completed' ? 'The results are in!' : runtimeState === 'review' ? 'Photo review time!' : 'Time’s up!'}</h2><p className="waiting-copy">The hunt has ended. Your team’s photos are ready for the organizer to review.</p><div className="teammate-panel"><div><Users size={17}/><b>{context.team.name}</b><span>{context.teammates.length} {context.teammates.length === 1 ? 'player' : 'players'}</span></div><ul>{context.teammates.map(person => <li key={person.id}><span className="participant-avatar">{person.display_name.slice(0,1).toUpperCase()}</span>{person.display_name}</li>)}</ul></div></section>}
      {['review','completed'].includes(runtimeState) && reviewGallery && <section className="participant-gallery"><div className="active-game-intro"><div><b>{runtimeState === 'completed' ? 'Final results' : 'Team photo gallery'}</b><p>{runtimeState === 'completed' ? 'See how every team placed.' : reviewGallery.voting_enabled ? `Vote for a different team’s photo. A winning vote earns ${reviewGallery.voting_bonus_points} bonus points.` : 'The organizer is reviewing all team photos.'}</p></div></div>{runtimeState === 'completed' && <div className="scoreboard participant-scoreboard">{reviewGallery.final_scores.map(score => <div className="score-row" key={score.team_id}><b>#{score.rank} {score.team_name}</b><span>{score.base_points} points{score.voting_bonus ? ` + ${score.voting_bonus} voting bonus` : ''}</span><strong>{score.total}</strong></div>)}</div>}<div className="review-item-list">{reviewGallery.items.map(item => <section className="review-item" key={item.id}><header><div><span>CHALLENGE</span><h2>{item.title}</h2></div><b>{item.points} pts</b></header><div className="review-photos">{reviewGallery.teams.map(team => { const photo = reviewGallery.submissions.find(row => row.item_id === item.id && row.team_id === team.id); const selected = reviewGallery.votes.find(row => row.item_id === item.id && row.voting_team_id === context.team.id)?.selected_team_id; return <article className="review-photo-card" key={team.id}><div className="review-photo-team"><span className="team-swatch" style={{backgroundColor:team.display_color}}/><b>{team.name}</b></div>{photo?.photo_url ? <img src={photo.photo_url} alt={`${team.name} photo for ${item.title}`}/> : <div className="review-photo-empty">No approved photo</div>}{photo?.status === 'approved' && reviewGallery.status === 'review' && reviewGallery.voting_enabled && team.id !== context.team.id && <button className={`vote-button ${selected === team.id ? 'voted' : ''}`} onClick={() => void vote(item.id,team.id)}>{selected === team.id ? 'Your vote' : 'Vote for this photo'}</button>}{photo?.status === 'approved' && runtimeState === 'completed' && <span className="review-status status-approved"><Check size={13}/> Approved</span>}</article>})}</div></section>)}</div></section>}
      <footer className="participant-footer">SnapQuest <i>•</i> {session.user.is_anonymous ? 'Your participant session is saved on this device.' : 'Welcome to the hunt.'}</footer>
    </> : null}
  </main>
}
