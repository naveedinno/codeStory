# Contributing to codeStory

Thanks for helping make diff review calmer and more useful.

## Local Setup

```sh
git clone https://github.com/naveedinno/codeStory.git
cd codeStory
npm install
npm run dev
```

The app opens at `http://localhost:7777/`. Core development only needs Node.js
20+ and git. Claude, Codex, Python, Kokoro, and Homebrew are optional.

## Before Opening a PR

Run the same check CI runs:

```sh
npm run check
```

For release/package changes, also run:

```sh
npm run release:check
```

`npm run check` rebuilds `dist/`, so commit generated `dist/` changes whenever
you change `src/`. GitHub installs of this project depend on the checked-in
build output.

With Lino installed, verify real video narration against an unreachable model
host. Set the model list to the English models downloaded in Lino:

```sh
CODESTORY_VIDEO_SMOKE_LINO=1 CODESTORY_VIDEO_SMOKE_OFFLINE=1 CODESTORY_VIDEO_SMOKE_LINO_MODELS=kokoro,pocket,voxcpm npm run test:video
```

## Development Notes

- Keep `.codestory/` local. Do not commit review sessions, comments, or generated
  story files unless a task explicitly asks for a shared example fixture.
- Prefer focused tests beside the behavior you change.
- Keep optional integrations optional. The plain diff viewer should keep working
  without AI agents or Kokoro voice setup.
- Use `npm run demo` when you want a realistic throwaway repo to review.

## Contribution License

By submitting a contribution, you agree that your contribution may be included
in codeStory under this repository's license, and you grant naveedinno the right
to use, modify, distribute, and commercially relicense your contribution as part
of codeStory.

## Good First Changes

- Improve onboarding text.
- Add focused tests around review workflows.
- Polish the demo repo/story.
- Improve error messages when optional tools are missing.
