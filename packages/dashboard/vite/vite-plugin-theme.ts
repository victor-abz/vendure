import { brand, darkTheme, fontFamily, lightTheme } from '@vendure-io/design-tokens';
import { Plugin } from 'vite';

type ThemeColors = Record<string, string | undefined>;

export interface ThemeVariables {
    light?: ThemeColors;
    dark?: ThemeColors;
}

/**
 * Dashboard-specific tokens that extend the base design-tokens themes.
 * These are layered on top of `@vendure-io/design-tokens` `lightTheme`/`darkTheme`.
 */
const dashboardLightExtensions: ThemeColors = {
    'dev-mode': brand[400],
    'dev-mode-foreground': brand[950],
    brand: brand[500],
    'brand-lighter': brand[300],
    'brand-darker': brand[700],
    'font-sans': fontFamily.sans,
    'font-heading': fontFamily.heading,
    'font-body': fontFamily.body,
    'font-mono': fontFamily.mono,
};

const dashboardDarkExtensions: ThemeColors = {
    'dev-mode': brand[400],
    'dev-mode-foreground': brand[950],
    brand: brand[500],
    'brand-lighter': brand[50],
    'brand-darker': brand[700],
    'font-sans': fontFamily.sans,
    'font-heading': fontFamily.heading,
    'font-body': fontFamily.body,
    'font-mono': fontFamily.mono,
};

const defaultVariables: ThemeVariables = {
    light: { ...lightTheme, ...dashboardLightExtensions },
    dark: { ...darkTheme, ...dashboardDarkExtensions },
};

export type ThemeVariablesPluginOptions = {
    theme?: ThemeVariables;
};

export function themeVariablesPlugin(options: ThemeVariablesPluginOptions): Plugin {
    const virtualModuleId = 'virtual:admin-theme';
    const resolvedVirtualModuleId = `\0${virtualModuleId}`;

    return {
        name: 'vendure:admin-theme',
        enforce: 'pre', // This ensures our plugin runs before other CSS processors
        transform(code, id) {
            // Only transform CSS files
            if (!id.endsWith('styles.css')) {
                return null;
            }

            // Replace the @import 'virtual:admin-theme'; with our theme variables
            if (
                code.includes('@import "virtual:admin-theme";') ||
                code.includes("@import 'virtual:admin-theme';")
            ) {
                const lightOverrides = options.theme?.light || {};
                const darkOverrides = options.theme?.dark || {};

                // Merge default themes with custom themes
                const mergedLightTheme = { ...defaultVariables.light, ...lightOverrides };
                const mergedDarkTheme = { ...defaultVariables.dark, ...darkOverrides };

                const themeCSS = `
                    :root {
                        ${Object.entries(mergedLightTheme)
                            .filter(([key, value]) => value !== undefined)
                            .map(([key, value]) => `--${key}: ${value as string};`)
                            .join('\n')}
                    }

                    .dark {
                        ${Object.entries(mergedDarkTheme)
                            .filter(([key, value]) => value !== undefined)
                            .map(([key, value]) => `--${key}: ${value as string};`)
                            .join('\n')}
                    }
                `;

                return code.replace(/@import ['"]virtual:admin-theme['"];?/, themeCSS);
            }

            return null;
        },
    };
}
