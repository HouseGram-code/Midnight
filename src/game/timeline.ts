/**
 * Движок кат-сцен.
 *
 * В песочнице нет интернета, поэтому внешнюю библиотеку поставить нельзя,
 * да и не нужно: вся логика кинематики — это очередь шагов с таймером,
 * интерполяция камеры и коллбеки. Оно точно контролируется и ничего не весит.
 */

export interface CameraKey {
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
	fov?: number
}

export interface SceneStep {
	/** Имя для отладки. */
	id?: string
	/** Длительность шага в секундах. */
	duration: number
	onEnter?: () => void
	/** progress — 0…1 внутри шага. */
	onUpdate?: (progress: number, dt: number) => void
	onExit?: () => void
}

export function clamp01(value: number): number {
	if (value < 0) return 0
	if (value > 1) return 1
	return value
}

export function easeInOut(t: number): number {
	const x = clamp01(t)
	return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}

export function easeOut(t: number): number {
	const x = clamp01(t)
	return 1 - (1 - x) ** 3
}

export function easeIn(t: number): number {
	const x = clamp01(t)
	return x * x * x
}

export function mix(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

/** Плавный переход угла по короткой дуге. */
export function mixAngle(a: number, b: number, t: number): number {
	let delta = b - a
	while (delta > Math.PI) delta -= Math.PI * 2
	while (delta < -Math.PI) delta += Math.PI * 2
	return a + delta * t
}

export function mixCamera(out: CameraKey, a: CameraKey, b: CameraKey, t: number): CameraKey {
	out.x = mix(a.x, b.x, t)
	out.y = mix(a.y, b.y, t)
	out.z = mix(a.z, b.z, t)
	out.yaw = mixAngle(a.yaw, b.yaw, t)
	out.pitch = mix(a.pitch, b.pitch, t)
	out.fov = mix(a.fov ?? 74, b.fov ?? 74, t)
	return out
}

export class Timeline {
	private index = 0
	private elapsed = 0
	private entered = false
	private done = false

	constructor(
		private readonly steps: readonly SceneStep[],
		private readonly onFinish?: () => void,
	) {}

	get finished(): boolean {
		return this.done
	}

	get stepIndex(): number {
		return this.index
	}

	get stepId(): string {
		return this.steps[this.index]?.id ?? ""
	}

	/** Общая длительность всей сцены. */
	get totalDuration(): number {
		let sum = 0
		for (const step of this.steps) sum += step.duration
		return sum
	}

	update(dt: number): void {
		if (this.done) return
		let guard = 0
		let remaining = dt
		while (remaining > 0 && !this.done && guard < 64) {
			guard += 1
			const step = this.steps[this.index]
			if (!step) {
				this.complete()
				return
			}
			if (!this.entered) {
				this.entered = true
				this.elapsed = 0
				step.onEnter?.()
				step.onUpdate?.(0, 0)
			}
			const left = step.duration - this.elapsed
			const slice = Math.min(remaining, Math.max(left, 0))
			this.elapsed += slice
			remaining -= slice
			const progress = step.duration > 0 ? clamp01(this.elapsed / step.duration) : 1
			step.onUpdate?.(progress, slice)
			if (this.elapsed >= step.duration - 1e-6) {
				step.onExit?.()
				this.entered = false
				this.index += 1
				if (this.index >= this.steps.length) {
					this.complete()
					return
				}
			}
			if (slice <= 0 && remaining > 0 && step.duration > 0) break
		}
	}

	/** Перемотка текущего шага до конца. */
	skipStep(): void {
		if (this.done) return
		const step = this.steps[this.index]
		if (!step) {
			this.complete()
			return
		}
		if (!this.entered) {
			this.entered = true
			step.onEnter?.()
		}
		step.onUpdate?.(1, 0)
		step.onExit?.()
		this.entered = false
		this.index += 1
		this.elapsed = 0
		if (this.index >= this.steps.length) this.complete()
	}

	/** Пропустить всю сцену (клавиша Esc / кнопка «Пропустить»). */
	skipAll(): void {
		let guard = 0
		while (!this.done && guard < 256) {
			guard += 1
			this.skipStep()
		}
		if (!this.done) this.complete()
	}

	private complete(): void {
		if (this.done) return
		this.done = true
		this.onFinish?.()
	}
}
