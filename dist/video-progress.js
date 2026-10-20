/** Estimate the active stage from measured work; never invent a warm-up rate. */
export class VideoProgressEstimate {
    now;
    stage = "";
    completed = 0;
    total = 0;
    sampledAt = 0;
    unitMs = null;
    finishAt = null;
    constructor(now = () => performance.now()) {
        this.now = now;
    }
    update(stage, completed, total) {
        if (!Number.isFinite(completed) || !Number.isFinite(total) || total < 0)
            return;
        const time = this.now();
        if (stage !== this.stage || total !== this.total || completed < this.completed) {
            this.stage = stage;
            this.completed = 0;
            this.total = total;
            this.sampledAt = time;
            this.unitMs = null;
            this.finishAt = null;
        }
        completed = Math.max(0, Math.min(completed, total));
        if (completed > this.completed) {
            const sample = (time - this.sampledAt) / (completed - this.completed);
            if (sample > 0) {
                this.unitMs = this.unitMs === null ? sample : this.unitMs * 0.7 + sample * 0.3;
                this.finishAt = time + this.unitMs * (total - completed);
            }
            this.completed = completed;
            this.sampledAt = time;
        }
    }
    fraction() {
        return this.total > 0 ? this.completed / this.total : null;
    }
    remainingMs() {
        if (this.finishAt === null || this.completed >= this.total)
            return null;
        const remaining = this.finishAt - this.now();
        // An overdue prediction is unknown until more work completes. A stalled
        // model must not leave a misleading zero-second countdown on screen.
        return remaining > 0 ? Math.ceil(remaining) : null;
    }
}
/** Subtitle/audio timestamps can run ahead; measure encoded video frames. */
export function videoEncodingProgress(onProgress) {
    let pending = "";
    return chunk => {
        const lines = (pending + chunk).split(/\r?\n/);
        pending = lines.pop().slice(-2000);
        for (const line of lines) {
            const match = /^frame=\s*(\d+)$/.exec(line);
            if (match) {
                const value = Number(match[1]);
                if (Number.isFinite(value))
                    onProgress(value);
            }
        }
    };
}
