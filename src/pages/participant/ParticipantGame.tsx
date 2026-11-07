import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Camera, Check, CircleHelp, Clock3, LoaderCircle, MapPin, ShieldCheck, Trophy, Users, RefreshCw, Image as ImageIcon, Settings2 } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { optimizePhoto } from '../../lib/photo'
import { pendingPhotoCleanup, removePhotoOrQueueCleanup } from '../../lib/photoCleanup'
import HuntChat from '../../components/HuntChat'
import { celebrationFilename, renderWinnerCelebrationCard, winnerCaption } from '../../lib/celebrationCard'
import { normalizeFinalScores } from '../../lib/scoring'
import { reportOperation } from '../../lib/operationLog'

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
type ReviewGallery = { voting_enabled: boolean; voting_bonus_points: number; status: string; final_scores: {team_id:string;team_name:string;base_points:number;voting_bonus:number;total:number;rank:number}[]; teams: {id:string;name:string;display_color:string}[]; items: {id:string;title:string;points:number;display_order:number}[]; submissions: {id:string;item_id:string;team_id:string;storage_path:string;status:string;photo_url?:string;signed_until?:number}[]; votes: {item_id:string;voting_team_id:string;selected_team_id:string}[] }

function clockLabel(seconds: number) {
  if (seconds < 0) return 'WAITING'
  const safe = Math.max(0, seconds)
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`
}

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export default function ParticipantGame({ huntId, session }: ParticipantGameProps) {
  const [context, setContext] = useState<HuntContext | null>(null)
  const [items, setItems] = useState<HuntItem[]>([])
  const [submissions, setSubmissions] = useState<Record<string, PhotoSubmission>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({})
  const [submissionRefreshTick, setSubmissionRefreshTick] = useState(0)
  const [reviewGallery, setReviewGallery] = useState<ReviewGallery | null>(null)
  const [previewRetryingPath, setPreviewRetryingPath] = useState('')
  const [celebrationBusy, setCelebrationBusy] = useState(false)
  const [celebrationError, setCelebrationError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [serverNow, setServerNow] = useState(0)
  const [teamProgress, setTeamProgress] = useState<TeamProgress[]>([])
  const [teamNameDraft, setTeamNameDraft] = useState('')
  const [teamNameDirty, setTeamNameDirty] = useState(false)
  const [teamIdentityBusy, setTeamIdentityBusy] = useState(false)
  const [teamIdentityError, setTeamIdentityError] = useState('')
  const [selfieUrl, setSelfieUrl] = useState('')
  const [selfiePreviewUnavailable, setSelfiePreviewUnavailable] = useState(false)
  const [selfiePreviewRetry, setSelfiePreviewRetry] = useState(0)
  const [organizerCapability, setOrganizerCapability] = useState<{ huntId: string; allowed: boolean }>({ huntId: '', allowed: false })
  const contextRequestId = useRef(0)
  const galleryRequestId = useRef(0)
  const reviewGalleryRef = useRef<ReviewGallery | null>(null)
  const submissionUrlCache = useRef(new Map<string, { url: string; expiresAt: number }>())
  const currentTeamId = context?.team.id

  const flushPhotoCleanup = useCallback(async () => {
    const teamId = currentTeamId
    if (!supabase || !teamId) return
    const storage = browserStorage()
    if (!storage) return
    for (const path of pendingPhotoCleanup(storage, huntId, teamId)) {
      const removed = await removePhotoOrQueueCleanup(storage, huntId, teamId, path,
        () => supabase!.storage.from('hunt-photos').remove([path]))
      if (!removed) void reportOperation(huntId, crypto.randomUUID(), 'photo_cleanup_retry_failed', 'failure')
    }
  }, [currentTeamId, huntId])

  const loadContext = useCallback(async () => {
    if (!supabase) return
    const requestId = ++contextRequestId.current
    const { data, error: contextError } = await supabase.rpc('get_participant_context', { p_hunt_id: huntId })
    if (requestId !== contextRequestId.current) return
    if (contextError) { setError(contextError.message); setLoading(false); return }
    const next = data as HuntContext
    setContext(next)
    if (!teamNameDirty) setTeamNameDraft(next.team.name)
    setServerNow(new Date(next.server_now).getTime())
    if (next.runtime_state === 'active') setSubmissionRefreshTick(value => value + 1)
    else setTeamProgress([])
    if (next.runtime_state !== 'active') {
      setLoading(false)
      return
    }
    const { data: progress, error: progressError } = await supabase.rpc('get_hunt_progress', { p_hunt_id: huntId })
    if (requestId !== contextRequestId.current) return
    if (!progressError && Array.isArray(progress)) setTeamProgress(progress as TeamProgress[])
    setLoading(false)
  }, [huntId, teamNameDirty])

  const loadReviewGallery = useCallback(async () => {
    if (!supabase) return
    const requestId = ++galleryRequestId.current
    const { data, error: galleryError } = await supabase.rpc('get_hunt_review_gallery', { p_hunt_id: huntId })
    if (requestId !== galleryRequestId.current) return
    if (galleryError) { setError(galleryError.message); return }
    const result = data as ReviewGallery
    const previous = reviewGalleryRef.current
    const signed = await Promise.all(result.submissions.map(async photo => {
      const cached = previous?.submissions.find(row => row.storage_path === photo.storage_path && row.photo_url && (row.signed_until ?? 0) > Date.now() + 30_000)
      if (cached) return { ...photo, photo_url: cached.photo_url, signed_until: cached.signed_until }
      const { data: url, error: signError } = await supabase!.storage.from('hunt-photos').createSignedUrl(photo.storage_path, 300)
      return { ...photo, photo_url: signError ? undefined : url?.signedUrl, signed_until: url?.signedUrl ? Date.now() + 270_000 : undefined }
    }))
    if (requestId !== galleryRequestId.current) return
    const next = { ...result, submissions: signed }
    reviewGalleryRef.current = next
    setReviewGallery(next)
    setError('')
  }, [huntId])

  function markReviewPreviewUnavailable(path: string) {
    const current = reviewGalleryRef.current
    if (!current) return
    const next = { ...current, submissions: current.submissions.map(photo => photo.storage_path === path ? { ...photo, photo_url: undefined, signed_until: undefined } : photo) }
    reviewGalleryRef.current = next
    setReviewGallery(next)
  }

  async function retryReviewPreview(path: string) {
    if (!supabase || previewRetryingPath === path) return
    setPreviewRetryingPath(path)
    try {
      const { data, error: signError } = await supabase.storage.from('hunt-photos').createSignedUrl(path, 300)
      if (signError || !data?.signedUrl) throw signError ?? new Error('A preview URL was not returned')
      const current = reviewGalleryRef.current
      if (!current) return
      const next = { ...current, submissions: current.submissions.map(photo => photo.storage_path === path ? { ...photo, photo_url: data.signedUrl, signed_until: Date.now() + 270_000 } : photo) }
      reviewGalleryRef.current = next
      setReviewGallery(next)
      setError('')
    } catch {
      setError('This photo preview is still unavailable. Check your connection and retry.')
    } finally { setPreviewRetryingPath('') }
  }

  useEffect(() => {
    let cancelled = false
    const selfiePath = context?.team.selfie?.storage_path
    // Refresh only when the stored path changes or the organizer/player asks to retry.
    // eslint-disable-next-line react/set-state-in-effect
    setSelfieUrl('')
    setSelfiePreviewUnavailable(false)
    if (!supabase || !selfiePath) return () => { cancelled = true }
    const renew = async () => {
      try {
        const { data, error: signError } = await supabase!.storage.from('hunt-photos').createSignedUrl(selfiePath, 300)
        if (cancelled) return
        setSelfieUrl(data?.signedUrl ?? '')
        setSelfiePreviewUnavailable(!!signError || !data?.signedUrl)
      } catch {
        if (!cancelled) setSelfiePreviewUnavailable(true)
      }
    }
    void renew()
    const renewalTimer = window.setInterval(() => void renew(), 240_000)
    return () => { cancelled = true; window.clearInterval(renewalTimer) }
  }, [context?.team.selfie?.storage_path, selfiePreviewRetry])

  // Initial load synchronizes this screen with the authoritative participant session.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadContext() }, [loadContext])
  useEffect(() => {
    let cancelled = false
    if (!supabase || session.user.is_anonymous) return () => { cancelled = true }
    void supabase.rpc('is_hunt_organizer', { p_hunt_id: huntId }).then(({ data }) => {
      if (!cancelled) setOrganizerCapability({ huntId, allowed: data === true })
    })
    return () => { cancelled = true }
  }, [huntId, session.user.id, session.user.is_anonymous])
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `hunt_id=eq.${huntId}` }, () => { void loadContext(); if (reviewGalleryRef.current) void loadReviewGallery() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hunt_votes', filter: `hunt_id=eq.${huntId}` }, () => { if (reviewGalleryRef.current) void loadReviewGallery() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hunts', filter: `id=eq.${huntId}` }, () => void loadContext())
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [huntId, loadContext, loadReviewGallery])

  const runtimeState = useMemo(() => {
    if (!context) return 'waiting'
    if (context.status === 'completed') return 'completed'
    if (context.status === 'review') return 'review'
    if (!context.start_at) return 'waiting'
    if (context.ends_at && serverNow >= new Date(context.ends_at).getTime()) return 'ended'
    if (serverNow < new Date(context.start_at).getTime()) return 'waiting'
    return 'active'
  }, [serverNow, context])

  const canManageCurrentHunt = organizerCapability.huntId === huntId && organizerCapability.allowed
  const participantScores = runtimeState === 'completed' && reviewGallery ? normalizeFinalScores(reviewGallery.final_scores) : []
  const ownFinalScore = participantScores.find(score => score.teamId === context?.team.id)
  const ownTeamIsTied = participantScores.filter(score => score.rank === 1 && score.total > 0).length > 1

  useEffect(() => {
    if (!supabase || !['active', 'review', 'completed'].includes(runtimeState)) return
    let cancelled = false
    async function loadItems() {
      const { data, error: itemError } = await supabase!.from('hunt_items')
        .select('id,title_snapshot,description_snapshot,point_value,display_order').eq('hunt_id', huntId).order('display_order')
      if (cancelled) return
      if (itemError) { setError(itemError.message); return }
      setItems(data ?? [])
    }
    void loadItems()
    return () => { cancelled = true }
  }, [huntId, runtimeState])

  useEffect(() => {
    if (!supabase || !currentTeamId || runtimeState !== 'active') return
    let cancelled = false
    async function loadSubmissions() {
      const { data, error: submissionError } = await supabase!.from('submissions')
        .select('id,hunt_item_id,team_id,participant_id,storage_path,submitted_at,approval_status')
        .eq('hunt_id', huntId).eq('team_id', currentTeamId!)
      if (cancelled) return
      if (submissionError) { setError(submissionError.message); return }
      const photoRows = (data ?? []) as Omit<PhotoSubmission, 'photoUrl'>[]
      const activePaths = new Set(photoRows.map(row => row.storage_path))
      for (const path of submissionUrlCache.current.keys()) if (!activePaths.has(path)) submissionUrlCache.current.delete(path)
      const signed = await Promise.all(photoRows.map(async row => {
        const cached = submissionUrlCache.current.get(row.storage_path)
        if (cached && cached.expiresAt > Date.now() + 30_000) return { ...row, photoUrl: cached.url }
        const { data: urlData, error: urlError } = await supabase!.storage.from('hunt-photos').createSignedUrl(row.storage_path, 300)
        if (!urlData?.signedUrl || urlError) return null
        submissionUrlCache.current.set(row.storage_path, { url: urlData.signedUrl, expiresAt: Date.now() + 270_000 })
        return { ...row, photoUrl: urlData.signedUrl }
      }))
      if (!cancelled) setSubmissions(Object.fromEntries(signed.filter((row): row is PhotoSubmission => row !== null).map(row => [row.hunt_item_id, row])))
    }
    void loadSubmissions()
    return () => { cancelled = true }
  }, [currentTeamId, huntId, runtimeState, submissionRefreshTick])

  useEffect(() => {
    if (!['review','completed'].includes(runtimeState)) return
    // The gallery is an external query and must be refreshed when review mode begins.
    // eslint-disable-next-line react/set-state-in-effect
    void loadReviewGallery()
    const refresh = window.setInterval(() => void loadReviewGallery(), 20_000)
    const reconcile = () => { if (document.visibilityState === 'visible') void loadReviewGallery() }
    window.addEventListener('focus', reconcile)
    window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      window.clearInterval(refresh)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('online', reconcile)
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [loadReviewGallery, runtimeState])

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
    let uploaded = false
    let committed = false
    let uncertain = false
    const operationId = crypto.randomUUID()
    try {
      const compressed = await optimizePhoto(file)
      storagePath = `${huntId}/${context.team.id}/selfie/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await supabase.storage.from('hunt-photos').upload(storagePath, compressed, { cacheControl: '3600', contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError
      uploaded = true
      const { data, error: submitError } = await supabase.rpc('submit_team_selfie', { p_hunt_id: huntId, p_team_id: context.team.id, p_storage_path: storagePath })
      let result = data as { submitted_at: string; previous_storage_path: string | null; submitted_by: string } | null
      if (submitError) {
        const reconciliation = await supabase.from('team_selfies').select('storage_path,submitted_by,submitted_at')
          .eq('hunt_id', huntId).eq('team_id', context.team.id).eq('storage_path', storagePath).maybeSingle()
        if (reconciliation.error) {
          uncertain = true
          throw new Error('The selfie upload completed, but its save status could not be confirmed. Check your connection before trying again.')
        }
        if (reconciliation.data) {
          result = { ...reconciliation.data, previous_storage_path: null }
        } else {
          throw submitError
        }
      }
      if (!result) throw new Error('The team selfie save could not be confirmed.')
      committed = true
      void reportOperation(huntId, operationId, 'selfie_accepted', 'success')
      setContext(current => current ? { ...current, team: { ...current.team, selfie: { storage_path: storagePath, submitted_by: result.submitted_by, submitted_at: result.submitted_at } } } : current)
      if (result.previous_storage_path) {
        const storage = browserStorage()
        const removed = await removePhotoOrQueueCleanup(storage, huntId, context.team.id, result.previous_storage_path,
          () => supabase!.storage.from('hunt-photos').remove([result.previous_storage_path!]))
        if (!removed) void reportOperation(huntId, operationId, 'selfie_cleanup_pending', 'failure')
      }
      try {
        const { data: signed, error: signedError } = await supabase.storage.from('hunt-photos').createSignedUrl(storagePath, 300)
        setSelfieUrl(signed?.signedUrl ?? '')
        if (signedError || !signed?.signedUrl) { setTeamIdentityError('Team selfie saved. Its preview is temporarily unavailable; refresh to try again.'); void reportOperation(huntId, operationId, 'selfie_preview_unavailable') }
      } catch {
        setTeamIdentityError('Team selfie saved. Its preview is temporarily unavailable; refresh to try again.')
        void reportOperation(huntId, operationId, 'selfie_preview_unavailable')
      }
    } catch (uploadError) {
      void reportOperation(huntId, operationId, uncertain ? 'selfie_reconciliation_uncertain' : uploaded ? 'selfie_acceptance_failed' : 'selfie_upload_failed', 'failure')
      if (uploaded && !committed && !uncertain) {
        const storage = browserStorage()
        const removed = await removePhotoOrQueueCleanup(storage, huntId, context.team.id, storagePath,
          () => supabase!.storage.from('hunt-photos').remove([storagePath]))
        if (!removed) void reportOperation(huntId, operationId, 'selfie_cleanup_pending', 'failure')
      }
      setTeamIdentityError(uploadError instanceof Error ? uploadError.message : 'The team selfie could not be saved.')
    } finally { setTeamIdentityBusy(false) }
  }

  async function submitPhoto(item: HuntItem, file?: File) {
    if (!supabase || !context || !file) return
    setUploading(current => ({ ...current, [item.id]: true }))
    setUploadErrors(current => ({ ...current, [item.id]: '' }))
    let storagePath = ''
    let uploaded = false
    let uploadRejected = false
    let accepted = false
    let uncertain = false
    const operationId = crypto.randomUUID()
    try {
      const compressed = await optimizePhoto(file)
      storagePath = `${huntId}/${context.team.id}/${item.id}/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await supabase.storage.from('hunt-photos').upload(storagePath, compressed, {
        cacheControl: '3600', contentType: 'image/jpeg', upsert: false,
      })
      if (uploadError) { uploadRejected = true; throw uploadError }
      uploaded = true
      const expectedPath = submissions[item.id]?.storage_path ?? null
      const rpcArgs = { p_hunt_item_id: item.id, p_storage_path: storagePath, p_expected_storage_path: expectedPath }
      const firstAttempt = await supabase.rpc('submit_hunt_photo', rpcArgs)
      let result = firstAttempt.data as { accepted: boolean; submitted_at: string; previous_storage_path: string | null } | null
      let displayPath = storagePath
      let reconciledRow: Omit<PhotoSubmission, 'photoUrl'> | null = null
      if (firstAttempt.error) {
        // A PostgreSQL exception is a definitive rejection, so retrying it cannot
        // recover a committed write and only duplicates the rejected request.
        if (firstAttempt.error.code === 'P0001') {
          if (/photo slot changed|teammate changed this photo slot/i.test(firstAttempt.error.message)) {
            const latest = await supabase.from('submissions')
              .select('id,hunt_item_id,team_id,participant_id,storage_path,submitted_at,approval_status')
              .eq('hunt_id', huntId).eq('hunt_item_id', item.id).eq('team_id', context.team.id).maybeSingle()
            if (!latest.error && latest.data && latest.data.storage_path !== expectedPath) {
              const row = latest.data as Omit<PhotoSubmission, 'photoUrl'>
              let photoUrl = ''
              try {
                const { data: signed } = await supabase.storage.from('hunt-photos').createSignedUrl(row.storage_path, 300)
                photoUrl = signed?.signedUrl ?? ''
              } catch { /* The saved submission remains visible even if its preview needs a retry. */ }
              setSubmissions(current => ({ ...current, [item.id]: { ...row, photoUrl } }))
              throw new Error('A teammate replaced this photo first. Their saved photo is now shown; your replacement was not saved.')
            }
          }
          throw new Error(firstAttempt.error.message)
        }
        const exact = await supabase.from('submissions')
          .select('id,hunt_item_id,team_id,participant_id,storage_path,submitted_at,approval_status')
          .eq('hunt_id', huntId).eq('hunt_item_id', item.id).eq('team_id', context.team.id).eq('storage_path', storagePath).maybeSingle()
        if (exact.error) {
          uncertain = true
          throw new Error('The photo uploaded, but its save status could not be confirmed. Check your connection before trying again.')
        }
        if (exact.data) {
          reconciledRow = exact.data as Omit<PhotoSubmission, 'photoUrl'>
          displayPath = reconciledRow.storage_path
          result = { accepted: true, submitted_at: reconciledRow.submitted_at, previous_storage_path: null }
        } else {
          const current = await supabase.from('submissions').select('storage_path')
            .eq('hunt_id', huntId).eq('hunt_item_id', item.id).eq('team_id', context.team.id).maybeSingle()
          if (current.error) {
            uncertain = true
            throw new Error('The photo uploaded, but its current save could not be checked. Check your connection before trying again.')
          }
          if ((current.data?.storage_path ?? null) !== expectedPath) {
            throw new Error('A teammate changed this photo slot. Their newer photo is still saved; refresh before replacing it again.')
          }
          const retry = await supabase.rpc('submit_hunt_photo', rpcArgs)
          if (retry.error) {
            const confirmation = await supabase.from('submissions').select('id,hunt_item_id,team_id,participant_id,storage_path,submitted_at,approval_status')
              .eq('hunt_id', huntId).eq('hunt_item_id', item.id).eq('team_id', context.team.id).eq('storage_path', storagePath).maybeSingle()
            if (confirmation.error) {
              uncertain = true
              throw new Error('The photo uploaded, but its save status could not be confirmed. Check your connection before trying again.')
            }
            if (!confirmation.data) throw new Error(firstAttempt.error.message)
            reconciledRow = confirmation.data as Omit<PhotoSubmission, 'photoUrl'>
            result = { accepted: true, submitted_at: reconciledRow.submitted_at, previous_storage_path: null }
          } else {
            result = retry.data as { accepted: boolean; submitted_at: string; previous_storage_path: string | null }
          }
        }
      }
      if (!result) throw new Error('The photo submission could not be confirmed.')
      accepted = true
      void reportOperation(huntId, operationId, 'photo_accepted', 'success')
      if (result.previous_storage_path) {
        const storage = browserStorage()
        const removed = await removePhotoOrQueueCleanup(storage, huntId, context.team.id, result.previous_storage_path,
          () => supabase!.storage.from('hunt-photos').remove([result.previous_storage_path!]))
        if (!removed) void reportOperation(huntId, operationId, 'photo_cleanup_pending', 'failure')
      }
      let previewUrl = ''
      let previewUnavailable = false
      try {
        const { data: signed, error: signedError } = await supabase.storage.from('hunt-photos').createSignedUrl(displayPath, 300)
        previewUrl = signed?.signedUrl ?? ''
        previewUnavailable = !!signedError || !previewUrl
      } catch { previewUnavailable = true }
      setSubmissions(current => ({ ...current, [item.id]: {
        id: reconciledRow?.id ?? current[item.id]?.id ?? crypto.randomUUID(), hunt_item_id: item.id, team_id: context.team.id,
        participant_id: reconciledRow?.participant_id ?? context.participant.id, storage_path: displayPath, submitted_at: result.submitted_at,
        approval_status: reconciledRow?.approval_status ?? 'pending', photoUrl: previewUrl,
      } }))
      if (previewUnavailable) { setUploadErrors(current => ({ ...current, [item.id]: 'Submitted successfully, but the preview could not load yet.' })); void reportOperation(huntId, operationId, 'photo_preview_unavailable') }
    } catch (uploadError) {
      void reportOperation(huntId, operationId, uncertain ? 'photo_reconciliation_uncertain' : uploaded ? 'photo_acceptance_failed' : 'photo_upload_failed', 'failure')
      if (storagePath && !uploadRejected && !accepted && !uncertain) {
        const storage = browserStorage()
        const removed = await removePhotoOrQueueCleanup(storage, huntId, context.team.id, storagePath,
          () => supabase!.storage.from('hunt-photos').remove([storagePath]))
        if (!removed) void reportOperation(huntId, operationId, 'photo_cleanup_pending', 'failure')
      }
      const detail = uploadError instanceof Error ? uploadError.message : 'The photo could not be submitted.'
      setUploadErrors(current => ({ ...current, [item.id]: detail }))
    } finally { setUploading(current => ({ ...current, [item.id]: false })) }
  }

  async function vote(itemId: string, selectedTeamId: string) {
    if (!supabase) return
    setError('')
    const { error: voteError } = await supabase.rpc('cast_hunt_vote', { p_hunt_id: huntId, p_hunt_item_id: itemId, p_selected_team_id: selectedTeamId })
    if (voteError) { setError(voteError.message); void reportOperation(huntId, crypto.randomUUID(), 'vote_failed', 'failure') }
    else await loadReviewGallery()
  }

  async function buildTeamCard() {
    if (!context || !ownFinalScore || ownFinalScore.total <= 0 || ownFinalScore.rank !== 1) return null
    return renderWinnerCelebrationCard({ title: context.title, venue: context.venue, teamName: context.team.name, teamColor: context.team.display_color, score: ownFinalScore.total, rank: ownFinalScore.rank, selfieUrl: selfieUrl || undefined, tied: ownTeamIsTied })
  }

  async function shareTeamCard() {
    if (!context || !ownFinalScore) return
    setCelebrationBusy(true); setCelebrationError('')
    try {
      const blob = await buildTeamCard()
      if (!blob) return
      const file = new File([blob], celebrationFilename(context.team.name), { type: 'image/png' })
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] })) ) await navigator.share({ title: `${context.team.name} ${ownTeamIsTied ? 'tied for first in' : 'won'} ${context.title}`, text: winnerCaption({ title: context.title, teamName: context.team.name, score: ownFinalScore.total, tied: ownTeamIsTied }), files: [file] })
      else { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      setCelebrationError(shareError instanceof Error ? shareError.message : 'The team card could not be shared.')
    } finally { setCelebrationBusy(false) }
  }

  async function downloadTeamCard() {
    if (!context) return
    setCelebrationBusy(true); setCelebrationError('')
    try { const blob = await buildTeamCard(); if (blob) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = celebrationFilename(context.team.name); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) } }
    catch (cardError) { setCelebrationError(cardError instanceof Error ? cardError.message : 'The team card could not be downloaded.') }
    finally { setCelebrationBusy(false) }
  }

  return <main className={`participant-shell game-shell ${!context?.start_at && runtimeState === 'waiting' ? 'manual-start-lobby' : ''}`}>
    <header className="participant-topbar"><a className="brand" href="#"><span className="brand-icon"><Camera size={19}/></span> SnapQuest</a><span className="nav-note"><ShieldCheck size={15}/> {context ? context.team.name : 'Participant space'} {canManageCurrentHunt && <a className="outline-button" href={`#/manage/${huntId}`}><Settings2 size={14}/> Organizer menu</a>}</span></header>
    {loading ? <div className="participant-loading"><LoaderCircle className="spin" size={24}/> Loading your hunt…</div> : error && !context ? <section className="participant-message"><CircleHelp size={24}/><h1>We couldn’t open this hunt</h1><p>{error}</p><button className="outline-button" onClick={() => { setLoading(true); setError(''); void loadContext() }}>Try again</button></section> : context ? <>
      <section className="participant-game-heading"><div><div className="eyebrow"><MapPin size={14}/> {context.venue}</div><h1>{context.title}</h1><p>You’re playing as <b>{context.participant.display_name}</b> on <span className="team-name-pill">{context.team.name}</span></p></div>{runtimeState === 'active' && <div className="game-clock"><Clock3 size={19}/><span>{clockLabel(remainingSeconds)}</span><small>TIME LEFT</small></div>}</section>
      {runtimeState === 'active' && <section className="participant-live-status" aria-label="Live hunt progress"><div className="live-time-progress"><div className="live-status-heading"><b>Time remaining</b><span>{clockLabel(remainingSeconds)}</span></div><div className="live-progress-track" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(100, remainingSeconds / (context.duration_minutes * 60) * 100)))}><span className="live-time-fill" style={{width: `${Math.max(0, Math.min(100, remainingSeconds / (context.duration_minutes * 60) * 100))}%`}}/></div></div>{teamProgress.length > 0 && <div className="live-team-progress"><div className="live-status-heading"><b>Team progress</b><span>Accepted photos</span></div>{teamProgress.map(team => <div className="live-team-row" key={team.team_id}><span className="team-swatch" style={{backgroundColor: team.display_color}}/><b>{team.team_name}</b><span>{team.accepted_count}/{team.total_items}</span><div className="live-progress-track" role="progressbar" aria-label={`${team.team_name} accepted photos`} aria-valuemin={0} aria-valuemax={team.total_items} aria-valuenow={team.accepted_count}><span style={{width: `${team.total_items ? Math.min(100, team.accepted_count / team.total_items * 100) : 0}%`}}/></div></div>)}</div>}</section>}
      {error && <div className="participant-error game-error"><CircleHelp size={15}/>{error}{['review','completed'].includes(runtimeState) && <button className="outline-button" onClick={() => void loadReviewGallery()}>Retry gallery</button>}</div>}
      {runtimeState === 'waiting' && context.team.selfie && selfiePreviewUnavailable && <div className="participant-error" role="status">Team selfie saved, but its preview is unavailable. <button className="outline-button" onClick={() => setSelfiePreviewRetry(value => value + 1)}>Retry preview</button></div>}
      {runtimeState === 'waiting' && !context.start_at && <div className="manual-start-message" role="status"><Clock3 size={18}/><span><b>Waiting for the organizer</b><small>Your team is checked in. The hunt begins when the organizer starts the timer.</small></span></div>}
      {runtimeState === 'waiting' ? <section className="waiting-card"><span className="waiting-icon"><Clock3 size={26}/></span><p className="card-kicker">GET READY, {context.team.name.toUpperCase()}</p><h2>The hunt starts in</h2><div className="waiting-countdown">{clockLabel(untilStart)}</div><p className="waiting-copy">Your photo list will appear when the countdown reaches zero. Stay with your team and get ready to explore <b>{context.venue}</b>.</p><div className="teammate-panel"><div><Users size={17}/><b>{context.team.name}</b><span>{context.teammates.length} {context.teammates.length === 1 ? 'player' : 'players'}</span></div><ul>{context.teammates.map(person => <li key={person.id}><span className="participant-avatar">{person.display_name.slice(0,1).toUpperCase()}</span>{person.display_name}</li>)}</ul></div><section className="team-identity-panel" aria-label="Team identity"><b>Make your team yours</b><p>Choose a team name and add one private team selfie before the hunt starts.</p><form onSubmit={event => void saveTeamName(event)}><label>Team name<input maxLength={40} value={teamNameDraft} onChange={event => { setTeamNameDirty(true); setTeamNameDraft(event.target.value) }}/></label><button className="outline-button" disabled={teamIdentityBusy || !teamNameDraft.trim()}>Save name</button></form>{selfieUrl && <img className="team-selfie-preview" src={selfieUrl} alt={`${context.team.name} team selfie`}/>}<label className={`photo-upload-button ${teamIdentityBusy ? 'uploading' : ''}`}><input type="file" accept="image/*" capture="environment" disabled={teamIdentityBusy} onChange={event => { const file = event.currentTarget.files?.[0]; void submitTeamSelfie(file); event.currentTarget.value = '' }}/>{teamIdentityBusy ? <><LoaderCircle className="spin" size={16}/> Saving team identity…</> : <><Camera size={16}/> {selfieUrl ? 'Replace team selfie' : 'Add team selfie'}</>}</label>{teamIdentityError && <p className="photo-upload-error" role="alert">{teamIdentityError}</p>}</section>{context.rules?.length > 0 && <div className="waiting-rules"><b>Remember</b>{context.rules.map(rule => <span key={rule}><Check size={14}/>{rule}</span>)}</div>}</section> : runtimeState === 'active' ? <section className="active-game-content">{teamProgress.length > 0 && <section className="team-progress-panel" aria-label="All team photo progress"><div className="active-game-intro"><div><b>Team progress</b><p>Accepted photo slots · team photos remain private.</p></div></div><div className="team-progress-list">{teamProgress.map(team => <div className="team-progress-row" key={team.team_id}><div className="team-progress-label"><span className="team-swatch" style={{backgroundColor: team.display_color}}/><b>{team.team_name}</b><span>{team.accepted_count}/{team.total_items}</span></div><div className="team-progress-track" role="progressbar" aria-label={`${team.team_name} photo progress`} aria-valuemin={0} aria-valuemax={team.total_items} aria-valuenow={team.accepted_count}><span style={{width: `${team.total_items ? Math.min(100, team.accepted_count / team.total_items * 100) : 0}%`}}/></div></div>)}</div></section>}<div className="active-game-intro"><div><b>Your photo list</b><p>Find each item and take a photo with your team.</p></div><span>{Object.keys(submissions).length}/{items.length} complete</span></div>{items.length ? <div className="participant-item-list">{items.map((item,index) => { const submission = submissions[item.id]; return <article className={`participant-item-card ${submission ? 'has-submission' : ''}`} key={item.id}><span className="participant-item-number">{index+1}</span><div className="participant-item-detail"><h2>{item.title_snapshot}</h2>{item.description_snapshot && <p>{item.description_snapshot}</p>}<small><Trophy size={12}/> {item.point_value} {item.point_value === 1 ? 'point' : 'points'}</small>{submission?.photoUrl && <img className="submission-preview" src={submission.photoUrl} alt={`Team photo for ${item.title_snapshot}`}/>}<div className="photo-submission-status">{submission ? <><Check size={13}/> Photo submitted · {submission.approval_status === 'pending' ? 'awaiting review' : submission.approval_status}</> : <><ImageIcon size={13}/> No photo yet</>}</div>{uploadErrors[item.id] && <p className="photo-upload-error" role="status">{uploadErrors[item.id]}</p>}<label className={`photo-upload-button ${uploading[item.id] ? 'uploading' : ''}`}><input type="file" accept="image/*" capture="environment" disabled={uploading[item.id] || remainingSeconds <= 0} onChange={event => { const file = event.currentTarget.files?.[0]; void submitPhoto(item,file); event.currentTarget.value = '' }}/>{uploading[item.id] ? <><LoaderCircle className="spin" size={16}/> Preparing photo…</> : submission ? <><RefreshCw size={15}/> Replace photo</> : <><Camera size={16}/> Take or choose photo</>}</label></div></article>})}</div> : <div className="waiting-card"><LoaderCircle className="spin" size={22}/> Loading the photo list…</div>}<p className="photo-next-note"><ShieldCheck size={14}/> Photos are private to your team until the hunt ends. Stay together and within the venue.</p></section> : <section className="waiting-card ended-card"><span className="waiting-icon"><Check size={26}/></span><p className="card-kicker">NICE WORK, {context.team.name.toUpperCase()}</p><h2>{runtimeState === 'completed' ? 'The results are in!' : runtimeState === 'review' ? 'Photo review time!' : 'Time’s up!'}</h2><p className="waiting-copy">The hunt has ended. Your team’s photos are ready for the organizer to review.</p><div className="teammate-panel"><div><Users size={17}/><b>{context.team.name}</b><span>{context.teammates.length} {context.teammates.length === 1 ? 'player' : 'players'}</span></div><ul>{context.teammates.map(person => <li key={person.id}><span className="participant-avatar">{person.display_name.slice(0,1).toUpperCase()}</span>{person.display_name}</li>)}</ul></div></section>}
      {['review','completed'].includes(runtimeState) && reviewGallery && <section className="participant-gallery"><div className="active-game-intro"><div><b>{runtimeState === 'completed' ? 'Final results' : 'Team photo gallery'}</b><p>{runtimeState === 'completed' ? 'See how every team placed.' : reviewGallery.voting_enabled ? `Vote for a different team’s photo. A winning vote earns ${reviewGallery.voting_bonus_points} bonus points.` : 'The organizer is reviewing all team photos.'}</p></div></div>{runtimeState === 'completed' && <div className="scoreboard participant-scoreboard">{reviewGallery.final_scores.map(score => <div className="score-row" key={score.team_id}><b>#{score.rank} {score.team_name}</b><span>{score.base_points} points{score.voting_bonus ? ` + ${score.voting_bonus} voting bonus` : ''}</span><strong>{score.total}</strong></div>)}</div>}<div className="review-item-list">{reviewGallery.items.map(item => <section className="review-item" key={item.id}><header><div><span>CHALLENGE</span><h2>{item.title}</h2></div><b>{item.points} pts</b></header><div className="review-photos">{reviewGallery.teams.map(team => { const photo = reviewGallery.submissions.find(row => row.item_id === item.id && row.team_id === team.id); const selected = reviewGallery.votes.find(row => row.item_id === item.id && row.voting_team_id === context.team.id)?.selected_team_id; const photoPlaceholder = !photo ? 'No photo submitted' : photo.status === 'pending' ? 'Awaiting organizer approval' : photo.status === 'rejected' ? 'Not approved' : 'Photo preview unavailable'; return <article className="review-photo-card" key={team.id}><div className="review-photo-team"><span className="team-swatch" style={{backgroundColor:team.display_color}}/><b>{team.name}</b></div>{photo?.photo_url ? <img src={photo.photo_url} alt={`${team.name} photo for ${item.title}`} onError={() => markReviewPreviewUnavailable(photo.storage_path)}/> : <div className="review-photo-empty">{photoPlaceholder}{photo && <button className="outline-button" disabled={previewRetryingPath === photo.storage_path} aria-label={`Retry ${team.name} photo preview for ${item.title}`} onClick={() => void retryReviewPreview(photo.storage_path)}>{previewRetryingPath === photo.storage_path ? 'Retrying preview…' : 'Retry preview'}</button>}</div>}{photo?.status === 'approved' && reviewGallery.status === 'review' && reviewGallery.voting_enabled && team.id !== context.team.id && <button className={`vote-button ${selected === team.id ? 'voted' : ''}`} onClick={() => void vote(item.id,team.id)}>{selected === team.id ? 'Your vote' : 'Vote for this photo'}</button>}{photo?.status === 'approved' && runtimeState === 'completed' && <span className="review-status status-approved"><Check size={13}/> Approved</span>}</article>})}</div></section>)}</div></section>}
      {runtimeState === 'completed' && ownFinalScore && ownFinalScore.rank === 1 && ownFinalScore.total > 0 && <section className="celebration-card-panel"><div className="eyebrow"><Trophy size={14}/> {participantScores.filter(score => score.rank === 1 && score.total > 0).length > 1 ? 'TIED WINNER' : 'YOUR TEAM WON'}</div><h2>Share your team’s result</h2><p>{context.team.name} finished with {ownFinalScore.total} points. Make a celebration card with your team photo.</p><div className="celebration-card-actions"><button className="primary-button" disabled={celebrationBusy} onClick={() => void shareTeamCard()}><Users size={15}/> Share team card</button><button className="outline-button" disabled={celebrationBusy} onClick={() => void downloadTeamCard()}><ImageIcon size={15}/> Download card</button></div>{celebrationError && <p className="photo-upload-error" role="alert">{celebrationError}</p>}</section>}
      {runtimeState === 'completed' && ownFinalScore && ownFinalScore.rank !== 1 && <div className="locked-note"><Trophy size={15}/> {context.team.name} finished #{ownFinalScore.rank}. Thanks for playing!</div>}
      {runtimeState === 'completed' && ownFinalScore && ownFinalScore.total === 0 && <div className="locked-note"><Trophy size={15}/> No team scored points this hunt. Thanks for being part of the game!</div>}
      {['waiting','active'].includes(runtimeState) && <HuntChat huntId={huntId} compact />}
      <footer className="participant-footer">SnapQuest <i>•</i> {session.user.is_anonymous ? 'Your participant session is saved on this device.' : 'Welcome to the hunt.'}</footer>
    </> : null}
  </main>
}
