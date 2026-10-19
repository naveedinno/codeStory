// One import site for the theme contract.
//
// `client/vendor/beui/lib/use-theme.ts` already implements codeStory's whole
// theme protocol — the `ds-theme` localStorage key, `data-theme` /
// `data-theme-mode` on <html>, `html.style.colorScheme`, the
// `meta[data-ds-theme-color]` tag, the `ds-theme-change` document event, and the
// cross-tab `storage` listener. `src/theme.ts` stays the canonical owner and its
// inline bootstrap performs the first write before paint.
//
// Do not reimplement any of that. Re-export it, so a surface never reaches into
// the vendored tree for theming and the next vendor refresh has one seam to fix.
export { useTheme } from "../vendor/beui/lib/use-theme";
export type { ThemeMode, ResolvedTheme, UseThemeResult } from "../vendor/beui/lib/use-theme";
