export type ScoringTeam = { id: string; name: string }
export type ScoringItem = { id: string; pointValue: number }
export type ScoringSubmission = { teamId: string; itemId: string; approvalStatus: 'pending' | 'approved' | 'rejected' }
export type ScoringVote = { itemId: string; votingTeamId: string; selectedTeamId: string }
export type TeamScore = { teamId: string; teamName: string; basePoints: number; votingBonus: number; total: number; rank: number }

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
  ranked.forEach((team, index) => {
    if (previousTotal !== team.total) rank = index + 1
    team.rank = rank
    previousTotal = team.total
  })
  return ranked
}
