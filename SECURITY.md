# Security and Privacy

codeStory is a local tool. It starts a Node.js server on your machine, reads the
git repository you choose, and writes review state into that repository's
`.codestory/` folder.

## Data Handling

- The core app does not require a hosted service, database, browser extension, or
  cloud account.
- Plain diff viewing stays local.
- Generated or repaired stories only run when you choose an installed agent
  such as Claude or Codex. Review comments are never sent by codeStory.
- Optional Kokoro voice setup creates a local Python environment under
  `~/.codestory/kokoro-venv`.

Review comments can contain code or private context. Keep `.codestory/` ignored
unless your team intentionally decides to share a story file.

## Reporting Security Issues

Please do not open a public issue for a sensitive vulnerability. Email the
maintainer listed in `package.json`, or use a private GitHub security advisory if
available.

Include:

- affected version or commit
- reproduction steps
- expected and actual behavior
- whether the issue requires optional agent or Kokoro setup
