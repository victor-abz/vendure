import { LanguageCode } from '@vendure/common/lib/generated-types';

import { ShippingEligibilityChecker } from './shipping-eligibility-checker';

export const defaultShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'default-shipping-eligibility-checker',
    description: [
        { languageCode: LanguageCode.en, value: 'Default Shipping Eligibility Checker' },
        { languageCode: LanguageCode.cs, value: 'Výchozí kontrola způsobilosti dopravy' },
    ],
    args: {
        orderMinimum: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Minimum order value' },
                { languageCode: LanguageCode.cs, value: 'Minimální hodnota objednávky' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Order is eligible only if its total is greater or equal to this value',
                },
                {
                    languageCode: LanguageCode.cs,
                    value: 'Objednávka je způsobilá pouze tehdy, když je její celková hodnota větší nebo rovna této hodnotě',
                },
            ],
        },
    },
    check: (ctx, order, args) => {
        return order.subTotalWithTax >= args.orderMinimum;
    },
});
