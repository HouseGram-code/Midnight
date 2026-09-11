/**
 * УПРАВЛЕНИЕ С ТЕЛЕФОНА (Android и iPhone).
 *
 * Модуль ничего не знает про игру: он превращает касания в те же самые
 * события, что и клавиатура (WASD через аналоговые оси, E, F, Shift, C,
 * пробел, T, Esc, цифры пояса). Поэтому игровая логика осталась нетронутой.
 *
 * Раскладка:
 *   • левая часть экрана — «плавающий» стик: основание появляется там, где палец;
 *   • правая часть экрана — обзор пальцем со сглаживанием;
 *   • правый низ — крупные кнопки действий;
 *   • правый верх — пауза, карта, чат, полный экран;
 *   • низ по центру — пояс предметов 1…6.
 */

import type { Input } from "../core/input.js"

export interface TouchCallbacks {
	/** Пишем в чат — обзор и кнопки на это время молчат. */
	isTyping: () => boolean
}

/** Телефон или планшет. Мышь такую проверку не проходит. */
export function isTouchDevice(): boolean {
	if (typeof window === "undefined") return false
	const forced = new URLSearchParams(window.location.search).get("touch")
	if (forced === "1") return true
	if (forced === "0") return false
	const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false
	const points = navigator.maxTouchPoints ?? 0
	return coarse && points > 0
}

/** Радиус стика в пикселях. */
const STICK_RADIUS = 60
/** Мёртвая зона: палец дрожит, персонаж — нет. */
const DEAD_ZONE = 0.14
/** Множитель чувствительности обзора относительно мышиной. */
const LOOK_SCALE = 1.9
/** Вертикаль на телефоне ощущается резче — приглушаем. */
const LOOK_PITCH_SCALE = 0.82
/** Сглаживание обзора: 1 — без фильтра, меньше — плавнее. */
const LOOK_SMOOTH = 0.55

interface ButtonSpec {
	label: string
	hint?: string
	/** Код клавиши, который эмулирует кнопка. */
	code?: string
	/** Кнопка-переключатель: держит клавишу нажатой до повторного тапа. */
	toggle?: boolean
	/** Короткое нажатие: клавиша нажалась и сразу отпустилась. */
	tap?: boolean
	press?: () => void
	className?: string
}

/** Короткая вибрация под палец: попадание по кнопке чувствуется. */
function buzz(ms: number): void {
	try {
		navigator.vibrate?.(ms)
	} catch {
		// Вибрации может не быть — это не ошибка.
	}
}

export class TouchControls {
	readonly enabled: boolean

	private root: HTMLElement | null = null
	private knob: HTMLElement | null = null
	private stickBase: HTMLElement | null = null
	private chatBtn: HTMLElement | null = null

	private stickId = -1
	private lookId = -1
	private lastLookX = 0
	private lastLookY = 0
	/** Накопленный сдвиг обзора: отдаём его игре равными порциями каждый кадр. */
	private lookVelX = 0
	private lookVelY = 0
	private stickCenterX = 0
	private stickCenterY = 0

	private sprintAuto = false
	private sprintManual = false
	private sprintOn = false

	private readonly held = new Set<string>()

	constructor(
		private readonly input: Input,
		private readonly callbacks: TouchCallbacks,
	) {
		this.enabled = isTouchDevice()
		if (!this.enabled) return
		document.body.dataset.touch = "1"
		this.build()
	}

	/** Показывать управление только во время игры. */
	setVisible(visible: boolean): void {
		const root = this.root
		if (!root) return
		if (root.hidden === !visible) return
		root.hidden = !visible
		if (!visible) this.releaseAll()
	}

	/** Кнопка чата нужна только в онлайне. */
	setOnline(online: boolean): void {
		if (this.chatBtn) this.chatBtn.hidden = !online
	}

	/**
	 * Отдаёт игре сглаженный сдвиг обзора. Вызывается раз в кадр из главного
	 * цикла: так поворот не зависит от того, сколько событий pointermove
	 * успел прислать браузер, и дрожание пальца не видно.
	 */
	frame(): void {
		if (!this.enabled) return
		if (Math.abs(this.lookVelX) < 0.01 && Math.abs(this.lookVelY) < 0.01) {
			this.lookVelX = 0
			this.lookVelY = 0
			return
		}
		const dx = this.lookVelX * LOOK_SMOOTH
		const dy = this.lookVelY * LOOK_SMOOTH
		this.lookVelX -= dx
		this.lookVelY -= dy
		if (this.callbacks.isTyping()) return
		const step = this.input.sensitivity * LOOK_SCALE
		this.input.addLook(dx * step, dy * step * LOOK_PITCH_SCALE)
	}

	// ------------------------------------------------------------------ вёрстка

	private build(): void {
		const root = document.createElement("div")
		root.className = "touch"
		root.hidden = true

		const look = document.createElement("div")
		look.className = "touch__look"
		root.append(look)

		// Зона стика занимает всю левую часть: палец можно ставить куда удобно.
		const zone = document.createElement("div")
		zone.className = "touch__zone"
		root.append(zone)

		const stick = document.createElement("div")
		stick.className = "touch__stick"
		const knob = document.createElement("i")
		knob.className = "touch__knob"
		stick.append(knob)
		root.append(stick)

		const actions = document.createElement("div")
		actions.className = "touch__actions"
		root.append(actions)

		const top = document.createElement("div")
		top.className = "touch__top"
		root.append(top)

		const belt = document.createElement("div")
		belt.className = "touch__belt"
		root.append(belt)

		document.body.append(root)
		this.root = root
		this.stickBase = stick
		this.knob = knob

		// Правый низ: то, чем играют постоянно.
		this.addButton(actions, {
			label: "Взять",
			hint: "держать",
			code: "KeyE",
			className: "touch__btn touch__btn--main",
		})
		this.addButton(actions, { label: "🔦", hint: "фонарь", code: "KeyF", tap: true })
		const sprint = this.addButton(actions, { label: "🏃", hint: "бег" })
		sprint.addEventListener("pointerdown", (event: PointerEvent) => {
			event.preventDefault()
			this.sprintManual = !this.sprintManual
			sprint.dataset.on = this.sprintManual ? "1" : ""
			buzz(12)
			this.applySprint()
		})
		this.addButton(actions, { label: "🧎", hint: "сесть", code: "KeyC", toggle: true })
		this.addButton(actions, { label: "⤴", hint: "прыжок", code: "Space", tap: true })

		// Правый верх: служебное.
		this.addButton(top, {
			label: "⏸",
			code: "Escape",
			tap: true,
			className: "touch__btn touch__btn--small",
		})
		this.addButton(top, {
			label: "🗺",
			code: "KeyM",
			tap: true,
			className: "touch__btn touch__btn--small",
		})
		this.chatBtn = this.addButton(top, {
			label: "💬",
			code: "KeyT",
			tap: true,
			className: "touch__btn touch__btn--small",
		})
		this.chatBtn.hidden = true
		this.addButton(top, {
			label: "⛶",
			press: () => this.toggleFullscreen(),
			className: "touch__btn touch__btn--small",
		})

		// Пояс предметов.
		for (let i = 1; i <= 6; i += 1) {
			this.addButton(belt, {
				label: String(i),
				code: `Digit${i}`,
				tap: true,
				className: "touch__btn touch__btn--slot",
			})
		}

		zone.addEventListener("pointerdown", this.onStickDown)
		stick.addEventListener("pointerdown", this.onStickDown)
		look.addEventListener("pointerdown", this.onLookDown)
		window.addEventListener("pointermove", this.onPointerMove, { passive: false })
		window.addEventListener("pointerup", this.onPointerUp)
		window.addEventListener("pointercancel", this.onPointerUp)
		// Safari на iPhone зумит по двойному тапу и щипку — гасим оба жеста.
		document.addEventListener("gesturestart", (event: Event) => event.preventDefault())
		document.addEventListener("dblclick", (event: Event) => event.preventDefault())
	}

	private addButton(parent: HTMLElement, spec: ButtonSpec): HTMLElement {
		const button = document.createElement("button")
		button.type = "button"
		button.className = spec.className ?? "touch__btn"
		const label = document.createElement("span")
		label.textContent = spec.label
		button.append(label)
		if (spec.hint) {
			const hint = document.createElement("i")
			hint.textContent = spec.hint
			button.append(hint)
		}
		parent.append(button)

		if (spec.press) {
			button.addEventListener("pointerdown", (event: PointerEvent) => {
				event.preventDefault()
				buzz(12)
				spec.press?.()
			})
			return button
		}
		const code = spec.code
		if (!code) return button

		if (spec.toggle) {
			button.addEventListener("pointerdown", (event: PointerEvent) => {
				event.preventDefault()
				const on = !this.held.has(code)
				button.dataset.on = on ? "1" : ""
				buzz(12)
				this.key(on ? "keydown" : "keyup", code)
			})
			return button
		}

		if (spec.tap) {
			button.addEventListener("pointerdown", (event: PointerEvent) => {
				event.preventDefault()
				button.dataset.on = "1"
				buzz(10)
				this.key("keydown", code)
				window.setTimeout(() => {
					this.key("keyup", code)
					button.dataset.on = ""
				}, 70)
			})
			return button
		}

		// Кнопка удержания: держим клавишу, пока палец на экране.
		const release = (): void => {
			if (!this.held.has(code)) return
			button.dataset.on = ""
			this.key("keyup", code)
		}
		button.addEventListener("pointerdown", (event: PointerEvent) => {
			event.preventDefault()
			button.dataset.on = "1"
			buzz(10)
			// Палец часто съезжает с круглой кнопки: ловим его до самого отпускания,
			// иначе «Взять» сбрасывается само и предмет не подбирается.
			try {
				button.setPointerCapture(event.pointerId)
			} catch {
				// Старый WebView без pointer capture — работаем как раньше.
			}
			this.key("keydown", code)
		})
		button.addEventListener("pointerup", release)
		button.addEventListener("pointercancel", release)
		button.addEventListener("lostpointercapture", release)
		return button
	}

	// ------------------------------------------------------------------ касания

	private readonly onStickDown = (event: PointerEvent): void => {
		if (this.stickId >= 0 || !this.stickBase) return
		this.stickId = event.pointerId
		// Плавающий стик: основание встаёт ровно под палец.
		this.stickCenterX = event.clientX
		this.stickCenterY = event.clientY
		const base = this.stickBase
		base.style.left = `${event.clientX}px`
		base.style.top = `${event.clientY}px`
		base.style.bottom = "auto"
		base.dataset.on = "1"
		this.moveStick(event.clientX, event.clientY)
		event.preventDefault()
	}

	private readonly onLookDown = (event: PointerEvent): void => {
		if (this.lookId >= 0) return
		this.lookId = event.pointerId
		this.lastLookX = event.clientX
		this.lastLookY = event.clientY
		event.preventDefault()
	}

	private readonly onPointerMove = (event: PointerEvent): void => {
		if (event.pointerId === this.stickId) {
			this.moveStick(event.clientX, event.clientY)
			event.preventDefault()
			return
		}
		if (event.pointerId !== this.lookId) return
		// Android присылает движения пачкой: учитываем все точки, а не только последнюю.
		const coalesced =
			typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : []
		const points: Array<{ clientX: number; clientY: number }> =
			coalesced.length > 0 ? coalesced : [event]
		for (const point of points) {
			this.lookVelX += point.clientX - this.lastLookX
			this.lookVelY += point.clientY - this.lastLookY
			this.lastLookX = point.clientX
			this.lastLookY = point.clientY
		}
		event.preventDefault()
	}

	private readonly onPointerUp = (event: PointerEvent): void => {
		if (event.pointerId === this.stickId) {
			this.stickId = -1
			this.input.padX = 0
			this.input.padY = 0
			if (this.knob) this.knob.style.transform = "translate(0px, 0px)"
			this.parkStick()
			if (this.sprintAuto) {
				this.sprintAuto = false
				this.applySprint()
			}
			return
		}
		if (event.pointerId === this.lookId) {
			this.lookId = -1
			this.lookVelX = 0
			this.lookVelY = 0
		}
	}

	/** Палец убран — основание стика возвращается в свой угол. */
	private parkStick(): void {
		const base = this.stickBase
		if (!base) return
		base.style.left = ""
		base.style.top = ""
		base.style.bottom = ""
		base.dataset.on = ""
	}

	private moveStick(clientX: number, clientY: number): void {
		let dx = clientX - this.stickCenterX
		let dy = clientY - this.stickCenterY
		const length = Math.hypot(dx, dy)
		if (length > STICK_RADIUS) {
			// Палец ушёл дальше радиуса — тянем стик за ним, как в мобильных шутерах.
			const overflow = length - STICK_RADIUS
			this.stickCenterX += (dx / length) * overflow
			this.stickCenterY += (dy / length) * overflow
			const base = this.stickBase
			if (base) {
				base.style.left = `${this.stickCenterX}px`
				base.style.top = `${this.stickCenterY}px`
			}
			dx = (dx / length) * STICK_RADIUS
			dy = (dy / length) * STICK_RADIUS
		}
		const nx = dx / STICK_RADIUS
		const ny = dy / STICK_RADIUS
		const power = Math.hypot(nx, ny)
		const scale = power < DEAD_ZONE ? 0 : Math.min(1, (power - DEAD_ZONE) / (1 - DEAD_ZONE))
		if (power > 1e-4 && scale > 0) {
			this.input.padX = (nx / power) * scale
			this.input.padY = (-ny / power) * scale
		} else {
			this.input.padX = 0
			this.input.padY = 0
		}
		if (this.knob) this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`
		// Полный наклон вперёд — побежали.
		const wantSprint = scale > 0.88 && -ny > 0.42
		if (wantSprint !== this.sprintAuto) {
			this.sprintAuto = wantSprint
			this.applySprint()
		}
	}

	private applySprint(): void {
		const want = this.sprintAuto || this.sprintManual
		if (want === this.sprintOn) return
		this.sprintOn = want
		this.key(want ? "keydown" : "keyup", "ShiftLeft")
	}

	private key(type: "keydown" | "keyup", code: string): void {
		if (type === "keydown") this.held.add(code)
		else this.held.delete(code)
		window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }))
	}

	private releaseAll(): void {
		this.input.padX = 0
		this.input.padY = 0
		this.stickId = -1
		this.lookId = -1
		this.lookVelX = 0
		this.lookVelY = 0
		this.sprintAuto = false
		this.sprintManual = false
		this.sprintOn = false
		if (this.knob) this.knob.style.transform = "translate(0px, 0px)"
		this.parkStick()
		for (const code of Array.from(this.held)) this.key("keyup", code)
		this.held.clear()
		if (!this.root) return
		for (const element of Array.from(this.root.querySelectorAll("[data-on]"))) {
			;(element as HTMLElement).dataset.on = ""
		}
	}

	private toggleFullscreen(): void {
		const element = document.documentElement as HTMLElement & {
			webkitRequestFullscreen?: () => void
		}
		if (document.fullscreenElement) {
			void document.exitFullscreen?.()
			return
		}
		if (element.requestFullscreen) {
			void element.requestFullscreen().catch(() => undefined)
		} else {
			element.webkitRequestFullscreen?.()
		}
		const orientation = screen.orientation as ScreenOrientation & {
			lock?: (value: string) => Promise<void>
		}
		void orientation?.lock?.("landscape").catch(() => undefined)
	}
}
