import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDependencyCheck } from './dependency-check';

// Mock fs-extra
vi.mock('fs-extra', () => ({
    default: {
        existsSync: vi.fn(),
        readJsonSync: vi.fn(),
        readFileSync: vi.fn(),
        readdirSync: vi.fn(() => []),
    },
}));

// Mock node:module's createRequire (used by checkDbDriver)
vi.mock('node:module', () => ({
    createRequire: vi.fn(() => ({
        resolve: vi.fn(() => {
            throw new Error('Cannot find module');
        }),
    })),
}));

import fs from 'fs-extra';

describe('dependency-check', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns fail when node_modules does not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = await runDependencyCheck({ nodeModulesPath: '/fake/node_modules' });

        expect(result.status).toBe('fail');
        expect(result.message).toContain('node_modules not found');
    });

    it('returns pass when all @vendure/* packages are same version', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readJsonSync).mockReturnValue({ version: '3.6.3' });
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck({ nodeModulesPath: '/fake/node_modules' });

        expect(result.status).toBe('pass');
        expect(result.details?.some(d => d.includes('All @vendure/* packages at 3.6.3'))).toBe(true);
    });

    it('returns warn when @vendure/* patch versions are mismatched', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        let callCount = 0;
        vi.mocked(fs.readJsonSync).mockImplementation(() => {
            callCount++;
            if (callCount === 3) {
                return { version: '3.6.2' };
            }
            return { version: '3.6.3' };
        });

        const result = await runDependencyCheck({ nodeModulesPath: '/fake/node_modules' });

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('Mismatched') && d.includes('patch'))).toBe(true);
    });

    it('returns fail when @vendure/* minor versions are mismatched', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        let callCount = 0;
        vi.mocked(fs.readJsonSync).mockImplementation(() => {
            callCount++;
            if (callCount === 3) {
                return { version: '3.7.0' };
            }
            return { version: '3.6.3' };
        });

        const result = await runDependencyCheck({ nodeModulesPath: '/fake/node_modules' });

        expect(result.status).toBe('fail');
        expect(result.details?.some(d => d.includes('Mismatched') && d.includes('minor/major'))).toBe(true);
    });

    it('detects duplicate singleton packages', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr === '/fake/node_modules') return true;
            if (pathStr.includes('@vendure')) return true;
            if (pathStr === '/fake/node_modules/graphql/package.json') return true;
            if (pathStr.includes('msw/node_modules/graphql/package.json')) return true;
            return false;
        });
        vi.mocked(fs.readdirSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr === '/fake/node_modules') return ['msw'] as any;
            return [];
        });
        vi.mocked(fs.readJsonSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr === '/fake/node_modules/graphql/package.json') {
                return { version: '16.11.0' };
            }
            if (pathStr.includes('msw/node_modules/graphql/package.json')) {
                return { version: '16.14.0' };
            }
            return { version: '3.6.3' };
        });
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck({ nodeModulesPath: '/fake/node_modules' });

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('Multiple graphql versions'))).toBe(true);
    });

    it('returns pass with no duplicate singleton dependencies', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readJsonSync).mockReturnValue({ version: '3.6.3' });
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck({ nodeModulesPath: '/fake/node_modules' });

        expect(result.details?.some(d => d.includes('No duplicate singleton dependencies'))).toBe(true);
    });

    it('finds @vendure/* packages hoisted to monorepo root', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            // Local node_modules exists but has no @vendure packages
            if (pathStr === '/app/node_modules') return true;
            // Monorepo root node_modules exists
            if (pathStr === '/root/node_modules') return true;
            // @vendure packages only at root
            if (pathStr.startsWith('/root/node_modules/@vendure')) return true;
            return false;
        });
        vi.mocked(fs.readJsonSync).mockImplementation((p: any) => {
            const pathStr = String(p);
            if (pathStr.startsWith('/root/node_modules/@vendure')) {
                return { version: '3.7.2' };
            }
            return {};
        });
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = await runDependencyCheck({
            nodeModulesPath: '/app/node_modules',
            monorepoRoot: '/root',
        });

        expect(result.details?.some(d => d.includes('All @vendure/* packages at 3.7.2'))).toBe(true);
    });

    it('finds DB driver via require.resolve when hoisted', async () => {
        // Mock createRequire to return a resolver that finds the driver
        const { createRequire: mockCreateRequire } = await import('node:module');
        vi.mocked(mockCreateRequire).mockReturnValue({
            resolve: vi.fn().mockReturnValue('/root/node_modules/pg/package.json'),
        } as any);

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readJsonSync).mockImplementation((p: any) => {
            if (String(p) === '/root/node_modules/pg/package.json') {
                return { version: '8.20.0', name: 'pg' };
            }
            return { version: '3.7.2' };
        });
        vi.mocked(fs.readdirSync).mockReturnValue([]);
        // Config file with postgres type
        vi.mocked(fs.readFileSync).mockReturnValue(
            'dbConnectionOptions: { type: \'postgres\' }',
        );

        const result = await runDependencyCheck({ nodeModulesPath: '/app/node_modules' });

        expect(result.details?.some(d => d.includes('DB driver pg') && d.includes('8.20.0'))).toBe(true);
    });
});
