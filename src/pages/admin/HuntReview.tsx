import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, CircleHelp, Clock3, Download, LoaderCircle, Medal, Share2, Trophy, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { calculateTeamScores, normalizeFinalScores, normalizeScoringVotes, winningTeams as findWinningTeams, type ScoringSubmission } from '../../lib/scoring'
import { celebrationFilename, renderWinnerCelebrationCard, winnerCaption } from '../../lib/celebrationCard'
import { reportOperation } from '../../lib/operationLog'

type HuntReviewProps = { huntId: string; title: string; status: string; onBack: () => void; onChanged: () => void }
type ReviewData = {
  voting_enabled: boolean; voting_bonus_points: number; status: string; can_begin_review: boolean
  final_scores: unknown
  teams: { id: string; name: string; display_color: string }[]
  items: { id: string; title: string; points: number; display_order: number }[]
  submissions: { id: string; item_id: string; team_id: string; participant_id: string; storage_path: string; status: 'pending' | 'approved' | 'rejected'; submitted_at: string; photo_url?: string }[]
  votes: unknown
  team_selfies: { team_id: string; storage_path: string; photo_url?: string }[]
}

export default function HuntReview({ huntId, title, status, onBack, onChanged }: HuntReviewProps) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [previewRetryingPath, setPreviewRetryingPath] = useState('')
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [celebrationBusy, setCelebrationBusy] = useState(false)
  const [celebrationError, setCelebrationError] = useState('')
  const [celebrationPreviewUrl, setCelebrationPreviewUrl] = useState('')
  const [celebrationTeamId, setCelebrationTeamId] = useState('')
  const galleryRequestId = useRef(0)
  const signedUrlCache = useRef(new Map<string, { url: string; expiresAt: number }>())

  const load = useCallback(async () => {
    if (!supabase) return
    const requestId = ++galleryRequestId.current
    const { data: raw, error: loadError } = await supabase.rpc('get_hunt_review_gallery', { p_hunt_id: huntId })
    if (loadError) { if (requestId === galleryRequestId.current) setError(loadError.message); return }
    const next = raw as Omit<ReviewData, 'submissions'> & { submissions: ReviewData['submissions'] }
    async function signedUrl(path: string) {
      const cached = signedUrlCache.current.get(path)
      if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url
      const { data: signed } = await supabase!.storage.from('hunt-photos').createSignedUrl(path, 300)
      if (signed?.signedUrl) signedUrlCache.current.set(path, { url: signed.signedUrl, expiresAt: Date.now() + 270_000 })
      return signed?.signedUrl
    }
    const photos = await Promise.all(next.submissions.map(async row => ({ ...row, photo_url: await signedUrl(row.storage_path) })))
    if (requestId !== galleryRequestId.current) return
    const { data: selfies } = await supabase.from('team_selfies').select('team_id,storage_path').eq('hunt_id', huntId)
    const teamSelfies = await Promise.all((selfies ?? []).map(async row => ({ ...row, photo_url: await signedUrl(row.storage_path) })))
    if (requestId !== galleryRequestId.current) return
    setData({ ...next, submissions: photos, team_selfies: teamSelfies })
    setError('')
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
    const { error: actionError } = await supabase.rpc('review_submission', { p_submission_id: id, p_decision: decision })
    if (actionError) { setError(actionError.message); void reportOperation(huntId, operationId, 'review_decision_failed', 'failure', 'organizer_web') }
    else { void reportOperation(huntId, operationId, `review_${decision}_confirmed`, 'success', 'organizer_web'); await load(); onChanged() }
    setBusy('')
  }

  async function startReview() {
    if (!supabase) return
    const operationId = crypto.randomUUID()
    setBusy('review'); setError('')
    const { error: actionError } = await supabase.rpc('begin_hunt_review', { p_hunt_id: huntId })
    if (actionError) { setError(actionError.message); void reportOperation(huntId, operationId, 'begin_review_failed', 'failure', 'organizer_web') }
    else { void reportOperation(huntId, operationId, 'review_opened', 'success', 'organizer_web'); await load(); onChanged() }
    setBusy('')
  }

  async function finalize() {
    if (!supabase) return
    const operationId = crypto.randomUUID()
    setBusy('finalize'); setError('')
    const { error: actionError } = await supabase.rpc('finalize_hunt', { p_hunt_id: huntId })
    if (actionError) { setError(actionError.message); void reportOperation(huntId, operationId, 'finalization_failed', 'failure', 'organizer_web') }
    else { void reportOperation(huntId, operationId, 'finalization_confirmed', 'success', 'organizer_web'); setConfirmFinalize(false); await load(); onChanged() }
    setBusy('')
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
  const reviewStarted = ['review', 'completed'].includes(data?.status ?? '')
  const canBeginReview = Boolean(data?.can_begin_review)
  const ended = ['ended', 'review', 'completed'].includes(status) || reviewStarted || canBeginReview
  const winningTeams = findWinningTeams(scores)
  const winner = winningTeams.find(score => score.teamId === celebrationTeamId) ?? winningTeams[0]
  const tiedWinner = winningTeams.length > 1

  useEffect(() => {
    // The card is an external canvas/blob resource; its preview state belongs in this effect.
    // eslint-disable-next-line react/set-state-in-effect
    if (!data || data.status !== 'completed' || !winner) { setCelebrationPreviewUrl(''); return }
    let cancelled = false
    let objectUrl = ''
    const selfie = data.team_selfies.find(row => row.team_id === winner.teamId)
    void renderWinnerCelebrationCard({ title, teamName: winner.teamName, teamColor: data.teams.find(team => team.id === winner.teamId)?.display_color ?? '#ef766f', score: winner.total, rank: winner.rank, selfieUrl: selfie?.photo_url, tied: tiedWinner }).then(blob => {
      if (!cancelled) { objectUrl = URL.createObjectURL(blob); setCelebrationPreviewUrl(objectUrl) }
    }).catch(() => { if (!cancelled) setCelebrationPreviewUrl('') })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, title, winner?.teamId, winner?.teamName, winner?.total, winner?.rank, tiedWinner])

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

  const completedResults = data?.status === 'completed'
    ? scores.length
      ? <section className="scoreboard"><div className="eyebrow"><Medal size={14}/> FINAL RESULTS</div><h2>Hunt complete</h2>{scores.map(score => <div className="score-row" key={score.teamId}><b>#{score.rank} {score.teamName}</b><span>{score.basePoints} points{score.votingBonus ? ` + ${score.votingBonus} voting bonus` : ''}</span><strong>{score.total}</strong></div>)}</section>
      : <div className="form-error" role="alert">Final scores are unavailable. Contact the hunt organizer before sharing results.</div>
    : null

  return <section className="workspace-content hunt-review-content">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to hunt</button>
    <div className="new-hunt-heading"><div className="eyebrow"><Medal size={14}/> PHOTO REVIEW</div><h1>{title}</h1><p>Approve the photos that meet your hunt rules. Approved photos earn the item’s points.</p></div>
    {error && <div className="form-error" role="alert"><CircleHelp size={15}/>{error}</div>}
    {!data ? <div className="workspace-loading"><LoaderCircle className="spin" size={20}/> Loading the private photo gallery…</div> : <>
      {canBeginReview && <div className="review-action-banner"><Clock3 size={18}/><div><b>Hunt time is up</b><span>Start photo review when you’re ready. This does not change the hunt’s end time.</span></div><button className="outline-button" disabled={busy === 'review'} onClick={() => void startReview()}>{busy === 'review' ? 'Opening review…' : 'Start photo review'}</button></div>}
      {!ended && <div className="review-action-banner"><Clock3 size={18}/><div><b>Hunt is still running</b><span>Photo review opens after the hunt ends. You can end the hunt from its lobby.</span></div></div>}
      {reviewStarted && <div className="review-summary"><b>{pendingCount ? `${pendingCount} photos need review` : 'All submitted photos reviewed'}</b><span>{data.submissions.length} submitted · {data.teams.length} teams · {data.items.length} challenges</span></div>}
      <div className="review-item-list">{data.items.map(item => <section className="review-item" key={item.id}><header><div><span>CHALLENGE {item.display_order + 1}</span><h2>{item.title}</h2></div><b>{item.points} pts</b></header><div className="review-photos">{data.teams.map(team => {
        const photo = data.submissions.find(row => row.item_id === item.id && row.team_id === team.id)
        return <article className="review-photo-card" key={team.id}><div className="review-photo-team"><span className="team-swatch" style={{ backgroundColor: team.display_color }}/><b>{team.name}</b></div>{photo?.photo_url ? <a href={photo.photo_url} target="_blank" rel="noreferrer"><img src={photo.photo_url} alt={`${team.name} photo for ${item.title}`} onError={() => markPreviewUnavailable(photo.storage_path)}/></a> : <div className="review-photo-empty">{photo ? <>Preview unavailable<button className="outline-button" disabled={previewRetryingPath === photo.storage_path} onClick={() => void retryReviewPhoto(photo.storage_path)}>{previewRetryingPath === photo.storage_path ? 'Retrying preview…' : 'Retry preview'}</button></> : 'No photo submitted'}</div>}{photo && <><div className={`review-status status-${photo.status}`}>{photo.status}</div>{data.status === 'review' && <div className="review-photo-actions">{photo.status === 'pending' ? <><button className="approve-button" disabled={busy === photo.id} onClick={() => void decide(photo.id, 'approved')}><Check size={14}/> Approve</button><button className="reject-button" disabled={busy === photo.id} onClick={() => void decide(photo.id, 'rejected')}><X size={14}/> Reject</button></> : <button className={photo.status === 'approved' ? 'reject-button' : 'approve-button'} disabled={busy === photo.id} aria-label={photo.status === 'approved' ? 'Change decision to rejected' : 'Change decision to approved'} onClick={() => void decide(photo.id, photo.status === 'approved' ? 'rejected' : 'approved')}>{photo.status === 'approved' ? <><X size={14}/> Change to rejected</> : <><Check size={14}/> Change to approved</>}</button>}</div>}</>}</article>
      })}</div></section>)}</div>
      {data.status === 'completed' ? completedResults : ended ? (
        <div className="review-finish">
          <div><b>Ready to publish the results?</b><span>{pendingCount ? 'Every submitted photo must be approved or rejected first.' : 'This locks the final scores and shows the leaderboard to participants.'}</span></div>
          {confirmFinalize ? <><button className="outline-button" onClick={() => setConfirmFinalize(false)}>Cancel</button><button className="primary-button" disabled={!!pendingCount || busy === 'finalize'} onClick={() => void finalize()}>{busy === 'finalize' ? 'Finalizing…' : 'Confirm final results'}</button></> : <button className="primary-button" disabled={!!pendingCount} onClick={() => setConfirmFinalize(true)}>Finalize results</button>}
        </div>
      ) : null}
      {data.status === 'completed' && (winner ? <section className="celebration-card-panel"><div className="eyebrow"><Trophy size={14}/> {winningTeams.length > 1 ? 'TIED WINNERS' : 'WINNER CELEBRATION'}</div><h2>{winningTeams.length > 1 ? `${winningTeams.length} teams share first place` : 'Make the win shareable'}</h2>{winningTeams.length > 1 && <label>Choose a team card<select value={winner.teamId} onChange={event => setCelebrationTeamId(event.target.value)}>{winningTeams.map(team => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}</select></label>}{celebrationPreviewUrl && <img className="celebration-card-preview" src={celebrationPreviewUrl} alt={`Winner celebration card for ${winner.teamName}`}/>}<p>Create a branded winner card using {winner.teamName}’s team selfie. If no selfie was submitted, the card uses the team color as a placeholder.</p><div className="celebration-card-actions"><button className="primary-button" disabled={celebrationBusy} onClick={() => void shareCelebrationCard()}><Share2 size={15}/> {celebrationBusy ? 'Preparing card…' : 'Share winner card'}</button><button className="outline-button" disabled={celebrationBusy} onClick={() => void downloadCelebrationCard()}><Download size={15}/> Download card</button></div>{celebrationError && <p className="photo-upload-error" role="alert">{celebrationError}</p>}<small className="celebration-card-note">The image is created in this browser and is not uploaded to SnapQuest.</small></section> : <section className="celebration-card-panel"><div className="eyebrow"><Trophy size={14}/> RESULTS</div><h2>No winning team this time</h2><p>Every team finished with zero points. Celebrate the teams’ effort and try another hunt.</p></section>)}
    </>}
  </section>
}
