import fs from 'fs-extra';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path, { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';

import { commonAncestorDir, compile } from '../utils/compiler.js';

// #5086 — the source root defaulted to the config's own directory, so a config
// importing from above it produced a relative path with a leading `..` and the
// compiled file was written outside outputPath, past the package.json the
// compiler writes there to declare the module type.

const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    error: () => undefined,
};

function listFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    const files: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(entryPath);
            } else {
                files.push(path.relative(dir, entryPath).split(path.sep).join('/'));
            }
        }
    };
    walk(dir);
    return files.sort();
}

async function createProject(imported: 'above' | 'below') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-'));
    const importPath = imported === 'above' ? '../shared/util.js' : './lib/util.js';
    const utilPath =
        imported === 'above'
            ? path.join(root, 'shared', 'util.ts')
            : path.join(root, 'src', 'lib', 'util.ts');

    await fs.outputFile(utilPath, 'export const hostname = "shop.example.com";\n');
    await fs.outputFile(
        path.join(root, 'src', 'vendure-config.ts'),
        [
            `import type { VendureConfig } from '@vendure/core';`,
            `import { hostname } from '${importPath}';`,
            `export const config: VendureConfig = { apiOptions: { port: 3000, hostname } } as any;`,
        ].join('\n'),
    );

    return { root, configPath: path.join(root, 'src', 'vendure-config.ts') };
}

async function compileProject(configPath: string, sourceRoot?: string) {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-out-'));
    // Nested, as in production: <tempCompilationDir>/compiler/<id>
    const outputPath = path.join(outputRoot, 'compiler', randomUUID());

    const result = await compile({
        vendureConfigPath: configPath,
        outputPath,
        logger: silentLogger,
        ...(sourceRoot ? { pathAdapter: { sourceRoot } } : {}),
    });

    return { outputRoot, outputPath, result };
}

describe('commonAncestorDir', () => {
    it('returns the deepest shared directory', () => {
        expect(commonAncestorDir(['/projects/shop/src', '/projects/shop/shared'], posix)).toBe(
            '/projects/shop',
        );
    });

    it('returns the filesystem root when that is all the paths share', () => {
        expect(commonAncestorDir(['/alpha', '/beta'], posix)).toBe('/');
    });

    it('returns undefined for an empty list', () => {
        expect(commonAncestorDir([])).toBeUndefined();
    });

    // Windows path casing is not stable in practice: process.cwd(), a resolved
    // relative import and a tsconfig path alias can each report a different
    // drive letter or segment casing for the same directory. Passing win32
    // explicitly keeps these covered when the suite runs on Linux.
    describe('with Windows paths', () => {
        it('ignores drive letter casing', () => {
            expect(commonAncestorDir(['C:\\repo\\app\\src', 'c:\\repo\\shared'], win32)).toBe('C:\\repo');
        });

        it('ignores segment casing rather than widening to the drive root', () => {
            expect(commonAncestorDir(['C:\\Repo\\app\\src', 'C:\\repo\\shared'], win32)).toBe('C:\\Repo');
        });

        it('returns the drive root when that is all the paths share', () => {
            expect(commonAncestorDir(['C:\\alpha', 'C:\\beta'], win32)).toBe('C:\\');
        });

        it('returns undefined across different drives', () => {
            expect(commonAncestorDir(['C:\\a', 'D:\\b'], win32)).toBeUndefined();
        });
    });
});

describe('#5086 compiler source root', () => {
    it('keeps a config importing from above its directory inside outputPath', async () => {
        const { root, configPath } = await createProject('above');
        const { outputRoot, outputPath, result } = await compileProject(configPath);

        // The emitted files sit under outputPath, and the config nests to match
        // the layout, so nothing lands beside the package.json guard.
        expect(listFiles(outputPath)).toEqual(['package.json', 'shared/util.js', 'src/vendure-config.js']);
        expect(listFiles(path.dirname(outputPath))).toEqual(
            listFiles(outputPath).map(file => `${path.basename(outputPath)}/${file}`),
        );
        // Reaching a loaded config proves the compiled path followed the emit
        // layout rather than assuming the output root.
        expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');

        await fs.remove(outputRoot);
        await fs.remove(root);
    }, 120_000);

    it('leaves the layout unchanged when every import is at or below the config', async () => {
        const { root, configPath } = await createProject('below');
        const { outputRoot, outputPath, result } = await compileProject(configPath);

        expect(listFiles(outputPath)).toEqual(['lib/util.js', 'package.json', 'vendure-config.js']);
        expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');

        await fs.remove(outputRoot);
        await fs.remove(root);
    }, 120_000);

    it('still honours an explicit pathAdapter.sourceRoot', async () => {
        const { root, configPath } = await createProject('above');
        const { outputRoot, outputPath, result } = await compileProject(configPath, root);

        expect(listFiles(outputPath)).toEqual(['package.json', 'shared/util.js', 'src/vendure-config.js']);
        expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');

        await fs.remove(outputRoot);
        await fs.remove(root);
    }, 120_000);

    it('does not mistake a leading-dot filename for an escape', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-'));
        await fs.outputFile(
            path.join(root, 'src', '..util.ts'),
            'export const hostname = "shop.example.com";\n',
        );
        await fs.outputFile(
            path.join(root, 'src', 'vendure-config.ts'),
            [
                `import type { VendureConfig } from '@vendure/core';`,
                `import { hostname } from './..util.js';`,
                `export const config: VendureConfig = { apiOptions: { port: 3000, hostname } } as any;`,
            ].join('\n'),
        );

        const { outputRoot, outputPath, result } = await compileProject(
            path.join(root, 'src', 'vendure-config.ts'),
        );

        expect(listFiles(outputPath)).toContain('..util.js');
        expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');

        await fs.remove(outputRoot);
        await fs.remove(root);
    }, 120_000);

    it('fails with a clear error when an explicit sourceRoot excludes an imported file', async () => {
        const { root, configPath } = await createProject('above');
        const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-out-'));
        const outputPath = path.join(outputRoot, 'compiler', randomUUID());

        await expect(
            compile({
                vendureConfigPath: configPath,
                outputPath,
                logger: silentLogger,
                pathAdapter: { sourceRoot: path.join(root, 'src') },
            }),
        ).rejects.toThrow(/outside the output directory/);

        await fs.remove(outputRoot);
        await fs.remove(root);
    }, 120_000);
});
