/**
 * Звук на WebAudio без внешних библиотек.
 *
 * Важные решения:
 *  1. Все файлы грузятся и декодируются один раз в AudioBuffer.
 *  2. Лупы играют с loopStart/loopEnd — mp3 добавляет тишину на краях,
 *     и без обрезки был бы слышен щёлчок на стыке.
 *  3. Простая имитация 3D: громкость по расстоянию + панорама по углу.
 *  4. AudioContext стартует только после жеста пользователя (требование браузеров).
 */

export type SoundName =
	| "steps"
	| "door_open"
	| "door_full"
	| "scream"
	| "breath"
	| "jump"
	| "land"
	| "pickup_loop"
	| "pickup_done"
	| "place_item"
	| "unlock"
	| "click"
	| "locked"
	| "hit"
	| "hurt"
	| "swing"
	| "locker_open"
	| "locker_close"
	| "ambience"
	| "heartbeat"
	| "whisper"
	| "bell"
	| "chalk"
	| "knock"
	| "teacher_step"
	| "lights_out"
	| "win"
	| "lose"
	| "stinger"
	| "teacher_hit"
	| "fall"
	| "teacher_near"
	| "win_fanfare"
	| "teacher_scream"

export const SOUND_FILES: Readonly<Record<SoundName, string>> = {
	steps: "steps.mp3",
	door_open: "door_open.mp3",
	door_full: "door_full.mp3",
	scream: "scream.mp3",
	breath: "breath.mp3",
	jump: "jump.mp3",
	land: "land.mp3",
	pickup_loop: "pickup_loop.mp3",
	pickup_done: "pickup_done.mp3",
	place_item: "place_item.mp3",
	unlock: "unlock.mp3",
	click: "click.mp3",
	locked: "locked.mp3",
	hit: "hit.mp3",
	hurt: "hurt.mp3",
	swing: "swing.mp3",
	locker_open: "locker_open.mp3",
	locker_close: "locker_close.mp3",
	ambience: "ambience.mp3",
	heartbeat: "heartbeat.mp3",
	whisper: "whisper.mp3",
	bell: "bell.mp3",
	chalk: "chalk.mp3",
	knock: "knock.mp3",
	teacher_step: "teacher_step.mp3",
	lights_out: "lights_out.mp3",
	win: "win.mp3",
	lose: "lose.mp3",
	stinger: "stinger.mp3",
	/** Удар учительницы по игроку. */
	teacher_hit: "teacher_hit.mp3",
	/** Падение: нас сбили с ног или прыжок с высоты. */
	fall: "fall.mp3",
	/** Она где-то совсем рядом. */
	teacher_near: "teacher_near.mp3",
	/** Фанфары после побега из школы. */
	win_fanfare: "win_fanfare.mp3",
	/** Крик учительницы в момент, когда она нас заметила. */
	teacher_scream: "teacher_scream.mp3",
}

/** Звуки, которые зациклены и требуют обрезки mp3-паддинга. */
const LOOP_TRIM = 0.026

export interface PlayOptions {
	volume?: number
	rate?: number
	/** Задержка перед стартом, секунды. */
	delay?: number
	/** С какой секунды играть. */
	offset?: number
	/** Сколько секунд играть. */
	duration?: number
	/** Панорама −1…1. */
	pan?: number
}

interface ActiveLoop {
	source: AudioBufferSourceNode
	gain: GainNode
	targetVolume: number
}

export class AudioManager {
	private context: AudioContext | null = null
	private master: GainNode | null = null
	private readonly buffers = new Map<SoundName, AudioBuffer>()
	private readonly encoded = new Map<SoundName, ArrayBuffer>()
	private readonly loops = new Map<SoundName, ActiveLoop>()
	private readonly pendingLoops = new Map<
		SoundName,
		{ volume?: number; rate?: number; fade?: number }
	>()
	private readonly missing = new Set<SoundName>()
	private volume = 0.85
	private loaded = false
	private decoding: Promise<void> | null = null
	private unlockArmed = false

	constructor(private readonly basePath = "./assets/audio/") {}

	get ready(): boolean {
		return this.loaded
	}

	get masterVolume(): number {
		return this.volume
	}

	/** Загружает файлы, но не создаёт AudioContext до жеста пользователя. */
	async load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
		if (this.loaded) return
		const names = Object.keys(SOUND_FILES) as SoundName[]
		let done = 0
		await Promise.all(
			names.map(async (name) => {
				try {
					const response = await fetch(this.basePath + SOUND_FILES[name])
					if (!response.ok) throw new Error(`HTTP ${response.status}`)
					this.encoded.set(name, await response.arrayBuffer())
				} catch {
					// Звук — не критичный ресурс: игра должна работать и без него.
					this.missing.add(name)
				}
				done += 1
				onProgress?.(done, names.length)
			}),
		)
		this.loaded = true
		this.armUnlock()
	}

	/** Вызывать из обработчика клика/клавиши. */
	resume(): void {
		if (!this.userGestureActive()) {
			this.armUnlock()
			return
		}
		const context = this.ensureContext()
		if (!context) return
		if (context.state === "suspended") {
			void context
				.resume()
				.then(() => this.flushPendingLoops())
				.catch(() => this.armUnlock())
		} else {
			this.flushPendingLoops()
		}
	}

	suspend(): void {
		if (this.context && this.context.state === "running") void this.context.suspend()
	}

	setMasterVolume(value: number): void {
		this.volume = Math.max(0, Math.min(1, value))
		if (this.master && this.context) {
			this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.05)
		}
	}

	duration(name: SoundName): number {
		return this.buffers.get(name)?.duration ?? 0
	}

	play(name: SoundName, options: PlayOptions = {}): void {
		const context = this.context
		const master = this.master
		const buffer = this.buffers.get(name)
		if (!context || !master || !buffer) return
		if (context.state !== "running") return

		const source = context.createBufferSource()
		source.buffer = buffer
		source.playbackRate.value = options.rate ?? 1
		const gain = context.createGain()
		gain.gain.value = options.volume ?? 1

		if (options.pan !== undefined && typeof context.createStereoPanner === "function") {
			const panner = context.createStereoPanner()
			panner.pan.value = Math.max(-1, Math.min(1, options.pan))
			source.connect(gain).connect(panner).connect(master)
		} else {
			source.connect(gain).connect(master)
		}

		const when = context.currentTime + (options.delay ?? 0)
		if (options.duration !== undefined) {
			source.start(when, options.offset ?? 0, options.duration)
		} else {
			source.start(when, options.offset ?? 0)
		}
	}

	/** Звук в точке мира: тише с расстоянием и со стороны. */
	playAt(
		name: SoundName,
		source: { x: number; z: number },
		listener: { x: number; z: number; yaw: number },
		options: PlayOptions & { range?: number } = {},
	): void {
		const range = options.range ?? 26
		const dx = source.x - listener.x
		const dz = source.z - listener.z
		const distance = Math.hypot(dx, dz)
		if (distance > range) return
		const attenuation = Math.max(0, 1 - distance / range) ** 1.6
		if (attenuation < 0.01) return
		// Вправо от игрока = (cos yaw, −sin yaw).
		const rightX = Math.cos(listener.yaw)
		const rightZ = -Math.sin(listener.yaw)
		const side = distance > 0.001 ? (dx * rightX + dz * rightZ) / distance : 0
		this.play(name, {
			...options,
			volume: (options.volume ?? 1) * attenuation,
			pan: Math.max(-0.85, Math.min(0.85, side)),
		})
	}

	startLoop(name: SoundName, options: { volume?: number; rate?: number; fade?: number } = {}): void {
		const context = this.context
		const master = this.master
		const buffer = this.buffers.get(name)
		if (!context || !master || !buffer || context.state !== "running") {
			this.pendingLoops.set(name, options)
			return
		}
		this.pendingLoops.delete(name)
		const target = options.volume ?? 1
		const existing = this.loops.get(name)
		if (existing) {
			existing.targetVolume = target
			existing.gain.gain.setTargetAtTime(target, context.currentTime, 0.08)
			if (options.rate !== undefined) {
				existing.source.playbackRate.setTargetAtTime(options.rate, context.currentTime, 0.08)
			}
			return
		}
		const source = context.createBufferSource()
		source.buffer = buffer
		source.loop = true
		source.loopStart = Math.min(LOOP_TRIM, buffer.duration * 0.1)
		source.loopEnd = Math.max(source.loopStart + 0.05, buffer.duration - LOOP_TRIM)
		source.playbackRate.value = options.rate ?? 1
		const gain = context.createGain()
		const fadeTime = options.fade ?? 0.25
		gain.gain.value = fadeTime > 0 ? 0.0001 : target
		source.connect(gain).connect(master)
		source.start(0, source.loopStart)
		if (fadeTime > 0) gain.gain.setTargetAtTime(target, context.currentTime, fadeTime)
		this.loops.set(name, { source, gain, targetVolume: target })
	}

	setLoopVolume(name: SoundName, volume: number): void {
		const loop = this.loops.get(name)
		if (!loop || !this.context) return
		loop.targetVolume = volume
		loop.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.1)
	}

	setLoopRate(name: SoundName, rate: number): void {
		const loop = this.loops.get(name)
		if (!loop || !this.context) return
		loop.source.playbackRate.setTargetAtTime(rate, this.context.currentTime, 0.1)
	}

	isLooping(name: SoundName): boolean {
		return this.loops.has(name)
	}

	stopLoop(name: SoundName, fadeSeconds = 0.2): void {
		this.pendingLoops.delete(name)
		const loop = this.loops.get(name)
		const context = this.context
		if (!loop || !context) return
		this.loops.delete(name)
		const source = loop.source
		if (fadeSeconds <= 0) {
			try {
				source.stop()
			} catch {
				/* уже остановлен */
			}
			return
		}
		loop.gain.gain.setTargetAtTime(0.0001, context.currentTime, fadeSeconds / 3)
		window.setTimeout(() => {
			try {
				source.stop()
			} catch {
				/* уже остановлен */
			}
		}, fadeSeconds * 1000 + 60)
	}

	stopAllLoops(fadeSeconds = 0.2): void {
		this.pendingLoops.clear()
		for (const name of [...this.loops.keys()]) this.stopLoop(name, fadeSeconds)
	}

	private userGestureActive(): boolean {
		const activation = navigator.userActivation
		return activation ? activation.isActive : true
	}

	private armUnlock(): void {
		if (this.unlockArmed || this.context?.state === "running") return
		this.unlockArmed = true
		const unlock = (): void => {
			window.removeEventListener("pointerdown", unlock)
			window.removeEventListener("keydown", unlock)
			this.unlockArmed = false
			this.resume()
		}
		window.addEventListener("pointerdown", unlock, { once: true })
		window.addEventListener("keydown", unlock, { once: true })
	}

	private ensureContext(): AudioContext | null {
		if (this.context) return this.context
		const Ctor: typeof AudioContext | undefined =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
		if (!Ctor) return null
		const context = new Ctor()
		const master = context.createGain()
		master.gain.value = this.volume
		master.connect(context.destination)
		this.context = context
		this.master = master
		this.decoding = this.decodeAll(context)
		return context
	}

	private async decodeAll(context: AudioContext): Promise<void> {
		await Promise.all(
			[...this.encoded.entries()].map(async ([name, bytes]) => {
				try {
					this.buffers.set(name, await context.decodeAudioData(bytes.slice(0)))
				} catch {
					this.missing.add(name)
				}
			}),
		)
		this.encoded.clear()
		this.decoding = null
		this.flushPendingLoops()
	}

	private flushPendingLoops(): void {
		if (this.context?.state !== "running") return
		for (const [name, options] of [...this.pendingLoops]) this.startLoop(name, options)
	}
}
