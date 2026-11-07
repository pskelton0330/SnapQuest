import test from 'node:test'
import assert from 'node:assert/strict'
import { isAuthorizationFailure } from '../src/lib/operationFailure.ts'

test('authorization diagnostics recognize Storage and HTTP access denials', () => {
  assert.equal(isAuthorizationFailure({ statusCode: '403', message: 'RLS policy denied' }), true)
  assert.equal(isAuthorizationFailure({ status: 401 }), true)
  assert.equal(isAuthorizationFailure({ code: '42501' }), true)
  assert.equal(isAuthorizationFailure({ code: 'P0001', message: 'Organizer access required' }), true)
})

test('authorization diagnostics do not mislabel network, application, or server failures', () => {
  assert.equal(isAuthorizationFailure(new TypeError('Failed to fetch')), false)
  assert.equal(isAuthorizationFailure({ status: 500, code: 'XX000' }), false)
  assert.equal(isAuthorizationFailure({ code: 'P0001', message: 'Hunt is already active' }), false)
  assert.equal(isAuthorizationFailure(null), false)
})
