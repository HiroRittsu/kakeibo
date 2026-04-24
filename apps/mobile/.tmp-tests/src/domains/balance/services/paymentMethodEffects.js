"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectDeferredChargesForMonth = exports.resolveDeferredPaymentDate = exports.buildRecurringOccurrencesForMonth = void 0;
const dayjs_1 = __importDefault(require("dayjs"));
const format_1 = require("../../../shared/utils/format");
const recurring_1 = require("../../../shared/utils/recurring");
const buildRuleOccurrenceIndex = (entries) => {
    return new Set(entries
        .filter((entry) => entry.recurring_rule_id)
        .map((entry) => `${entry.recurring_rule_id}:${entry.occurred_on}`));
};
const buildRecurringOccurrencesForMonth = (rules, entries, month = (0, dayjs_1.default)()) => {
    const existingRuleOccurrences = buildRuleOccurrenceIndex(entries);
    return (0, recurring_1.buildRecurringOccurrences)(rules, 'month', month)
        .filter((occurrence) => !existingRuleOccurrences.has(`${occurrence.rule.id}:${occurrence.date.format('YYYY-MM-DD')}`))
        .map(({ rule, date }) => ({ rule, date: date.startOf('day') }));
};
exports.buildRecurringOccurrencesForMonth = buildRecurringOccurrencesForMonth;
const resolveDeferredPaymentDate = (occurredAt, method) => {
    const closingDay = (0, format_1.normalizeDayOfMonth)(method.card_closing_day);
    const paymentDay = (0, format_1.normalizeDayOfMonth)(method.card_payment_day);
    if (!closingDay || !paymentDay)
        return null;
    const occurred = (0, dayjs_1.default)(occurredAt);
    const closingBaseMonth = occurred.date() <= closingDay ? occurred.startOf('month') : occurred.add(1, 'month').startOf('month');
    const paymentBaseMonth = closingBaseMonth.add(1, 'month');
    const targetDay = Math.min(paymentDay, paymentBaseMonth.daysInMonth());
    return paymentBaseMonth.date(targetDay).startOf('day');
};
exports.resolveDeferredPaymentDate = resolveDeferredPaymentDate;
const collectDeferredChargesForMonth = (methods, entries, recurringRules, month = (0, dayjs_1.default)()) => {
    const selectedMonth = month.startOf('month');
    const methodMap = new Map(methods.map((method) => [method.id, method]));
    const charges = [];
    entries.forEach((entry) => {
        if (!entry.payment_method_id)
            return;
        const method = methodMap.get(entry.payment_method_id);
        if (!method)
            return;
        const paymentDate = (0, exports.resolveDeferredPaymentDate)(entry.occurred_at, method);
        if (!paymentDate || !paymentDate.isSame(selectedMonth, 'month'))
            return;
        charges.push({
            id: `deferred-entry:${entry.id}:${paymentDate.format('YYYY-MM-DD')}`,
            methodId: method.id,
            amount: entry.entry_type === 'expense' ? entry.amount : -entry.amount,
            paymentDate: paymentDate.toISOString(),
            categoryId: entry.entry_category_id,
            memo: entry.memo,
            isPlanned: true,
        });
    });
    const methodRules = recurringRules.filter((rule) => !!rule.payment_method_id && methodMap.has(rule.payment_method_id));
    const occurrenceMonths = [
        selectedMonth.subtract(2, 'month'),
        selectedMonth.subtract(1, 'month'),
        selectedMonth,
    ];
    occurrenceMonths.forEach((targetMonth) => {
        (0, exports.buildRecurringOccurrencesForMonth)(methodRules, entries, targetMonth).forEach(({ rule, date }) => {
            if (!rule.payment_method_id)
                return;
            const method = methodMap.get(rule.payment_method_id);
            if (!method)
                return;
            const paymentDate = (0, exports.resolveDeferredPaymentDate)(date.toISOString(), method);
            if (!paymentDate || !paymentDate.isSame(selectedMonth, 'month'))
                return;
            charges.push({
                id: `deferred-rule:${rule.id}:${paymentDate.format('YYYY-MM-DD')}`,
                methodId: method.id,
                amount: rule.entry_type === 'expense' ? rule.amount : -rule.amount,
                paymentDate: paymentDate.toISOString(),
                categoryId: rule.entry_category_id,
                memo: rule.memo,
                isPlanned: true,
            });
        });
    });
    const aggregated = new Map();
    charges.forEach((charge) => {
        const key = `${charge.methodId}:${charge.paymentDate}`;
        const current = aggregated.get(key);
        if (!current) {
            aggregated.set(key, { ...charge });
            return;
        }
        current.amount += charge.amount;
        aggregated.set(key, current);
    });
    return Array.from(aggregated.values());
};
exports.collectDeferredChargesForMonth = collectDeferredChargesForMonth;
