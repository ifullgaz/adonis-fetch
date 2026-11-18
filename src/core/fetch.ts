import os from 'node:os'
import type { HeadersInit, BodyInit } from 'undici-types'
import type { ApplicationService } from '@adonisjs/core/types'
import type { SystemConfigServiceContract } from '@ifullgaz/adonis-system-config/types'
import logger from '@adonisjs/core/services/logger'
import type { FetchConfig } from '../types/types.js'

let fetchService: FetchService | undefined

// Truncate function for strings
const truncate = (str: string | null | undefined, maxLength: number): string | null => {
  if (!str) return null
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}

// Serialize headers to JSON string
const serializeHeaders = (headers: HeadersInit | undefined): string | null => {
  if (!headers) return null

  try {
    if (headers instanceof Headers) {
      const obj: Record<string, string> = {}
      headers.forEach((value, key) => {
        obj[key] = value
      })
      return JSON.stringify(obj)
    } else if (Array.isArray(headers)) {
      const obj: Record<string, string> = {}
      headers.forEach(([key, value]) => {
        obj[key] = value
      })
      return JSON.stringify(obj)
    } else {
      return JSON.stringify(headers)
    }
  } catch (error) {
    logger.error({ error }, 'Failed to serialize request headers')
    return null
  }
}

// Serialize request body
const serializeBody = async (body: BodyInit | null | undefined): Promise<string | null> => {
  if (!body) {
    return null
  }
  try {
    if (typeof body === 'string') {
      return body
    } else if (body instanceof URLSearchParams) {
      return body.toString()
    } else if (body instanceof FormData) {
      return '[FormData]'
    } else if (body instanceof Blob) {
      return `[Blob: ${body.type || 'unknown'}, ${body.size} bytes]`
    } else if (body instanceof ArrayBuffer) {
      return `[ArrayBuffer: ${body.byteLength} bytes]`
    } else if (ArrayBuffer.isView(body)) {
      return `[TypedArray: ${body.byteLength} bytes]`
    } else if (body instanceof ReadableStream) {
      return '[ReadableStream]'
    }
  } catch (error) {
    logger.error({ error }, 'Failed to serialize request body')
  }
  return '[Unknown body type]'
}

class FetchService {
  private globalFetch: typeof globalThis.fetch

  constructor(
    private readonly app: ApplicationService,
    private readonly config: FetchConfig
  ) {
    this.globalFetch = globalThis.fetch
    globalThis.fetch = this.fetch.bind(this)
  }

  private async resolveConfig(): Promise<Omit<FetchConfig, 'model'>> {
    const systemConfig = (await this.app.container.make(
      'systemConfig'
    )) as unknown as SystemConfigServiceContract
    const enabled = await systemConfig.getBoolean('Fetch.Enabled', this.config.enabled)
    const requestLength = await systemConfig.getNumber(
      'Fetch.RequestLength',
      this.config.requestLength
    )
    const responseLength = await systemConfig.getNumber(
      'Fetch.ResponseLength',
      this.config.responseLength
    )
    return {
      enabled,
      requestLength,
      responseLength,
    }
  }

  private async logRequest(
    input: string | URL | globalThis.Request,
    init: RequestInit | undefined,
    response: Response,
    startTime: bigint,
    startMemory: number
  ): Promise<void> {
    // Get truncation limits from config
    const config = await this.resolveConfig()
    // Extract request details
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method?.toUpperCase() || 'GET'
    const status = response.status
    // Get running time statistics
    const endTime = process.hrtime.bigint()
    const durationNs = endTime - startTime
    const durationMs = Math.round(Number(durationNs) / 1000000)
    // Get running memory statistics
    const endMemory = process.memoryUsage().heapUsed
    const memoryKb = Math.round((endMemory - startMemory) / 1024)

    const requestHeaders = truncate(serializeHeaders(init?.headers), config.requestLength)
    const requestBody = truncate(await serializeBody(init?.body), config.requestLength)

    let responseBody: string | null = null
    let responseHeaders: string | null = null
    if (status) {
      // Serialize response headers
      try {
        const headers: Record<string, string> = {}
        for (const [key, value] of response.headers) {
          headers[key] = value
        }
        responseHeaders = truncate(JSON.stringify(headers), 1024)
      } catch (error) {
        logger.error({ error }, 'Failed to serialize response headers')
      }
      // Read response body for logging
      try {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json') || contentType.includes('text/')) {
          const body = await response.text()
          responseBody = truncate(body, config.responseLength)
        } else {
          const blob = await response.blob()
          responseBody = `[${contentType || 'binary'}: ${blob.size} bytes]`
        }
      } catch (error) {
        logger.error({ error }, 'Failed to read response body')
        responseBody = '[Error reading body]'
      }
    } else {
      responseBody = response.statusText || '[No response body]'
    }
    try {
      await this.config.model.create({
        hostname: os.hostname(),
        pid: process.pid,
        method,
        status,
        url,
        requestHeaders,
        request: requestBody,
        responseHeaders,
        response: responseBody,
        durationMs,
        memoryKb,
      })
    } catch (error) {
      logger.error({ error, url, method }, 'Failed to log HTTP client request')
    }
  }

  /**
   * Enhanced fetch function that logs all HTTP client requests to third-party APIs
   * Drop-in replacement for the standard Node.js fetch
   */
  private async fetch(
    input: string | URL | globalThis.Request,
    init?: RequestInit
  ): Promise<Response> {
    const config = await this.resolveConfig()
    if (!config.enabled) {
      return await this.globalFetch(input, init)
    }
    const startTime = process.hrtime.bigint()
    const startMemory = process.memoryUsage().heapUsed
    try {
      const response = await this.globalFetch(input, init)
      this.logRequest(input, init, response.clone(), startTime, startMemory)
      return response
    } catch (error) {
      // Network error or request failed
      const response = {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : String(error),
      } as unknown as Response
      this.logRequest(input, init, response, startTime, startMemory)
      // Re-throw the error after logging
      throw error
    }
  }
}

export function registerFetch(app: ApplicationService, config: FetchConfig) {
  if (fetchService) {
    return
  }
  fetchService = new FetchService(app, config)
}
