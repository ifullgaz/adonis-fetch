import { type DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { dateTime } from '@ifullgaz/adonis-lucid/columns'
import { withScopedModel } from '@ifullgaz/adonis-lucid/traits'

export default class FetchLog extends compose(BaseModel, withScopedModel()) {
  @column({ isPrimary: true })
  declare id: number
  @column()
  declare hostname: string
  @column()
  declare pid: number
  @column()
  declare method: string
  @column()
  declare status: number
  @column()
  declare url: string
  @column()
  declare request: string | null
  @column()
  declare requestHeaders: string | null
  @column()
  declare response: string | null
  @column()
  declare responseHeaders: string | null
  @column()
  declare durationMs: number
  @column()
  declare memoryKb: number

  @dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
