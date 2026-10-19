// Command-line entry for the bundled story checker. See story-check.ts.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatLedger, formatReport, reportReady, runStoryCheck, storyLedger, unownedFiles, } from "./story-check.js";
const HELP = `Usage: node check-story.mjs [story.json ...] [options]

Checks a diffStory story against the app's own contract, the real git diff,
and the storyteller's prose lints. Run it from inside the repository.

  (no story)        check .diffstory/story.json, or every .diffstory/stories/*.json
  <story.json ...>  check these files; a code story (.diffstory/stories/code-*.json) is
                    checked against its pinned commit instead of a diff
  --ledger          print the changed ranges a story must claim, with enclosing scopes
  --base <ref>      ledger only: diff base (default: the repository's review base)
  --head <ref>      ledger only: fixed head (default: working tree)
  --include <glob>  ledger only: limit to matching files (repeatable)
  --repo <dir>      repository root (default: git root of the current directory)
  --json            machine-readable output
  --strict          warnings also fail the check
  -h, --help        show this help

Ledger includes/excludes default to includeGlobs/excludeGlobs from
.diffstory/preferences.json when that file exists.

Exit status: 0 ready, 1 not ready, 2 usage or setup error.`;
function parseArgs(argv) {
    const args = { stories: [], ledger: false, include: [], json: false, strict: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined || v.startsWith("--"))
                throw new Error(`${a} needs a value`);
            return v;
        };
        try {
            if (a === "-h" || a === "--help")
                args.help = true;
            else if (a === "--ledger")
                args.ledger = true;
            else if (a === "--json")
                args.json = true;
            else if (a === "--strict")
                args.strict = true;
            else if (a === "--base")
                args.base = value();
            else if (a === "--head")
                args.head = value();
            else if (a === "--include")
                args.include.push(value());
            else if (a === "--repo")
                args.repo = value();
            else if (a.startsWith("-"))
                return `unknown option: ${a}`;
            else
                args.stories.push(a);
        }
        catch (error) {
            return error.message;
        }
    }
    return args;
}
function gitRoot(cwd) {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    }
    catch {
        return null;
    }
}
function readPreferences(repo) {
    const path = join(repo, ".diffstory", "preferences.json");
    if (!existsSync(path))
        return {};
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch (error) {
        console.error(`check-story: ignoring unreadable .diffstory/preferences.json (${error.message})`);
        return {};
    }
}
function defaultStories(repo) {
    const single = join(repo, ".diffstory", "story.json");
    if (existsSync(single))
        return [single];
    const dir = join(repo, ".diffstory", "stories");
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => join(dir, name));
}
function main(argv) {
    const args = parseArgs(argv);
    if (typeof args === "string") {
        console.error(`check-story: ${args}\n\n${HELP}`);
        return 2;
    }
    if (args.help) {
        console.log(HELP);
        return 0;
    }
    const repo = args.repo ? resolve(args.repo) : gitRoot(process.cwd());
    if (!repo) {
        console.error("check-story: not inside a git repository (use --repo <dir>)");
        return 2;
    }
    const prefs = readPreferences(repo);
    if (args.ledger) {
        const ledger = storyLedger(repo, {
            base: args.base,
            head: args.head,
            include: args.include.length ? args.include : prefs.includeGlobs ?? [],
            exclude: prefs.excludeGlobs ?? [],
        });
        console.log(args.json ? JSON.stringify(ledger, null, 2) : formatLedger(ledger));
        return 0;
    }
    const stories = args.stories.length ? args.stories.map((p) => resolve(p)) : defaultStories(repo);
    if (!stories.length) {
        console.error("check-story: no story found. Write .diffstory/story.json (or .diffstory/stories/<slug>.json) first.");
        return 2;
    }
    const reports = stories.map((path) => runStoryCheck(repo, path));
    // Ownership splits one diff between scoped stories; a code story owns no diff.
    const diffReports = reports.filter((r) => r.subject !== "code");
    const tours = diffReports.flatMap((r) => (r.tour ? [r.tour] : []));
    const unowned = diffReports.length > 1 && tours.length === diffReports.length ? unownedFiles(repo, tours) : [];
    const ready = reports.every((r) => reportReady(r, args.strict)) && unowned.length === 0;
    if (args.json) {
        console.log(JSON.stringify({ ready, unownedFiles: unowned, reports: reports.map(({ tour: _tour, ...rest }) => rest) }, null, 2));
    }
    else {
        console.log(reports.map((r) => formatReport(r, args.strict)).join("\n\n"));
        if (unowned.length) {
            console.log(`\nUNOWNED FILES (${unowned.length}) — changed, but in no story's storyScope.includedFiles or excludedFiles:\n` +
                unowned.map((f) => `  - ${f}`).join("\n"));
        }
    }
    return ready ? 0 : 1;
}
process.exitCode = main(process.argv.slice(2));
