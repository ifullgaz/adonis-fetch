import { test } from '@japa/runner'
import type { FetchConfig } from '../src/types/types.js'
import HttpClientProvider from '../providers/provider.js'
import {
  fetchIsWrapped,
  getApp,
  getFetchConfig,
  resetStorage,
  setFetchHandler,
} from './helpers/app.js'
import { waitForLogs } from './helpers/logs.js'

test.group('HttpClientProvider', (group) => {
  group.each.setup(async () => {
    await resetStorage()
  })

  test('wraps global fetch when the provider registers', ({ assert }) => {
    assert.isTrue(fetchIsWrapped())
    assert.strictEqual(getApp().config.get('fetch'), getFetchConfig())
  })

  test('does not replace the fetch service when register runs again', async ({ assert }) => {
    const app = getApp()
    const provider = new HttpClientProvider(app)
    const original = getFetchConfig()
    app.config.set('fetch', {
      ...original,
      enabled: false,
    })

    try {
      provider.register()
      setFetchHandler(async () => {
        return new Response('still-logged', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      })

      const response = await fetch('https://example.test/provider')
      assert.equal(await response.text(), 'still-logged')

      const rows = await waitForLogs(1)
      assert.lengthOf(rows, 1)
      assert.equal(rows[0].url, 'https://example.test/provider')
      assert.equal(rows[0].response, 'still-logged')
    } finally {
      app.config.set('fetch', original)
    }
  })

  test('ignores registerFetch after the service exists', async ({ assert }) => {
    const { registerFetch } = await import('../src/core/fetch.js')
    registerFetch(getApp(), {
      model: {
        async create() {
          throw new Error('replacement model')
        },
      } as unknown as FetchConfig['model'],
      enabled: false,
      requestLength: 1,
      responseLength: 1,
    })

    setFetchHandler(async () => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const response = await fetch('https://example.test/guard')
    assert.equal(await response.text(), '{"ok":true}')

    const rows = await waitForLogs(1)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].response, '{"ok":true}')
  })
})
