export type ScoringTeam = { id: string; name: string }
export type ScoringItem = { id: string; pointValue: number }
export type ScoringSubmission = { teamId: string; itemId: string; approvalStatus: 'pending' | 'approved' | 'rejected' }
export type ScoringVote = { itemId: string; votingTeamId: string; selectedTeamId: string }
export type TeamScore = { teamId: string; teamName: string; basePoints: number; votingBonus: number; total: number; rank: number }

/** Zero-point ties have no winner; all positive teams at rank one share the win. */
export function winningTeams(scores: TeamScore[]) {
  if (!scores.length || scores[0].total <= 0) return []
  return scores.filter(score => score.rank === scores[0].rank)
}

/** Convert the snake_case vote rows returned by the review RPC at the API boundary. */
export function normalizeScoringVotes(value: unknown): ScoringVote[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const vote = row as Record<string, unknown>
    const itemId = vote.itemId ?? vote.item_id
    const votingTeamId = vote.votingTeamId ?? vote.voting_team_id
    const selectedTeamId = vote.selectedTeamId ?? vote.selected_team_id
    if (typeof itemId !== 'string' || typeof votingTeamId !== 'string' || typeof selectedTeamId !== 'string') return []
    return [{ itemId, votingTeamId, selectedTeamId }]
  })
}

/** Read the immutable database score snapshot for completed games. */
export function normalizeFinalScores(value: unknown): TeamScore[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const score = row as Record<string, unknown>
    const teamId = score.team_id
    const teamName = score.team_name
    const basePoints = score.base_points
    const votingBonus = score.voting_bonus
    const total = score.total
    const rank = score.rank
    if (typeof teamId !== 'string' || typeof teamName !== 'string'
      || ![basePoints, votingBonus, total, rank].every(number => typeof number === 'number' && Number.isFinite(number))) return []
    return [{ teamId, teamName, basePoints: basePoints as number, votingBonus: votingBonus as number, total: total as number, rank: rank as number }]
  })
}

/** Pure display helper. The database repeats this calculation for authoritative results. */
export function calculateTeamScores(
  teams: ScoringTeam[],
  items: ScoringItem[],
  submissions: ScoringSubmission[],
  votes: ScoringVote[] = [],
  votingBonusPoints = 0,
): TeamScore[] {
  const pointsByItem = new Map(items.map(item => [item.id, Math.max(0, Math.trunc(item.pointValue))]))
  const scores = new Map(teams.map(team => [team.id, { basePoints: 0, votingBonus: 0 }]))
  const approvedPhotos = new Set<string>()

  for (const submission of submissions) {
    if (submission.approvalStatus !== 'approved' || !pointsByItem.has(submission.itemId)) continue
    approvedPhotos.add(`${submission.teamId}:${submission.itemId}`)
    const score = scores.get(submission.teamId)
    if (score) score.basePoints += pointsByItem.get(submission.itemId) ?? 0
  }

  const bonus = Math.max(0, Math.trunc(votingBonusPoints))
  if (bonus > 0) {
    const votesByItem = new Map<string, Map<string, number>>()
    for (const vote of votes) {
      if (!pointsByItem.has(vote.itemId) || !scores.has(vote.selectedTeamId) || vote.votingTeamId === vote.selectedTeamId || !approvedPhotos.has(`${vote.selectedTeamId}:${vote.itemId}`)) continue
      const itemVotes = votesByItem.get(vote.itemId) ?? new Map<string, number>()
      itemVotes.set(vote.selectedTeamId, (itemVotes.get(vote.selectedTeamId) ?? 0) + 1)
      votesByItem.set(vote.itemId, itemVotes)
    }
    for (const itemVotes of votesByItem.values()) {
      const maximum = Math.max(0, ...itemVotes.values())
      if (maximum === 0) continue
      for (const [teamId, count] of itemVotes) {
        if (count === maximum) scores.get(teamId)!.votingBonus += bonus
      }
    }
  }

  const ranked = teams.map(team => {
    const score = scores.get(team.id)!
    return { teamId: team.id, teamName: team.name, ...score, total: score.basePoints + score.votingBonus, rank: 0 }
  }).sort((a, b) => b.total - a.total || a.teamName.localeCompare(b.teamName))

  let rank = 0
  let previousTotal: number | undefined
  ranked.forEach(team => {
    if (previousTotal !== team.total) rank += 1
    team.rank = rank
    previousTotal = team.total
  })
  return ranked
}
