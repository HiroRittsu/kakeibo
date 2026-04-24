"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDayLabel = exports.dayToInputValue = exports.normalizeDayOfMonth = exports.formatAmount = void 0;
const formatAmount = (amount) => {
    return new Intl.NumberFormat('ja-JP').format(amount);
};
exports.formatAmount = formatAmount;
const normalizeDayOfMonth = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed))
        return null;
    const normalized = Math.trunc(parsed);
    if (normalized < 1 || normalized > 31)
        return null;
    return normalized;
};
exports.normalizeDayOfMonth = normalizeDayOfMonth;
const dayToInputValue = (value) => (typeof value === 'number' ? String(value) : '');
exports.dayToInputValue = dayToInputValue;
const formatDayLabel = (value) => (typeof value === 'number' ? `${value}日` : '未設定');
exports.formatDayLabel = formatDayLabel;
