import { type ApplicationService } from '@adonisjs/core/types'
import { registerFetch } from '../src/core/fetch.js'
import type { FetchConfig } from '../src/types/types.js'

export default class HttpClientProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    const config = this.app.config.get('fetch') as FetchConfig
    registerFetch(this.app, config)
  }
}
