// The source-jump editor is a personal machine preference. Keep it in the
// global codeStory store so reviewing a repository never dirties that repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./config.js";
const DEFAULT_PREFERENCES = {
    version: 1,
    editor: "vscode",
};
export function editorPreferencesFile(home) {
    return join(home, DATA_DIR, "settings.json");
}
export function isSourceEditor(value) {
    return value === "vscode" || value === "zed";
}
/** Missing, malformed, and future settings all fall back without blocking review. */
export function loadEditorPreferences(home) {
    const file = editorPreferencesFile(home);
    if (!existsSync(file))
        return { ...DEFAULT_PREFERENCES };
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { ...DEFAULT_PREFERENCES };
        }
        const editor = parsed.editor;
        return isSourceEditor(editor)
            ? { version: 1, editor }
            : { ...DEFAULT_PREFERENCES };
    }
    catch {
        return { ...DEFAULT_PREFERENCES };
    }
}
/** Preserve unrelated future settings while changing only the editor choice. */
export function saveSourceEditor(home, editor) {
    const file = editorPreferencesFile(home);
    let current = {};
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            current = parsed;
        }
    }
    catch {
        // A missing or corrupt preference is replaced with the smallest valid file.
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...current, version: 1, editor }, null, 2) + "\n", "utf8");
}
