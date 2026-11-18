import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import Configure from '@adonisjs/core/commands/configure'
import type { ApplicationService } from '@adonisjs/core/types'
import { bootHostApplication, restoreTestApp } from './helpers/app.js'

const PROVIDER_SPECIFIER = '@ifullgaz/adonis-fetch/provider'

test.group('configure', (group) => {
  group.each.timeout(20000)

  test('registers the provider and publishes the stubs', async ({ assert }) => {
    const host = await createHostApp()
    try {
      const command = await configureHost(host)
      const rcFile = await readFile(join(host.directory, 'adonisrc.ts'), 'utf8')
      const configFile = await readFile(join(host.directory, 'config', 'fetch.ts'), 'utf8')
      const configStub = await readFile(new URL('../stubs/config.stub', import.meta.url), 'utf8')
      const migrationStub = await readFile(
        new URL('../stubs/migrations/fetch_log.stub', import.meta.url),
        'utf8'
      )
      const migrations = await readdir(join(host.directory, 'database', 'migrations'))

      assert.notEqual(command.exitCode, 1)
      assert.include(rcFile, `() => import('${PROVIDER_SPECIFIER}')`)
      assert.equal(countOccurrences(rcFile, PROVIDER_SPECIFIER), 1)
      assert.equal(
        normalizeStubOutput(configFile),
        normalizeStubOutput(stripStubHeader(configStub))
      )
      assert.lengthOf(migrations, 1)
      assert.isTrue(/^\d+_create_fetch_logs_table\.ts$/.test(migrations[0]))
      assert.equal(
        normalizeStubOutput(
          await readFile(join(host.directory, 'database', 'migrations', migrations[0]), 'utf8')
        ),
        normalizeStubOutput(stripStubHeader(migrationStub))
      )
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })

  test('does not register the provider twice', async ({ assert }) => {
    const host = await createHostApp()
    try {
      await configureHost(host)
      await configureHost(host)

      const rcFile = await readFile(join(host.directory, 'adonisrc.ts'), 'utf8')
      const migrations = await readdir(join(host.directory, 'database', 'migrations'))

      assert.equal(countOccurrences(rcFile, PROVIDER_SPECIFIER), 1)
      assert.lengthOf(migrations, 2)
      assert.isTrue(migrations.every((file) => /^\d+_create_fetch_logs_table\.ts$/.test(file)))
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })

  test('keeps an existing config file unless force is set', async ({ assert }) => {
    const host = await createHostApp()
    try {
      await configureHost(host)
      const configPath = join(host.directory, 'config', 'fetch.ts')
      await writeFile(configPath, 'export const marker = true\n')

      await configureHost(host)
      assert.equal(await readFile(configPath, 'utf8'), 'export const marker = true\n')

      await configureHost(host, { force: true })
      const stub = await readFile(new URL('../stubs/config.stub', import.meta.url), 'utf8')
      assert.equal(
        normalizeStubOutput(await readFile(configPath, 'utf8')),
        normalizeStubOutput(stripStubHeader(stub))
      )
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })

  test('writes the config file into a custom config directory', async ({ assert }) => {
    const host = await createHostApp()
    try {
      await configureHost(host, {
        rcFileContents: {
          directories: {
            config: 'settings',
          },
        },
      })

      const customConfig = await readFile(join(host.directory, 'settings', 'fetch.ts'), 'utf8')
      assert.include(customConfig, 'defineConfig(')
      assert.isUndefined(await readOptional(join(host.directory, 'config', 'fetch.ts')))
      const migrations = await readdir(join(host.directory, 'database', 'migrations'))
      assert.lengthOf(migrations, 1)
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  })
})

test.group('package entry', () => {
  test('exports the runtime api and the stubs directory', async ({ assert }) => {
    const entry = await import('../index.js')
    const { configure } = await import('../configure.js')
    const { defineConfig } = await import('../src/define_config.js')
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports: Record<string, string> }

    assert.deepEqual(Object.keys(entry).sort(), ['configure', 'defineConfig', 'stubsRoot'])
    assert.strictEqual(entry.configure, configure)
    assert.strictEqual(entry.defineConfig, defineConfig)
    assert.isTrue(entry.stubsRoot.endsWith('stubs'))
    assert.deepEqual(manifest.exports, {
      '.': './build/index.js',
      './model': './build/src/model/fetch_log.js',
      './provider': './build/providers/provider.js',
      './types': './build/src/types/types.js',
    })

    const configStub = await readFile(join(entry.stubsRoot, 'config.stub'), 'utf8')
    const migrationStub = await readFile(
      join(entry.stubsRoot, 'migrations', 'fetch_log.stub'),
      'utf8'
    )
    assert.include(configStub, '@ifullgaz/adonis-fetch/model')
    assert.include(configStub, 'Fetch.Enabled')
    assert.include(migrationStub, 'fetch_logs')
  })
})

async function createHostApp() {
  const root = fileURLToPath(new URL('./tmp/', import.meta.url))
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'app-'))
  const url = pathToFileURL(directory)
  url.pathname = `${url.pathname}/`

  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'fetch-app', private: true, type: 'module' }, null, 2)}\n`
  )
  await writeFile(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
        },
        include: ['adonisrc.ts'],
      },
      null,
      2
    )}\n`
  )
  await writeFile(
    join(directory, 'adonisrc.ts'),
    `import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  providers: [() => import('@adonisjs/core/providers/app_provider')],
})
`
  )

  return { directory, url }
}

async function configureHost(
  host: { directory: string; url: URL },
  options?: { force?: boolean; rcFileContents?: Record<string, unknown> }
) {
  let app: ApplicationService | undefined
  try {
    app = await bootHostApplication(host.url, options?.rcFileContents)
    return await runConfigure(app, options?.force === true)
  } finally {
    try {
      if (app) {
        await app.terminate()
      }
    } finally {
      restoreTestApp()
    }
  }
}

async function runConfigure(app: ApplicationService, force: boolean) {
  const ace = await app.container.make('ace')
  const argv = ['@ifullgaz/adonis-fetch']
  if (force) {
    argv.push('--force')
  }
  const command = await ace.create(Configure, argv)
  command.ui.switchMode('silent')
  const { configure } = await import('../configure.js')
  await configure(command)
  return command
}

function normalizeStubOutput(contents: string) {
  return contents.replace(/\r\n/g, '\n').trimEnd()
}

function stripStubHeader(contents: string) {
  const marker = '}}}'
  const start = contents.indexOf(marker)
  if (start === -1) {
    throw new Error('Stub header is missing')
  }
  return contents.slice(start + marker.length).replace(/^\r?\n/, '')
}

function countOccurrences(contents: string, value: string) {
  return contents.split(value).length - 1
}

async function readOptional(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      return undefined
    }
    throw error
  }
}

function isEnoent(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
