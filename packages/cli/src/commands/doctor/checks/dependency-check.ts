import fs from 'fs-extra';
import { createRequire } from 'node:module';
import path from 'node:path';

import { CheckResult } from '../types';

/**
 * Known @vendure/* packages that use fixed versioning.
 * These should all be at the same version when installed.
 *
 * TODO: Consider deriving this list dynamically from the monorepo
 * or from a published registry to avoid manual maintenance.
 */
const VENDURE_PACKAGES = [
    '@vendure/admin-ui',
    '@vendure/admin-ui-plugin',
    '@vendure/asset-server-plugin',
    '@vendure/cli',
    '@vendure/common',
    '@vendure/core',
    '@vendure/create',
    '@vendure/dashboard',
    '@vendure/email-plugin',
    '@vendure/graphiql-plugin',
    '@vendure/harden-plugin',
    '@vendure/job-queue-plugin',
    '@vendure/sentry-plugin',
    '@vendure/telemetry-plugin',
    '@vendure/testing',
    '@vendure/ui-devkit',
];

/**
 * Dependencies that must not be duplicated in node_modules.
 * Multiple installed versions of these cause runtime identity bugs.
 */
const SINGLETON_PACKAGES = [
    'graphql',
    'typeorm',
    '@nestjs/core',
    '@nestjs/common',
    '@nestjs/graphql',
    '@nestjs/typeorm',
    '@apollo/server',
];

/**
 * Maps dbConnectionOptions.type to the required npm package.
 */
const DB_DRIVER_MAP: Record<string, string> = {
    mysql: 'mysql2',
    mariadb: 'mysql2',
    postgres: 'pg',
    'better-sqlite3': 'better-sqlite3',
    sqlite: 'better-sqlite3',
    sqljs: 'sql.js',
};

export interface DependencyCheckOptions {
    /** Override the node_modules path (used in tests). */
    nodeModulesPath?: string;
    /** The monorepo workspace root, if detected by the project check. */
    monorepoRoot?: string;
}

/**
 * Runs dependency checks:
 * 1. Detects mismatched @vendure/* package versions
 * 2. Detects duplicate singleton dependencies
 * 3. Verifies the configured DB driver is installed
 *
 * In a monorepo, packages may be hoisted to the workspace root's node_modules.
 * When a monorepoRoot is provided, both the local and root node_modules are checked.
 */
export async function runDependencyCheck(options?: DependencyCheckOptions): Promise<CheckResult> {
    const cwd = process.cwd();
    const modulesDir = options?.nodeModulesPath ?? path.join(cwd, 'node_modules');
    const monorepoRoot = options?.monorepoRoot;
    const details: string[] = [];
    let worstStatus: 'pass' | 'warn' | 'fail' = 'pass';

    // Collect all node_modules directories to search (local + monorepo root)
    const modulesDirs = [modulesDir];
    if (monorepoRoot) {
        const rootModulesDir = path.join(monorepoRoot, 'node_modules');
        if (rootModulesDir !== modulesDir && fs.existsSync(rootModulesDir)) {
            modulesDirs.push(rootModulesDir);
        }
    }

    // At least one node_modules must exist
    if (!modulesDirs.some(dir => fs.existsSync(dir))) {
        return {
            name: 'Dependencies',
            status: 'fail',
            message: 'node_modules not found. Run your package manager install first.',
        };
    }

    // 1. Check @vendure/* version alignment
    const vendureVersions = getInstalledVendureVersions(modulesDirs);
    if (vendureVersions.size > 0) {
        const versions = new Set(vendureVersions.values());
        if (versions.size > 1) {
            const grouped = groupByVersion(vendureVersions);
            // Check if it's only a patch mismatch (e.g. 3.6.3 vs 3.6.2) or a
            // minor/major mismatch (e.g. 3.7.0 vs 3.6.3). Patch mismatches are
            // unlikely to cause issues; minor/major mismatches can break things.
            const majorMinors = new Set(
                [...versions].map(v => v.split('.').slice(0, 2).join('.')),
            );
            if (majorMinors.size > 1) {
                worstStatus = 'fail';
                details.push('Mismatched @vendure/* package versions (minor/major):');
            } else {
                if (worstStatus === 'pass') worstStatus = 'warn';
                details.push('Mismatched @vendure/* package versions (patch):');
            }
            for (const [version, pkgs] of grouped) {
                details.push(`  ${version}: ${pkgs.join(', ')}`);
            }
        } else {
            const version = [...versions][0];
            details.push(`All @vendure/* packages at ${version}`);
        }
    }

    // 2. Check for duplicate singleton dependencies
    // Duplicates are a warning rather than a failure because in monorepos,
    // nested copies (e.g. msw bundling its own graphql) may not actually
    // cause runtime issues for the Vendure application.
    const duplicates = findDuplicatePackages(modulesDirs, SINGLETON_PACKAGES);
    for (const [pkg, versions] of duplicates) {
        if (versions.length > 1) {
            if (worstStatus === 'pass') worstStatus = 'warn';
            details.push(`Multiple ${pkg} versions found: ${versions.join(', ')}`);
        }
    }
    if (duplicates.size === 0 || [...duplicates.values()].every(v => v.length <= 1)) {
        details.push('No duplicate singleton dependencies');
    }

    // 3. Check DB driver using Node's module resolution (handles hoisted packages)
    const dbDriverResult = checkDbDriver(cwd);
    if (dbDriverResult) {
        if (dbDriverResult.status === 'fail') {
            worstStatus = 'fail';
        } else if (dbDriverResult.status === 'warn' && worstStatus === 'pass') {
            worstStatus = 'warn';
        }
        details.push(dbDriverResult.message);
    }

    const message =
        worstStatus === 'pass'
            ? 'All dependency checks passed'
            : worstStatus === 'warn'
              ? 'Dependency warnings detected'
              : 'Dependency issues detected';

    return {
        name: 'Dependencies',
        status: worstStatus,
        message,
        details,
    };
}

/**
 * Reads installed @vendure/* package versions from node_modules.
 * Searches all provided node_modules directories (local + monorepo root).
 */
function getInstalledVendureVersions(modulesDirs: string[]): Map<string, string> {
    const versions = new Map<string, string>();

    for (const pkg of VENDURE_PACKAGES) {
        for (const modulesDir of modulesDirs) {
            const pkgJsonPath = path.join(modulesDir, pkg, 'package.json');
            const version = readPackageVersion(pkgJsonPath);
            if (version) {
                versions.set(pkg, version);
                break; // Use the first found (local takes precedence)
            }
        }
    }
    return versions;
}

/**
 * Finds duplicate installations of packages by scanning nested node_modules.
 * Searches all provided node_modules directories (local + monorepo root).
 * Returns a map of package name -> list of installed versions.
 */
function findDuplicatePackages(
    modulesDirs: string[],
    packages: string[],
): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const pkg of packages) {
        const versions = new Set<string>();

        for (const modulesDir of modulesDirs) {
            // Check this node_modules root
            const rootVersion = readPackageVersion(path.join(modulesDir, pkg, 'package.json'));
            if (rootVersion) {
                versions.add(rootVersion);
            }

            // Scan for nested copies
            const nestedVersions = findNestedPackageVersions(modulesDir, pkg);
            for (const v of nestedVersions) {
                versions.add(v);
            }
        }

        if (versions.size > 0) {
            result.set(pkg, [...versions].sort((a, b) => a.localeCompare(b)));
        }
    }

    return result;
}

/**
 * Scans nested node_modules directories for additional installations of a package.
 * Checks up to 2 levels deep to catch common duplication patterns.
 */
function findNestedPackageVersions(modulesDir: string, targetPkg: string): string[] {
    const versions: string[] = [];

    let entries: string[];
    try {
        entries = fs.readdirSync(modulesDir);
    } catch {
        return versions;
    }

    for (const entry of entries) {
        // Skip the target package itself and hidden directories (.pnpm, .cache, etc.).
        // pnpm's content-addressable store (.pnpm) doesn't need direct scanning because
        // pnpm symlinks packages into standard node_modules locations, and Node's fs
        // operations follow symlinks transparently. Scanning .pnpm directly would produce
        // false positives since every package appears there by design.
        if (entry === targetPkg || entry.startsWith('.')) continue;

        const entryPath = path.join(modulesDir, entry);

        if (entry.startsWith('@')) {
            // Scoped packages: check @scope/pkg/node_modules/<target>
            let scopedEntries: string[];
            try {
                scopedEntries = fs.readdirSync(entryPath);
            } catch {
                continue;
            }
            for (const scopedEntry of scopedEntries) {
                const nestedModules = path.join(entryPath, scopedEntry, 'node_modules');
                const nestedPkgJson = path.join(nestedModules, targetPkg, 'package.json');
                const version = readPackageVersion(nestedPkgJson);
                if (version) {
                    versions.push(version);
                }
            }
        } else {
            // Regular packages: check pkg/node_modules/<target>
            const nestedModules = path.join(entryPath, 'node_modules');
            const nestedPkgJson = path.join(nestedModules, targetPkg, 'package.json');
            const version = readPackageVersion(nestedPkgJson);
            if (version) {
                versions.push(version);
            }
        }
    }

    return versions;
}

/**
 * Reads the version field from a package.json file.
 * Returns undefined if the file doesn't exist or can't be parsed.
 */
function readPackageVersion(pkgJsonPath: string): string | undefined {
    try {
        if (!fs.existsSync(pkgJsonPath)) return undefined;
        const pkg = fs.readJsonSync(pkgJsonPath);
        return pkg.version;
    } catch {
        return undefined;
    }
}

/**
 * Groups packages by their version for readable output.
 */
function groupByVersion(packages: Map<string, string>): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const [pkg, version] of packages) {
        const existing = grouped.get(version) ?? [];
        existing.push(pkg);
        grouped.set(version, existing);
    }
    return grouped;
}

/**
 * Checks if the correct database driver package is installed for the configured DB type.
 * Uses Node's module resolution (require.resolve) so hoisted packages in monorepo
 * workspaces are found correctly -- matching the way Node resolves them at runtime.
 */
function checkDbDriver(
    cwd: string,
): { status: 'pass' | 'warn' | 'fail'; message: string } | null {
    const dbType = detectDbTypeFromSource(cwd);
    if (!dbType) {
        return null;
    }

    const driverPkg = DB_DRIVER_MAP[dbType];
    if (!driverPkg) {
        return {
            status: 'warn',
            message: `Unknown database type: ${dbType}`,
        };
    }

    // Use require.resolve with the cwd as the resolution base.
    // This follows Node's module resolution algorithm, walking up
    // ancestor node_modules directories -- correctly finding packages
    // hoisted to a workspace root.
    const localRequire = createRequire(path.join(cwd, 'package.json'));
    let version: string | undefined;

    // First try resolving the package.json directly (works for most packages).
    // Some packages (e.g. mysql2 3.x) omit ./package.json from their exports
    // map, causing ERR_PACKAGE_PATH_NOT_EXPORTED. In that case, fall back to
    // resolving the main entry point and walking up to the package directory.
    try {
        const resolvedPath = localRequire.resolve(`${driverPkg}/package.json`);
        version = readPackageVersion(resolvedPath);
    } catch {
        try {
            const entryPath = localRequire.resolve(driverPkg);
            // Walk up from the resolved entry to find the package.json
            let dir = path.dirname(entryPath);
            const root = path.parse(dir).root;
            while (dir !== root) {
                const pkgJsonPath = path.join(dir, 'package.json');
                if (fs.existsSync(pkgJsonPath)) {
                    const pkg = fs.readJsonSync(pkgJsonPath);
                    if (pkg.name === driverPkg) {
                        version = pkg.version;
                        break;
                    }
                }
                dir = path.dirname(dir);
            }
        } catch {
            return {
                status: 'fail',
                message: `DB driver "${driverPkg}" not installed (required for dbConnectionOptions.type: "${dbType}")`,
            };
        }
    }

    return {
        status: 'pass',
        message: `DB driver ${driverPkg}${version ? ` (${version})` : ''} installed for type "${dbType}"`,
    };
}

/**
 * Attempts to detect the database type by scanning source files for
 * dbConnectionOptions configuration. This is a lightweight text-based scan
 * that avoids importing the config (which requires ts-node setup).
 */
function detectDbTypeFromSource(cwd: string): string | undefined {
    const candidates = [
        'vendure-config.ts',
        'src/vendure-config.ts',
        'vendure-config.js',
        'src/vendure-config.js',
        'dev-config.ts',
        'src/dev-config.ts',
    ];

    for (const candidate of candidates) {
        const filePath = path.join(cwd, candidate);
        if (!fs.existsSync(filePath)) continue;

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Match type within dbConnectionOptions block
            const dbBlockMatch = content.match(/dbConnectionOptions\s*[:{][\s\S]*?type\s*:\s*['"]([^'"]+)['"]/);
            if (dbBlockMatch) {
                return dbBlockMatch[1];
            }
        } catch {
            continue;
        }
    }

    return undefined;
}
