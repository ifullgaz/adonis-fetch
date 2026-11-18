import FetchLog from '../../src/model/fetch_log.js'

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function waitForLogs(count: number) {
  const deadline = Date.now() + 2000
  let rows = await FetchLog.query().orderBy('id', 'asc')
  while (rows.length < count && Date.now() < deadline) {
    await delay(10)
    rows = await FetchLog.query().orderBy('id', 'asc')
  }
  return rows
}

export async function waitForMessage(messages: string[], message: string) {
  const deadline = Date.now() + 2000
  while (!messages.includes(message) && Date.now() < deadline) {
    await delay(10)
  }
}
