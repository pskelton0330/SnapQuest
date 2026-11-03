import test from 'node:test'
import assert from 'node:assert/strict'
import { completePhotoCleanup, pendingPhotoCleanup, queuePhotoCleanup } from '../src/lib/photoCleanup.ts'

function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

test('photo cleanup queue deduplicates, caps, and retries only unfinished paths', () => {
  const local = storage()
  for (let i = 0; i < 22; i++) queuePhotoCleanup(local, 'hunt', 'team', `photo-${i}`)
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').length, 20)
  queuePhotoCleanup(local, 'hunt', 'team', 'photo-21')
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').filter(path => path === 'photo-21').length, 1)
  completePhotoCleanup(local, 'hunt', 'team', 'photo-21')
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').includes('photo-21'), false)
  completePhotoCleanup(local, 'hunt', 'team', 'missing')
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').length, 19)
})
