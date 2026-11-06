import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTeamScores, normalizeFinalScores, normalizeScoringVotes, winningTeams } from '../src/lib/scoring.ts'

const teams = [{ id: 'red', name: 'Team Red' }, { id: 'blue', name: 'Team Blue' }, { id: 'gold', name: 'Team Gold' }]
const items = [{ id: 'one', pointValue: 1 }, { id: 'bonus', pointValue: 5 }]

test('only approved submissions earn base points and ties share rank', () => {
  const scores = calculateTeamScores(teams, items, [
    { teamId: 'red', itemId: 'one', approvalStatus: 'approved' },
    { teamId: 'red', itemId: 'bonus', approvalStatus: 'rejected' },
    { teamId: 'blue', itemId: 'one', approvalStatus: 'pending' },
    { teamId: 'gold', itemId: 'one', approvalStatus: 'approved' },
  ])
  assert.deepEqual(scores.map(({ teamId, total, rank }) => [teamId, total, rank]), [
    ['gold', 1, 1], ['red', 1, 1], ['blue', 0, 2],
  ])
})

test('voting bonuses apply per item, ignore self votes, and pay ties', () => {
  const scores = calculateTeamScores(teams, items, [
    { teamId: 'blue', itemId: 'one', approvalStatus: 'approved' },
    { teamId: 'gold', itemId: 'bonus', approvalStatus: 'approved' },
  ], [
    { itemId: 'one', votingTeamId: 'red', selectedTeamId: 'blue' },
    { itemId: 'one', votingTeamId: 'gold', selectedTeamId: 'blue' },
    { itemId: 'one', votingTeamId: 'blue', selectedTeamId: 'blue' },
    { itemId: 'one', votingTeamId: 'gold', selectedTeamId: 'red' },
    { itemId: 'bonus', votingTeamId: 'red', selectedTeamId: 'gold' },
    { itemId: 'bonus', votingTeamId: 'blue', selectedTeamId: 'gold' },
  ], 3)
  assert.deepEqual(scores.map(({ teamId, votingBonus }) => [teamId, votingBonus]), [
    ['gold', 3], ['blue', 3], ['red', 0],
  ])
})

test('no submissions or votes produce a tied zero score', () => {
  const scores = calculateTeamScores(teams, items, [])
  assert.ok(scores.every(score => score.total === 0 && score.rank === 1))
  assert.deepEqual(winningTeams(scores), [])
})

test('all positive teams tied at first share the winner result', () => {
  const scores = calculateTeamScores(teams, items, [
    { teamId: 'blue', itemId: 'one', approvalStatus: 'approved' },
    { teamId: 'gold', itemId: 'one', approvalStatus: 'approved' },
  ])
  assert.deepEqual(winningTeams(scores).map(team => team.teamId), ['blue','gold'])
})

test('review RPC snake_case votes normalize before provisional scoring', () => {
  const votes = normalizeScoringVotes([
    { item_id: 'one', voting_team_id: 'red', selected_team_id: 'blue' },
    { item_id: 'one', voting_team_id: 'gold', selected_team_id: 'blue' },
    { item_id: 'one', voting_team_id: 'blue', selected_team_id: 'red' },
    { item_id: 4, voting_team_id: 'red', selected_team_id: 'gold' },
  ])
  assert.deepEqual(votes, [
    { itemId: 'one', votingTeamId: 'red', selectedTeamId: 'blue' },
    { itemId: 'one', votingTeamId: 'gold', selectedTeamId: 'blue' },
    { itemId: 'one', votingTeamId: 'blue', selectedTeamId: 'red' },
  ])
  const scores = calculateTeamScores(teams, items, [
    { teamId: 'blue', itemId: 'one', approvalStatus: 'approved' },
    { teamId: 'red', itemId: 'one', approvalStatus: 'approved' },
  ], votes, 3)
  assert.equal(scores.find(score => score.teamId === 'blue')?.votingBonus, 3)
})

test('completed score snapshots normalize from the database contract', () => {
  const scores = normalizeFinalScores([
    { team_id: 'red', team_name: 'Team Red', base_points: 10, voting_bonus: 0, total: 10, rank: 1 },
    { team_id: 'blue', team_name: 'Team Blue', base_points: 0, voting_bonus: 0, total: 0, rank: 2 },
    { team_id: 'bad', team_name: 'Bad', base_points: '10', voting_bonus: 0, total: 10, rank: 1 },
  ])
  assert.deepEqual(scores, [
    { teamId: 'red', teamName: 'Team Red', basePoints: 10, votingBonus: 0, total: 10, rank: 1 },
    { teamId: 'blue', teamName: 'Team Blue', basePoints: 0, votingBonus: 0, total: 0, rank: 2 },
  ])
})
