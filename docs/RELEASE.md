# Release Guide

Use this guide for public npm releases.

## Preflight

```sh
git status --short --branch
npm run release:check
```

Confirm:

- working tree is clean or contains only intended release changes
- tests pass
- npm pack dry-run includes the expected files
- `CHANGELOG.md` mentions the version being released

## Package

```sh
npm login
npm publish --access public
```

If npm requires 2FA, complete the prompt in your terminal. The package is build
material for the desktop app and must not expose a command-line executable.
After publishing, verify:

```sh
npm view @naveedinno/codestory version
npm pack --dry-run
./scripts/install-macos-app.sh
```

Open the installed codeStory app and confirm the workspace picker loads.

## Tag

```sh
git tag v0.1.0
git push origin v0.1.0
```

Use the actual package version for future tags.
