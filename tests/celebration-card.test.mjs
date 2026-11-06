import test from 'node:test'
import assert from 'node:assert/strict'
import { celebrationFilename, winnerCaption } from '../src/lib/celebrationCard.ts'

test('celebration captions distinguish an outright win from a tie for first', () => {
  const winner = { title: 'Park Hunt', teamName: 'Team Cedar', score: 12 }
  assert.match(winnerCaption(winner), /Team Cedar won Park Hunt with 12 points/)
  assert.match(winnerCaption({ ...winner, tied: true }), /Team Cedar tied for first in Park Hunt with 12 points/)
})

test('celebration filenames are safe for long or punctuation-only team names', () => {
  assert.equal(celebrationFilename('Team Cedar!'), 'snapquest-team-cedar-winner.png')
  assert.equal(celebrationFilename('!!!'), 'snapquest-winner-winner.png')
})
