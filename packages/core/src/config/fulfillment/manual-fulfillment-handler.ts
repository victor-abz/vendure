import { LanguageCode } from '@vendure/common/lib/generated-types';

import { FulfillmentHandler } from './fulfillment-handler';

export const manualFulfillmentHandler = new FulfillmentHandler({
    code: 'manual-fulfillment',
    description: [
        { languageCode: LanguageCode.en, value: 'Manually enter fulfillment details' },
        { languageCode: LanguageCode.cs, value: 'Ručně zadat detaily plnění' },
    ],
    args: {
        method: {
            type: 'string',
            required: false,
        },
        trackingCode: {
            type: 'string',
            required: false,
        },
    },
    createFulfillment: (ctx, orders, orderItems, args) => {
        return {
            method: args.method,
            trackingCode: args.trackingCode,
        };
    },
});
