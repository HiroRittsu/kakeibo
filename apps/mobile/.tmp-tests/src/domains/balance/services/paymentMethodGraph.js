"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectTreeMethodIds = exports.hasDeferredAncestor = exports.findUnlinkedRootId = exports.buildFundingReason = exports.buildFundingChain = exports.buildChildrenByParent = exports.getMethodFundingSourceId = void 0;
const paymentMethodModel_1 = require("./paymentMethodModel");
const getMethodFundingSourceId = (method) => {
    return method.funding_source_payment_method_id ?? method.linked_bank_payment_method_id ?? null;
};
exports.getMethodFundingSourceId = getMethodFundingSourceId;
const buildChildrenByParent = (paymentMethods, paymentMap) => {
    const childrenByParent = new Map();
    paymentMethods.forEach((method) => {
        const parentId = (0, exports.getMethodFundingSourceId)(method);
        if (!parentId || !paymentMap.has(parentId))
            return;
        const current = childrenByParent.get(parentId) ?? [];
        current.push(method);
        childrenByParent.set(parentId, current);
    });
    return childrenByParent;
};
exports.buildChildrenByParent = buildChildrenByParent;
const buildFundingChain = (methodId, paymentMap) => {
    const chain = [];
    const visited = new Set();
    let currentId = methodId;
    while (currentId) {
        if (visited.has(currentId))
            return { chain, status: 'cycle' };
        visited.add(currentId);
        const method = paymentMap.get(currentId);
        if (!method)
            return { chain, status: 'missing-parent' };
        chain.push(method);
        currentId = (0, exports.getMethodFundingSourceId)(method);
    }
    const last = chain.at(-1) ?? null;
    if (last && (0, paymentMethodModel_1.isBankAccountMethod)(last)) {
        return { chain, status: 'bank', bankId: last.id };
    }
    return { chain, status: 'no-parent' };
};
exports.buildFundingChain = buildFundingChain;
const buildFundingReason = (methodId, paymentMap) => {
    const resolution = (0, exports.buildFundingChain)(methodId, paymentMap);
    if (resolution.status === 'bank')
        return null;
    if (resolution.status === 'cycle')
        return '循環参照';
    if (resolution.status === 'missing-parent')
        return '親ID不正';
    return '親未設定';
};
exports.buildFundingReason = buildFundingReason;
const findUnlinkedRootId = (methodId, paymentMap) => {
    const visited = [];
    let currentId = methodId;
    while (currentId) {
        if (visited.includes(currentId)) {
            return [...visited.slice(visited.indexOf(currentId)), currentId].sort()[0] ?? methodId;
        }
        visited.push(currentId);
        const method = paymentMap.get(currentId);
        if (!method)
            return methodId;
        const parentId = (0, exports.getMethodFundingSourceId)(method);
        if (!parentId)
            return method.id;
        const parent = paymentMap.get(parentId);
        if (!parent)
            return method.id;
        if ((0, paymentMethodModel_1.isBankAccountMethod)(parent))
            return null;
        currentId = parent.id;
    }
    return methodId;
};
exports.findUnlinkedRootId = findUnlinkedRootId;
const hasDeferredAncestor = (methodId, paymentMap, visited = new Set()) => {
    if (!methodId || visited.has(methodId))
        return false;
    visited.add(methodId);
    const method = paymentMap.get(methodId);
    if (!method)
        return false;
    if ((0, paymentMethodModel_1.isDebtMethod)(method))
        return true;
    return (0, exports.hasDeferredAncestor)((0, exports.getMethodFundingSourceId)(method), paymentMap, visited);
};
exports.hasDeferredAncestor = hasDeferredAncestor;
const collectTreeMethodIds = (rootId, childrenByParent) => {
    const ids = new Set();
    const walk = (methodId) => {
        if (ids.has(methodId))
            return;
        ids.add(methodId);
        (childrenByParent.get(methodId) ?? []).forEach((child) => walk(child.id));
    };
    walk(rootId);
    return ids;
};
exports.collectTreeMethodIds = collectTreeMethodIds;
