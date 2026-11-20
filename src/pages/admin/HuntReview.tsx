import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, CircleHelp, Clock3, Copy, Download, LoaderCircle, Medal, Share2, Trophy, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { calculateTeamScores, normalizeFinalScores, normalizeScoringVotes, winningTeams as findWinningTeams, type ScoringSubmission } from '../../lib/scoring'
import { celebrationFilename, renderWinnerCelebrationCard, winnerCaption } from '../../lib/celebrationCard'
import { copyTextToClipboard } from '../../lib/clipboard'
import { reportOperation, reportOperationFailure } from '../../lib/operationLog'

type HuntReviewProps = { huntId: string; title: string; status: string; onBack: () => void; onChanged: () => void }
type ReviewData = {
  voting_enabled: boolean; voting_bonus_points: number; status: string; can_begin_review: boolean
  final_scores: unknown
  teams: { id: string; name: string; display_color: string }[]
  items: { id: string; title: string; points: number; display_order: number }[]
  submissions: { id: string; item_id: string; team_id: string; participant_id: string; participant_name?: string | null; storage_path: string; status: 'pending' | 'approved' | 'rejected'; submitted_at: string; photo_url?: string }[]
  votes: unknown
  team_selfies: { team_id: string; storage_path: string; photo_url?: string }[]
  winner_cards: { team_id: string; storage_path: string; photo_url?: string }[]
}

export default function HuntReview({ huntId, title, status, onBack, onChanged }: HuntReviewProps) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [previewRetryingPath, setPreviewRetryingPath] = useState('')
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [celebrationBusy, setCelebrationBusy] = useState(false)
  const [celebrationError, setCelebrationError] = useState('')
  const [copiedCaption, setCopiedCaption] = useState('')
  const [celebrationPreviewUrl, setCelebrationPreviewUrl] = useState('')
  const [celebrationTeamId, setCelebrationTeamId] = useState('')
  const [savingWinnerCards, setSavingWinnerCards] = useState(false)
  const [winnerCardSaveRetry, setWinnerCardSaveRetry] = useState(0)
  const galleryRequestId = useRef(0)
  const signedUrlCache = useRef(new Map<string, { url: string; expiresAt: number }>())
  const winnerCardJobs = useRef(new Set<string>())
  const failedWinnerCardJobs = useRef(new Set<string>())
  const finalizationOperationId = useRef<string | null>(null)
  const finalizationAttempt = useRef(0)

  const load = useCallback(async () => {
    if (!supabase) return
    const requestId = ++galleryRequestId.current
    const { data: raw, error: loadError } = await supabase.rpc('get_hunt_review_gallery', { p_hunt_id: huntId })
    if (loadError) { if (requestId === galleryRequestId.current) setError(loadError.message); reportOperationFailure(huntId, crypto.randomUUID(), 'review_gallery_load_failed', loadError, 'organizer_web'); return }
    const next = raw as Omit<ReviewData, 'submissions'> & { submissions: ReviewData['submissions'] }
    const participantIds = [...new Set(next.submissions.map(row => row.participant_id).filter(Boolean))]
    const participantResult = participantIds.length
      ? await supabase.from('participants').select('id,display_name').in('id', participantIds)
      : { data: [], error: null }
    if (participantResult.error) {
      setError('Could not load the names for submitted photos. Retry the review screen to try again.')
      reportOperationFailure(huntId, crypto.randomUUID(), 'review_participant_names_load_failed', participantResult.error, 'organizer_web')
    }
    const participantNames = new Map((participantResult.data ?? []).map(row => [row.id, row.display_name]))
    let previewUnavailable = false
    let previewFailure: unknown = null
    async function signedUrl(path: string, bucket = 'hunt-photos') {
      const cacheKey = `${bucket}:${path}`
      const cached = signedUrlCache.current.get(cacheKey)
      if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url
      try {
        const { data: signed, error: signError } = await supabase!.storage.from(bucket).createSignedUrl(path, 3600)
        if (signError || !signed?.signedUrl) { previewUnavailable = true; previewFailure ??= signError ?? new Error('Signed preview URL was unavailable'); return undefined }
        signedUrlCache.current.set(cacheKey, { url: signed.signedUrl, expiresAt: Date.now() + 3_500_000 })
        return signed.signedUrl
      } catch (signError) {
        previewUnavailable = true
        previewFailure ??= signError
        return undefined
      }
    }
    const photos = await Promise.all(next.submissions.map(async row => ({ ...row, participant_name: participantNames.get(row.participant_id) ?? null, photo_url: await signedUrl(row.storage_path) })))
    if (requestId !== galleryRequestId.current) return
    const { data: selfies } = await supabase.from('team_selfies').select('team_id,storage_path').eq('hunt_id', huntId)
    const teamSelfies = await Promise.all((selfies ?? []).map(async row => ({ ...row, photo_url: await signedUrl(row.storage_path) })))
    if (requestId !== galleryRequestId.current) return
    const { data: winnerCards, error: cardError } = next.status === 'completed'
      ? await supabase.from('winner_celebration_cards').select('team_id,storage_path').eq('hunt_id', huntId)
      : { data: [], error: null }
    if (cardError) {
      setError(cardError.message)
      reportOperationFailure(huntId, crypto.randomUUID(), 'winner_cards_load_failed', cardError, 'organizer_web')
    }
    const savedCards = await Promise.all((winnerCards ?? []).map(async row => ({ ...row, photo_url: await signedUrl(row.storage_path, 'winner-cards') })))
    if (requestId !== galleryRequestId.current) return
    if (previewUnavailable) reportOperationFailure(huntId, crypto.randomUUID(), 'review_preview_unavailable', previewFailure, 'organizer_web')
    setData({ ...next, submissions: photos, team_selfies: teamSelfies, winner_cards: savedCards })
    if (!cardError && !participantResult.error) setError('')
  }, [huntId])

  function markPreviewUnavailable(path: string) {
    signedUrlCache.current.delete(path)
    setData(current => current ? { ...current, submissions: current.submissions.map(photo => photo.storage_path === path ? { ...photo, photo_url: undefined } : photo) } : current)
  }

  async function retryReviewPhoto(path: string) {
    if (previewRetryingPath === path) return
    setPreviewRetryingPath(path)
    signedUrlCache.current.delete(path)
    try { await load() }
    finally { setPreviewRetryingPath('') }
  }

  // Initializing the review screen from its database-backed source is intentional.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const requestCounter = galleryRequestId
    const refresh = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 20_000)
    const reconcile = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', reconcile); window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      ++requestCounter.current
      window.clearInterval(refresh)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('online', reconcile)
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [load])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (!supabase) return
    const operationId = crypto.randomUUID()
    setBusy(id); setError('')
    try {
      const { error: actionError } = await supabase.rpc('review_submission', { p_submission_id: id, p_decision: decision })
      if (actionError) {
        setError(actionError.message)
        reportOperationFailure(huntId, operationId, 'review_decision_failed', actionError, 'organizer_web')
        return
      }
      void reportOperation(huntId, operationId, `review_${decision}_confirmed`, 'success', 'organizer_web')
      // The decision RPC has committed. Reflect it immediately so a slow gallery
      // refresh cannot leave the control disabled or make the organizer retry.
      setData(current => current ? { ...current, submissions: current.submissions.map(photo => photo.id === id ? { ...photo, status: decision } : photo) } : current)
      onChanged()
      void load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The photo decision could not be saved. Please try again.')
      reportOperationFailure(huntId, operationId, 'review_decision_failed', actionError, 'organizer_web')
    } finally {
      setBusy('')
    }
  }

  async function startReview() {
    if (!supabase) return
    const operationId = crypto.randomUUID()
    setBusy('review'); setError('')
    const { error: actionError } = await supabase.rpc('begin_hunt_review', { p_hunt_id: huntId })
    if (actionError) { setError(actionError.message); reportOperationFailure(huntId, operationId, 'begin_review_failed', actionError, 'organizer_web') }
    else { void reportOperation(huntId, operationId, 'review_opened', 'success', 'organizer_web'); await load(); onChanged() }
    setBusy('')
  }

  async function finalize() {
    if (!supabase) return
    const operationId = finalizationOperationId.current ?? crypto.randomUUID()
    finalizationOperationId.current = operationId
    const attempt = ++finalizationAttempt.current
    setBusy('finalize'); setError('')
    let actionErrorMessage: string | null = null
    let actionFailure: unknown = null
    try {
      const { error: actionError } = await supabase.rpc('finalize_hunt', { p_hunt_id: huntId })
      actionErrorMessage = actionError?.message ?? null
      actionFailure = actionError
    } catch (finalizeError) {
      actionFailure = finalizeError
      actionErrorMessage = finalizeError instanceof Error ? finalizeError.message : 'Final results could not be confirmed. Please retry.'
    }
    if (actionErrorMessage) {
      setError(actionErrorMessage)
      reportOperationFailure(huntId, operationId, attempt === 1 ? 'finalization_failed' : 'finalization_retry_failed', actionFailure, 'organizer_web')
      setBusy('')
      return
    }
    void reportOperation(huntId, operationId, attempt === 1 ? 'finalization_confirmed' : 'finalization_retry_confirmed', 'success', 'organizer_web')
    finalizationOperationId.current = null
    finalizationAttempt.current = 0
    setConfirmFinalize(false)
    try { await load(); onChanged() }
    finally { setBusy('') }
  }

  const scores = data
    ? data.status === 'completed'
      ? normalizeFinalScores(data.final_scores)
      : calculateTeamScores(
        data.teams,
        data.items.map(item => ({ id: item.id, pointValue: item.points })),
        data.submissions.map(row => ({ teamId: row.team_id, itemId: row.item_id, approvalStatus: row.status } as ScoringSubmission)),
        normalizeScoringVotes(data.votes),
        data.voting_bonus_points,
      )
    : []
  const pendingCount = data?.submissions.filter(row => row.status === 'pending').length ?? 0
  const approvedCount = data?.submissions.filter(row => row.status === 'approved').length ?? 0
  const rejectedCount = data?.submissions.filter(row => row.status === 'rejected').length ?? 0
  const reviewStarted = ['review', 'completed'].includes(data?.status ?? '')
  const canBeginReview = Boolean(data?.can_begin_review)
  const ended = ['ended', 'review', 'completed'].includes(status) || reviewStarted || canBeginReview
  const winningTeams = findWinningTeams(scores)
  const winner = winningTeams.find(score => score.teamId === celebrationTeamId) ?? winningTeams[0]
  const tiedWinner = winningTeams.length > 1
  const celebrationCaption = winner ? winnerCaption({ title, teamName: winner.teamName, score: winner.total, tied: tiedWinner }) : ''

  useEffect(() => {
    // The card is an external canvas/blob resource; its preview state belongs in this effect.
    // eslint-disable-next-line react/set-state-in-effect
    if (!data || data.status !== 'completed' || !winner) { setCelebrationPreviewUrl(''); return }
    let cancelled = false
    let objectUrl = ''
    const savedCard = data.winner_cards.find(row => row.team_id === winner.teamId)
    if (savedCard?.photo_url) { setCelebrationPreviewUrl(savedCard.photo_url); return }
    const selfie = data.team_selfies.find(row => row.team_id === winner.teamId)
    void renderWinnerCelebrationCard({ title, teamName: winner.teamName, teamColor: data.teams.find(team => team.id === winner.teamId)?.display_color ?? '#ef766f', score: winner.total, rank: winner.rank, selfieUrl: selfie?.photo_url, tied: tiedWinner }).then(blob => {
      if (!cancelled) { objectUrl = URL.createObjectURL(blob); setCelebrationPreviewUrl(objectUrl) }
    }).catch(() => { if (!cancelled) setCelebrationPreviewUrl('') })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, title, winner?.teamId, winner?.teamName, winner?.total, winner?.rank, tiedWinner])

  useEffect(() => {
    if (!supabase || data?.status !== 'completed') return
    const missingCards = winningTeams.filter(team => !data.winner_cards.some(card => card.team_id === team.teamId) && !failedWinnerCardJobs.current.has(`${huntId}:${team.teamId}`))
    if (!missingCards.length) { setSavingWinnerCards(false); return }
    setSavingWinnerCards(true)
    for (const team of missingCards) {
      const jobKey = `${huntId}:${team.teamId}`
      if (winnerCardJobs.current.has(jobKey)) continue
      winnerCardJobs.current.add(jobKey)
      const selfie = data.team_selfies.find(row => row.team_id === team.teamId)
      const teamColor = data.teams.find(row => row.id === team.teamId)?.display_color ?? '#ef766f'
      const tied = winningTeams.length > 1
      const cardPath = `${huntId}/${team.teamId}/winner.png`
      void (async () => {
        const blob = await renderWinnerCelebrationCard({ title, teamName: team.teamName, teamColor, score: team.total, rank: team.rank, selfieUrl: selfie?.photo_url, tied })
        const { error: uploadError } = await supabase!.storage.from('winner-cards').upload(cardPath, blob, { contentType: 'image/png', cacheControl: '31536000', upsert: true })
        if (uploadError) throw uploadError
        const { error: saveError } = await supabase!.from('winner_celebration_cards').upsert({ hunt_id: huntId, team_id: team.teamId, storage_path: cardPath }, { onConflict: 'hunt_id,team_id' })
        if (saveError) throw saveError
        const { data: signed, error: signError } = await supabase!.storage.from('winner-cards').createSignedUrl(cardPath, 3600)
        if (signError || !signed?.signedUrl) throw signError ?? new Error('The saved winner card could not be reopened.')
        signedUrlCache.current.set(`winner-cards:${cardPath}`, { url: signed.signedUrl, expiresAt: Date.now() + 3_500_000 })
        setData(current => current ? { ...current, winner_cards: [...current.winner_cards.filter(card => card.team_id !== team.teamId), { team_id: team.teamId, storage_path: cardPath, photo_url: signed.signedUrl }] } : current)
        void reportOperation(huntId, crypto.randomUUID(), 'winner_card_saved', 'success', 'organizer_web')
      })().catch(saveError => {
        failedWinnerCardJobs.current.add(jobKey)
        setCelebrationError(saveError instanceof Error ? saveError.message : 'The winner card could not be saved. It will remain available to retry.')
        reportOperationFailure(huntId, crypto.randomUUID(), 'winner_card_save_failed', saveError, 'organizer_web')
      }).finally(() => {
        winnerCardJobs.current.delete(jobKey)
        setSavingWinnerCards([...missingCards].some(row => row.teamId !== team.teamId && winnerCardJobs.current.has(`${huntId}:${row.teamId}`)))
      })
    }
  }, [data, huntId, title, winningTeams, winnerCardSaveRetry])

  function retryWinnerCardSave() {
    for (const team of winningTeams) failedWinnerCardJobs.current.delete(`${huntId}:${team.teamId}`)
    setCelebrationError('')
    setWinnerCardSaveRetry(value => value + 1)
  }

  useEffect(() => {
    if (data?.status === 'completed') window.scrollTo(0, 0)
  }, [data?.status])

  async function buildCelebrationCard() {
    if (!data || !winner) return null
    const selfie = data.team_selfies.find(row => row.team_id === winner.teamId)
    return renderWinnerCelebrationCard({
      title,
      teamName: winner.teamName,
      teamColor: data.teams.find(team => team.id === winner.teamId)?.display_color ?? '#ef766f',
      score: winner.total,
      rank: winner.rank,
      selfieUrl: selfie?.photo_url,
      tied: tiedWinner,
    })
  }

  async function shareCelebrationCard() {
    if (!winner) return
    setCelebrationBusy(true); setCelebrationError('')
    try {
      const blob = await buildCelebrationCard()
      if (!blob) return
      const file = new File([blob], celebrationFilename(winner.teamName), { type: 'image/png' })
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: `${winner.teamName} ${tiedWinner ? 'tied for first in' : 'won'} ${title}`, text: winnerCaption({ title, teamName: winner.teamName, score: winner.total, tied: tiedWinner }), files: [file] })
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (cardError) {
      if (cardError instanceof DOMException && cardError.name === 'AbortError') return
      setCelebrationError(cardError instanceof Error ? cardError.message : 'The celebration card could not be created.')
    } finally { setCelebrationBusy(false) }
  }

  async function downloadCelebrationCard() {
    if (!winner) return
    setCelebrationBusy(true); setCelebrationError('')
    try {
      const blob = await buildCelebrationCard()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = celebrationFilename(winner.teamName); link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cardError) { setCelebrationError(cardError instanceof Error ? cardError.message : 'The celebration card could not be downloaded.')
    } finally { setCelebrationBusy(false) }
  }

  async function copyCelebrationCaption() {
    if (!winner) return
    setCelebrationError('')
    try {
      await copyTextToClipboard(celebrationCaption)
      setCopiedCaption(celebrationCaption)
    } catch {
      setCelebrationError('Caption could not be copied. Select the caption below and copy it manually.')
    }
  }

  const completedResults = data?.status === 'completed'
    ? scores.length
      ? <section className="scoreboard"><div className="eyebrow"><Medal size={14}/> FINAL RESULTS</div><h2>Hunt complete</h2>{scores.map(score => <div className="score-row" key={score.teamId}><b>#{score.rank} {score.teamName}</b><span>{score.basePoints} points{score.votingBonus ? ` + ${score.votingBonus} voting bonus` : ''}</span><strong>{score.total}</strong></div>)}</section>
      : <div className="form-error" role="alert">Final scores are unavailable. Contact the hunt organizer before sharing results.</div>
    : null

  return <section className="workspace-content hunt-review-content">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to hunt</button>
    <div className="new-hunt-heading"><div className="eyebrow"><Medal size={14}/> {status === 'completed' ? 'FINAL RESULTS' : 'PHOTO REVIEW'}</div><h1>{title}</h1><p>{status === 'completed' ? 'Final scores and submitted photos from this hunt.' : 'Review each photo and approve the ones that follow your hunt rules. Approved photos earn points.'}</p></div>
    {error && <div className="form-error" role="alert"><CircleHelp size={15}/>{error}</div>}
    {!data ? <div className="workspace-loading"><LoaderCircle className="spin" size={20}/> Loading the private photo gallery…</div> : <>
      {canBeginReview && <div className="review-action-banner"><Clock3 size={18}/><div><b>Hunt time is up</b><span>Start photo review when you’re ready. This does not change the hunt’s end time.</span></div><button className="outline-button" disabled={busy === 'review'} onClick={() => void startReview()}>{busy === 'review' ? 'Opening review…' : 'Start photo review'}</button></div>}
      {!ended && <div className="review-action-banner"><Clock3 size={18}/><div><b>Hunt is still running</b><span>Photo review opens after the hunt ends. You can end the hunt from its lobby.</span></div></div>}
      {completedResults}
      {data.status === 'completed' && (winner ? <section className="celebration-card-panel"><div className="eyebrow"><Trophy size={14}/> {winningTeams.length > 1 ? 'TIED WINNERS' : 'WINNER CELEBRATION'}</div><h2>{winningTeams.length > 1 ? `${winningTeams.length} teams share first place` : 'Make the win shareable'}</h2>{winningTeams.length > 1 && <label>Choose a team card<select value={winner.teamId} onChange={event => setCelebrationTeamId(event.target.value)}>{winningTeams.map(team => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}</select></label>}{celebrationPreviewUrl && <img className="celebration-card-preview" src={celebrationPreviewUrl} alt={`Winner celebration card for ${winner.teamName}`}/>}<p>Create a branded winner card using {winner.teamName}’s team selfie. If no selfie was submitted, the card uses the team color as a placeholder.</p><p className="celebration-caption">{celebrationCaption}</p><div className="celebration-card-actions"><button className="primary-button" disabled={celebrationBusy} onClick={() => void shareCelebrationCard()}><Share2 size={15}/> {celebrationBusy ? 'Preparing card?' : 'Share winner card'}</button><button className="outline-button" disabled={celebrationBusy} onClick={() => void downloadCelebrationCard()}><Download size={15}/> Download card</button><button className="outline-button" onClick={() => void copyCelebrationCaption()}><Copy size={15}/> {copiedCaption === celebrationCaption ? 'Caption copied' : 'Copy caption'}</button></div>{savingWinnerCards && <p className="celebration-card-note" role="status">Saving winner card{winningTeams.length > 1 ? 's' : ''} to your organizer account…</p>}{data.winner_cards.some(card => card.team_id === winner.teamId) && <p className="celebration-card-note">Saved to this hunt. Reopen it from My hunts → View results to see the card.</p>}{celebrationError && <><p className="photo-upload-error" role="alert">{celebrationError}</p><button className="outline-button" onClick={retryWinnerCardSave}>Retry saving winner card</button></>}</section> : <section className="celebration-card-panel"><div className="eyebrow"><Trophy size={14}/> RESULTS</div><h2>No winning team this time</h2><p>Every team finished with zero points. Celebrate the teams’ effort and try another hunt.</p></section>)}
      {data.status === 'review' && <div className="review-summary"><b>{pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'photo still needs' : 'photos still need'} a decision` : data.submissions.length ? 'All submitted photos have a decision' : 'No photos submitted yet'}</b><span>Approve photos that follow the hunt rules. {approvedCount} approved / {rejectedCount} rejected / {data.submissions.length} submitted.</span></div>}
      {data.status === 'review' && <label className="review-filter">Show photos <select value={reviewFilter} onChange={event => setReviewFilter(event.target.value as typeof reviewFilter)}><option value="all">All photos</option><option value="pending">Needs review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>}
      {data.status === 'review' && reviewFilter !== 'all' && !data.submissions.some(photo => photo.status === reviewFilter) && <p>No photos match this filter.</p>}
      <div className="review-item-list">{data.items.filter(item => data.status !== 'review' || reviewFilter === 'all' || data.submissions.some(photo => photo.item_id === item.id && photo.status === reviewFilter)).map(item => <section className="review-item" key={item.id}><header><div><span>CHALLENGE {item.display_order + 1}</span><h2>{item.title}</h2></div><b>{item.points} pts</b></header><div className="review-photos">{data.teams.filter(team => data.status !== 'review' || reviewFilter === 'all' || data.submissions.some(photo => photo.item_id === item.id && photo.team_id === team.id && photo.status === reviewFilter)).map(team => {
        const photo = data.submissions.find(row => row.item_id === item.id && row.team_id === team.id)
        return <article className="review-photo-card" key={team.id}><div className="review-photo-team"><span className="team-swatch" style={{ backgroundColor: team.display_color }}/><b>{team.name}</b></div>{photo && <small className="review-photo-author">Photo by {photo.participant_name ?? 'unknown participant'}</small>}{photo?.photo_url ? <a href={photo.photo_url} target="_blank" rel="noreferrer"><img src={photo.photo_url} alt={`${team.name} photo for ${item.title}`} onError={() => markPreviewUnavailable(photo.storage_path)}/></a> : <div className="review-photo-empty">{photo ? <>Preview unavailable<button className="outline-button" disabled={previewRetryingPath === photo.storage_path} onClick={() => void retryReviewPhoto(photo.storage_path)}>{previewRetryingPath === photo.storage_path ? 'Retrying preview…' : 'Retry preview'}</button></> : 'No photo submitted'}</div>}{photo && <><div className={`review-status status-${photo.status}`}>{photo.status}</div>{data.status === "review" && <div className="review-photo-actions">{photo.status === "pending" ? <><button className="approve-button" disabled={busy === photo.id} onClick={() => void decide(photo.id, "approved")}><Check size={14}/> Approve</button><button className="reject-button" disabled={busy === photo.id} onClick={() => void decide(photo.id, "rejected")}><X size={14}/> Reject</button></> : <label className={"review-approval-toggle " + photo.status}><input type="checkbox" checked={photo.status === "approved"} disabled={busy === photo.id} aria-label={"Photo meets hunt rules: " + team.name + " photo for " + item.title} onChange={event => void decide(photo.id, event.currentTarget.checked ? "approved" : "rejected")}/><span>{photo.status === "approved" ? "Approved and counted" : "Rejected and not counted"}</span></label>}</div>}</>}</article>
      })}</div></section>)}</div>
      {data.status !== 'completed' && ended ? (
        <div className="review-finish">
          <div><b>Ready to publish the results?</b><span>{pendingCount ? 'Every submitted photo must be approved or rejected first.' : 'This locks the final scores and shows the leaderboard to participants.'}</span></div>
          {confirmFinalize ? <><button className="outline-button" onClick={() => { setConfirmFinalize(false); finalizationOperationId.current = null; finalizationAttempt.current = 0 }}>Cancel</button><button className="primary-button" disabled={!!pendingCount || busy === 'finalize'} onClick={() => void finalize()}>{busy === 'finalize' ? 'Finalizing…' : 'Confirm final results'}</button></> : <button className="primary-button" disabled={!!pendingCount} onClick={() => setConfirmFinalize(true)}>Finalize results</button>}
        </div>
      ) : null}
    </>}
  </section>
}
