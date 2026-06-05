import { LanguageCode } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';

import { ShippingCalculator } from './shipping-calculator';

export enum TaxSetting {
    include = 'include',
    exclude = 'exclude',
    auto = 'auto',
}

export const defaultShippingCalculator = new ShippingCalculator({
    code: 'default-shipping-calculator',
    description: [
        { languageCode: LanguageCode.en, value: 'Default Flat-Rate Shipping Calculator' },
        { languageCode: LanguageCode.cs, value: 'Výchozí kalkulátor dopravy s pevnou sazbou' },
    ],
    args: {
        rate: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Shipping price' },
                { languageCode: LanguageCode.cs, value: 'Cena dopravy' },
            ],
        },
        includesTax: {
            type: 'string',
            defaultValue: TaxSetting.auto,
            ui: {
                component: 'select-form-input',
                options: [
                    {
                        label: [
                            { languageCode: LanguageCode.en, value: 'Includes tax' },
                            { languageCode: LanguageCode.cs, value: 'Včetně daně' },
                        ],
                        value: TaxSetting.include,
                    },
                    {
                        label: [
                            { languageCode: LanguageCode.en, value: 'Excludes tax' },
                            { languageCode: LanguageCode.cs, value: 'Bez daně' },
                        ],
                        value: TaxSetting.exclude,
                    },
                    {
                        label: [
                            { languageCode: LanguageCode.en, value: 'Auto (based on Channel)' },
                            { languageCode: LanguageCode.cs, value: 'Automaticky (podle kanálu)' },
                        ],
                        value: TaxSetting.auto,
                    },
                ],
            },
            label: [
                { languageCode: LanguageCode.en, value: 'Price includes tax' },
                { languageCode: LanguageCode.cs, value: 'Cena zahrnuje daň' },
            ],
        },
        taxRate: {
            type: 'float',
            defaultValue: 0,
            ui: { component: 'number-form-input', suffix: '%', min: 0 },
            label: [
                { languageCode: LanguageCode.en, value: 'Tax rate' },
                { languageCode: LanguageCode.cs, value: 'Sazba daně' },
            ],
        },
    },
    calculate: (ctx, order, args) => {
        return {
            price: args.rate,
            taxRate: args.taxRate,
            priceIncludesTax: getPriceIncludesTax(ctx, args.includesTax as any),
        };
    },
});

function getPriceIncludesTax(ctx: RequestContext, setting: TaxSetting): boolean {
    switch (setting) {
        case TaxSetting.auto:
            return ctx.channel.pricesIncludeTax;
        case TaxSetting.exclude:
            return false;
        case TaxSetting.include:
            return true;
    }
}
