/// <reference lib="dom" />
// DOM types are used only inside Playwright's isolated page callbacks.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { chromium } from "playwright-core";
export function parseVideoOptions(value) {
    const input = value;
    if (!input || !["720p", "1080p"].includes(input.resolution ?? "") ||
        typeof input.narration !== "boolean" || ![0.75, 1, 1.25, 1.5].includes(input.speed ?? 0) ||
        !["light", "dark"].includes(input.theme ?? "")) {
        throw new Error("Choose a resolution, narration, reading speed, and theme.");
    }
    return { resolution: input.resolution, narration: input.narration, speed: input.speed, theme: input.theme };
}
export function videoFilename(title) {
    return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "codestory"}.mp4`;
}
// Keep subtitle passages readable, preserving every word (even a long
// identifier) and the corresponding code focus and narration boundary.
export function videoScenes(payload) {
    const scenes = [];
    const add = (step, text, group) => {
        let chunk = "";
        for (const word of text.trim().split(/\s+/).filter(Boolean)) {
            if (chunk && chunk.length + word.length > 210) {
                scenes.push({ step, group, text: chunk });
                chunk = "";
            }
            chunk += (chunk ? " " : "") + word;
        }
        if (chunk)
            scenes.push({ step, group, text: chunk });
    };
    add(0, `${payload.story.title.text}. ${payload.story.summary?.text ?? ""}`);
    payload.steps.forEach((step, index) => {
        if (step.beats.length)
            step.beats.forEach(beat => add(index + 1, beat.text.text, beat.focusGroup));
        else
            add(index + 1, step.conceptSpeech || step.why?.text || step.title.text);
    });
    return scenes;
}
/** WebVTT is an intermediate; the MP4 carries a selectable mov_text track. */
export function videoSubtitles(cues) {
    const timestamp = (ms) => {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor(ms / 60000) % 60;
        const seconds = Math.floor(ms / 1000) % 60;
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
    };
    let previousEnd = 0;
    return "WEBVTT\n\n" + cues.map((cue, index) => {
        if (!Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs < previousEnd || cue.endMs <= cue.startMs) {
            throw new Error("Video subtitles need ordered, non-overlapping millisecond timings.");
        }
        previousEnd = cue.endMs;
        // FFmpeg's WebVTT decoder resolves these entities before mov_text encoding;
        // its SRT decoder leaves them literal. Keep source operators/type parameters
        // intact rather than treating them as formatting or displaying entities.
        const text = cue.text.replace(/\s+/g, " ").trim()
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `${index + 1}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${text}\n\n`;
    }).join("");
}
function executable(name, extra = []) {
    return [...extra, ...(process.env.PATH ?? "").split(delimiter).map(dir => join(dir, name)),
        join("/opt/homebrew/bin", name), join("/usr/local/bin", name), join("/usr/bin", name)]
        .find(path => path && existsSync(path));
}
export function videoCapabilities() {
    const browser = executable("chromium", [process.env.CODESTORY_VIDEO_BROWSER ?? "", chromium.executablePath(),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/google-chrome", "/usr/bin/chromium-browser"]);
    const ffmpeg = executable("ffmpeg", [process.env.CODESTORY_FFMPEG ?? ""]);
    const ffprobe = executable("ffprobe", [process.env.CODESTORY_FFPROBE ?? ""]);
    const narration = process.platform === "darwin" && existsSync("/usr/bin/say");
    return { browser, ffmpeg, ffprobe, narration };
}
export function videoRequirements() {
    const { browser, ffmpeg, ffprobe, narration } = videoCapabilities();
    const missing = [!browser && "Install Google Chrome, or install Chromium with npx playwright-core install chromium.",
        (!ffmpeg || !ffprobe) && "Install FFmpeg (includes ffprobe). On macOS: brew install ffmpeg."].filter(Boolean);
    return { available: !missing.length, narration, missing };
}
/** No shell, bounded diagnostics, and cancellation that waits for process exit. */
async function command(bin, args, signal, cwd) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
        let output = "", diagnostics = "";
        child.stdout.on("data", data => { output = (output + data).slice(-12000); });
        child.stderr.on("data", data => { diagnostics = (diagnostics + data).slice(-4000); });
        const abort = () => child.kill("SIGKILL");
        signal.addEventListener("abort", abort, { once: true });
        child.once("error", reject);
        child.once("close", code => {
            signal.removeEventListener("abort", abort);
            if (signal.aborted)
                reject(signal.reason);
            else if (code === 0)
                resolve(output.trim());
            else
                reject(new Error(`Video export could not run ${bin.split(/[\\/]/).pop()}: ${diagnostics || `exit ${code}`}`));
        });
        if (signal.aborted)
            abort();
    });
}
// Screenshots use the same React reader, lazy panels, focus logic and diagram
// renderer as an interactive story. Subtitles live in a separate MP4 track.
async function renderVideo(input) {
    const { options, directory, signal, progress } = input;
    const capabilities = videoCapabilities();
    const requirements = videoRequirements();
    if (!requirements.available)
        throw new Error(requirements.missing.join(" "));
    if (options.narration && !capabilities.narration)
        throw new Error("System narration is available on macOS. Export with captions only on this device.");
    const snapshot = input.snapshot();
    const scenes = videoScenes(snapshot.payload);
    if (!scenes.length || scenes.length > 5000)
        throw new Error("Export a story with between 1 and 5,000 subtitle passages.");
    progress(0, scenes.length, "Opening the story renderer…");
    signal.throwIfAborted();
    const browser = await chromium.launch({ executablePath: capabilities.browser, headless: true, timeout: 30000 });
    const abort = () => { void browser.close().catch(() => { }); };
    signal.addEventListener("abort", abort, { once: true });
    try {
        signal.throwIfAborted();
        // A 12.5% wider viewport gently zooms the UI out; output dimensions stay
        // exact at either resolution and the content gets the whole video stage.
        const context = await browser.newContext({ viewport: { width: 1440, height: 810 },
            deviceScaleFactor: (options.resolution === "1080p" ? 1920 : 1280) / 1440, reducedMotion: "reduce", colorScheme: options.theme,
            serviceWorkers: "block" });
        // All story content is frozen before rendering. The browser cannot mutate
        // review state, speak through Lino, launch agents, or access the network.
        await context.route("**/*", async (route) => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin !== input.origin)
                return route.abort();
            if (request.method() === "GET" && url.pathname.startsWith("/assets/"))
                return route.continue();
            if (url.pathname === "/video-render")
                return route.fulfill({ contentType: "text/html", body: snapshot.shell });
            if (url.pathname === "/api/review/step-panel")
                return route.fulfill({ contentType: "text/html", body: snapshot.panels[Number(url.searchParams.get("index")) - 1] ?? "" });
            if (url.pathname === "/api/review/concept-page")
                return route.fulfill({ contentType: "text/html", body: snapshot.concepts[Number(url.searchParams.get("index"))] ?? "" });
            if (url.pathname === "/api/aloud/status")
                return route.fulfill({ json: { running: false } });
            if (url.pathname === "/api/events")
                return route.fulfill({ status: 204 });
            if (url.pathname === "/api/review/coverage")
                return route.fulfill({ json: { storyless: false, uncovered: 0 } });
            if (request.method() !== "GET")
                return route.fulfill({ json: {} });
            return route.fulfill({ status: 404, json: { error: "Unavailable in a video snapshot." } });
        });
        await context.addInitScript(({ theme }) => { localStorage.setItem("ds-theme", theme); }, { theme: options.theme });
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        await page.goto(`${input.origin}/video-render?view=tour&step=0`, { waitUntil: "networkidle" });
        await page.locator("[data-thread-node='0']").waitFor({ state: "attached" });
        await page.addStyleTag({ content: `
      *,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
      .ds-rail,.ds-rail-resizer,.ds-reviewchrome,.ds-dock,.ds-toast,.ds-live-banner,.ds-history-banner,
      .ds-diffview-controls,.ds-story-tune,.ds-concept-page-fullscreen,[data-mermaid-fullscreen],
      .ds-caller-evidence,.ds-intro-start,.ds-intro-utility,[data-story-health]{display:none!important}
      body{gap:0!important}.ds-layout{gap:0!important}.ds-main{width:100%!important}
      #ds-view-tour{gap:0!important}
    ` });
        const videoList = ["ffconcat version 1.0"], audioList = ["ffconcat version 1.0"];
        const subtitles = [];
        let durationMs = 0, activeStep = -1;
        for (let index = 0; index < scenes.length; index++) {
            signal.throwIfAborted();
            const scene = scenes[index];
            progress(index, scenes.length, `Rendering passage ${index + 1} of ${scenes.length}…`);
            if (scene.step !== activeStep) {
                // Compact stories hide their numeral thread. Drive the same delegated
                // navigation even when that optional control is visually collapsed.
                await page.locator(`[data-thread-node='${scene.step}']`).evaluate(node => node.click());
                if (scene.step) {
                    await page.waitForFunction(step => {
                        const panel = document.querySelector(`[data-step-panel='${step}']`);
                        return panel && !panel.hasAttribute("data-step-lazy") && !panel.hasAttribute("hidden") && !panel.querySelector(".ds-step-error");
                    }, scene.step);
                    // Wait for authored pages and local Mermaid before taking the frame.
                    for (const iframe of await page.locator(`[data-step-panel='${scene.step}'] iframe`).all()) {
                        const frame = await (await iframe.elementHandle())?.contentFrame();
                        // A new iframe's about:blank document is already "loaded". Wait
                        // for the actual concept URL before evaluating its fonts/layout.
                        await frame?.waitForURL(url => url.pathname === "/api/review/concept-page" &&
                            url.searchParams.get("index") === String(scene.step), { waitUntil: "load" });
                        await frame?.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
                    }
                    await page.waitForFunction(step => !document.querySelector(`[data-step-panel='${step}'] [data-concept-diagram][data-render-state='loading']`), scene.step);
                }
                activeStep = scene.step;
            }
            if (scene.group !== undefined) {
                const beat = page.locator(`[data-dock-step='${scene.step}'] [data-story-beat][data-focus-group='${scene.group}']`).first();
                if (!(await beat.count()))
                    throw new Error(`Could not locate spotlight ${scene.group + 1} in step ${scene.step}.`);
                await beat.evaluate(node => node.click());
            }
            await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
            const image = `frame-${index}.png`;
            await page.screenshot({ path: join(directory, image), animations: "disabled" });
            let seconds = Math.max(2.4, scene.text.split(/\s+/).length / (175 * options.speed) * 60 + 0.8);
            if (options.narration) {
                await writeFile(join(directory, "speech.txt"), scene.text);
                await command("/usr/bin/say", ["-r", String(Math.round(175 * options.speed)), "-f", "speech.txt", "-o", "speech.aiff"], signal, directory);
                const measured = Number(await command(capabilities.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", "speech.aiff"], signal, directory));
                if (!Number.isFinite(measured) || measured <= 0)
                    throw new Error("Could not measure the generated narration.");
                seconds = measured + 0.6;
                seconds = Math.ceil(seconds * 25) / 25;
                await command(capabilities.ffmpeg, ["-nostdin", "-y", "-v", "error", "-i", "speech.aiff", "-af", "apad", "-t", String(seconds), "-ar", "24000", "-ac", "1", `audio-${index}.wav`], signal, directory);
                audioList.push(`file audio-${index}.wav`);
            }
            seconds = Math.ceil(seconds * 25) / 25;
            const endMs = durationMs + Math.round(seconds * 1000);
            subtitles.push({ startMs: durationMs, endMs, text: scene.text });
            durationMs = endMs;
            if (durationMs > 7200000)
                throw new Error("This video exceeds two hours. Export a shorter story or use a faster reading speed.");
            videoList.push(`file ${image}`, `duration ${seconds}`);
        }
        videoList.push(`file frame-${scenes.length - 1}.png`);
        await writeFile(join(directory, "frames.txt"), videoList.join("\n") + "\n");
        await writeFile(join(directory, "audio.txt"), audioList.join("\n") + "\n");
        await writeFile(join(directory, "subtitles.vtt"), videoSubtitles(subtitles));
        progress(scenes.length, scenes.length, "Encoding MP4…", true);
        const args = ["-nostdin", "-y", "-v", "error", "-f", "concat", "-safe", "1", "-i", "frames.txt"];
        if (options.narration)
            args.push("-f", "concat", "-safe", "1", "-i", "audio.txt");
        args.push("-i", "subtitles.vtt", "-map", "0:v:0");
        if (options.narration)
            args.push("-map", "1:a:0", "-c:a", "aac", "-b:a", "128k");
        args.push("-map", `${options.narration ? 2 : 1}:s:0`, "-c:s", "mov_text", "-metadata:s:s:0", "title=Story subtitles", "-metadata:s:s:0", "handler_name=Story subtitles", "-metadata:s:s:0", "language=und", "-disposition:s:0", "0", "-vf", "fps=25", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-t", String(durationMs / 1000), "-movflags", "+faststart", "video.mp4");
        await command(capabilities.ffmpeg, args, signal, directory);
    }
    finally {
        signal.removeEventListener("abort", abort);
        await browser.close();
    }
}
/** Per-server jobs. Completed files expire, and partial files never download. */
export class VideoExports {
    renderer;
    jobs = new Map();
    disposed = false;
    constructor(renderer = renderVideo) {
        this.renderer = renderer;
    }
    start(owner, title, origin, options, snapshot) {
        if (this.disposed)
            throw new Error("Video export is shutting down.");
        if ([...this.jobs.values()].some(row => !row.settled))
            throw new Error("Another video export is running. Wait for it to finish or cancel it.");
        for (const [id, row] of this.jobs) {
            if (this.jobs.size >= 3 || Date.now() - row.created > 3600000) {
                clearTimeout(row.expiry);
                this.jobs.delete(id);
                void rm(row.directory, { recursive: true, force: true }).catch(() => { });
            }
        }
        const controller = new AbortController();
        const job = { id: randomUUID(), state: "rendering", completed: 0, total: 0, message: "Preparing the video…", filename: videoFilename(title) };
        const row = { job, owner, controller, directory: "", task: Promise.resolve(), created: Date.now(), settled: false };
        this.jobs.set(job.id, row);
        row.task = (async () => {
            const timeout = setTimeout(() => controller.abort(new Error("Video export exceeded 30 minutes. Try a shorter story.")), 30 * 60 * 1000);
            timeout.unref();
            try {
                row.directory = await mkdtemp(join(tmpdir(), "codestory-video-"));
                controller.signal.throwIfAborted();
                await this.renderer({ snapshot, origin, options, directory: row.directory, signal: controller.signal,
                    progress: (completed, total, message, encoding) => {
                        if (!controller.signal.aborted)
                            Object.assign(job, { completed, total, message, state: encoding ? "encoding" : "rendering" });
                    } });
                controller.signal.throwIfAborted();
                job.state = "ready";
                job.message = "Your video is ready.";
            }
            catch (error) {
                if (job.state !== "cancelled") {
                    job.state = "error";
                    job.message = error?.message || "Could not export this story.";
                }
            }
            finally {
                clearTimeout(timeout);
                if (job.state !== "ready")
                    await rm(row.directory, { recursive: true, force: true }).catch(() => { });
                else {
                    // Keep just the final artifact, not source images and narration.
                    const { readdir } = await import("node:fs/promises");
                    for (const file of await readdir(row.directory).catch(() => []))
                        if (file !== "video.mp4")
                            await rm(join(row.directory, file), { force: true }).catch(() => { });
                }
                row.settled = true;
                row.expiry = setTimeout(() => {
                    this.jobs.delete(job.id);
                    void rm(row.directory, { recursive: true, force: true }).catch(() => { });
                }, 3600000);
                row.expiry.unref();
            }
        })();
        return { ...job };
    }
    get(id, owner) {
        const row = this.jobs.get(id);
        return row?.owner === owner ? { ...row.job } : undefined;
    }
    file(id, owner) {
        const row = this.jobs.get(id);
        return row?.owner === owner && row.job.state === "ready" ? join(row.directory, "video.mp4") : undefined;
    }
    async cancel(id, owner) {
        const row = this.jobs.get(id);
        if (!row || row.owner !== owner)
            return undefined;
        if (["rendering", "encoding"].includes(row.job.state)) {
            row.job.state = "cancelled";
            row.job.message = "Video export cancelled.";
            row.controller.abort();
            await row.task;
        }
        return { ...row.job };
    }
    async dispose() {
        this.disposed = true;
        for (const row of this.jobs.values())
            row.controller.abort();
        await Promise.all([...this.jobs.values()].map(async (row) => {
            await row.task;
            clearTimeout(row.expiry);
            await rm(row.directory, { recursive: true, force: true }).catch(() => { });
        }));
        this.jobs.clear();
    }
}
