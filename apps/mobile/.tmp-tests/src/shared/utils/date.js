"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRangeBounds = exports.buildCalendar = exports.getEntryDateKey = exports.toTokyoDateString = exports.getDefaultSelectedDateForMonth = exports.parseMonthYm = exports.addMonthsToYm = exports.formatYmFromIndex = exports.ymToIndex = exports.getYmFromDate = void 0;
const dayjs_1 = __importDefault(require("dayjs"));
const getYmFromDate = (value) => value.slice(0, 7);
exports.getYmFromDate = getYmFromDate;
const ymToIndex = (ym) => {
    const [yearRaw, monthRaw] = ym.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month))
        return 0;
    return year * 12 + (month - 1);
};
exports.ymToIndex = ymToIndex;
const formatYmFromIndex = (index) => {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return `${year}-${`${month}`.padStart(2, '0')}`;
};
exports.formatYmFromIndex = formatYmFromIndex;
const addMonthsToYm = (ym, diff) => {
    const nextIndex = (0, exports.ymToIndex)(ym) + diff;
    return (0, exports.formatYmFromIndex)(nextIndex);
};
exports.addMonthsToYm = addMonthsToYm;
const parseMonthYm = (ym) => {
    const parsed = (0, dayjs_1.default)(`${ym}-01`);
    if (!parsed.isValid())
        return (0, dayjs_1.default)().startOf('month');
    return parsed.startOf('month');
};
exports.parseMonthYm = parseMonthYm;
const getDefaultSelectedDateForMonth = (month) => {
    const today = (0, dayjs_1.default)();
    if (today.isSame(month, 'month'))
        return today.format('YYYY-MM-DD');
    return month.startOf('month').format('YYYY-MM-DD');
};
exports.getDefaultSelectedDateForMonth = getDefaultSelectedDateForMonth;
const toTokyoDateString = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value.slice(0, 10);
    const tokyo = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return tokyo.toISOString().slice(0, 10);
};
exports.toTokyoDateString = toTokyoDateString;
const getEntryDateKey = (entry) => entry.occurred_on ?? (0, exports.toTokyoDateString)(entry.occurred_at);
exports.getEntryDateKey = getEntryDateKey;
const buildCalendar = (month, totals) => {
    const start = month.startOf('month');
    const end = month.endOf('month');
    const startWeekday = start.day();
    const days = [];
    for (let i = 0; i < startWeekday; i += 1) {
        const date = start.subtract(startWeekday - i, 'day');
        days.push({ date, inMonth: false, totals: totals.get(date.format('YYYY-MM-DD')) ?? { income: 0, expense: 0 } });
    }
    for (let day = 0; day < end.date(); day += 1) {
        const date = start.add(day, 'day');
        const key = date.format('YYYY-MM-DD');
        days.push({ date, inMonth: true, totals: totals.get(key) ?? { income: 0, expense: 0 } });
    }
    while (days.length % 7 !== 0) {
        const date = end.add(days.length % 7, 'day');
        days.push({ date, inMonth: false, totals: totals.get(date.format('YYYY-MM-DD')) ?? { income: 0, expense: 0 } });
    }
    return days;
};
exports.buildCalendar = buildCalendar;
const getRangeBounds = (range, base = (0, dayjs_1.default)()) => {
    let start = base.startOf('month');
    let end = base.endOf('month');
    if (range === 'week') {
        const day = (base.day() + 6) % 7;
        start = base.subtract(day, 'day').startOf('day');
        end = start.add(6, 'day').endOf('day');
    }
    else if (range === 'year') {
        start = base.startOf('year');
        end = base.endOf('year');
    }
    return { start, end };
};
exports.getRangeBounds = getRangeBounds;
