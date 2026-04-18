import { db } from '../../../../infra/db'
import { enqueueOutbox } from '../../../../infra/sync'
import { getFamilyId } from '../../../../infra/api'
import { CATEGORY_COLORS } from '../../../../shared/constants'
import type { EntryCategory } from '../../../../types'

export const saveCategory = async (category: EntryCategory) => {
  const existing = await db.entryCategories.get(category.id)
  const baseUpdatedAt = existing?.updated_at ?? null
  await db.entryCategories.put(category)
  await enqueueOutbox({
    method: 'POST',
    endpoint: '/entry-categories',
    payload: {
      id: category.id,
      name: category.name,
      type: category.type,
      icon_key: category.icon_key ?? null,
      color: category.color ?? null,
      sort_order: category.sort_order,
      base_updated_at: baseUpdatedAt,
    },
    created_at: new Date().toISOString(),
    entity_type: 'entry_categories',
    entity_id: category.id,
    operation: 'upsert',
    base_updated_at: baseUpdatedAt,
  })
}

export const addCategory = async (params: { name: string; type: string; count: number }) => {
  const now = new Date().toISOString()
  const category: EntryCategory = {
    id: crypto.randomUUID(),
    family_id: getFamilyId(),
    name: params.name,
    type: params.type,
    icon_key: null,
    color: CATEGORY_COLORS[params.count % CATEGORY_COLORS.length],
    sort_order: params.count + 1,
    created_at: now,
    updated_at: now,
  }

  await saveCategory(category)
}

export const deleteCategory = async (category: EntryCategory) => {
  await db.entryCategories.delete(category.id)
  await enqueueOutbox({
    method: 'DELETE',
    endpoint: `/entry-categories/${category.id}`,
    payload: null,
    created_at: new Date().toISOString(),
    entity_type: 'entry_categories',
    entity_id: category.id,
    operation: 'delete',
    base_updated_at: category.updated_at ?? null,
  })
}
