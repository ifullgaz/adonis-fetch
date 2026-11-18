import { test } from '@japa/runner'
import FetchLog from '../src/model/fetch_log.js'
import { defineConfig } from '../src/define_config.js'

test.group('defineConfig', () => {
  test('returns the same config reference', ({ assert }) => {
    const config = {
      model: FetchLog,
      enabled: false,
      requestLength: 32,
      responseLength: 64,
    }

    const defined = defineConfig(config)

    assert.strictEqual(defined, config)
    assert.strictEqual(defined.model, FetchLog)
    assert.isFalse(defined.enabled)
    assert.equal(defined.requestLength, 32)
    assert.equal(defined.responseLength, 64)
  })
})
