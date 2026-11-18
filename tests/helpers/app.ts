import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setApp } from '@adonisjs/core/services/app'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { defineConfig as defineCacheConfig, drivers, store } from '@adonisjs/cache'
import { defineConfig as defineDatabaseConfig } from '@adonisjs/lucid'
import type { ApplicationService } from '@adonisjs/core/types'
import type { SystemConfigServiceContract } from '@ifullgaz/adonis-system-config/types'
import type FetchLog from '../../src/model/fetch_log.js'
import type { FetchConfig } from '../../src/types/types.js'

const DEFAULT_REQUEST_LENGTH = 256
const DEFAULT_RESPONSE_LENGTH = 256

type FetchHandler = typeof globalThis.fetch

const defaultFetchHandler: FetchHandler = async () => {
  return new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

let fetchHandler: FetchHandler = defaultFetchHandler

const delegatingFetch: FetchHandler = async (input, init) => {
  return fetchHandler(input, init)
}

/**
 * The provider captures global fetch while the app boots. Install the double
 * first so tests can swap the upstream response without touching the network.
 */
export function installFetchDouble() {
  if (globalThis.fetch === delegatingFetch) {
    return
  }
  globalThis.fetch = delegatingFetch
}

export function setFetchHandler(next: FetchHandler) {
  fetchHandler = next
}

export function resetFetchHandler() {
  fetchHandler = defaultFetchHandler
}

export function fetchIsWrapped() {
  return globalThis.fetch !== delegatingFetch
}

let fetchLogModel: typeof FetchLog | undefined
let fetchConfig: FetchConfig | undefined
let application: ApplicationService | undefined

export function getFetchConfig() {
  if (!fetchConfig) {
    throw new Error('Test application is not booted')
  }
  return fetchConfig
}

export function resetFetchConfig() {
  const config = getFetchConfig()
  if (!fetchLogModel) {
    throw new Error('Test application is not booted')
  }
  config.enabled = true
  config.requestLength = DEFAULT_REQUEST_LENGTH
  config.responseLength = DEFAULT_RESPONSE_LENGTH
  config.model = fetchLogModel
}

export function getApp() {
  if (!application) {
    throw new Error('Test application is not booted')
  }
  return application
}

/**
 * Point the global app service back at the shared test app. Configure specs boot
 * short-lived host apps, and those replace the global reference.
 */
export function restoreTestApp() {
  setApp(getApp())
}

export async function getSystemConfig() {
  return (await getApp().container.make('systemConfig')) as SystemConfigServiceContract
}

export async function bootTestApp() {
  if (application) {
    return application
  }

  installFetchDouble()

  const filename = join(mkdtempSync(join(tmpdir(), 'adonis-fetch-')), 'db.sqlite')
  application = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        providers: [
          () => import('@adonisjs/lucid/database_provider'),
          () => import('@adonisjs/cache/cache_provider'),
          () => import('@ifullgaz/adonis-system-config/provider'),
        ],
      },
      config: {
        database: defineDatabaseConfig({
          connection: 'sqlite',
          connections: {
            sqlite: {
              client: 'better-sqlite3',
              connection: { filename },
              useNullAsDefault: true,
              pool: { min: 1, max: 1 },
            },
          },
        }),
        cache: defineCacheConfig({
          default: 'memory',
          stores: {
            memory: store().useL1Layer(drivers.memory()),
          },
        }),
      },
    })
    .create(new URL('../../', import.meta.url), {
      importer: (filePath) => import(filePath),
    })
    .createApp('test')

  await application.init()
  await application.boot()

  const { default: FetchLogModel } = await import('../../src/model/fetch_log.js')
  const { default: HttpClientProvider } = await import('../../providers/provider.js')
  fetchLogModel = FetchLogModel
  fetchConfig = {
    model: FetchLogModel,
    enabled: true,
    requestLength: DEFAULT_REQUEST_LENGTH,
    responseLength: DEFAULT_RESPONSE_LENGTH,
  }
  application.config.set('fetch', fetchConfig)
  new HttpClientProvider(application).register()

  const resolved = application.config.get('fetch') as FetchConfig
  if (resolved !== fetchConfig) {
    throw new Error('Fetch config identity changed during boot')
  }

  await import('@adonisjs/lucid/services/db')
  await import('@adonisjs/cache/services/main')
  await createSchema()

  const { default: SystemConfig } = await import('@ifullgaz/adonis-system-config/model')
  application.config.set('systemConfig', {
    model: SystemConfig,
    cacheKey: 'system_config:all',
    cacheTtl: '1d',
  })

  const logger = await application.container.make('logger')
  logger.level = 'silent'
  return application
}

async function createSchema() {
  const database = await getApp().container.make('lucid.db')
  const connection = database.connection()
  await connection.schema.createTable('system_configs', (table) => {
    table.string('key', 64).primary()
    table.json('value').notNullable()
    table.enum('type', ['string', 'number', 'boolean', 'array', 'object']).notNullable()
    table.string('description', 256).nullable()
    table.timestamp('created_at').nullable()
    table.timestamp('updated_at').nullable()
  })
  await connection.schema.createTable('fetch_logs', (table) => {
    table.bigIncrements('id')
    table.string('hostname', 255).notNullable()
    table.integer('pid').notNullable()
    table.string('method', 10).notNullable()
    table.integer('status').unsigned().notNullable()
    table.text('url').notNullable()
    table.string('request_headers', 1024).nullable()
    table.string('request', 4096).nullable()
    table.string('response_headers', 1024).nullable()
    table.string('response', 4096).nullable()
    table.integer('duration_ms').notNullable()
    table.integer('memory_kb').notNullable()
    table.timestamp('created_at').nullable()
    table.timestamp('updated_at').nullable()
  })
}

export async function resetStorage() {
  resetFetchConfig()
  resetFetchHandler()

  const app = getApp()
  const database = await app.container.make('lucid.db')
  await database.connection().from('fetch_logs').delete()
  await database.connection().from('system_configs').delete()

  const { default: cache } = await import('@adonisjs/cache/services/main')
  await cache.clear()

  if (app.container.hasBinding('systemConfig')) {
    const service = await getSystemConfig()
    await service.clearCache()
  }
}

export async function bootHostApplication(appRoot: URL, rcFileContents?: Record<string, unknown>) {
  const factory = new IgnitorFactory().withCoreProviders().withCoreConfig()
  if (rcFileContents) {
    factory.merge({ rcFileContents })
  }

  const app = factory
    .create(appRoot, {
      importer: (filePath) => import(filePath),
    })
    .createApp('web')

  await app.init()
  await app.boot()
  return app
}

export async function shutdownTestApp() {
  if (!application) {
    return
  }
  await application.terminate()
  application = undefined
}
