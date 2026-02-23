import { dummyPaymentHandler, LanguageCode, mergeConfig } from '@vendure/core';
import {
    createTestEnvironment,
    testConfig as defaultTestConfig,
    registerInitializer,
    SqljsInitializer,
} from '@vendure/testing';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { VENDURE_PORT } from './constants.js';
import { initialData } from './fixtures/initial-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

/**
 * Compiles a TypeScript fixture with SWC so that NestJS parameter decorators
 * and emitDecoratorMetadata work correctly. Playwright's built-in transpiler
 * (esbuild/Babel) does not support these features.
 */
async function importWithSwc<T>(fixturePath: string): Promise<T> {
    const { transformFileSync } = await import('@swc/core');
    const { code } = transformFileSync(fixturePath, {
        jsc: {
            parser: { syntax: 'typescript', decorators: true },
            transform: { decoratorMetadata: true, useDefineForClassFields: false },
            target: 'es2017',
        },
        module: { type: 'es6' },
    });
    const outDir = path.join(__dirname, 'fixtures', '.compiled');
    const outFile = path.join(outDir, path.basename(fixturePath).replace(/\.ts$/, '.mjs'));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, code);
    return import(pathToFileURL(outFile).href) as Promise<T>;
}

export default async function globalSetup() {
    const { CustomHistoryEntryPlugin } = await importWithSwc<{
        CustomHistoryEntryPlugin: new () => unknown;
    }>(path.join(__dirname, 'fixtures', 'custom-history-entry-plugin.ts'));

    const config = mergeConfig(defaultTestConfig, {
        apiOptions: {
            port: VENDURE_PORT,
        },
        paymentOptions: {
            paymentMethodHandlers: [dummyPaymentHandler],
        },
        plugins: [CustomHistoryEntryPlugin],
        customFields: {
            Product: [
                // ── General tab (default) ──
                {
                    name: 'infoUrl',
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: 'Info URL' }],
                },
                {
                    name: 'weight',
                    type: 'float',
                    label: [{ languageCode: LanguageCode.en, value: 'Weight' }],
                },
                {
                    name: 'reviewRating',
                    type: 'int',
                    label: [{ languageCode: LanguageCode.en, value: 'Review Rating' }],
                },
                {
                    name: 'isDownloadable',
                    type: 'boolean',
                    label: [{ languageCode: LanguageCode.en, value: 'Downloadable' }],
                },
                {
                    name: 'releaseDate',
                    type: 'datetime',
                    label: [{ languageCode: LanguageCode.en, value: 'Release Date' }],
                },
                {
                    name: 'additionalInfo',
                    type: 'text',
                    label: [{ languageCode: LanguageCode.en, value: 'Additional Info' }],
                },
                {
                    name: 'priority',
                    type: 'string',
                    label: [{ languageCode: LanguageCode.en, value: 'Priority' }],
                    options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
                },
                // ── SEO tab ──
                {
                    name: 'seoTitle',
                    type: 'localeString',
                    label: [{ languageCode: LanguageCode.en, value: 'SEO Title' }],
                    ui: { tab: 'SEO' },
                },
                {
                    name: 'seoDescription',
                    type: 'localeText',
                    label: [{ languageCode: LanguageCode.en, value: 'SEO Description' }],
                    ui: { tab: 'SEO', fullWidth: true },
                },
                // ── Details tab ──
                {
                    name: 'detailNotes',
                    type: 'text',
                    label: [{ languageCode: LanguageCode.en, value: 'Detail Notes' }],
                    ui: { tab: 'Details', fullWidth: true },
                },
                // ── Lists tab ──
                {
                    name: 'tags',
                    type: 'string',
                    list: true,
                    label: [{ languageCode: LanguageCode.en, value: 'Tags' }],
                    ui: { tab: 'Lists' },
                },
                // ── Struct tab ──
                {
                    name: 'specifications',
                    type: 'struct',
                    label: [{ languageCode: LanguageCode.en, value: 'Specifications' }],
                    ui: { tab: 'Struct' },
                    fields: [
                        {
                            name: 'material',
                            type: 'string',
                            label: [{ languageCode: LanguageCode.en, value: 'Material' }],
                        },
                        {
                            name: 'height',
                            type: 'float',
                            label: [{ languageCode: LanguageCode.en, value: 'Height' }],
                        },
                        {
                            name: 'isRecyclable',
                            type: 'boolean',
                            label: [{ languageCode: LanguageCode.en, value: 'Recyclable' }],
                        },
                        {
                            name: 'certifications',
                            type: 'string',
                            list: true,
                            label: [{ languageCode: LanguageCode.en, value: 'Certifications' }],
                        },
                    ],
                },
                {
                    name: 'dimensions',
                    type: 'struct',
                    list: true,
                    label: [{ languageCode: LanguageCode.en, value: 'Dimensions' }],
                    ui: { tab: 'Struct' },
                    fields: [
                        {
                            name: 'dimensionName',
                            type: 'string',
                            label: [{ languageCode: LanguageCode.en, value: 'Dimension Name' }],
                        },
                        {
                            name: 'dimensionValue',
                            type: 'float',
                            label: [{ languageCode: LanguageCode.en, value: 'Dimension Value' }],
                        },
                        {
                            name: 'dimensionUnit',
                            type: 'string',
                            label: [{ languageCode: LanguageCode.en, value: 'Dimension Unit' }],
                        },
                    ],
                },
            ],
        },
    });

    // mergeConfig won't replace a boolean with an object, so set CORS explicitly.
    // The dashboard's fetch uses credentials: 'include', which requires the server
    // to reflect the request origin (not wildcard *) and set credentials: true.
    config.apiOptions.cors = {
        origin: true,
        credentials: true,
    };

    const { server } = createTestEnvironment(config);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-full.csv'),
        customerCount: 5,
    });
    (globalThis as any).__VENDURE_SERVER__ = server;
}
