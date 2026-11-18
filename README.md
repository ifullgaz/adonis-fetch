# Adonis Fetch

`@ifullgaz/adonis-fetch` is an AdonisJS integration that logs outbound HTTP
calls by replacing the global `fetch` and writing each call to a Lucid model.

It integrates with:

- `@adonisjs/core`
- `@adonisjs/lucid`
- `@ifullgaz/adonis-lucid`
- `@ifullgaz/adonis-system-config`

## Installation

```bash
npm install @ifullgaz/adonis-fetch @adonisjs/lucid @ifullgaz/adonis-lucid @ifullgaz/adonis-system-config
node ace configure @ifullgaz/adonis-fetch
```

The configure command will:

- register provider `@ifullgaz/adonis-fetch/provider`
- create `config/fetch.ts`
- create `database/migrations/<timestamp>_create_fetch_logs_table.ts`

Run the migration before the first logged request. The `fetch_logs` table
stores the host, process id, method, status, URL, request and response
headers and bodies, duration, heap delta, and timestamps.

`@ifullgaz/adonis-system-config` must be configured in the same app. Every
call reads `Fetch.Enabled`, `Fetch.RequestLength`, and `Fetch.ResponseLength`
from that service.

## Configuration

Define your fetch configuration:

```ts
import { defineConfig } from '@ifullgaz/adonis-fetch'
import FetchLog from '@ifullgaz/adonis-fetch/model'

export default defineConfig({
  model: FetchLog,
  enabled: true,
  requestLength: 256,
  responseLength: 256,
})
```

`model` is the Lucid model used for inserts. `enabled` turns logging on.
`requestLength` and `responseLength` are the maximum characters stored for
the request and the response body.

These file values are the defaults. A stored system config value wins:

| Key | Type | Overrides |
| --- | --- | --- |
| `Fetch.Enabled` | boolean | `enabled` |
| `Fetch.RequestLength` | number | `requestLength` |
| `Fetch.ResponseLength` | number | `responseLength` |

The provider reads `config/fetch.ts` when it registers and installs the
logger once.

## Usage

### Call fetch as usual

With `enabled` set to `true`, any later `fetch` in the process is logged.
The caller still receives the original `Response`.

```ts
const response = await fetch('https://example.com/items', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'meter' }),
})
```

The insert runs after the response is cloned, so a failed write does not
fail the call. Write errors are reported through the Adonis logger.

A network error is stored with status `0` and the error message, then
rethrown.

Set `enabled` to `false`, or store `Fetch.Enabled` as `false`, to call the
original `fetch` with no log row.

### Read the log

```ts
import FetchLog from '@ifullgaz/adonis-fetch/model'

const logs = await FetchLog.query().orderBy('id', 'desc').limit(20)
```

Each row records:

- `hostname` and `pid`
- `method`, `url`, and `status`
- `requestHeaders` and `request`, truncated to `requestLength`
- `responseHeaders`, truncated to 1024 characters, and `response`, truncated
  to `responseLength`
- `durationMs` and `memoryKb` (heap used during the call)

JSON and text bodies are stored as text. Other response bodies are stored
as the content type and byte size. `FormData`, blobs, buffers, and streams
are stored as a short placeholder.

## Types

```ts
import type { FetchConfig } from '@ifullgaz/adonis-fetch/types'
```

## Exports

- `@ifullgaz/adonis-fetch`
- `@ifullgaz/adonis-fetch/model`
- `@ifullgaz/adonis-fetch/provider`
- `@ifullgaz/adonis-fetch/types`

## Testing

### Prerequisites

Tests require a `NODE_AUTH_TOKEN` with read access to the `@ifullgaz` GitHub Packages registry (see `.npmrc`). Export it before running:

```bash
export NODE_AUTH_TOKEN=<your_token>
```

### Running the suite

```bash
npm test            # lint → c8 coverage → full Japa suite
npm run quick:test  # Japa only, no lint/coverage — use during iteration
```

### Running a single test or group

Pass Japa filter flags directly to the test entry:

```bash
# by group name
node --import=@poppinss/ts-exec --enable-source-maps bin/test.ts --groups "Example"

# by test title (substring match)
node --import=@poppinss/ts-exec --enable-source-maps bin/test.ts --tests "add two numbers"
```
