"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inheritsParentEffectiveDate = exports.isVisibleBalanceMethod = exports.isBalanceChildMethod = exports.isDebtMethod = exports.isBankAccountMethod = exports.getPaymentMethodValueMode = void 0;
const getMethodType = (methodOrType) => {
    return typeof methodOrType === 'string' ? methodOrType : methodOrType.type;
};
const getPaymentMethodValueMode = (methodOrType) => {
    const type = getMethodType(methodOrType);
    if (type === 'card' || type === 'postpaid')
        return 'debt';
    return 'balance';
};
exports.getPaymentMethodValueMode = getPaymentMethodValueMode;
const isBankAccountMethod = (methodOrType) => {
    return getMethodType(methodOrType) === 'bank';
};
exports.isBankAccountMethod = isBankAccountMethod;
const isDebtMethod = (methodOrType) => {
    return (0, exports.getPaymentMethodValueMode)(methodOrType) === 'debt';
};
exports.isDebtMethod = isDebtMethod;
const isBalanceChildMethod = (methodOrType) => {
    const type = getMethodType(methodOrType);
    return (0, exports.getPaymentMethodValueMode)(type) === 'balance' && type !== 'bank' && type !== 'cash';
};
exports.isBalanceChildMethod = isBalanceChildMethod;
const isVisibleBalanceMethod = (methodOrType) => {
    return (0, exports.isDebtMethod)(methodOrType) || (0, exports.isBalanceChildMethod)(methodOrType);
};
exports.isVisibleBalanceMethod = isVisibleBalanceMethod;
const inheritsParentEffectiveDate = (methodOrType) => {
    return (0, exports.isBalanceChildMethod)(methodOrType);
};
exports.inheritsParentEffectiveDate = inheritsParentEffectiveDate;
