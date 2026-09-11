/**
 * Главное меню и настройки.
 *
 * Настройки хранятся в localStorage, поэтому переживают перезагрузку.
 * Всё на обычных DOM-событиях — никаких фреймворков.
 */

import { requireElement, setHidden, setText } from "./dom.js"

export const GAME_VERSION = "1.0.1-beta"

export interface GameSettings {
	/** Чувствительность мыши, множитель 0.3…2.5. */
	sensitivity: number
	/** Общая громкость 0…1. */
	volume: number
	/** Яркость ночи 0.6…1.6 — чтобы на любом мониторе было видно. */
	brightness: number
	/** Инвертировать вертикальную ось. */
	invertY: boolean
	/** Показывать счётчик FPS в игре. */
	showFps: boolean
	/** Профиль качества картинки. */
	quality: QualityLevel
}

/** Уровни графики: «авто» сам подбирает разрешение под железо. */
export type QualityLevel = "auto" | "low" | "medium" | "high"

export const QUALITY_LEVELS: ReadonlyArray<QualityLevel> = ["auto", "low", "medium", "high"]

const STORAGE_KEY = "school3d.settings.v1"

const DEFAULT_SETTINGS: GameSettings = {
	sensitivity: 1,
	volume: 0.8,
	brightness: 1,
	invertY: false,
	showFps: false,
	quality: "auto",
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

export function loadSettings(): GameSettings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return { ...DEFAULT_SETTINGS }
		const parsed = JSON.parse(raw) as Partial<GameSettings>
		return {
			sensitivity: clamp(Number(parsed.sensitivity ?? 1) || 1, 0.3, 2.5),
			volume: clamp(Number(parsed.volume ?? 0.8), 0, 1),
			brightness: clamp(Number(parsed.brightness ?? 1) || 1, 0.6, 1.6),
			invertY: Boolean(parsed.invertY),
			showFps: Boolean(parsed.showFps),
			quality: QUALITY_LEVELS.includes(parsed.quality as QualityLevel)
				? (parsed.quality as QualityLevel)
				: "auto",
		}
	} catch {
		return { ...DEFAULT_SETTINGS }
	}
}

export function saveSettings(settings: GameSettings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
	} catch {
		// Приватный режим браузера — просто играем без сохранения.
	}
}

/** Android пробуем повернуть автоматически; iPhone показывает аккуратную подсказку. */
export function requestMobileLandscape(): void {
	if (!matchMedia("(pointer: coarse)").matches && innerWidth > 900) return
	document.body.dataset.landscape = "1"
	const element = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
	try {
		if (!document.fullscreenElement) {
			if (element.requestFullscreen) void element.requestFullscreen().catch(() => undefined)
			else element.webkitRequestFullscreen?.()
		}
		const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> }
		void orientation?.lock?.("landscape").catch(() => undefined)
	} catch {
		// iOS Safari не разрешает программный lock — CSS попросит повернуть устройство.
	}
}

type Panel = "root" | "acts" | "settings" | "controls" | "about" | "online"

/** Закрытый акт: трясём карточку и объясняем, почему не запускается. */
function refuseLocked(card: HTMLElement): void {
	card.classList.remove("act--shake")
	// Перезапуск анимации: без reflow класс не сработает второй раз.
	void card.offsetWidth
	card.classList.add("act--shake")
	try {
		navigator.vibrate?.(18)
	} catch {
		// вибрации может не быть
	}
}

export interface MenuCallbacks {
	onPlay: () => void
	onSettingsChange: (settings: GameSettings) => void
	/** Открыли панель онлайна. */
	onOnline: () => void
	/** Ушли с панели онлайна. */
	onOnlineClose: () => void
}

export class Menu {
	private readonly screen = requireElement("menu")
	private readonly panels: Record<Panel, HTMLElement> = {
		root: requireElement("menu-root"),
		settings: requireElement("menu-settings"),
		controls: requireElement("menu-controls"),
		acts: requireElement("menu-acts"),
		about: requireElement("menu-about"),
		online: requireElement("menu-online"),
	}
	private readonly playButton = requireElement("menu-play")
	private readonly versionEl = requireElement("menu-version")
	private readonly sensitivityInput = requireElement("set-sensitivity") as HTMLInputElement
	private readonly volumeInput = requireElement("set-volume") as HTMLInputElement
	private readonly brightnessInput = requireElement("set-brightness") as HTMLInputElement
	private readonly invertInput = requireElement("set-invert") as HTMLInputElement
	private readonly fpsInput = requireElement("set-fps") as HTMLInputElement
	private readonly qualityInput = requireElement("set-quality") as HTMLSelectElement
	private readonly sensitivityValue = requireElement("set-sensitivity-value")
	private readonly volumeValue = requireElement("set-volume-value")
	private readonly brightnessValue = requireElement("set-brightness-value")

	settings: GameSettings
	private panel: Panel = "root"
	private visible = true

	constructor(private readonly callbacks: MenuCallbacks) {
		this.settings = loadSettings()
		setText(this.versionEl, `версия ${GAME_VERSION}`)

		// Кнопка «Играть» ведёт на выбор акта, а не сразу в игру.
		this.playButton.addEventListener("click", () => this.showPanel("acts"))
		requireElement("act-1").addEventListener("click", () => {
			requestMobileLandscape()
			this.callbacks.onPlay()
		})
		const lockedAct = requireElement("act-2")
		const actsNote = requireElement("acts-note")
		lockedAct.addEventListener("click", () => {
			refuseLocked(lockedAct)
			setText(actsNote, "Акт II закрыт: он ещё в разработке. Пока играется Акт I.")
		})
		const onlineLockedAct = requireElement("online-act-2")
		onlineLockedAct.addEventListener("click", () => {
			onlineLockedAct.classList.remove("act--shake")
			void onlineLockedAct.offsetWidth
			onlineLockedAct.classList.add("act--shake")
		})
		this.bindPanel("menu-open-settings", "settings")
		this.bindPanel("menu-open-controls", "controls")
		this.bindPanel("menu-open-about", "about")
		requireElement("menu-open-online").addEventListener("click", () => {
			// В панели онлайна надо вводить имя и код комнаты, поэтому экран
			// не переворачиваем — альбомный режим включится уже при старте матча.
			this.showPanel("online")
			this.callbacks.onOnline()
		})
		for (const id of ["settings-back", "controls-back", "about-back", "acts-back"]) {
			requireElement(id).addEventListener("click", () => this.showPanel("root"))
		}

		this.sensitivityInput.value = String(Math.round(this.settings.sensitivity * 100))
		this.volumeInput.value = String(Math.round(this.settings.volume * 100))
		this.brightnessInput.value = String(Math.round(this.settings.brightness * 100))
		this.invertInput.checked = this.settings.invertY
		this.fpsInput.checked = this.settings.showFps
		this.qualityInput.value = this.settings.quality
		this.refreshLabels()

		const onInput = (): void => {
			this.settings = {
				sensitivity: clamp(Number(this.sensitivityInput.value) / 100, 0.3, 2.5),
				volume: clamp(Number(this.volumeInput.value) / 100, 0, 1),
				brightness: clamp(Number(this.brightnessInput.value) / 100, 0.6, 1.6),
				invertY: this.invertInput.checked,
				showFps: this.fpsInput.checked,
				quality: QUALITY_LEVELS.includes(this.qualityInput.value as QualityLevel)
					? (this.qualityInput.value as QualityLevel)
					: "auto",
			}
			this.refreshLabels()
			saveSettings(this.settings)
			this.callbacks.onSettingsChange(this.settings)
		}
		for (const input of [
			this.sensitivityInput,
			this.volumeInput,
			this.brightnessInput,
			this.invertInput,
			this.fpsInput,
			this.qualityInput,
		]) {
			input.addEventListener("input", onInput)
			input.addEventListener("change", onInput)
		}
		requireElement("settings-reset").addEventListener("click", () => {
			this.settings = { ...DEFAULT_SETTINGS }
			this.sensitivityInput.value = "100"
			this.volumeInput.value = "80"
			this.brightnessInput.value = "100"
			this.invertInput.checked = false
			this.fpsInput.checked = DEFAULT_SETTINGS.showFps
			this.qualityInput.value = DEFAULT_SETTINGS.quality
			this.refreshLabels()
			saveSettings(this.settings)
			this.callbacks.onSettingsChange(this.settings)
		})
	}

	private bindPanel(buttonId: string, panel: Panel): void {
		requireElement(buttonId).addEventListener("click", () => this.showPanel(panel))
	}

	private refreshLabels(): void {
		setText(this.sensitivityValue, `${Math.round(this.settings.sensitivity * 100)}%`)
		setText(this.volumeValue, `${Math.round(this.settings.volume * 100)}%`)
		setText(this.brightnessValue, `${Math.round(this.settings.brightness * 100)}%`)
	}

	showPanel(panel: Panel): void {
		if (this.panel === "online" && panel !== "online") this.callbacks.onOnlineClose()
		this.panel = panel
		for (const [name, element] of Object.entries(this.panels)) {
			setHidden(element, name !== panel)
		}
	}

	get isVisible(): boolean {
		return this.visible
	}

	get currentPanel(): Panel {
		return this.panel
	}

	show(): void {
		this.visible = true
		this.showPanel("root")
		setHidden(this.screen, false)
	}

	hide(): void {
		this.visible = false
		setHidden(this.screen, true)
	}

	/** Esc в меню: из подраздела — назад, из корня — ничего. */
	handleEscape(): boolean {
		if (this.panel !== "root") {
			this.showPanel("root")
			return true
		}
		return false
	}

	setPlayLabel(text: string): void {
		setText(this.playButton, text)
	}
}
