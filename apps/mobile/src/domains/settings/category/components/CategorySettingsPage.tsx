import type { FormEvent } from 'react'
import { useMemo } from 'react'
import { useCategorySettingsState } from '../hooks/useCategorySettingsState'
import { CATEGORY_COLORS, CATEGORY_ICON_CHOICES } from '../../../../shared/constants'
import styles from '../../../../shared/styles/App.module.css'
import { createStyleCx } from '../../../../shared/utils/cx'
import { renderMaterialIcon, getCategoryIcon } from '../../../../shared/icons/materialIcon'
import type { EntryCategory } from '../../../../types'

const scx = createStyleCx(styles)

type CategorySettingsPageProps = {
  categories: EntryCategory[]
  onAdd: (name: string, type: string) => void
  onSave: (category: EntryCategory) => void
  onDelete: (category: EntryCategory) => void
}

export const CategorySettingsPage = ({ categories, onAdd, onSave, onDelete }: CategorySettingsPageProps) => {
  const { state, dispatch } = useCategorySettingsState()

  const filtered = useMemo(() => {
    return categories
      .filter((category) => category.type === state.entryType)
      .sort((a, b) => a.sort_order - b.sort_order)
  }, [categories, state.entryType])

  const handleMove = (category: EntryCategory, direction: 'up' | 'down') => {
    const index = filtered.findIndex((item) => item.id === category.id)
    const target = direction === 'up' ? filtered[index - 1] : filtered[index + 1]
    if (!target) return

    const updatedCurrent = { ...category, sort_order: target.sort_order }
    const updatedTarget = { ...target, sort_order: category.sort_order }
    void onSave(updatedCurrent)
    void onSave(updatedTarget)
  }

  const handleUpdate = (event: FormEvent) => {
    event.preventDefault()
    if (!state.editingCategory || !state.editName.trim()) return
    const updated: EntryCategory = {
      ...state.editingCategory,
      name: state.editName.trim(),
      icon_key: state.editIconKey,
      color: state.editColor,
      updated_at: state.editingCategory.updated_at,
    }
    onSave(updated)
    dispatch({ type: 'CLOSE_EDIT' })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!state.name.trim()) return
    onAdd(state.name.trim(), state.entryType)
    dispatch({ type: 'PATCH', payload: { name: '', showForm: false } })
  }

  const handleDeleteEditing = () => {
    if (!state.editingCategory) return
    onDelete(state.editingCategory)
    dispatch({ type: 'CLOSE_EDIT' })
  }

  return (
    <div className={scx('page')}>
      <div className={scx('pill-toggle')}>
        <button
          type="button"
          className={scx(state.entryType === 'income' && 'active')}
          onClick={() => dispatch({ type: 'PATCH', payload: { entryType: 'income' } })}
        >
          収入
        </button>
        <button
          type="button"
          className={scx(state.entryType === 'expense' && 'active')}
          onClick={() => dispatch({ type: 'PATCH', payload: { entryType: 'expense' } })}
        >
          支出
        </button>
      </div>

      <ul className={scx('category-list scrollable')}>
        {filtered.map((category, index) => (
          <li key={category.id} className={scx('category-row')}>
            <span
              className={scx('category-icon')}
              style={{ background: category.color ?? CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
            >
              {getCategoryIcon(category.icon_key) ?? <span className={scx('category-fallback')}>{category.name.slice(0, 1)}</span>}
            </span>
            <strong className={scx('category-title')}>{category.name}</strong>
            <div className={scx('category-actions')}>
              <div className={scx('category-action-buttons')}>
                <button
                  type="button"
                  className={scx('icon-button-small')}
                  aria-label="編集"
                  onClick={() => dispatch({ type: 'OPEN_EDIT', payload: category })}
                >
                  {renderMaterialIcon('edit')}
                </button>
              </div>
              <div className={scx('reorder-buttons')}>
                <button
                  type="button"
                  className={scx('icon-button-small')}
                  aria-label="上へ"
                  onClick={() => handleMove(category, 'up')}
                  disabled={index === 0}
                >
                  {renderMaterialIcon('arrow_upward')}
                </button>
                <button
                  type="button"
                  className={scx('icon-button-small')}
                  aria-label="下へ"
                  onClick={() => handleMove(category, 'down')}
                  disabled={index === filtered.length - 1}
                >
                  {renderMaterialIcon('arrow_downward')}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {state.showForm && (
        <div className={scx('sheet')}>
          <form className={scx('sheet-card')} onSubmit={handleSubmit}>
            <h3>カテゴリ追加</h3>
            <input
              type="text"
              placeholder="カテゴリ名"
              value={state.name}
              onChange={(event) => dispatch({ type: 'PATCH', payload: { name: event.target.value } })}
            />
            <div className={scx('sheet-actions')}>
              <button type="button" className={scx('ghost')} onClick={() => dispatch({ type: 'PATCH', payload: { showForm: false } })}>
                キャンセル
              </button>
              <button type="submit" className={scx('primary')}>
                追加
              </button>
            </div>
          </form>
        </div>
      )}

      {state.editingCategory && (
        <div className={scx('sheet')}>
          <form className={scx('sheet-card scrollable')} onSubmit={handleUpdate}>
            <h3>カテゴリ編集</h3>
            <input
              type="text"
              placeholder="カテゴリ名"
              value={state.editName}
              onChange={(event) => dispatch({ type: 'PATCH', payload: { editName: event.target.value } })}
            />
            <div className={scx('icon-picker')}>
              {CATEGORY_ICON_CHOICES.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  className={scx('icon-choice', state.editIconKey === iconName && 'active')}
                  aria-label={iconName}
                  onClick={() => dispatch({ type: 'PATCH', payload: { editIconKey: iconName } })}
                >
                  <span className={scx('icon-preview')}>{renderMaterialIcon(iconName)}</span>
                </button>
              ))}
            </div>
            <div className={scx('color-picker')}>
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={scx('color-swatch', state.editColor === color && 'active')}
                  style={{ background: color }}
                  onClick={() => dispatch({ type: 'PATCH', payload: { editColor: color } })}
                />
              ))}
            </div>
            <div className={scx('sheet-actions spread')}>
              <button type="button" className={scx('icon-button-small danger')} aria-label="削除" onClick={handleDeleteEditing}>
                {renderMaterialIcon('delete')}
              </button>
              <div className={scx('sheet-action-buttons')}>
                <button type="button" className={scx('ghost')} onClick={() => dispatch({ type: 'CLOSE_EDIT' })}>
                  キャンセル
                </button>
                <button type="submit" className={scx('primary')}>
                  保存
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <button className={scx('floating-button')} onClick={() => dispatch({ type: 'PATCH', payload: { showForm: true } })}>
        +
      </button>
    </div>
  )
}
