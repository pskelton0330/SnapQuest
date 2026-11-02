import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalWorkspaceRepository, sampleWorkspace, WORKSPACE_KEY, LEGACY_KEY, LOCAL_CREATOR, parseWorkspaceRoute } from '../src/lib/workspace.ts'

function memoryStorage() {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
test('first load seeds once and reloads retain saved personal hunts', async () => {
  const storage = memoryStorage()
  const repo = createLocalWorkspaceRepository(storage)
  const first = await repo.load()
  const own = { ...structuredClone(first.hunts[0]), id: 'new-hunt', creatorId: LOCAL_CREATOR, creatorName: 'Local', visibility: 'personal' }
  await repo.saveHunt(own)
  const reopened = await createLocalWorkspaceRepository(storage).load()
  assert.equal(reopened.hunts.length, first.hunts.length + 1)
  assert.deepEqual(reopened.hunts.find(h => h.id === own.id), own)
})
test('legacy local drafts migrate without changing their source or duplicating on reload', async () => {
  const storage = memoryStorage()
  const legacy = JSON.stringify([{ id: 'legacy', title: 'Old draft', venue: 'Shop', duration: 45, rules: 'Be safe', items: ['Red item', 'Round item'], createdAt: '2026-01-01' }])
  storage.setItem(LEGACY_KEY, legacy)
  const repo = createLocalWorkspaceRepository(storage)
  await repo.load()
  const reloaded = await repo.load()
  assert.equal(reloaded.hunts.filter(h => h.id === 'legacy').length, 1)
  assert.equal(reloaded.hunts.find(h => h.id === 'legacy').challenges[1].points, 1)
  assert.equal(storage.getItem(LEGACY_KEY), legacy)
  assert.equal(reloaded.games.some(g => g.templateId === 'legacy'), false)
})
test('multiple games preserve independent snapshots when the source hunt changes', async () => {
  const storage = memoryStorage()
  const repo = createLocalWorkspaceRepository(storage)
  const own = (await repo.load()).hunts.find(h => h.creatorId === LOCAL_CREATOR)
  const a = await repo.createGame(own.id, 'game-a', '2026-10-29')
  await repo.createGame(own.id, 'game-b', '2026-10-29')
  own.challenges[0].title = 'Edited template'
  await repo.saveHunt(own)
  a.huntSnapshot.challenges[0].title = 'Changed returned object'
  const loaded = await repo.load()
  assert.equal(loaded.games.filter(g => g.templateId === own.id).length, 2)
  assert.notEqual(loaded.games.find(g => g.id === 'game-a').huntSnapshot.challenges[0].title, own.challenges[0].title)
  assert.deepEqual(loaded.games.find(g => g.id === 'game-a').huntSnapshot, loaded.games.find(g => g.id === 'game-b').huntSnapshot)
})
test('invalid stored data is reported and never overwritten', async () => {
  const storage = memoryStorage()
  storage.setItem(WORKSPACE_KEY, '{broken')
  await assert.rejects(createLocalWorkspaceRepository(storage).load())
  assert.equal(storage.getItem(WORKSPACE_KEY), '{broken')
})
test('storage write failure is surfaced rather than claiming a successful save', async () => {
  const storage = memoryStorage()
  storage.setItem(WORKSPACE_KEY, JSON.stringify(sampleWorkspace()))
  const repo = createLocalWorkspaceRepository({ getItem: storage.getItem, setItem: () => { throw new Error('Storage full') } })
  await assert.rejects(repo.createGame('sample-craft', 'new-game', '2026-10-29'), /Storage full/)
})
test('sample public hunts cannot be overwritten and game creation validates references', async () => {
  const repo = createLocalWorkspaceRepository(memoryStorage())
  const publicHunt = (await repo.load()).hunts[0]
  await assert.rejects(repo.saveHunt(publicHunt))
  await assert.rejects(repo.saveHunt({ ...publicHunt, creatorId: LOCAL_CREATOR }))
  await assert.rejects(repo.createGame('missing', 'g', 'now'))
  await repo.createGame(publicHunt.id, 'g', 'now')
  await assert.rejects(repo.createGame(publicHunt.id, 'g', 'now'))
})
test('detail hashes survive reload parsing and malformed routes fall back safely', () => {
  assert.deepEqual(parseWorkspaceRoute('#/dev/games/sample-scheduled'), { page: 'games', id: 'sample-scheduled' })
  assert.deepEqual(parseWorkspaceRoute('#/dev/hunts/legacy'), { page: 'hunts', id: 'legacy' })
  assert.equal(parseWorkspaceRoute('#/dev/create').page, 'create')
  assert.equal(parseWorkspaceRoute('#/dev/nonsense').page, 'browse')
  assert.equal(parseWorkspaceRoute('#/join/secret').page, 'browse')
})
