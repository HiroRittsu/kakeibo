"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMonthEndSnapshotMap = void 0;
const dayjs_1 = __importDefault(require("dayjs"));
const paymentMethodEffects_1 = require("./paymentMethodEffects");
const paymentMethodModel_1 = require("./paymentMethodModel");
const getSnapshotSignedAmount = (method, entry) => {
    if ((0, paymentMethodModel_1.getPaymentMethodValueMode)(method) === 'debt') {
        return entry.entry_type === 'expense' ? entry.amount : -entry.amount;
    }
    return entry.entry_type === 'income' ? entry.amount : -entry.amount;
};
const buildMonthEndSnapshotMap = (methods, entries, recurringRules, month = (0, dayjs_1.default)()) => {
    const selectedMonth = month.startOf('month');
    const monthEnd = selectedMonth.endOf('month');
    const methodMap = new Map(methods.map((method) => [method.id, method]));
    const snapshotMap = new Map();
    methods.forEach((method) => {
        snapshotMap.set(method.id, 0);
    });
    entries.forEach((entry) => {
        if (!entry.payment_method_id)
            return;
        const method = methodMap.get(entry.payment_method_id);
        if (!method)
            return;
        if ((0, dayjs_1.default)(entry.occurred_at).isAfter(monthEnd))
            return;
        snapshotMap.set(method.id, (snapshotMap.get(method.id) ?? 0) + getSnapshotSignedAmount(method, entry));
    });
    recurringRules.forEach((rule) => {
        if (!rule.payment_method_id)
            return;
        const method = methodMap.get(rule.payment_method_id);
        if (!method)
            return;
        const plannedTotal = (0, paymentMethodEffects_1.buildRecurringOccurrencesForMonth)([rule], entries, selectedMonth).reduce((sum, { rule: occurrenceRule }) => {
            return sum + getSnapshotSignedAmount(method, occurrenceRule);
        }, 0);
        snapshotMap.set(method.id, (snapshotMap.get(method.id) ?? 0) + plannedTotal);
    });
    return snapshotMap;
};
exports.buildMonthEndSnapshotMap = buildMonthEndSnapshotMap;
