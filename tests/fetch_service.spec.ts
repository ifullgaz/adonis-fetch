import { hostname } from 'node:os'
import { test } from '@japa/runner'
import logger from '@adonisjs/core/services/logger'
import FetchLog from '../src/model/fetch_log.js'
import { getFetchConfig, getSystemConfig, resetStorage, setFetchHandler } from './helpers/app.js'
import { delay, waitForLogs, waitForMessage } from './helpers/logs.js'

function rowFor(rows: FetchLog[], url: string) {
  const row = rows.find((item) => item.url === url)
  if (!row) {
    throw new Error(`Missing log for ${url}`)
  }
  return row
}

function headerJson(value: string | null) {
  if (value === null) {
    throw new Error('Expected headers to be logged')
  }
  return JSON.parse(value) as Record<string, string>
}

function captureLoggerErrors() {
  const messages: string[] = []
  const log = logger as unknown as { error: (...args: unknown[]) => unknown }
  const original = log.error
  log.error = (...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        messages.push(arg)
      }
    }
    return original.apply(log, args)
  }
  return {
    messages,
    restore() {
      log.error = original
    },
  }
}

function responseFrom(value: {
  status?: number
  statusText?: string
  headers: unknown
  text?: () => Promise<string>
  blob?: () => Promise<Blob>
}) {
  const response = {
    ok: (value.status ?? 200) >= 200 && (value.status ?? 200) < 300,
    status: value.status ?? 200,
    statusText: value.statusText ?? 'OK',
    headers: value.headers,
    text: value.text,
    blob: value.blob,
    clone() {
      return response
    },
  }
  return response as unknown as Response
}

test.group('FetchService', (group) => {
  group.each.setup(async () => {
    await resetStorage()
  })

  test('logs a successful request without consuming the caller response', async ({ assert }) => {
    setFetchHandler(async () => {
      return new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json', 'x-request-id': 'abc' },
      })
    })

    const response = await fetch('https://example.test/items', {
      method: 'post',
      headers: { 'x-id': '1' },
      body: '{"a":1}',
    })

    assert.equal(response.status, 201)
    assert.equal(response.headers.get('x-request-id'), 'abc')
    assert.equal(await response.text(), '{"ok":true}')

    const [row] = await waitForLogs(1)
    assert.equal(row.hostname, hostname())
    assert.equal(row.pid, process.pid)
    assert.equal(row.method, 'POST')
    assert.equal(row.status, 201)
    assert.equal(row.url, 'https://example.test/items')
    assert.equal(row.request, '{"a":1}')
    assert.deepEqual(headerJson(row.requestHeaders), { 'x-id': '1' })
    assert.equal(row.response, '{"ok":true}')
    assert.deepEqual(headerJson(row.responseHeaders), {
      'content-type': 'application/json',
      'x-request-id': 'abc',
    })
    assert.isTrue(Number.isInteger(row.durationMs))
    assert.isAtLeast(row.durationMs, 0)
    assert.isTrue(Number.isInteger(row.memoryKb))
  })

  test('logs error responses and still returns them', async ({ assert }) => {
    setFetchHandler(async () => {
      return new Response('nope', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'content-type': 'text/plain' },
      })
    })

    const response = await fetch('https://example.test/unavailable')
    assert.equal(response.status, 503)
    assert.equal(await response.text(), 'nope')

    const [row] = await waitForLogs(1)
    assert.equal(row.status, 503)
    assert.equal(row.response, 'nope')
  })

  test('reads the url from a URL or a Request', async ({ assert }) => {
    setFetchHandler(async () => {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    })

    await fetch(new URL('https://example.test/items?page=2'))
    await fetch(new Request('https://example.test/from-request', { method: 'PUT' }), {
      method: 'patch',
    })
    await fetch(new Request('https://example.test/request-only', { method: 'DELETE' }))

    const rows = await waitForLogs(3)
    assert.equal(rowFor(rows, 'https://example.test/items?page=2').method, 'GET')
    assert.equal(rowFor(rows, 'https://example.test/from-request').method, 'PATCH')
    assert.equal(rowFor(rows, 'https://example.test/request-only').method, 'GET')
  })

  test('defaults the method to GET and uppercases a provided method', async ({ assert }) => {
    setFetchHandler(async () => {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    })

    await fetch('https://example.test/get')
    await fetch('https://example.test/post', { method: 'post' })
    await fetch('https://example.test/blank', { method: '' })

    const rows = await waitForLogs(3)
    assert.equal(rowFor(rows, 'https://example.test/get').method, 'GET')
    assert.isNull(rowFor(rows, 'https://example.test/get').requestHeaders)
    assert.isNull(rowFor(rows, 'https://example.test/get').request)
    assert.equal(rowFor(rows, 'https://example.test/post').method, 'POST')
    assert.equal(rowFor(rows, 'https://example.test/blank').method, 'GET')
  })

  test('serializes header objects, Headers, and header tuples', async ({ assert }) => {
    setFetchHandler(async () => {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    })

    await fetch('https://example.test/headers-object', {
      headers: { 'Accept': 'application/json', 'X-Trace': 'abc' },
    })
    await fetch('https://example.test/headers-class', {
      headers: new Headers({ Accept: 'application/json' }),
    })
    await fetch('https://example.test/headers-tuples', {
      headers: [
        ['Accept', 'application/json'],
        ['X-Trace', 'abc'],
      ],
    })

    const rows = await waitForLogs(3)
    assert.deepEqual(
      headerJson(rowFor(rows, 'https://example.test/headers-object').requestHeaders),
      {
        'Accept': 'application/json',
        'X-Trace': 'abc',
      }
    )
    assert.deepEqual(
      headerJson(rowFor(rows, 'https://example.test/headers-class').requestHeaders),
      {
        accept: 'application/json',
      }
    )
    assert.deepEqual(
      headerJson(rowFor(rows, 'https://example.test/headers-tuples').requestHeaders),
      {
        'Accept': 'application/json',
        'X-Trace': 'abc',
      }
    )
  })

  test('serializes every request body kind', async ({ assert }) => {
    setFetchHandler(async () => {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    })

    const cases: Array<{ url: string; init: RequestInit; expected: string | null }> = [
      {
        url: 'https://example.test/body-text',
        init: { method: 'POST', body: 'plain' },
        expected: 'plain',
      },
      {
        url: 'https://example.test/body-empty',
        init: { method: 'POST', body: '' },
        expected: null,
      },
      {
        url: 'https://example.test/body-params',
        init: { method: 'POST', body: new URLSearchParams({ a: '1', b: '2' }) },
        expected: 'a=1&b=2',
      },
      {
        url: 'https://example.test/body-form',
        init: { method: 'POST', body: new FormData() },
        expected: '[FormData]',
      },
      {
        url: 'https://example.test/body-blob',
        init: { method: 'POST', body: new Blob(['hello'], { type: 'text/plain' }) },
        expected: '[Blob: text/plain, 5 bytes]',
      },
      {
        url: 'https://example.test/body-blob-empty-type',
        init: { method: 'POST', body: new Blob(['data']) },
        expected: '[Blob: unknown, 4 bytes]',
      },
      {
        url: 'https://example.test/body-buffer',
        init: { method: 'POST', body: new Uint8Array([1, 2, 3, 4]).buffer },
        expected: '[ArrayBuffer: 4 bytes]',
      },
      {
        url: 'https://example.test/body-view',
        init: { method: 'POST', body: new Uint8Array([1, 2, 3]) },
        expected: '[TypedArray: 3 bytes]',
      },
      {
        url: 'https://example.test/body-stream',
        init: { method: 'POST', body: new ReadableStream() },
        expected: '[ReadableStream]',
      },
      {
        url: 'https://example.test/body-unknown',
        init: { method: 'POST', body: {} as NonNullable<RequestInit['body']> },
        expected: '[Unknown body type]',
      },
    ]

    for (const entry of cases) {
      await fetch(entry.url, entry.init)
    }

    const rows = await waitForLogs(cases.length)
    for (const entry of cases) {
      const row = rowFor(rows, entry.url)
      if (entry.expected === null) {
        assert.isNull(row.request)
      } else {
        assert.equal(row.request, entry.expected)
      }
    }
  })

  test('truncates logged text at the configured lengths', async ({ assert }) => {
    const payload = 'abcdefghijklmnopqrstuvwxyz'
    const headers = { 'x-trace': payload }
    const serializedHeaders = JSON.stringify(headers)
    const config = getFetchConfig()

    config.requestLength = 10
    config.responseLength = 12
    setFetchHandler(async () => {
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    })
    await fetch('https://example.test/truncated', { method: 'POST', headers, body: payload })
    await waitForLogs(1)

    config.requestLength = Math.max(payload.length, serializedHeaders.length)
    config.responseLength = payload.length
    await fetch('https://example.test/exact', { method: 'POST', headers, body: payload })

    const rows = await waitForLogs(2)
    const truncated = rowFor(rows, 'https://example.test/truncated')
    const exact = rowFor(rows, 'https://example.test/exact')

    assert.equal(truncated.request, `${payload.substring(0, 7)}...`)
    assert.equal(truncated.response, `${payload.substring(0, 9)}...`)
    assert.equal(truncated.requestHeaders, `${serializedHeaders.substring(0, 7)}...`)
    assert.equal(exact.request, payload)
    assert.equal(exact.response, payload)
    assert.equal(exact.requestHeaders, serializedHeaders)
  })

  test('truncates response headers to 1024 characters', async ({ assert }) => {
    const response = new Response('ok', {
      status: 202,
      headers: {
        'content-type': 'text/plain',
        'x-trace': 'a'.repeat(1100),
      },
    })
    const recorded: Record<string, string> = {}
    for (const [key, value] of response.headers) {
      recorded[key] = value
    }
    const raw = JSON.stringify(recorded)
    assert.isAbove(raw.length, 1024)

    setFetchHandler(async () => response)
    await fetch('https://example.test/response-headers')

    const [row] = await waitForLogs(1)
    assert.equal(row.response, 'ok')
    assert.equal(row.responseHeaders, `${raw.substring(0, 1021)}...`)
    assert.equal(row.status, 202)
  })

  test('logs text responses and records the size of other bodies', async ({ assert }) => {
    setFetchHandler(async (input) => {
      const url = String(input)
      if (url.endsWith('/json')) {
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      }
      if (url.endsWith('/html')) {
        return new Response('<p>hi</p>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (url.endsWith('/image')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      if (url.endsWith('/vendor')) {
        return new Response('{"data":1}', {
          status: 200,
          headers: { 'content-type': 'application/vnd.api+json' },
        })
      }
      return new Response(new Uint8Array([9, 9]), { status: 200 })
    })

    await fetch('https://example.test/json')
    await fetch('https://example.test/html')
    await fetch('https://example.test/image')
    await fetch('https://example.test/vendor')
    await fetch('https://example.test/bare')

    const rows = await waitForLogs(5)
    assert.equal(rowFor(rows, 'https://example.test/json').response, '{"ok":true}')
    assert.equal(rowFor(rows, 'https://example.test/html').response, '<p>hi</p>')
    assert.equal(rowFor(rows, 'https://example.test/image').response, '[image/png: 3 bytes]')
    assert.equal(
      rowFor(rows, 'https://example.test/vendor').response,
      '[application/vnd.api+json: 10 bytes]'
    )
    assert.equal(rowFor(rows, 'https://example.test/bare').response, '[binary: 2 bytes]')
  })

  test('returns the response without logging when fetch is disabled', async ({ assert }) => {
    const seen: string[] = []
    getFetchConfig().enabled = false
    setFetchHandler(async (input) => {
      seen.push(String(input))
      return new Response(null, { status: 204 })
    })

    const response = await fetch('https://example.test/skipped', { method: 'PUT' })
    await delay(40)

    assert.equal(response.status, 204)
    assert.deepEqual(seen, ['https://example.test/skipped'])
    assert.lengthOf(await FetchLog.all(), 0)
  })

  test('lets system config turn logging on and off', async ({ assert }) => {
    const service = await getSystemConfig()
    const seen: string[] = []
    getFetchConfig().enabled = true
    setFetchHandler(async (input) => {
      seen.push(String(input))
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    })

    await service.set('Fetch.Enabled', false, 'boolean')
    const skipped = await fetch('https://example.test/disabled-by-config')
    await delay(40)
    assert.equal(await skipped.text(), 'ok')
    assert.lengthOf(await FetchLog.all(), 0)

    await service.delete('Fetch.Enabled')
    await fetch('https://example.test/enabled-by-config')
    const rows = await waitForLogs(1)
    assert.equal(rows[0].url, 'https://example.test/enabled-by-config')
    assert.deepEqual(seen, [
      'https://example.test/disabled-by-config',
      'https://example.test/enabled-by-config',
    ])
  })

  test('lets system config override the truncation lengths', async ({ assert }) => {
    const config = getFetchConfig()
    const service = await getSystemConfig()
    const payload = 'abcdefghijklmnopqrstuvwxyz'
    config.requestLength = 100
    config.responseLength = 100
    await service.set('Fetch.RequestLength', 10, 'number')
    await service.set('Fetch.ResponseLength', 8, 'number')
    setFetchHandler(async () => {
      return new Response(payload, { headers: { 'content-type': 'text/plain' } })
    })

    await fetch('https://example.test/lengths', { method: 'POST', body: payload })

    const [row] = await waitForLogs(1)
    assert.equal(row.request, `${payload.substring(0, 7)}...`)
    assert.equal(row.response, `${payload.substring(0, 5)}...`)
  })

  test('logs network failures and rethrows them', async ({ assert }) => {
    setFetchHandler(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    try {
      await fetch('https://example.test/down', { method: 'put' })
      throw new Error('Expected fetch to throw')
    } catch (error) {
      if (!(error instanceof Error) || error.message === 'Expected fetch to throw') {
        throw error
      }
      assert.equal(error.message, 'connect ECONNREFUSED')
    }

    setFetchHandler(async () => {
      throw 'offline'
    })
    try {
      await fetch('https://example.test/offline')
      throw new Error('Expected fetch to throw')
    } catch (error) {
      if (error !== 'offline') {
        throw error
      }
    }

    setFetchHandler(async () => {
      throw new Error('')
    })
    try {
      await fetch('https://example.test/empty-error')
      throw new Error('Expected fetch to throw')
    } catch (error) {
      if (!(error instanceof Error) || error.message === 'Expected fetch to throw') {
        throw error
      }
      assert.equal(error.message, '')
    }

    const rows = await waitForLogs(3)
    const refused = rowFor(rows, 'https://example.test/down')
    assert.equal(refused.method, 'PUT')
    assert.equal(refused.status, 0)
    assert.isNull(refused.responseHeaders)
    assert.equal(refused.response, 'connect ECONNREFUSED')

    const offline = rowFor(rows, 'https://example.test/offline')
    assert.equal(offline.status, 0)
    assert.equal(offline.response, 'offline')
    assert.isNull(offline.responseHeaders)

    const empty = rowFor(rows, 'https://example.test/empty-error')
    assert.equal(empty.status, 0)
    assert.equal(empty.response, '[No response body]')
  })

  test('logs the request when headers or the body cannot be serialized', async ({ assert }) => {
    const logs = captureLoggerErrors()
    try {
      const headers: Record<string, unknown> = { accept: 'application/json' }
      headers.self = headers
      setFetchHandler(async () => {
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      const response = await fetch('https://example.test/bad-headers', {
        headers: headers as unknown as NonNullable<RequestInit['headers']>,
      })
      assert.equal(await response.text(), '{"ok":true}')

      const params = new URLSearchParams({ a: '1' })
      params.toString = () => {
        throw new Error('params broke')
      }
      await fetch('https://example.test/bad-body', { method: 'POST', body: params })

      const rows = await waitForLogs(2)
      const badHeaders = rowFor(rows, 'https://example.test/bad-headers')
      assert.isNull(badHeaders.requestHeaders)
      assert.equal(badHeaders.response, '{"ok":true}')
      assert.equal(rowFor(rows, 'https://example.test/bad-body').request, '[Unknown body type]')

      await waitForMessage(logs.messages, 'Failed to serialize request headers')
      await waitForMessage(logs.messages, 'Failed to serialize request body')
      assert.isTrue(logs.messages.includes('Failed to serialize request headers'))
      assert.isTrue(logs.messages.includes('Failed to serialize request body'))
    } finally {
      logs.restore()
    }
  })

  test('records a placeholder when the response cannot be read', async ({ assert }) => {
    const logs = captureLoggerErrors()
    try {
      setFetchHandler(async (input) => {
        const url = String(input)
        if (url.endsWith('/bad-response-headers')) {
          return responseFrom({
            headers: {
              get: () => 'application/json',
              [Symbol.iterator]() {
                throw new Error('headers broke')
              },
            },
            text: async () => '{"ok":true}',
          })
        }
        if (url.endsWith('/bad-text')) {
          return responseFrom({
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => {
              throw new Error('read failed')
            },
          })
        }
        return responseFrom({
          headers: new Headers({ 'content-type': 'image/png' }),
          blob: async () => {
            throw new Error('blob failed')
          },
        })
      })

      await fetch('https://example.test/bad-response-headers')
      await fetch('https://example.test/bad-text')
      await fetch('https://example.test/bad-blob')

      const rows = await waitForLogs(3)
      const headers = rowFor(rows, 'https://example.test/bad-response-headers')
      assert.isNull(headers.responseHeaders)
      assert.equal(headers.response, '{"ok":true}')
      assert.equal(rowFor(rows, 'https://example.test/bad-text').response, '[Error reading body]')
      assert.equal(rowFor(rows, 'https://example.test/bad-blob').response, '[Error reading body]')

      await waitForMessage(logs.messages, 'Failed to serialize response headers')
      await waitForMessage(logs.messages, 'Failed to read response body')
      assert.isTrue(logs.messages.includes('Failed to serialize response headers'))
      assert.isTrue(logs.messages.includes('Failed to read response body'))
    } finally {
      logs.restore()
    }
  })

  test('returns the response when the log cannot be saved', async ({ assert }) => {
    const logs = captureLoggerErrors()
    const config = getFetchConfig()
    const model = config.model
    config.model = {
      async create() {
        throw new Error('db down')
      },
    } as unknown as typeof model

    try {
      setFetchHandler(async () => {
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      const response = await fetch('https://example.test/not-saved')
      assert.equal(await response.text(), '{"ok":true}')
      await waitForMessage(logs.messages, 'Failed to log HTTP client request')
      assert.lengthOf(await FetchLog.all(), 0)

      config.model = model
      await fetch('https://example.test/saved-after')
      const rows = await waitForLogs(1)
      assert.equal(rows[0].url, 'https://example.test/saved-after')
      assert.isTrue(logs.messages.includes('Failed to log HTTP client request'))
    } finally {
      config.model = model
      logs.restore()
    }
  })
})
