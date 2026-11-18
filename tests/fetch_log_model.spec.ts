import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { type BaseModel } from '@adonisjs/lucid/orm'
import FetchLog from '../src/model/fetch_log.js'
import { resetStorage } from './helpers/app.js'

function columnOf(model: typeof BaseModel, name: string) {
  const definition = model.$getColumn(name)
  if (!definition) {
    throw new Error(`Missing column ${name}`)
  }
  return definition
}

test.group('FetchLog model', (group) => {
  group.each.setup(async () => {
    await resetStorage()
  })

  test('maps the fetch log columns', ({ assert }) => {
    assert.equal(FetchLog.primaryKey, 'id')
    assert.isFalse(FetchLog.selfAssignPrimaryKey)
    assert.equal(FetchLog.table, 'fetch_logs')

    const id = columnOf(FetchLog, 'id')
    const hostname = columnOf(FetchLog, 'hostname')
    const pid = columnOf(FetchLog, 'pid')
    const method = columnOf(FetchLog, 'method')
    const status = columnOf(FetchLog, 'status')
    const url = columnOf(FetchLog, 'url')
    const request = columnOf(FetchLog, 'request')
    const requestHeaders = columnOf(FetchLog, 'requestHeaders')
    const response = columnOf(FetchLog, 'response')
    const responseHeaders = columnOf(FetchLog, 'responseHeaders')
    const durationMs = columnOf(FetchLog, 'durationMs')
    const memoryKb = columnOf(FetchLog, 'memoryKb')
    const createdAt = columnOf(FetchLog, 'createdAt')
    const updatedAt = columnOf(FetchLog, 'updatedAt')

    assert.isTrue(id.isPrimary)
    assert.equal(hostname.columnName, 'hostname')
    assert.equal(pid.columnName, 'pid')
    assert.equal(method.columnName, 'method')
    assert.equal(status.columnName, 'status')
    assert.equal(url.columnName, 'url')
    assert.equal(request.columnName, 'request')
    assert.equal(requestHeaders.columnName, 'request_headers')
    assert.equal(response.columnName, 'response')
    assert.equal(responseHeaders.columnName, 'response_headers')
    assert.equal(durationMs.columnName, 'duration_ms')
    assert.equal(memoryKb.columnName, 'memory_kb')
    assert.equal(createdAt.meta?.type, 'datetime')
    assert.isTrue(createdAt.meta?.autoCreate)
    assert.isFalse(createdAt.meta?.autoUpdate)
    assert.equal(updatedAt.meta?.type, 'datetime')
    assert.isTrue(updatedAt.meta?.autoCreate)
    assert.isTrue(updatedAt.meta?.autoUpdate)
  })

  test('persists a log and can update and delete it', async ({ assert }) => {
    const row = await FetchLog.create({
      hostname: 'api-1',
      pid: 42,
      method: 'GET',
      status: 200,
      url: 'https://example.test/items',
      request: null,
      requestHeaders: null,
      response: '{"ok":true}',
      responseHeaders: '{"content-type":"application/json"}',
      durationMs: 12,
      memoryKb: 4,
    })

    assert.isNumber(row.id)
    assert.isTrue(DateTime.isDateTime(row.createdAt))
    assert.isTrue(DateTime.isDateTime(row.updatedAt))

    row.status = 201
    row.response = 'updated'
    await row.save()

    const fresh = await FetchLog.find(row.id)
    if (!fresh) {
      throw new Error('Expected the fetch log to exist')
    }
    assert.equal(fresh.hostname, 'api-1')
    assert.equal(fresh.pid, 42)
    assert.equal(fresh.method, 'GET')
    assert.equal(fresh.status, 201)
    assert.equal(fresh.url, 'https://example.test/items')
    assert.isNull(fresh.request)
    assert.isNull(fresh.requestHeaders)
    assert.equal(fresh.response, 'updated')
    assert.equal(fresh.responseHeaders, '{"content-type":"application/json"}')
    assert.equal(fresh.durationMs, 12)
    assert.equal(fresh.memoryKb, 4)

    await fresh.delete()
    assert.isNull(await FetchLog.find(row.id))
  })

  test('stores, updates, and destroys rows through the scoped model helpers', async ({
    assert,
  }) => {
    const stored = await FetchLog.store({
      hostname: 'api-1',
      pid: 7,
      method: 'POST',
      status: 200,
      url: 'https://example.test/store',
      response: 'ok',
      durationMs: 5,
      memoryKb: -2,
    })

    assert.equal(stored.response, 'ok')
    assert.equal(stored.memoryKb, -2)
    assert.isTrue(DateTime.isDateTime(stored.createdAt))
    assert.isTrue(DateTime.isDateTime(stored.updatedAt))

    const updated = await stored.update({ status: 204, response: null })
    assert.equal(updated.status, 204)
    assert.isNull(updated.response)

    const fresh = await FetchLog.find(stored.id)
    assert.equal(fresh?.status, 204)
    assert.isNull(fresh?.response)

    await stored.destroy()
    assert.isNull(await FetchLog.find(stored.id))
  })
})
