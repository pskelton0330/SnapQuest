import test from 'node:test'
import assert from 'node:assert/strict'
import { completePhotoCleanup, pendingPhotoCleanup, queuePhotoCleanup, removePhotoOrQueueCleanup } from '../src/lib/photoCleanup.ts'

function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

test('photo cleanup queue deduplicates, preserves every failed path, and retries only unfinished paths', () => {
  const local = storage()
  for (let i = 0; i < 25; i++) queuePhotoCleanup(local, 'hunt', 'team', `photo-${i}`)
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').length, 25)
  queuePhotoCleanup(local, 'hunt', 'team', 'photo-24')
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').filter(path => path === 'photo-21').length, 1)
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').filter(path => path === 'photo-24').length, 1)
  completePhotoCleanup(local, 'hunt', 'team', 'photo-21')
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').includes('photo-21'), false)
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').includes('photo-0'), true)
  completePhotoCleanup(local, 'hunt', 'team', 'missing')
  assert.equal(pendingPhotoCleanup(local, 'hunt', 'team').length, 24)
})

test('failed Storage deletion is queued whether the client returns an error or throws', async () => {
  const local = storage()
  const deny = async () => ({ error: new Error('Storage denied the delete') })
  const disconnect = async () => { throw new Error('network disconnected') }

  assert.equal(await removePhotoOrQueueCleanup(local, 'hunt', 'team', 'returned-error.jpg', deny), false)
  assert.equal(await removePhotoOrQueueCleanup(local, 'hunt', 'team', 'thrown-error.jpg', disconnect), false)
  assert.deepEqual(pendingPhotoCleanup(local, 'hunt', 'team'), ['returned-error.jpg', 'thrown-error.jpg'])
})

test('successful deletion clears its retry entry and returned cleanup failures do not reject saves', async () => {
  const local = storage()
  queuePhotoCleanup(local, 'hunt', 'team', 'old-photo.jpg')

  assert.equal(await removePhotoOrQueueCleanup(local, 'hunt', 'team', 'old-photo.jpg', async () => ({ error: null })), true)
  assert.deepEqual(pendingPhotoCleanup(local, 'hunt', 'team'), [])
})
