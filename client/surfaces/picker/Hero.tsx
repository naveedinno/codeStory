// The picker masthead: brand lock, kicker, and the theme control.
//
// The Thread Path backdrop is absolutely positioned behind everything at z-0,
// and the two pieces of chrome sit on solid `--bg` plates so the thread reads as
// passing *behind* the labels rather than striking through them. Below 480px the
// thread is hidden outright — at that width it only crosses the wordmark.

import { BrandMark, ThreadBackdrop } from "../../shared/brand";
import { EditorMenu } from "../../shared/editor-menu";
import { ThemeMenu } from "../../shared/theme-menu";

export function Hero() {
  return (
    <section className="ds-reveal ds-reveal-1 relative mb-6 flex min-h-[168px] items-center overflow-visible border-b border-line-soft pt-6 pb-[26px] max-[760px]:mb-5 max-[760px]:min-h-[128px] max-[760px]:pt-3.5 max-[760px]:pb-5 max-[480px]:min-h-0 max-[480px]:pt-1.5 max-[480px]:pb-4">
      <ThreadBackdrop className="pointer-events-none absolute inset-0 z-0 h-full w-full [clip-path:inset(35%_0_30%_0)] max-[480px]:hidden" />

      <div className="relative z-[1] -ms-3.5 flex flex-none items-center gap-3.5 rounded-[var(--radius-lg)] bg-bg py-2.5 pe-4 ps-3.5">
        <span className="flex flex-none items-center justify-center" aria-hidden="true">
          <BrandMark
            className="block [--ds-brand-node-a:var(--text)] [--ds-brand-node-b:var(--accent-hi)] [--ds-brand-node-c:var(--text)] [--ds-brand-path:var(--accent)] max-[480px]:h-7 max-[480px]:w-7"
            size={34}
          />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="m-0 font-display text-2xl leading-none font-medium tracking-[-.03em]">
            <span className="font-medium text-text-2">code</span>
            <span className="font-bold text-text">Story</span>
          </span>
          <span className="font-mono text-xs tracking-[var(--tracking-kicker)] text-accent-text uppercase max-[400px]:hidden">
            the story of this change
          </span>
        </span>
      </div>

      <div className="relative z-[1] ms-auto flex items-center gap-2 rounded-[var(--radius-lg)] bg-bg shadow-[0_0_0_6px_var(--bg)]">
        <EditorMenu />
        <ThemeMenu />
      </div>
    </section>
  );
}
