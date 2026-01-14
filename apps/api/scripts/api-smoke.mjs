import { randomUUID } from 'node:crypto'

const baseUrl = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const familyId = process.env.FAMILY_ID ?? 'family-default'
const userId = process.env.USER_ID ?? 'user-default'

const headers = {
  'Content-Type': 'application/json',
  'X-Family-Id': familyId,
  'X-User-Id': userId,
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
  { method = 'GET', body, headers: extraHeaders, useDefaultHeaders = true } = {}
) => {
  const mergedHeaders = useDefaultHeaders ? { ...headers, ...(extraHeaders ?? {}) } : { ...(extraHeaders ?? {}) }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: mergedHeaders,
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
    const allow = response.headers.get('allow')
    const allowNote = allow ? ` (allow: ${allow})` : ''
    throw new Error(`${response.status} ${response.url}${allowNote} ${JSON.stringify(data)}`)
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
      const allow = response.headers.get('allow')
      const allowNote = allow ? ` (allow: ${allow})` : ''
      throw new Error(`expected ${expected.join('/')} got ${response.status}${allowNote} ${JSON.stringify(data)}`)
    }
    return data
  })

const expectEmptyEntries = (data) => {
  if (!data || !Array.isArray(data.entries)) {
    throw new Error('entries response missing')
  }
  if (data.entries.length > 0) {
    throw new Error('expected empty entries')
  }
}

const run = async () => {
  await step('health', () => request('/health'))

  await expectStatus('missing family header', '/entries', { useDefaultHeaders: false }, [400])
  await expectStatus('entry invalid amount', '/entries', { method: 'POST', body: { entry_type: 'expense', amount: 0 } }, [400])
  await expectStatus(
    'entry invalid type',
    '/entries',
    { method: 'POST', body: { entry_type: 'invalid', amount: 100 } },
    [400]
  )
  await expectStatus(
    'entry-category missing name',
    '/entry-categories',
    { method: 'POST', body: { type: 'expense' } },
    [400]
  )
  await expectStatus(
    'entry-category missing type',
    '/entry-categories',
    { method: 'POST', body: { name: 'Missing Type' } },
    [400]
  )
  await expectStatus(
    'payment-method missing name',
    '/payment-methods',
    { method: 'POST', body: { type: 'cash' } },
    [400]
  )
  await expectStatus(
    'payment-method missing type',
    '/payment-methods',
    { method: 'POST', body: { name: 'Missing Type' } },
    [400]
  )
  await expectStatus(
    'recurring-rule invalid payload',
    '/recurring-rules',
    { method: 'POST', body: { entry_type: 'expense', amount: 0 } },
    [400]
  )
  await expectStatus('monthly-balance missing ym', '/monthly-balance', {}, [400])
  await expectStatus(
    'monthly-balance missing balance',
    '/monthly-balance/2026-01',
    { method: 'PUT', body: {} },
    [400]
  )
  await expectStatus('method mismatch entry-categories', '/entry-categories', { method: 'PUT' }, [404, 405])

  const categoryId = randomUUID()
  const paymentId = randomUUID()
  const recurringId = randomUUID()
  const entryId = randomUUID()
  const now = new Date().toISOString()

  await step('pull entries', () => request('/entries'))
  await step('pull entry-categories', () => request('/entry-categories'))
  await step('pull payment-methods', () => request('/payment-methods'))
  await step('pull recurring-rules', () => request('/recurring-rules'))

  const category = await step('create entry-category', () =>
    request('/entry-categories', {
      method: 'POST',
      body: {
        id: categoryId,
        name: 'Smoke Food',
        type: 'expense',
        icon_key: 'food',
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

  const recurring = await step('create recurring-rule', () =>
    request('/recurring-rules', {
      method: 'POST',
      body: {
        id: recurringId,
        entry_type: 'expense',
        amount: 1200,
        entry_category_id: categoryId,
        payment_method_id: paymentId,
        memo: 'Smoke Rule',
        frequency: 'monthly',
        day_of_month: 1,
        start_at: now,
        is_active: true,
      },
    })
  )

  const entry = await step('create entry', () =>
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
        recurring_rule_id: recurringId,
        client_updated_at: now,
      },
    })
  )

  const entryUpdatedAt = entry?.entry?.updated_at ?? now

  const patched = await step('update entry', () =>
    request(`/entries/${entryId}`, {
      method: 'PATCH',
      body: {
        amount: 700,
        memo: 'Smoke Entry Updated',
      },
    })
  )

  const patchedUpdatedAt = patched?.entry?.updated_at ?? entryUpdatedAt

  const conflictResult = await step('entry conflict', () =>
    request('/entries', {
      method: 'POST',
      body: {
        id: entryId,
        entry_type: 'expense',
        amount: 800,
        entry_category_id: categoryId,
        payment_method_id: paymentId,
        memo: 'Smoke Entry Conflict',
        occurred_at: now,
        client_updated_at: entryUpdatedAt,
      },
    })
  )

  if (conflictResult?.conflict !== true) {
    throw new Error('expected conflict true')
  }

  await step('entries since (future)', async () => {
    const data = await request('/entries?since=2999-01-01T00:00:00.000Z')
    expectEmptyEntries(data)
  })

  const ym = now.slice(0, 7)
  await step('monthly-balance put', () =>
    request(`/monthly-balance/${ym}`, {
      method: 'PUT',
      body: {
        balance: 12345,
        is_closed: true,
      },
    })
  )
  await step('monthly-balance get', async () => {
    const data = await request(`/monthly-balance?ym=${ym}`)
    if (!data?.monthly_balance) {
      throw new Error('monthly_balance missing')
    }
    return data
  })

  await step('reports week', () => request('/reports?range=week'))
  await step('reports month', () => request('/reports?range=month'))
  await step('reports year', () => request('/reports?range=year'))

  await step('audit-logs', async () => {
    const data = await request('/audit-logs?limit=5')
    if (!data || !Array.isArray(data.audit_logs)) {
      throw new Error('audit_logs missing')
    }
    if (data.audit_logs.length === 0) {
      throw new Error('audit_logs empty')
    }
    return data
  })

  await step('delete entry', () =>
    request(`/entries/${entryId}`, {
      method: 'DELETE',
    })
  )

  await step('delete recurring-rule', () =>
    request(`/recurring-rules/${recurringId}`, {
      method: 'DELETE',
    })
  )

  await step('delete payment-method', () =>
    request(`/payment-methods/${paymentId}`, {
      method: 'DELETE',
    })
  )

  await step('delete entry-category', () =>
    request(`/entry-categories/${categoryId}`, {
      method: 'DELETE',
    })
  )

  if (!category?.entry_category?.id || !payment?.payment_method?.id || !recurring?.recurring_rule?.id) {
    throw new Error('create responses missing')
  }

  console.log('done')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
