import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTeamScores } from '../src/lib/scoring.ts'

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
    ['gold', 1, 1], ['red', 1, 1], ['blue', 0, 3],
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
})
