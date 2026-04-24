"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMethodDetailEntriesForMonth = exports.findBankSummary = exports.buildBalanceOverview = void 0;
const dayjs_1 = __importDefault(require("dayjs"));
const paymentOrder_1 = require("../../../shared/utils/paymentOrder");
const paymentMethodGraph_1 = require("./paymentMethodGraph");
const paymentMethodModel_1 = require("./paymentMethodModel");
const paymentMethodStatement_1 = require("./paymentMethodStatement");
const buildMethodTree = (method, childrenByParent, statementMap) => {
    const children = (childrenByParent.get(method.id) ?? [])
        .filter((child) => (0, paymentMethodModel_1.isVisibleBalanceMethod)(child))
        .map((child) => buildMethodTree(child, childrenByParent, statementMap));
    return {
        methodId: method.id,
        methodName: method.name,
        type: method.type,
        iconKey: method.icon_key ?? null,
        color: method.color ?? null,
        amount: (0, paymentMethodStatement_1.sumStatementEntries)(method, statementMap.get(method.id)?.entries ?? []),
        children,
    };
};
const flattenSegments = (nodes) => {
    return nodes.flatMap((node) => {
        const current = node.amount > 0
            ? [
                {
                    methodId: node.methodId,
                    label: node.methodName,
                    color: node.color ?? null,
                    amount: node.amount,
                },
            ]
            : [];
        return [...current, ...flattenSegments(node.children)];
    });
};
const sumMethodTreeAmounts = (nodes) => {
    return nodes.reduce((sum, node) => sum + node.amount + sumMethodTreeAmounts(node.children), 0);
};
const buildBalanceOverview = (entries, paymentMethods, recurringRules, month = (0, dayjs_1.default)()) => {
    const selectedMonth = month.startOf('month');
    const methods = (0, paymentOrder_1.sortPaymentMethods)(paymentMethods);
    const paymentMap = new Map(methods.map((method) => [method.id, method]));
    const childrenByParent = (0, paymentMethodGraph_1.buildChildrenByParent)(methods, paymentMap);
    const statementMap = (0, paymentMethodStatement_1.buildMonthlyStatementMap)(methods, entries, recurringRules, selectedMonth);
    const bankSummaries = methods
        .filter((method) => (0, paymentMethodModel_1.isBankAccountMethod)(method))
        .map((bank) => {
        const linkedMethods = (childrenByParent.get(bank.id) ?? [])
            .filter((method) => (0, paymentMethodModel_1.isVisibleBalanceMethod)(method))
            .map((method) => buildMethodTree(method, childrenByParent, statementMap));
        const bankStatement = (0, paymentMethodStatement_1.buildBankStatementForMonth)(bank.id, methods, entries, recurringRules, selectedMonth);
        return {
            bankMethodId: bank.id,
            bankName: bank.name,
            iconKey: bank.icon_key ?? null,
            color: bank.color ?? null,
            detailTotal: (0, paymentMethodStatement_1.sumStatementEntries)(bank, bankStatement?.entries ?? statementMap.get(bank.id)?.entries ?? []),
            linkedTotal: sumMethodTreeAmounts(linkedMethods),
            linkedMethods,
            deductionSegments: flattenSegments(linkedMethods),
            detailEntries: bankStatement?.entries ?? [],
        };
    });
    const bankDescendantIds = new Set();
    bankSummaries.forEach((bank) => {
        bank.linkedMethods.forEach((node) => {
            (0, paymentMethodGraph_1.collectTreeMethodIds)(node.methodId, childrenByParent).forEach((id) => bankDescendantIds.add(id));
        });
    });
    const unlinkedRootIds = new Set();
    const unlinkedReasonMap = new Map();
    methods
        .filter((method) => (0, paymentMethodModel_1.isVisibleBalanceMethod)(method))
        .filter((method) => !bankDescendantIds.has(method.id))
        .forEach((method) => {
        const rootId = (0, paymentMethodGraph_1.findUnlinkedRootId)(method.id, paymentMap);
        if (!rootId)
            return;
        unlinkedRootIds.add(rootId);
        const reason = (0, paymentMethodGraph_1.buildFundingReason)(rootId, paymentMap);
        if (reason)
            unlinkedReasonMap.set(rootId, reason);
    });
    const otherMethodRoots = Array.from(unlinkedRootIds)
        .sort()
        .map((methodId) => paymentMap.get(methodId))
        .filter((method) => Boolean(method))
        .map((method) => buildMethodTree(method, childrenByParent, statementMap));
    return {
        bankSummaries,
        otherMethodRoots,
        unlinkedReasonMap,
    };
};
exports.buildBalanceOverview = buildBalanceOverview;
const findBankSummary = (entries, paymentMethods, recurringRules, bankMethodId, month = (0, dayjs_1.default)()) => {
    return (0, exports.buildBalanceOverview)(entries, paymentMethods, recurringRules, month).bankSummaries.find((summary) => summary.bankMethodId === bankMethodId);
};
exports.findBankSummary = findBankSummary;
const buildMethodDetailEntriesForMonth = (methodId, entries, paymentMethods, recurringRules, month = (0, dayjs_1.default)()) => {
    return (0, paymentMethodStatement_1.buildMethodStatementForMonth)(methodId, paymentMethods, entries, recurringRules, month)?.entries ?? [];
};
exports.buildMethodDetailEntriesForMonth = buildMethodDetailEntriesForMonth;
