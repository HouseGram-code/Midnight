/**
 * Управление с клавиатуры и мыши (только ПК на этом этапе).
 *
 * Использует Pointer Lock API: после клика мышь захватывается и камера
 * крутится как в любом шутере. Esc отпускает курсор.
 * Коды клавиш берутся из event.code — работает на любой раскладке (в т.ч. русской).
 */

export type InputAction =
	| "forward"
	| "back"
	| "left"
	| "right"
	| "jump"
	| "sprint"
	| "crouch"

const KEY_MAP: Record<string, InputAction> = {
	KeyW: "forward",
	ArrowUp: "forward",
	KeyS: "back",
	ArrowDown: "back",
	KeyA: "left",
	ArrowLeft: "left",
	KeyD: "right",
	ArrowRight: "right",
	Space: "jump",
	ShiftLeft: "sprint",
	ShiftRight: "sprint",
	KeyC: "crouch",
	ControlLeft: "crouch",
}

/** Предел смещения одного события мыши в пикселях: выбросы браузера обрезаем. */
const MAX_EVENT_PIXELS = 260
/** Предел поворота за один кадр в радианах — страховка от рывка камеры. */
const MAX_FRAME_TURN = 0.65

const clampSpike = (value: number): number => {
	if (!Number.isFinite(value)) return 0
	return Math.max(-MAX_EVENT_PIXELS, Math.min(MAX_EVENT_PIXELS, value))
}

const clampTurn = (value: number): number =>
	Math.max(-MAX_FRAME_TURN, Math.min(MAX_FRAME_TURN, value))

export class Input {
	private readonly pressed = new Set<InputAction>()
	private readonly onceHandlers = new Map<string, Array<() => void>>()

	mouseDeltaX = 0
	mouseDeltaY = 0
	/** Аналоговый стик с телефона: -1…1 по каждой оси. */
	padX = 0
	padY = 0
	pointerLocked = false
	sensitivity: number
	/** Первое событие сразу после захвата курсора игнорируем. */
	private skipNextMove = false

	private readonly canvas: HTMLCanvasElement

	constructor(canvas: HTMLCanvasElement, sensitivity: number) {
		this.canvas = canvas
		this.sensitivity = sensitivity

		window.addEventListener("keydown", this.handleKeyDown, { passive: false })
		window.addEventListener("keyup", this.handleKeyUp)
		window.addEventListener("blur", this.releaseAll)
		document.addEventListener("pointerlockchange", this.handlePointerLockChange)
		document.addEventListener("mousemove", this.handleMouseMove)
	}

	/** Подписка на одиночное нажатие клавиши (event.code). */
	onKey(code: string, handler: () => void): void {
		const list = this.onceHandlers.get(code) ?? []
		list.push(handler)
		this.onceHandlers.set(code, list)
	}

	isDown(action: InputAction): boolean {
		return this.pressed.has(action)
	}

	/** Ось вперёд/назад в диапазоне -1..1. */
	get moveForward(): number {
		const keys = (this.isDown("forward") ? 1 : 0) - (this.isDown("back") ? 1 : 0)
		return keys !== 0 ? keys : this.padY
	}

	get moveRight(): number {
		const keys = (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0)
		return keys !== 0 ? keys : this.padX
	}

	/** Поворот от пальца на экране — уже в радианах. */
	addLook(dx: number, dy: number): void {
		if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
		this.mouseDeltaX += dx
		this.mouseDeltaY += dy
	}

	/**
	 * Захват мыши. Никогда не бросает и не оставляет отклонённый промис:
	 * браузер отказывает, если запрос пришёл не из жеста пользователя
	 * (а кат-сцена идёт дольше минуты). Возвращает true, если мышь захвачена.
	 */
	async requestPointerLock(): Promise<boolean> {
		const attempt = async (options?: PointerLockOptions): Promise<void> => {
			try {
				const request = this.canvas.requestPointerLock as unknown as (
					options?: PointerLockOptions,
				) => Promise<void> | undefined
				const maybePromise = request.call(this.canvas, options)
				if (maybePromise && typeof maybePromise.then === "function") {
					await maybePromise.catch(() => undefined)
				}
			} catch {
				/* игнорируем: ниже вернём false */
			}
		}

		await attempt({ unadjustedMovement: true } as PointerLockOptions)
		if (document.pointerLockElement === this.canvas) return true
		// Браузер без unadjustedMovement — пробуем обычный захват.
		await attempt()
		return document.pointerLockElement === this.canvas
	}

	exitPointerLock(): void {
		if (document.pointerLockElement) document.exitPointerLock()
	}

	/**
	 * Отдаёт накопленный поворот в радианах и обнуляет счётчик —
	 * вызывать один раз за кадр.
	 */
	consumeMouseDelta(): { x: number; y: number } {
		const x = clampTurn(this.mouseDeltaX)
		const y = clampTurn(this.mouseDeltaY)
		this.mouseDeltaX = 0
		this.mouseDeltaY = 0
		return { x, y }
	}

	/** Забыть накопленное смещение (после заставки, паузы, смены окна). */
	resetMouse(): void {
		this.mouseDeltaX = 0
		this.mouseDeltaY = 0
		this.skipNextMove = true
	}

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		const action = KEY_MAP[event.code]
		if (action) {
			this.pressed.add(action)
			if (event.code === "Space") event.preventDefault()
		}
		if (!event.repeat) {
			const handlers = this.onceHandlers.get(event.code)
			if (handlers) {
				event.preventDefault()
				for (const handler of handlers) handler()
			}
		}
	}

	private readonly handleKeyUp = (event: KeyboardEvent): void => {
		const action = KEY_MAP[event.code]
		if (action) this.pressed.delete(action)
	}

	private readonly releaseAll = (): void => {
		this.pressed.clear()
		this.padX = 0
		this.padY = 0
	}

	private readonly handlePointerLockChange = (): void => {
		this.pointerLocked = document.pointerLockElement === this.canvas
		// И при захвате, и при отпускании курсора старое смещение больше не нужно.
		this.resetMouse()
		if (!this.pointerLocked) this.releaseAll()
	}

	private readonly handleMouseMove = (event: MouseEvent): void => {
		if (!this.pointerLocked) return
		// Сразу после захвата браузер присылает разницу с прежней позицией курсора —
		// это сотни пикселей, из-за которых камера срывалась в разворот.
		if (this.skipNextMove) {
			this.skipNextMove = false
			return
		}
		// Смещение приходит в пикселях: переводим в радианы чувствительностью.
		this.mouseDeltaX += clampSpike(event.movementX) * this.sensitivity
		this.mouseDeltaY += clampSpike(event.movementY) * this.sensitivity
	}
}
