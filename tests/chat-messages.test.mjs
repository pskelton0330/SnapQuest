import test from 'node:test'
import assert from 'node:assert/strict'
import { countNewMessages } from '../src/lib/chatMessages.ts'

test('chat unread counts include each newly received message once', () => {
  assert.equal(countNewMessages(['one', 'two'], [{ id: 'two' }, { id: 'three' }, { id: 'four' }]), 2)
})
