"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const dayjs_1 = __importDefault(require("dayjs"));
const balanceTimeline_1 = require("../src/domains/balance/services/balanceTimeline");
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
const aprilOverview = (0, balanceTimeline_1.buildBalanceOverview)(entries, paymentMethods, recurringRules, (0, dayjs_1.default)('2026-04-01'));
strict_1.default.equal(aprilOverview.otherMethodRoots.length, 2, '未連携ルートは2件');
strict_1.default.equal(aprilOverview.otherMethodRoots.find((root) => root.methodId === 'card-unlinked')?.amount, 400, '未連携カードは月内明細合計を出す');
strict_1.default.equal(aprilOverview.otherMethodRoots.find((root) => root.methodId === 'wallet-unlinked')?.amount, 750, '未連携ウォレットは月内明細合計を出す');
const mayOverview = (0, balanceTimeline_1.buildBalanceOverview)(entries, paymentMethods, recurringRules, (0, dayjs_1.default)('2026-05-01'));
const mainBank = mayOverview.bankSummaries.find((summary) => summary.bankMethodId === 'bank-main');
strict_1.default.ok(mainBank, '銀行サマリーが取れる');
strict_1.default.equal(mainBank?.detailTotal, 99700, '銀行表示値は前月繰越と同じ月の銀行明細合計');
strict_1.default.equal(mainBank?.linkedTotal, 0, '銀行配下の紐づき合計は同じ月の子明細合計');
strict_1.default.equal(mainBank?.linkedMethods[0]?.amount, 0, '銀行配下のカード表示値も同じ月の明細合計');
strict_1.default.equal(mayOverview.otherMethodRoots.find((root) => root.methodId === 'card-unlinked')?.amount, 0, '未連携カードは翌月に明細がなければ0');
strict_1.default.equal(mayOverview.otherMethodRoots.find((root) => root.methodId === 'wallet-unlinked')?.amount, 0, '未連携ウォレットは翌月に明細がなければ0');
const carryover = mainBank?.detailEntries.find((entry) => entry.is_carryover);
strict_1.default.ok(carryover, '銀行明細に前月繰越が出る');
strict_1.default.equal(carryover?.amount, 100000, '銀行明細の前月繰越は過去の銀行アクティビティから計算する');
const linkedSettlement = mainBank?.detailEntries.find((entry) => entry.display_name === 'リンクカード引落');
strict_1.default.ok(linkedSettlement, '銀行明細に合算されたカード引落が出る');
strict_1.default.equal(linkedSettlement?.amount, 300, '銀行明細のカード引落は合算されている');
const linkedDetails = (0, balanceTimeline_1.buildMethodDetailEntriesForMonth)('card-linked', entries, paymentMethods, recurringRules, (0, dayjs_1.default)('2026-05-01'));
strict_1.default.equal(linkedDetails.length, 0, 'リンクカード明細は5月に実明細がなければ空になる');
console.log('balance overview checks passed');
