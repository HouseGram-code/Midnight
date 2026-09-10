/**
 * Часы игры с фиксированным шагом физики.
 *
 * Рендер идёт с частотой монитора, а физика — всегда шагами 1/120 с.
 * Так управление одинаково ощущается и на 60 Hz, и на 144 Hz, и при просадках.
 */
import { CONFIG } from "../config.js";
export class Clock {
    previous = performance.now();
    accumulator = 0;
    fpsTime = 0;
    fpsFrames = 0;
    /** Длительность последнего кадра в миллисекундах. */
    frameMs = 16.7;
    /** Сглаженный FPS для HUD. */
    fps = 60;
    /** Общее игровое время в секундах. */
    elapsed = 0;
    get fixedStep() {
        return CONFIG.physics.fixedStep;
    }
    /** Сколько шагов физики нужно просчитать в этом кадре. */
    tick(now) {
        let delta = (now - this.previous) / 1000;
        this.previous = now;
        if (!Number.isFinite(delta) || delta < 0)
            delta = 0;
        if (delta > CONFIG.physics.maxFrameDelta)
            delta = CONFIG.physics.maxFrameDelta;
        this.frameMs = delta * 1000;
        this.elapsed += delta;
        this.fpsTime += delta;
        this.fpsFrames += 1;
        if (this.fpsTime >= 0.4) {
            this.fps = this.fpsFrames / this.fpsTime;
            this.fpsTime = 0;
            this.fpsFrames = 0;
        }
        this.accumulator += delta;
        const step = CONFIG.physics.fixedStep;
        let steps = 0;
        while (this.accumulator >= step && steps < CONFIG.physics.maxStepsPerFrame) {
            this.accumulator -= step;
            steps += 1;
        }
        // Отстали слишком сильно (вкладка была в фоне) — не копим долг.
        if (this.accumulator > step * CONFIG.physics.maxStepsPerFrame)
            this.accumulator = 0;
        return steps;
    }
    /** Сброс после паузы, чтобы не было рывка. */
    resume(now) {
        this.previous = now;
        this.accumulator = 0;
    }
}
//# sourceMappingURL=clock.js.map