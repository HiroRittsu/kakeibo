import { AuthScreen } from './domains/auth/components/AuthScreen'
import { HomeTab } from './domains/home/components/HomeTab'
import { HistoryTab } from './domains/history/components/HistoryTab'
import { ReportsTab } from './domains/reports/components/ReportsTab'
import { BalancePage } from './domains/balance/components/BalancePage'
import { EntryInputPage } from './domains/entries/components/EntryInputPage'
import { CategorySettingsPage } from './domains/settings/category/components/CategorySettingsPage'
import { RecurringSettingsPage } from './domains/settings/recurring/components/RecurringSettingsPage'
import { PaymentSettingsPage } from './domains/settings/payment/components/PaymentSettingsPage'
import { ReportCategoryEntitiesPage } from './domains/reports/components/ReportCategoryEntitiesPage'
import { PaymentMethodEntitiesPage } from './domains/balance/components/PaymentMethodEntitiesPage'
import { AppLayout } from './app/AppLayout'
import { useAppController } from './app/useAppController'

export default function App() {
  const controller = useAppController()
  const { state, viewModel, actions } = controller

  if (state.session.authStatus !== 'ready') {
    return <AuthScreen status={state.session.authStatus} onLogin={actions.auth.handleLogin} error={state.session.authError} />
  }

  return (
    <AppLayout
      page={state.nav.page}
      headerTitle={viewModel.headerTitle}
      showSync={viewModel.showSync}
      syncing={state.sync.syncing}
      deadLetterCount={viewModel.deadLetterCount}
      outboxCount={viewModel.outboxCount}
      onSync={actions.sync.handleSync}
      showIconBar={viewModel.showIconBar}
      iconActive={viewModel.iconActive}
      onSelectHome={actions.navigation.selectHome}
      onSelectHistory={actions.navigation.selectHistory}
      onSelectReports={actions.navigation.selectReports}
      onSelectBalance={actions.navigation.selectBalance}
      onOpenMenu={actions.navigation.openMenu}
      onBack={actions.navigation.handleBack}
      menuOpen={state.nav.menuOpen}
      onCloseMenu={actions.navigation.closeMenu}
      onOpenCategorySettings={() => actions.navigation.handleOpenPage('category-settings')}
      onOpenRecurringSettings={() => actions.navigation.handleOpenPage('recurring-settings')}
      onOpenPaymentSettings={() => actions.navigation.handleOpenPage('payment-settings')}
      onLogout={actions.mutations.handleLogout}
      toast={state.sync.toast}
      syncFailureLog={viewModel.syncFailureLog}
      onCopySyncFailureLog={actions.sync.handleCopySyncFailureLog}
    >
      {state.nav.page === 'main' && state.nav.activeTab === 'home' && (
        <HomeTab
          entries={viewModel.entries}
          categories={viewModel.entryCategories}
          paymentMethods={viewModel.paymentOptions}
          monthlyBalanceMap={viewModel.monthlyBalanceMap}
          entryType={state.context.preferredEntryType}
          onEntryTypeChange={actions.navigation.setPreferredEntryType}
          onOpenCategorySettings={() => actions.navigation.handleOpenPage('category-settings')}
          onOpenEntryInput={actions.navigation.handleOpenEntryInput}
        />
      )}
      {state.nav.page === 'main' && state.nav.activeTab === 'history' && (
        <HistoryTab
          entries={viewModel.entries}
          categoryMap={viewModel.categoryMap}
          paymentMap={viewModel.paymentMap}
          monthlyBalanceMap={viewModel.monthlyBalanceMap}
          recurringRules={viewModel.recurringRules}
          currentMonthYm={state.context.historyMonthYm}
          onChangeMonthYm={actions.navigation.setHistoryMonthYm}
          defaultEntryType={state.context.preferredEntryType}
          defaultPaymentMethodId={viewModel.orderedPaymentMethods[0]?.id ?? null}
          onOpenEntryInput={actions.navigation.handleOpenEntryInput}
          onEdit={(entry) =>
            actions.navigation.handleOpenEntryInput(
              {
                id: entry.id,
                entryType: entry.entry_type,
                amount: entry.amount,
                entryCategoryId: entry.entry_category_id,
                paymentMethodId: entry.payment_method_id,
                memo: entry.memo,
                occurredAt: entry.occurred_at,
                createdAt: entry.created_at,
                updatedAt: entry.updated_at,
                recurringRuleId: entry.recurring_rule_id,
                createdByUserId: entry.created_by_user_id ?? null,
                createdByUserName: entry.created_by_user_name ?? null,
                createdByAvatarUrl: entry.created_by_avatar_url ?? null,
              },
              'history'
            )
          }
        />
      )}
      {state.nav.page === 'main' && state.nav.activeTab === 'reports' && (
        <ReportsTab
          entries={viewModel.entries}
          categories={viewModel.entryCategories}
          monthlyBalanceMap={viewModel.monthlyBalanceMap}
          onOpenCategoryEntities={actions.navigation.handleOpenReportCategoryEntities}
        />
      )}
      {state.nav.page === 'balance' && (
        <BalancePage
          entries={viewModel.entries}
          monthlyBalanceMap={viewModel.monthlyBalanceMap}
          paymentMethods={viewModel.orderedPaymentMethods}
          onOpenPayment={actions.navigation.handleOpenPayment}
          onOpenPaymentMethodEntities={actions.navigation.handleOpenPaymentMethodEntities}
        />
      )}
      {state.nav.page === 'entry-input' && state.context.entrySeed && (
        <EntryInputPage
          key={`${state.context.entrySeed.id ?? 'new'}-${state.context.entrySeed.occurredAt}`}
          seed={state.context.entrySeed}
          categories={viewModel.entryCategories}
          paymentMethods={viewModel.orderedPaymentMethods}
          onSave={(payload) => {
            void actions.mutations.handleSaveEntry(payload)
            actions.navigation.handleBack()
          }}
          onDelete={(entryId) => {
            void actions.mutations.handleDeleteEntry(entryId)
            actions.navigation.handleBack()
          }}
          onEntryTypeChange={actions.navigation.updateEntrySeedType}
        />
      )}
      {state.nav.page === 'category-settings' && (
        <CategorySettingsPage
          categories={viewModel.entryCategories}
          onAdd={actions.mutations.handleAddCategory}
          onSave={actions.mutations.handleSaveCategory}
          onDelete={actions.mutations.handleDeleteCategory}
        />
      )}
      {state.nav.page === 'recurring-settings' && (
        <RecurringSettingsPage
          rules={viewModel.recurringRules}
          categories={viewModel.entryCategories}
          paymentMethods={viewModel.orderedPaymentMethods}
          onAdd={actions.mutations.handleAddRecurringRule}
          onSave={actions.mutations.handleSaveRecurringRule}
          onDelete={actions.mutations.handleDeleteRecurringRule}
        />
      )}
      {state.nav.page === 'payment-settings' && (
        <PaymentSettingsPage
          defaultType={state.context.paymentType}
          paymentMethods={viewModel.orderedPaymentMethods}
          onAdd={actions.mutations.handleAddPaymentMethod}
          onSave={actions.mutations.handleSavePaymentMethod}
          onDelete={actions.mutations.handleDeletePaymentMethod}
        />
      )}
      {state.nav.page === 'report-category-entities' && state.context.reportCategorySeed && (
        <ReportCategoryEntitiesPage
          seed={state.context.reportCategorySeed}
          entries={viewModel.entries}
          categoryMap={viewModel.categoryMap}
          paymentMethods={viewModel.orderedPaymentMethods}
        />
      )}
      {state.nav.page === 'payment-method-entities' && state.context.paymentMethodSeed && (
        <PaymentMethodEntitiesPage
          seed={state.context.paymentMethodSeed}
          entries={viewModel.entries}
          categoryMap={viewModel.categoryMap}
          paymentMethods={viewModel.orderedPaymentMethods}
        />
      )}
    </AppLayout>
  )
}
