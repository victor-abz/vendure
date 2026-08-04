import type { VendureConfig } from '@vendure/core';
import fs from 'fs-extra';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import tsConfigPaths from 'tsconfig-paths';
import { RegisterParams } from 'tsconfig-paths/lib/register.js';
import * as ts from 'typescript';

import { Logger, PathAdapter, PluginInfo } from '../types.js';

import { findConfigExport } from './ast-utils.js';
import { resolvePathAliasImports, resolveSourceFile } from './import-resolution.js';
import { noopLogger } from './logger.js';
import { createPathTransformer } from './path-transformer.js';
import { discoverPlugins } from './plugin-discovery.js';
import { findTsConfigPaths } from './tsconfig-utils.js';

const defaultPathAdapter: Required<
    Pick<PathAdapter, 'getCompiledConfigPath' | 'transformTsConfigPathMappings'>
> = {
    getCompiledConfigPath: ({ outputPath, configFileName }) => path.join(outputPath, configFileName),
    transformTsConfigPathMappings: ({ patterns }) => patterns,
};

/** Minimal surface of `node:path` used by the path helpers, so tests can pass `path.win32`. */
type PathImpl = Pick<typeof path, 'relative' | 'resolve' | 'dirname' | 'isAbsolute' | 'sep'>;

/**
 * Whether `child` is `parent` itself or sits below it.
 *
 * Uses `path.relative` rather than comparing strings, so the platform's own
 * rules apply: on Windows that means case-insensitive matching and correct
 * handling of drive and UNC roots.
 */
function isWithin(parent: string, child: string, pathImpl: PathImpl = path): boolean {
    const relative = pathImpl.relative(parent, child);
    return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${pathImpl.sep}`) && !pathImpl.isAbsolute(relative))
    );
}

/**
 * Deepest directory containing all of the given paths, or `undefined` when they
 * share no common root, as with different Windows drives.
 *
 * Walks up from the first path until it contains the rest, which keeps the
 * platform's path semantics in `path.relative` instead of restating them here.
 *
 * `pathImpl` is injectable so the Windows behaviour can be covered from any
 * platform; production callers use the default.
 */
export function commonAncestorDir(dirs: string[], pathImpl: PathImpl = path): string | undefined {
    if (dirs.length === 0) {
        return undefined;
    }
    let ancestor = pathImpl.resolve(dirs[0]);
    for (const dir of dirs.slice(1)) {
        const target = pathImpl.resolve(dir);
        while (!isWithin(ancestor, target, pathImpl)) {
            const parent = pathImpl.dirname(ancestor);
            if (parent === ancestor) {
                // Reached the root without containing `target`.
                return undefined;
            }
            ancestor = parent;
        }
    }
    return ancestor;
}

export interface PackageScannerConfig {
    nodeModulesRoot?: string;
}

export interface CompilerOptions {
    vendureConfigPath: string;
    outputPath: string;
    pathAdapter?: PathAdapter;
    logger?: Logger;
    pluginPackageScanner?: PackageScannerConfig;
    module?: 'commonjs' | 'esm';
}

export interface CompileResult {
    vendureConfig: VendureConfig;
    exportedSymbolName: string;
    pluginInfo: PluginInfo[];
}

const compileLocks = new Map<string, Promise<void>>();
let packageJsonWriteId = 0;

/**
 * Compiles TypeScript files and discovers Vendure plugins in both the compiled output
 * and in node_modules.
 */
export async function compile(options: CompilerOptions): Promise<CompileResult> {
    return withCompileLock(path.resolve(options.outputPath), () => compileInternal(options));
}

async function withCompileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Serialize every compile for the same output path; callers that need
    // last-one-wins behavior should debounce before calling compile().
    const previous = compileLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
        release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);

    compileLocks.set(key, queued);
    await previous.catch(() => undefined);

    try {
        return await fn();
    } finally {
        release();
        if (compileLocks.get(key) === queued) {
            compileLocks.delete(key);
        }
    }
}

async function compileInternal(options: CompilerOptions): Promise<CompileResult> {
    const { vendureConfigPath, outputPath, pathAdapter, logger = noopLogger, pluginPackageScanner } = options;
    const getCompiledConfigPath =
        pathAdapter?.getCompiledConfigPath ?? defaultPathAdapter.getCompiledConfigPath;
    const transformTsConfigPathMappings =
        pathAdapter?.transformTsConfigPathMappings ?? defaultPathAdapter.transformTsConfigPathMappings;

    // 0. Clear the outputPath
    fs.removeSync(outputPath);

    // 1. Compile TypeScript files
    const compileStart = Date.now();
    const { sourceRoot } = await compileTypeScript({
        inputPath: vendureConfigPath,
        outputPath,
        logger,
        module: options.module ?? 'commonjs',
        sourceRoot: pathAdapter?.sourceRoot,
    });
    logger.info(`TypeScript compilation completed in ${Date.now() - compileStart}ms`);

    // 2. Discover plugins
    const analyzePluginsStart = Date.now();
    const plugins = await discoverPlugins({
        vendureConfigPath,
        transformTsConfigPathMappings,
        logger,
        outputPath,
        pluginPackageScanner,
    });
    logger.info(
        `Analyzed plugins and found ${plugins.length} dashboard extensions in ${Date.now() - analyzePluginsStart}ms`,
    );

    // 3. Load the compiled config
    // Note: configFileName is kept as the basename to preserve the public API contract.
    // Custom pathAdapter implementations (e.g. in monorepos) rely on this being just
    // the filename, not a relative path — they hardcode the directory structure themselves.
    const configFileName = path.basename(vendureConfigPath);
    // A custom adapter owns its own layout, so it keeps deciding where the config
    // is. The default follows the emit: that is the config's path relative to the
    // resolved source root, which is the bare filename unless the root widened to
    // keep an upward import inside outputPath.
    const compiledConfigPath = pathAdapter?.getCompiledConfigPath
        ? pathAdapter.getCompiledConfigPath({
              inputRootDir: path.dirname(vendureConfigPath),
              outputPath,
              configFileName,
          })
        : path.join(outputPath, path.relative(sourceRoot, vendureConfigPath));
    const compiledConfigFilePath = pathToFileURL(compiledConfigPath).href.replace(/\.ts$/, '.js');

    await writePackageJson(outputPath, options.module);

    // Find the exported config symbol
    const sourceFile = ts.createSourceFile(
        vendureConfigPath,
        await fs.readFile(vendureConfigPath, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const exportedSymbolName = findConfigExport(sourceFile);
    if (!exportedSymbolName) {
        throw new Error(
            `Could not find a variable exported as VendureConfig. Please specify the name of the exported variable.`,
        );
    }

    const loadConfigStart = Date.now();

    await registerTsConfigPaths({
        outputPath,
        configPath: vendureConfigPath,
        logger,
        phase: 'loading',
        transformTsConfigPathMappings,
    });

    let config: any;
    try {
        config = await import(compiledConfigFilePath).then(m => m[exportedSymbolName]);
    } catch (e: any) {
        const errorMessage =
            e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : JSON.stringify(e, null, 2);
        logger.error(`Error loading config: ${errorMessage}`);
    }
    if (!config) {
        throw new Error(
            `Could not find a variable exported as VendureConfig with the name "${exportedSymbolName}".`,
        );
    }
    logger.debug(`Loaded config in ${Date.now() - loadConfigStart}ms`);

    return { vendureConfig: config, exportedSymbolName, pluginInfo: plugins };
}

async function writePackageJson(outputPath: string, module?: 'commonjs' | 'esm'): Promise<void> {
    const packageJsonPath = path.join(outputPath, 'package.json');
    const tempPackageJsonPath = path.join(
        outputPath,
        `.package-${process.pid}-${Date.now()}-${packageJsonWriteId++}.json`,
    );

    await fs.writeFile(
        tempPackageJsonPath,
        JSON.stringify({ type: module === 'esm' ? 'module' : 'commonjs', private: true }, null, 2),
    );
    await fs.rename(tempPackageJsonPath, packageJsonPath);
}

/**
 * Compiles TypeScript files to JavaScript using per-file transpilation.
 *
 * Instead of using `ts.createProgram()` (which resolves all imports including
 * node_modules type definitions and can OOM on projects with heavy dependencies),
 * this function:
 * 1. Walks the import tree via lightweight AST parsing to find all local source files
 * 2. Transpiles each file individually with `ts.transpileModule()` (no type resolution)
 *
 * This avoids loading massive `.d.ts` files from packages like `openai`, `ai`, etc.
 * See: https://github.com/vendurehq/vendure/issues/4559
 */
async function compileTypeScript({
    inputPath,
    outputPath,
    logger,
    module,
    sourceRoot: customSourceRoot,
}: {
    inputPath: string;
    outputPath: string;
    logger: Logger;
    module: 'commonjs' | 'esm';
    sourceRoot?: string;
}): Promise<{ sourceRoot: string }> {
    await fs.ensureDir(outputPath);

    // Find tsconfig paths for resolving path aliases in the import tree
    const originalTsConfigInfo = await findTsConfigPaths(
        inputPath,
        logger,
        'compiling',
        ({ patterns }) => patterns, // No transformation - use original paths
    );

    logger.debug(`tsConfig paths: ${JSON.stringify(originalTsConfigInfo?.paths, null, 2)}`);
    logger.debug(`tsConfig baseUrl: ${originalTsConfigInfo?.baseUrl ?? 'UNKNOWN'}`);

    // 1. Collect all local source files by walking the import tree
    const collectStart = Date.now();
    const sourceFiles = await collectLocalSourceFiles(inputPath, originalTsConfigInfo);
    logger.debug(`Collected ${sourceFiles.length} source files in ${Date.now() - collectStart}ms`);

    // 2. Build path transformer for ESM mode
    // This is necessary because tsconfig-paths.register() only works for CommonJS require(),
    // not for ESM import(). We need to transform the import paths during transpilation.
    let pathTransformer: ts.TransformerFactory<ts.SourceFile> | undefined;
    if (module === 'esm' && originalTsConfigInfo) {
        logger.debug('Adding path transformer for ESM mode');
        pathTransformer = createPathTransformer({
            baseUrl: originalTsConfigInfo.baseUrl,
            paths: originalTsConfigInfo.paths,
        });
    }

    // 3. Determine the source root for computing output directory structure.
    // Compiled files preserve their directory structure relative to this root.
    // In monorepos, set pathAdapter.sourceRoot to the workspace root so that
    // e.g. apps/server/src/config.ts → {output}/apps/server/src/config.js.
    //
    // The default is the deepest directory containing the config and every file
    // it imports. For a config whose imports all sit alongside or below it, that
    // is exactly its own directory, so the layout is unchanged. It only widens
    // when a collected file lives above the config — otherwise `path.relative`
    // below would produce a leading `..` and emit that file outside outputPath,
    // past the package.json written to mark the output's module type.
    const configDir = path.dirname(inputPath);
    let sourceRoot = customSourceRoot;
    if (!sourceRoot) {
        const resolvedRoot = commonAncestorDir([configDir, ...sourceFiles.map(file => path.dirname(file))]);
        if (!resolvedRoot) {
            // Only reachable when the files span roots that share no ancestor,
            // such as two Windows drives. Falling back to the config directory
            // would guarantee an escape and report it as one, which says nothing
            // about the actual cause.
            throw new Error(
                `The Vendure config and the files it imports span multiple filesystem roots, so no common source root exists. ` +
                    `Set pathAdapter.sourceRoot to the directory the compiled output should be relative to.`,
            );
        }
        sourceRoot = resolvedRoot;
    }

    // 4. Transpile each file individually
    // Note: emitDecoratorMetadata with transpileModule emits `Object` for all
    // imported types since there is no type resolver. This is acceptable because
    // the compiled output is only used for config loading and plugin discovery,
    // not for runtime dependency injection.
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: module === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
    };
    const transformers: ts.CustomTransformers | undefined = pathTransformer
        ? { after: [pathTransformer] }
        : undefined;

    for (const filePath of sourceFiles) {
        const content = await fs.readFile(filePath, 'utf-8');
        const result = ts.transpileModule(content, {
            compilerOptions,
            fileName: filePath,
            transformers,
        });

        // Compute output path preserving directory structure relative to source root
        const relativePath = path.relative(sourceRoot, filePath);
        const outputFilePath = path.join(outputPath, relativePath).replace(/\.tsx?$/, '.js');

        // An emit outside outputPath escapes the package.json written there to
        // declare the module type, and Node then resolves the file against the
        // enclosing project instead. Fail here rather than at config load, where
        // it surfaces as an unrelated "exports is not defined" error.
        assertWithinOutputPath(outputFilePath, outputPath, filePath);

        await fs.ensureDir(path.dirname(outputFilePath));
        await fs.writeFile(outputFilePath, result.outputText);
    }

    return { sourceRoot };
}

function assertWithinOutputPath(outputFilePath: string, outputPath: string, sourceFile: string): void {
    const relativeToOutput = path.relative(outputPath, outputFilePath);
    // Compare against a path segment rather than a `..` prefix, so a file whose
    // own name begins with dots is not mistaken for an escape.
    const escapes =
        relativeToOutput === '..' ||
        relativeToOutput.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToOutput);
    if (escapes) {
        throw new Error(
            `Compiling "${sourceFile}" would emit to "${outputFilePath}", which is outside the output directory "${outputPath}". ` +
                `Set pathAdapter.sourceRoot to a directory containing every file the config imports.`,
        );
    }
}

/**
 * Collects all local source files reachable from the entry point by following
 * import/export declarations. Only follows local imports (relative paths and
 * tsconfig path aliases), not npm package imports.
 *
 * This is intentionally lightweight — it uses TypeScript's AST parser only
 * for reading import statements, without any module resolution or type loading.
 */
async function collectLocalSourceFiles(
    entryFile: string,
    tsConfigInfo?: { baseUrl: string; paths: Record<string, string[]> },
): Promise<string[]> {
    const visited = new Set<string>();

    async function processFile(filePath: string) {
        const resolved = await resolveSourceFile(filePath);
        if (!resolved) return;

        // Skip declaration files and non-source files before adding to visited,
        // so they don't leak into the returned sourceFiles array.
        if (resolved.endsWith('.d.ts') || resolved.endsWith('.d.tsx')) return;
        if (!/\.(ts|tsx|js|jsx)$/.test(resolved)) return;

        if (visited.has(resolved)) return;
        visited.add(resolved);

        const content = await fs.readFile(resolved, 'utf-8');
        const sf = ts.createSourceFile(resolved, content, ts.ScriptTarget.Latest, true);
        const dir = path.dirname(resolved);
        const importsToFollow: string[] = [];

        ts.forEachChild(sf, node => {
            if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
            const moduleSpecifier = node.moduleSpecifier;
            if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) return;
            const importPath = moduleSpecifier.text;

            // Follow local relative imports
            if (importPath.startsWith('.')) {
                importsToFollow.push(path.resolve(dir, importPath));
                return;
            }

            // Follow tsconfig path aliases (uses shared resolution logic)
            importsToFollow.push(...resolvePathAliasImports(importPath, tsConfigInfo));
            // npm package imports are intentionally skipped — they are resolved
            // at runtime via require() / import(), not during transpilation.
        });

        for (const imp of importsToFollow) {
            await processFile(imp);
        }
    }

    await processFile(entryFile);
    return [...visited];
}

async function registerTsConfigPaths(options: {
    outputPath: string;
    configPath: string;
    logger: Logger;
    phase: 'compiling' | 'loading';
    transformTsConfigPathMappings: Required<PathAdapter>['transformTsConfigPathMappings'];
}) {
    const { outputPath, configPath, logger, phase, transformTsConfigPathMappings } = options;
    const tsConfigInfo = await findTsConfigPaths(configPath, logger, phase, transformTsConfigPathMappings);
    if (tsConfigInfo) {
        const params: RegisterParams = {
            baseUrl: outputPath,
            paths: tsConfigInfo.paths,
        };
        logger.debug(`Registering tsconfig paths: ${JSON.stringify(params, null, 2)}`);
        tsConfigPaths.register(params);
    }
}
