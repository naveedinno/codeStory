# Runtime recheck

Repository Playwright capture workflow, isolated app home and temporary Git repositories. Desktop Chromium emulation; no physical-device or screen-reader claims. Root-font-200pct is font stress, not native browser zoom.

- screens/picker-1440-dark.png: 1440px, overflow 0px, codeStory — Pick a repository
- screens/stories-1440-dark.png: 1440px, overflow 0px, codeStory — Review history
- screens/change-1440-dark.png: 1440px, overflow 0px, codeStory — Choose review scope
- screens/review-1440-dark.png: 1440px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/explain-1440-dark.png: 1440px, overflow 0px, codeStory — Explain code
- screens/404-1440-dark.png: 1440px, overflow 0px, codeStory — Page not found
- screens/picker-1440-light.png: 1440px, overflow 0px, codeStory — Pick a repository
- screens/stories-1440-light.png: 1440px, overflow 0px, codeStory — Review history
- screens/change-1440-light.png: 1440px, overflow 0px, codeStory — Choose review scope
- screens/review-1440-light.png: 1440px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/explain-1440-light.png: 1440px, overflow 0px, codeStory — Explain code
- screens/404-1440-light.png: 1440px, overflow 0px, codeStory — Page not found
- screens/picker-375-dark.png: 375px, overflow 0px, codeStory — Pick a repository
- screens/stories-375-dark.png: 375px, overflow 0px, codeStory — Review history
- screens/change-375-dark.png: 375px, overflow 0px, codeStory — Choose review scope
- screens/review-375-dark.png: 375px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/explain-375-dark.png: 375px, overflow 0px, codeStory — Explain code
- screens/404-375-dark.png: 375px, overflow 0px, codeStory — Page not found
- screens/picker-375-light.png: 375px, overflow 0px, codeStory — Pick a repository
- screens/stories-375-light.png: 375px, overflow 0px, codeStory — Review history
- screens/change-375-light.png: 375px, overflow 0px, codeStory — Choose review scope
- screens/review-375-light.png: 375px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/explain-375-light.png: 375px, overflow 0px, codeStory — Explain code
- screens/404-375-light.png: 375px, overflow 0px, codeStory — Page not found
- screens/picker-320-dark.png: 320px, overflow 0px, codeStory — Pick a repository
- screens/stories-320-dark.png: 320px, overflow 0px, codeStory — Review history
- screens/change-320-dark.png: 320px, overflow 0px, codeStory — Choose review scope
- screens/review-320-dark.png: 320px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/explain-320-dark.png: 320px, overflow 0px, codeStory — Explain code
- screens/404-320-dark.png: 320px, overflow 0px, codeStory — Page not found
- screens/picker-320-light.png: 320px, overflow 0px, codeStory — Pick a repository
- screens/stories-320-light.png: 320px, overflow 0px, codeStory — Review history
- screens/change-320-light.png: 320px, overflow 0px, codeStory — Choose review scope
- screens/review-320-light.png: 320px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/explain-320-light.png: 320px, overflow 0px, codeStory — Explain code
- screens/404-320-light.png: 320px, overflow 0px, codeStory — Page not found
- screens/stress-long-repo-branch-375.png: 375px, overflow 0px, codeStory — Pick a repository
- screens/stress-long-basename-375.png: 375px, overflow 0px, codeStory — Choose review scope
- screens/stress-long-history-375.png: 375px, overflow 0px, codeStory — Review history
- screens/review-forced-colors-reduced-more-375.png: 375px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/review-root-font-200pct.png: 1440px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/change-invalid-ref-375.png: 375px, overflow 0px, codeStory — Choose review scope
- screens/change-container-650.png: 650px, overflow 0px, codeStory — Choose review scope
- screens/change-rtl-650.png: 650px, overflow 0px, codeStory — Choose review scope
- screens/explain-restored-draft.png: 1440px, overflow 0px, codeStory — Explain code
- screens/stress-42-steps-375.png: 375px, overflow 0px, codeStory — Diff annotations in one spending-limit review
- screens/stress-one-step-375.png: 375px, overflow 0px, codeStory — One boundary

Checks:
```json
[
  {
    "scenario": "review close reachable 320 dark",
    "bounds": {
      "x": 275,
      "y": 6,
      "width": 44,
      "height": 44
    },
    "inside": true
  },
  {
    "scenario": "review close reachable 320 light",
    "bounds": {
      "x": 275,
      "y": 6,
      "width": 44,
      "height": 44
    },
    "inside": true
  },
  {
    "scenario": "forced-colors/reduced-motion",
    "result": {
      "reduced": true,
      "forced": true,
      "contrast": true,
      "carets": [
        "0s",
        "0s"
      ]
    }
  },
  {
    "scenario": "unknown ref",
    "value": "unknown-ui-ref-for-recheck",
    "invalid": "true"
  },
  {
    "scenario": "valid Git expression",
    "url": "http://127.0.0.1:63906/repo/review-demo/change?scope=commit&commit=HEAD~1"
  },
  {
    "scenario": "Explain draft round trip",
    "restored": "How is the monthly cap checked?"
  },
  {
    "scenario": "42 steps",
    "nodes": 43
  },
  {
    "scenario": "one step",
    "nodes": 2
  }
]
```

Page errors:
```json
[]
```

## T3 preview supplement

Real desktop preview filmstrip clicks changed step 1 to 2, then 3, then back to 2. After settling, exactly one step was visible and the primer diagram reported ready. Recording: `recordings/step-reversal.mp4`. Captures: `screens/review-code-preview.png` and `screens/review-primer-preview.png`. Computed story-focus code-cell background image was `none`; the focus cue remains in the gutter. These observations establish coherent state changes, not frame-rate or subjective smoothness.
