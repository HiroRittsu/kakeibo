import { randomUUID } from 'node:crypto'

const baseUrl = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const sessionCookieRaw = process.env.API_SESSION_COOKIE?.trim() ?? ''
const sessionCookie =
  !sessionCookieRaw || sessionCookieRaw.includes('=') ? sessionCookieRaw : `kakeibo_session=${sessionCookieRaw}`

const authHeaders = {
  'Content-Type': 'application/json',
  ...(sessionCookie ? { Cookie: sessionCookie } : {}),
}

if (!sessionCookie) {
  console.error('API_SESSION_COOKIE is required. Example: API_SESSION_COOKIE=kakeibo_session=<id> npm run api:smoke')
  process.exit(1)
}

const toJson = async (response) => {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const requestRaw = async (
  path,
  {
    method = 'GET',
    body,
    headers: extraHeaders,
    withAuth = true,
  } = {}
) => {
  const headers = withAuth ? { ...authHeaders, ...(extraHeaders ?? {}) } : { ...(extraHeaders ?? {}) }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  return {
    response,
    data: await toJson(response),
  }
}

const request = async (path, options) => {
  const { response, data } = await requestRaw(path, options)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.url} ${JSON.stringify(data)}`)
  }
  return data
}

const step = async (label, fn) => {
  try {
    const result = await fn()
    console.log(`ok: ${label}`)
    return result
  } catch (error) {
    console.error(`fail: ${label}`)
    throw error
  }
}

const expectStatus = async (label, path, options, expected) =>
  step(label, async () => {
    const { response, data } = await requestRaw(path, options)
    if (!expected.includes(response.status)) {
      throw new Error(`expected ${expected.join('/')} got ${response.status} ${JSON.stringify(data)}`)
    }
    return data
  })

const run = async () => {
  const categoryId = randomUUID()
  const paymentId = randomUUID()
  const entryId = randomUUID()
  const idempotentPaymentId = randomUUID()
  const now = new Date().toISOString()

  await step('health', () => request('/health', { withAuth: false }))
  await expectStatus('unauthorized entries without cookie', '/entries', { withAuth: false }, [401])

  const category = await step('create entry-category', () =>
    request('/entry-categories', {
      method: 'POST',
      body: {
        id: categoryId,
        name: 'Smoke Food',
        type: 'expense',
        icon_key: 'restaurant',
        color: '#d9554c',
        sort_order: 1,
      },
    })
  )

  const payment = await step('create payment-method', () =>
    request('/payment-methods', {
      method: 'POST',
      body: {
        id: paymentId,
        name: 'Smoke Cash',
        type: 'cash',
        sort_order: 1,
      },
    })
  )

  const createdEntry = await step('create entry', () =>
    request('/entries', {
      method: 'POST',
      body: {
        id: entryId,
        entry_type: 'expense',
        amount: 500,
        entry_category_id: categoryId,
        payment_method_id: paymentId,
        memo: 'Smoke Entry',
        occurred_at: now,
      },
    })
  )

  const createdUpdatedAt = createdEntry?.entry?.updated_at
  if (!createdUpdatedAt) {
    throw new Error('created entry.updated_at missing')
  }

  const patched = await step('patch entry with current base_updated_at', () =>
    request(`/entries/${entryId}`, {
      method: 'PATCH',
      body: {
        amount: 600,
        base_updated_at: createdUpdatedAt,
      },
    })
  )

  if (patched?.conflict !== false) {
    throw new Error('expected conflict=false in first patch')
  }

  const softConflict = await step('soft conflict returns 200', () =>
    request(`/entries/${entryId}`, {
      method: 'PATCH',
      body: {
        amount: 700,
        base_updated_at: createdUpdatedAt,
      },
    })
  )

  if (softConflict?.conflict !== true || softConflict?.conflict_class !== 'soft') {
    throw new Error('expected soft conflict payload')
  }

  const fatal = await expectStatus(
    'fatal conflict returns 409 with detail',
    '/entries',
    {
      method: 'POST',
      body: {
        id: randomUUID(),
        entry_type: 'expense',
        amount: 100,
        entry_category_id: randomUUID(),
        payment_method_id: paymentId,
        memo: 'Invalid category',
        occurred_at: now,
      },
    },
    [409]
  )

  if (fatal?.error?.kind !== 'fatal_conflict') {
    throw new Error('expected fatal_conflict kind')
  }
  if (!fatal?.error?.code) {
    throw new Error('expected fatal conflict code')
  }

  const requestId = randomUUID()
  const idempotentBody = {
    id: idempotentPaymentId,
    name: 'Idempotent Card',
    type: 'card',
    sort_order: 10,
  }

  const firstIdempotent = await step('idempotent first request', () =>
    request('/payment-methods', {
      method: 'POST',
      headers: { 'X-Outbox-Id': requestId },
      body: idempotentBody,
    })
  )

  const secondIdempotent = await step('idempotent second request', () =>
    request('/payment-methods', {
      method: 'POST',
      headers: { 'X-Outbox-Id': requestId },
      body: idempotentBody,
    })
  )

  if (firstIdempotent?.payment_method?.id !== idempotentPaymentId) {
    throw new Error('first idempotent response id mismatch')
  }
  if (secondIdempotent?.payment_method?.id !== idempotentPaymentId) {
    throw new Error('second idempotent response id mismatch')
  }

  await step('idempotent method exists once', async () => {
    const data = await request('/payment-methods')
    const matches = (data?.payment_methods ?? []).filter((row) => row.id === idempotentPaymentId)
    if (matches.length !== 1) {
      throw new Error(`expected 1 payment method, got ${matches.length}`)
    }
  })

  await step('delete entry', () =>
    request(`/entries/${entryId}`, {
      method: 'DELETE',
    })
  )

  await step('delete payment-method primary', () =>
    request(`/payment-methods/${paymentId}`, {
      method: 'DELETE',
    })
  )

  await step('delete payment-method idempotent', () =>
    request(`/payment-methods/${idempotentPaymentId}`, {
      method: 'DELETE',
    })
  )

  await step('delete entry-category', () =>
    request(`/entry-categories/${categoryId}`, {
      method: 'DELETE',
    })
  )

  if (!category?.entry_category?.id || !payment?.payment_method?.id) {
    throw new Error('create responses missing')
  }

  console.log('done')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
