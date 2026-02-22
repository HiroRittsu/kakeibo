import { createApp } from './app'
import type { Bindings } from './types'
import { cleanupMutationReceipts, generateRecurringEntries, runMonthStartBalanceUpdate } from './shared'

const app = createApp()
const API_PREFIXES = [
  '/auth',
  '/entries',
  '/entry-categories',
  '/payment-methods',
  '/recurring-rules',
  '/monthly-balance',
  '/monthly-balances',
  '/reports',
  '/audit-logs',
]

const isApiPath = (pathname: string) => {
  if (pathname === '/health' || pathname === '/sync' || pathname === '/bootstrap') return true
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

const hasFileExtension = (pathname: string) => {
  const lastSlash = pathname.lastIndexOf('/')
  const segment = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname
  return segment.includes('.')
}

export default {
  fetch: async (request: Request, env: Bindings, ctx: ExecutionContext) => {
    const url = new URL(request.url)
    const pathname = url.pathname
    if (isApiPath(pathname)) {
      return app.fetch(request, env, ctx)
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return app.fetch(request, env, ctx)
    }

    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) {
      return assetResponse
    }

    // For SPA routes (without file extension), fallback to index.html.
    if (!hasFileExtension(pathname)) {
      const fallbackUrl = new URL('/index.html', url)
      const fallbackRequest = new Request(fallbackUrl.toString(), request)
      return env.ASSETS.fetch(fallbackRequest)
    }

    return assetResponse
  },
  scheduled: (event: { scheduledTime?: number }, env: Bindings, ctx: ExecutionContext) => {
    const scheduledTime = typeof event.scheduledTime === 'number' ? event.scheduledTime : Date.now()
    const scheduledDate = new Date(scheduledTime)
    ctx.waitUntil(generateRecurringEntries(env.DB, scheduledDate))
    ctx.waitUntil(runMonthStartBalanceUpdate(env.DB, scheduledDate))
    ctx.waitUntil(cleanupMutationReceipts(env.DB))
  },
}
