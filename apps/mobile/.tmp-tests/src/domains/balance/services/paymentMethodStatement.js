"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBankStatementForMonth = exports.buildMethodStatementForMonth = exports.sumStatementEntries = exports.buildMonthlyStatementMap = void 0;
const dayjs_1 = __importDefault(require("dayjs"));
const paymentMethodEffects_1 = require("./paymentMethodEffects");
const paymentMethodGraph_1 = require("./paymentMethodGraph");
const paymentMethodModel_1 = require("./paymentMethodModel");
const getSignedAmount = (method, entry) => {
    if ((0, paymentMethodModel_1.getPaymentMethodValueMode)(method) === 'debt') {
        return entry.entry_type === 'expense' ? entry.amount : -entry.amount;
    }
    return entry.entry_type === 'income' ? entry.amount : -entry.amount;
};
const buildMethodActivityEntriesForMonth = (method, entries, recurringRules, month = (0, dayjs_1.default)()) => {
    const selectedMonth = month.startOf('month');
    const actualEntries = entries
        .filter((entry) => entry.payment_method_id === method.id)
        .filter((entry) => (0, dayjs_1.default)(entry.occurred_at).isSame(selectedMonth, 'month'))
        .map((entry) => ({
        ...entry,
        is_planned: (0, dayjs_1.default)(entry.occurred_at).isAfter((0, dayjs_1.default)()),
    }));
    const plannedEntries = recurringRules
        .filter((rule) => rule.payment_method_id === method.id)
        .flatMap((rule) => (0, paymentMethodEffects_1.buildRecurringOccurrencesForMonth)([rule], entries, selectedMonth).map(({ date }) => ({
        id: `statement-rule:${rule.id}:${date.format('YYYY-MM-DD')}`,
        family_id: rule.family_id,
        entry_type: rule.entry_type,
        amount: rule.amount,
        entry_category_id: rule.entry_category_id,
        payment_method_id: method.id,
        memo: rule.memo,
        occurred_at: date.toISOString(),
        occurred_on: date.format('YYYY-MM-DD'),
        recurring_rule_id: rule.id,
        created_at: date.toISOString(),
        updated_at: date.toISOString(),
        is_planned: true,
    })));
    return [...actualEntries, ...plannedEntries].sort((a, b) => (0, dayjs_1.default)(a.occurred_at).valueOf() - (0, dayjs_1.default)(b.occurred_at).valueOf());
};
const buildMonthlyStatementMap = (methods, entries, recurringRules, month = (0, dayjs_1.default)()) => {
    const selectedMonth = month.startOf('month');
    const statements = new Map();
    methods.forEach((method) => {
        const activityEntries = buildMethodActivityEntriesForMonth(method, entries, recurringRules, selectedMonth);
        statements.set(method.id, {
            methodId: method.id,
            activityEntries,
            entries: activityEntries,
        });
    });
    return statements;
};
exports.buildMonthlyStatementMap = buildMonthlyStatementMap;
const sumStatementEntries = (method, entries) => {
    return entries.reduce((sum, entry) => sum + getSignedAmount(method, entry), 0);
};
exports.sumStatementEntries = sumStatementEntries;
const buildMethodStatementForMonth = (methodId, methods, entries, recurringRules, month = (0, dayjs_1.default)()) => {
    return (0, exports.buildMonthlyStatementMap)(methods, entries, recurringRules, month).get(methodId) ?? null;
};
exports.buildMethodStatementForMonth = buildMethodStatementForMonth;
const collectDescendantIds = (bankId, methods) => {
    const methodMap = new Map(methods.map((method) => [method.id, method]));
    const childrenByParent = (0, paymentMethodGraph_1.buildChildrenByParent)(methods, methodMap);
    const descendantIds = new Set();
    const walk = (methodId) => {
        ;
        (childrenByParent.get(methodId) ?? []).forEach((child) => {
            descendantIds.add(child.id);
            walk(child.id);
        });
    };
    walk(bankId);
    return descendantIds;
};
const buildSettlementEntriesForMonth = (bank, methods, entries, recurringRules, descendantIds, month) => {
    const methodMap = new Map(methods.map((method) => [method.id, method]));
    return (0, paymentMethodEffects_1.collectDeferredChargesForMonth)(methods.filter((method) => (0, paymentMethodModel_1.isDebtMethod)(method) && descendantIds.has(method.id)), entries, recurringRules, month).map((charge) => {
        const method = methodMap.get(charge.methodId);
        const entryType = charge.amount >= 0 ? 'expense' : 'income';
        return {
            id: charge.id,
            family_id: bank.family_id,
            entry_type: entryType,
            amount: Math.abs(charge.amount),
            entry_category_id: null,
            payment_method_id: charge.methodId,
            memo: null,
            occurred_at: charge.paymentDate,
            occurred_on: (0, dayjs_1.default)(charge.paymentDate).format('YYYY-MM-DD'),
            recurring_rule_id: null,
            created_at: charge.paymentDate,
            updated_at: charge.paymentDate,
            is_planned: charge.isPlanned,
            display_name: `${method?.name ?? '後払い'}引落`,
            detail_label: '口座引落',
            use_payment_icon_as_primary: true,
        };
    });
};
const buildBankActivityEntriesForMonth = (bank, methods, entries, recurringRules, descendantIds, month) => {
    const baseStatement = (0, exports.buildMethodStatementForMonth)(bank.id, methods, entries, recurringRules, month);
    const settlementEntries = buildSettlementEntriesForMonth(bank, methods, entries, recurringRules, descendantIds, month);
    return [...(baseStatement?.activityEntries ?? []), ...settlementEntries].sort((a, b) => (0, dayjs_1.default)(a.occurred_at).valueOf() - (0, dayjs_1.default)(b.occurred_at).valueOf());
};
const findEarliestActivityMonth = (bank, entries, recurringRules, descendantIds) => {
    const targetMethodIds = new Set([bank.id, ...descendantIds]);
    const dates = [
        ...entries
            .filter((entry) => entry.payment_method_id && targetMethodIds.has(entry.payment_method_id))
            .map((entry) => entry.occurred_at),
        ...recurringRules
            .filter((rule) => rule.payment_method_id && targetMethodIds.has(rule.payment_method_id))
            .map((rule) => rule.start_at),
    ];
    const earliest = dates
        .map((date) => (0, dayjs_1.default)(date))
        .filter((date) => date.isValid())
        .sort((a, b) => a.valueOf() - b.valueOf())[0];
    return earliest?.startOf('month') ?? null;
};
const calculateBankCarryoverAmount = (bank, methods, entries, recurringRules, descendantIds, month) => {
    const selectedMonth = month.startOf('month');
    const startMonth = findEarliestActivityMonth(bank, entries, recurringRules, descendantIds);
    if (!startMonth || !startMonth.isBefore(selectedMonth, 'month'))
        return 0;
    let amount = 0;
    let cursor = startMonth;
    while (cursor.isBefore(selectedMonth, 'month')) {
        amount += (0, exports.sumStatementEntries)(bank, buildBankActivityEntriesForMonth(bank, methods, entries, recurringRules, descendantIds, cursor));
        cursor = cursor.add(1, 'month');
    }
    return amount;
};
const buildCarryoverEntry = (bank, amount, month) => {
    if (amount === 0)
        return null;
    const date = month.startOf('month');
    const entryType = amount >= 0 ? 'income' : 'expense';
    return {
        id: `bank-carryover:${bank.id}:${date.format('YYYY-MM')}`,
        family_id: bank.family_id,
        entry_type: entryType,
        amount: Math.abs(amount),
        entry_category_id: null,
        payment_method_id: bank.id,
        memo: '前月末残高',
        occurred_at: date.toISOString(),
        occurred_on: date.format('YYYY-MM-DD'),
        recurring_rule_id: null,
        created_at: date.toISOString(),
        updated_at: date.toISOString(),
        is_carryover: true,
    };
};
const buildBankStatementForMonth = (bankId, methods, entries, recurringRules, month = (0, dayjs_1.default)()) => {
    const selectedMonth = month.startOf('month');
    const methodMap = new Map(methods.map((method) => [method.id, method]));
    const bank = methodMap.get(bankId);
    if (!bank || !(0, paymentMethodModel_1.isBankAccountMethod)(bank))
        return null;
    const descendantIds = collectDescendantIds(bankId, methods);
    const activityEntries = buildBankActivityEntriesForMonth(bank, methods, entries, recurringRules, descendantIds, selectedMonth);
    const carryoverEntry = buildCarryoverEntry(bank, calculateBankCarryoverAmount(bank, methods, entries, recurringRules, descendantIds, selectedMonth), selectedMonth);
    const statementEntries = [carryoverEntry, ...activityEntries].filter((entry) => Boolean(entry)).sort((a, b) => (0, dayjs_1.default)(a.occurred_at).valueOf() - (0, dayjs_1.default)(b.occurred_at).valueOf());
    return {
        methodId: bank.id,
        activityEntries,
        entries: statementEntries,
    };
};
exports.buildBankStatementForMonth = buildBankStatementForMonth;
