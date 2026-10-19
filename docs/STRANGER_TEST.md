# Stranger Test

Use this checklist before a public launch or after changing setup docs.

## Fresh Clone

On a machine or temp folder that has Node.js 20+ and git:

```sh
git clone https://github.com/naveedinno/codeStory.git
cd codeStory
npm install
npm run dev
```

Expected:

- the app prints a local URL, usually `http://localhost:7777/`
- opening the URL shows the workspace picker
- no Python, Kokoro, Claude, Codex, Homebrew, or API key is required

This is an internal development server check. End users install and open the
macOS app; there is no codeStory CLI.

## Demo Review

```sh
npm run demo
```

Expected:

- a throwaway demo repo is created under the system temp directory
- the app opens with a saved story available
- the reviewer can open the story, view the diff, and see seeded comments

## Package Check

```sh
npm run release:check
```

Expected:

- TypeScript build succeeds
- Node test suite passes
- npm pack dry-run lists `dist`, `skills`, `assets/brand`, `assets/demo`,
  `scripts/setup-kokoro.sh`, `README.md`, `LICENSE`, and `package.json`
