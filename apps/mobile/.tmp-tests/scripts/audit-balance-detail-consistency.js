"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dayjs_1 = __importDefault(require("dayjs"));
const balanceTimeline_1 = require("../src/domains/balance/services/balanceTimeline");
const paymentMethodModel_1 = require("../src/domains/balance/services/paymentMethodModel");
const paymentMethods = [
    {
        id: 'bank-main',
        family_id: 'family-test',
        name: 'メイン口座',
        type: 'bank',
        sort_order: 10,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
        id: 'card-linked',
        family_id: 'family-test',
        name: 'リンクカード',
        type: 'card',
        card_closing_day: 20,
        card_payment_day: 10,
        funding_source_payment_method_id: 'bank-main',
        linked_bank_payment_method_id: 'bank-main',
        sort_order: 20,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
        id: 'card-unlinked',
        family_id: 'family-test',
        name: '未連携カード',
        type: 'card',
        card_closing_day: 15,
        card_payment_day: 5,
        funding_source_payment_method_id: null,
        linked_bank_payment_method_id: null,
        sort_order: 30,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
        id: 'wallet-unlinked',
        family_id: 'family-test',
        name: '未連携ウォレット',
        type: 'emoney',
        funding_source_payment_method_id: null,
        linked_bank_payment_method_id: null,
        sort_order: 40,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    },
];
const entries = [
    {
        id: 'entry-bank-income',
        family_id: 'family-test',
        entry_type: 'income',
        amount: 100000,
        entry_category_id: null,
        payment_method_id: 'bank-main',
        memo: '入金',
        occurred_at: '2026-04-01T00:00:00.000Z',
        occurred_on: '2026-04-01',
        recurring_rule_id: null,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
        id: 'entry-linked-1',
        family_id: 'family-test',
        entry_type: 'expense',
        amount: 100,
        entry_category_id: null,
        payment_method_id: 'card-linked',
        memo: '買い物A',
        occurred_at: '2026-04-05T00:00:00.000Z',
        occurred_on: '2026-04-05',
        recurring_rule_id: null,
        created_at: '2026-04-05T00:00:00.000Z',
        updated_at: '2026-04-05T00:00:00.000Z',
    },
    {
        id: 'entry-linked-2',
        family_id: 'family-test',
        entry_type: 'expense',
        amount: 200,
        entry_category_id: null,
        payment_method_id: 'card-linked',
        memo: '買い物B',
        occurred_at: '2026-04-07T00:00:00.000Z',
        occurred_on: '2026-04-07',
        recurring_rule_id: null,
        created_at: '2026-04-07T00:00:00.000Z',
        updated_at: '2026-04-07T00:00:00.000Z',
    },
    {
        id: 'entry-unlinked-1',
        family_id: 'family-test',
        entry_type: 'expense',
        amount: 400,
        entry_category_id: null,
        payment_method_id: 'card-unlinked',
        memo: '未連携利用',
        occurred_at: '2026-04-08T00:00:00.000Z',
        occurred_on: '2026-04-08',
        recurring_rule_id: null,
        created_at: '2026-04-08T00:00:00.000Z',
        updated_at: '2026-04-08T00:00:00.000Z',
    },
    {
        id: 'entry-wallet-1',
        family_id: 'family-test',
        entry_type: 'income',
        amount: 1000,
        entry_category_id: null,
        payment_method_id: 'wallet-unlinked',
        memo: 'チャージ',
        occurred_at: '2026-04-03T00:00:00.000Z',
        occurred_on: '2026-04-03',
        recurring_rule_id: null,
        created_at: '2026-04-03T00:00:00.000Z',
        updated_at: '2026-04-03T00:00:00.000Z',
    },
    {
        id: 'entry-wallet-2',
        family_id: 'family-test',
        entry_type: 'expense',
        amount: 250,
        entry_category_id: null,
        payment_method_id: 'wallet-unlinked',
        memo: '利用',
        occurred_at: '2026-04-09T00:00:00.000Z',
        occurred_on: '2026-04-09',
        recurring_rule_id: null,
        created_at: '2026-04-09T00:00:00.000Z',
        updated_at: '2026-04-09T00:00:00.000Z',
    },
];
const recurringRules = [];
const paymentMap = new Map(paymentMethods.map((method) => [method.id, method]));
const sumEntriesForDisplay = (method, detailEntries) => {
    const valueMode = (0, paymentMethodModel_1.getPaymentMethodValueMode)(method);
    return detailEntries.reduce((sum, entry) => {
        if (valueMode === 'debt') {
            return sum + (entry.entry_type === 'expense' ? entry.amount : -entry.amount);
        }
        return sum + (entry.entry_type === 'income' ? entry.amount : -entry.amount);
    }, 0);
};
const flattenVisibleNodes = (nodes) => {
    const flat = [];
    const walk = (node) => {
        flat.push({ methodId: node.methodId, methodName: node.methodName, amount: node.amount });
        node.children.forEach(walk);
    };
    nodes.forEach(walk);
    return flat;
};
const months = ['2026-04', '2026-05'];
const mismatches = [];
months.forEach((ym) => {
    const month = (0, dayjs_1.default)(`${ym}-01`);
    const overview = (0, balanceTimeline_1.buildBalanceOverview)(entries, paymentMethods, recurringRules, month);
    overview.bankSummaries.forEach((summary) => {
        const method = paymentMap.get(summary.bankMethodId);
        if (!method || !(0, paymentMethodModel_1.isBankAccountMethod)(method))
            return;
        const detailAmount = sumEntriesForDisplay(method, summary.detailEntries);
        if (detailAmount !== summary.detailTotal) {
            mismatches.push(`${ym} / ${summary.bankName}: 画面=${summary.detailTotal}, 明細合計=${detailAmount}`);
        }
    });
    const visibleMethods = [
        ...flattenVisibleNodes(overview.bankSummaries.flatMap((summary) => summary.linkedMethods)),
        ...flattenVisibleNodes(overview.otherMethodRoots),
    ];
    visibleMethods.forEach((item) => {
        const method = paymentMap.get(item.methodId);
        if (!method)
            return;
        const detailEntries = (0, balanceTimeline_1.buildMethodDetailEntriesForMonth)(item.methodId, entries, paymentMethods, recurringRules, month);
        const detailAmount = sumEntriesForDisplay(method, detailEntries);
        if (detailAmount !== item.amount) {
            mismatches.push(`${ym} / ${item.methodName}: 画面=${item.amount}, 明細合計=${detailAmount}`);
        }
    });
});
if (mismatches.length > 0) {
    console.error('balance/detail consistency mismatches found:');
    mismatches.forEach((line) => console.error(`- ${line}`));
    process.exit(1);
}
console.log('balance/detail consistency checks passed');
