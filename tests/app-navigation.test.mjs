import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRouteToOrganizerWorkspace } from '../src/lib/appNavigation.ts'

test('anonymous participant sessions return to the public home instead of the recovery screen', () => {
  assert.equal(shouldRouteToOrganizerWorkspace({ user: { is_anonymous: true } }), false)
  assert.equal(shouldRouteToOrganizerWorkspace(null), false)
})

test('permanent organizer sessions open the organizer workspace', () => {
  assert.equal(shouldRouteToOrganizerWorkspace({ user: { is_anonymous: false } }), true)
})
