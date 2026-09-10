/**
 * Движок кат-сцен.
 *
 * В песочнице нет интернета, поэтому внешнюю библиотеку поставить нельзя,
 * да и не нужно: вся логика кинематики — это очередь шагов с таймером,
 * интерполяция камеры и коллбеки. Оно точно контролируется и ничего не весит.
 */
export function clamp01(value) {
    if (value < 0)
        return 0;
    if (value > 1)
        return 1;
    return value;
}
export function easeInOut(t) {
    const x = clamp01(t);
    return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}
export function easeOut(t) {
    const x = clamp01(t);
    return 1 - (1 - x) ** 3;
}
export function easeIn(t) {
    const x = clamp01(t);
    return x * x * x;
}
export function mix(a, b, t) {
    return a + (b - a) * t;
}
/** Плавный переход угла по короткой дуге. */
export function mixAngle(a, b, t) {
    let delta = b - a;
    while (delta > Math.PI)
        delta -= Math.PI * 2;
    while (delta < -Math.PI)
        delta += Math.PI * 2;
    return a + delta * t;
}
export function mixCamera(out, a, b, t) {
    out.x = mix(a.x, b.x, t);
    out.y = mix(a.y, b.y, t);
    out.z = mix(a.z, b.z, t);
    out.yaw = mixAngle(a.yaw, b.yaw, t);
    out.pitch = mix(a.pitch, b.pitch, t);
    out.fov = mix(a.fov ?? 74, b.fov ?? 74, t);
    return out;
}
export class Timeline {
    steps;
    onFinish;
    index = 0;
    elapsed = 0;
    entered = false;
    done = false;
    constructor(steps, onFinish) {
        this.steps = steps;
        this.onFinish = onFinish;
    }
    get finished() {
        return this.done;
    }
    get stepIndex() {
        return this.index;
    }
    get stepId() {
        return this.steps[this.index]?.id ?? "";
    }
    /** Общая длительность всей сцены. */
    get totalDuration() {
        let sum = 0;
        for (const step of this.steps)
            sum += step.duration;
        return sum;
    }
    update(dt) {
        if (this.done)
            return;
        let guard = 0;
        let remaining = dt;
        while (remaining > 0 && !this.done && guard < 64) {
            guard += 1;
            const step = this.steps[this.index];
            if (!step) {
                this.complete();
                return;
            }
            if (!this.entered) {
                this.entered = true;
                this.elapsed = 0;
                step.onEnter?.();
                step.onUpdate?.(0, 0);
            }
            const left = step.duration - this.elapsed;
            const slice = Math.min(remaining, Math.max(left, 0));
            this.elapsed += slice;
            remaining -= slice;
            const progress = step.duration > 0 ? clamp01(this.elapsed / step.duration) : 1;
            step.onUpdate?.(progress, slice);
            if (this.elapsed >= step.duration - 1e-6) {
                step.onExit?.();
                this.entered = false;
                this.index += 1;
                if (this.index >= this.steps.length) {
                    this.complete();
                    return;
                }
            }
            if (slice <= 0 && remaining > 0 && step.duration > 0)
                break;
        }
    }
    /** Перемотка текущего шага до конца. */
    skipStep() {
        if (this.done)
            return;
        const step = this.steps[this.index];
        if (!step) {
            this.complete();
            return;
        }
        if (!this.entered) {
            this.entered = true;
            step.onEnter?.();
        }
        step.onUpdate?.(1, 0);
        step.onExit?.();
        this.entered = false;
        this.index += 1;
        this.elapsed = 0;
        if (this.index >= this.steps.length)
            this.complete();
    }
    /** Пропустить всю сцену (клавиша Esc / кнопка «Пропустить»). */
    skipAll() {
        let guard = 0;
        while (!this.done && guard < 256) {
            guard += 1;
            this.skipStep();
        }
        if (!this.done)
            this.complete();
    }
    complete() {
        if (this.done)
            return;
        this.done = true;
        this.onFinish?.();
    }
}
//# sourceMappingURL=timeline.js.map