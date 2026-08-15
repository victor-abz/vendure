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
});
