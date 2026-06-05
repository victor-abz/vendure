import { LanguageCode, ShippingEligibilityChecker } from '@vendure/core';

export const digitalShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'digital-shipping-eligibility-checker',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Allows only orders that contain at least 1 digital product',
        },
        {
            languageCode: LanguageCode.cs,
            value: 'Povoluje pouze objednávky, které obsahují alespoň 1 digitální produkt',
        },
    ],
    args: {},
    check: (ctx, order, args) => {
        const digitalOrderLines = order.lines.filter(l => l.productVariant.customFields.isDigital);
        return digitalOrderLines.length > 0;
    },
});
