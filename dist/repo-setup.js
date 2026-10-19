// Per-repo setup: choose how .codestory/ is tracked in git, and check the
// producer skill is installed for some agent. Pure FS; no CLI dependencies.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';
const SHARED_LINE = `${DATA_DIR}/comments.json`;
const LOCAL_LINE = `${DATA_DIR}/`;
const STORYTELLER_SKILL = 'codestory-storyteller';
/**
 * Earlier names of the storyteller, oldest first: it shipped as review-tour,
 * then as diffstory-storyteller until the app was renamed to codeStory. A copy
 * under any of them is reported as legacy and removed by updateSkills.
 */
const RETIRED_STORYTELLER_SKILLS = ['review-tour', 'diffstory-storyteller'];
const RETIRED_REVIEW_SKILL = 'address-review';
const SKILLS = [STORYTELLER_SKILL];
/**
 * Edit the repo's .gitignore for the chosen tracking mode (idempotent):
 *  - 'shared': only comments.json is ignored (story.json stays tracked, travels with a PR).
 *  - 'local' : the whole .codestory/ dir is ignored.
 * Removes the other mode's line so switching modes is clean.
 */
export function setGitignore(repo, mode) {
    const path = join(repo, '.gitignore');
    const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
    const kept = lines.filter((l) => l.trim() !== SHARED_LINE && l.trim() !== LOCAL_LINE);
    while (kept.length && kept[kept.length - 1].trim() === '')
        kept.pop();
    kept.push(mode === 'shared' ? SHARED_LINE : LOCAL_LINE);
    writeFileSync(path, kept.join('\n') + '\n', 'utf8');
}
/** True if the codeStory producer skill is installed for any agent under `home`. */
export function skillsInstalled(home) {
    return skillStatus(home).installed;
}
/**
 * Check whether the installed producer skill exists and matches this CLI bundle.
 * The aggregate `installed`/`current` spans every candidate location; `agents`
 * reports the one directory each agent CLI reads (claude → ~/.claude/skills,
 * codex → ~/.codex/skills), so callers can warn for the agent actually in use.
 */
export function skillStatus(home, expected = bundledStorytellerSkill()) {
    // Compare the whole skill folder (SKILL.md, references/, scripts/), not just
    // SKILL.md: a stale reference file or checker bundle teaches the old skill too.
    const expectedDigest = existsSync(expected) ? skillDirDigest(dirname(expected)) : null;
    const skillRoots = [
        join(home, '.agents', 'skills'),
        join(home, '.claude', 'skills'),
        join(home, '.codex', 'skills'),
    ];
    const candidates = skillRoots.map((root) => {
        const path = join(root, STORYTELLER_SKILL, 'SKILL.md');
        const installed = existsSync(path);
        const current = installed && expectedDigest != null && skillDirDigest(dirname(path)) === expectedDigest;
        return { path, installed, current };
    });
    const legacyNames = RETIRED_STORYTELLER_SKILLS.filter((name) => skillRoots.some((root) => existsSync(join(root, name, 'SKILL.md'))));
    const legacyInstalled = legacyNames.length > 0;
    const matches = candidates.filter((c) => c.installed);
    // A matching new copy is not enough while the retired producer remains: an
    // agent may discover both commands and invoke the stale one. Keep Update
    // skills visible until migration removes every old directory.
    const current = matches.some((c) => c.current) && !legacyInstalled;
    const agents = {
        claude: { dir: '~/.claude/skills', ...candidates[1], current: candidates[1].current && !legacyInstalled },
        codex: { dir: '~/.codex/skills', ...candidates[2], current: candidates[2].current && !legacyInstalled },
    };
    return {
        name: STORYTELLER_SKILL,
        expected,
        installed: matches.length > 0,
        current,
        legacyInstalled,
        legacyNames,
        candidates,
        matches,
        agents,
        message: legacyInstalled
            ? `${legacyNames.join(' and ')} ${legacyNames.length > 1 ? 'were' : 'was'} renamed to ${STORYTELLER_SKILL}. Update skills to finish the migration.`
            : matches.length === 0
                ? 'codestory-storyteller skill is not installed.'
                : current
                    ? 'codestory-storyteller skill is installed and up to date.'
                    : 'codestory-storyteller skill is installed but out of date.',
    };
}
function bundledStorytellerSkill() {
    return join(bundledSkillsRoot(), STORYTELLER_SKILL, 'SKILL.md');
}
function bundledSkillsRoot() {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
}
/** Update the local agent skill installs from this app's bundled skills. */
export function updateSkills(home, sourceRoot = bundledSkillsRoot()) {
    const targets = [
        join(home, '.agents', 'skills'),
        join(home, '.claude', 'skills'),
        join(home, '.codex', 'skills'),
    ];
    const installed = [];
    for (const targetRoot of targets) {
        mkdirSync(targetRoot, { recursive: true });
        // The producer skill has been renamed twice. Remove every retired install so
        // agents do not expose two commands that write the same story artifact.
        for (const retired of RETIRED_STORYTELLER_SKILLS)
            rmSync(join(targetRoot, retired), { recursive: true, force: true });
        rmSync(join(targetRoot, RETIRED_REVIEW_SKILL), { recursive: true, force: true });
        for (const skill of SKILLS) {
            const source = join(sourceRoot, skill);
            if (!existsSync(source))
                continue;
            const target = join(targetRoot, skill);
            rmSync(target, { recursive: true, force: true });
            cpSync(source, target, { recursive: true });
            installed.push(target);
        }
    }
    return {
        installed,
        status: skillStatus(home, join(sourceRoot, STORYTELLER_SKILL, 'SKILL.md')),
    };
}
function readNormalized(path) {
    try {
        return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    }
    catch {
        return null;
    }
}
/**
 * Content digest of a skill folder: every file's relative path and normalized
 * text, in sorted order. Two folders with the same digest teach the same skill.
 */
export function skillDirDigest(dir) {
    const files = [];
    const walk = (rel) => {
        for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
            if (entry.name === '.DS_Store')
                continue;
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory())
                walk(child);
            else if (entry.isFile())
                files.push(child);
        }
    };
    walk('');
    const hash = createHash('sha256');
    for (const file of files.sort()) {
        hash.update(`${file}\0${readNormalized(join(dir, file)) ?? ''}\0`);
    }
    return hash.digest('hex');
}
