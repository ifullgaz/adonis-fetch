import type FetchLog from '../model/fetch_log.js'

export interface FetchConfig {
  model: typeof FetchLog
  enabled: boolean
  requestLength: number
  responseLength: number
}
