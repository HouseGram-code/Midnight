/**
 * Главное меню и настройки.
 *
 * Настройки хранятся в localStorage, поэтому переживают перезагрузку.
 * Всё на обычных DOM-событиях — никаких фреймворков.
 */

import { requireElement, setHidden, setText } from "./dom.js"
import { DIFFICULTY_PRESETS, difficultyOf, type Difficulty } from "../game/difficulty.js"

export const GAME_VERSION = "1.0.3-beta"

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
	/** Сложность одиночной игры. */
	difficulty: Difficulty
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
	difficulty: "normal",
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
			difficulty: difficultyOf(parsed.difficulty),
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

type Panel = "root" | "acts" | "skins" | "settings" | "controls" | "about" | "online"
type PlayerSkinId = "ryzik3489" | "classic"

const SKIN_STORAGE_KEY = "school3d.skin.v1"

function loadSkin(): PlayerSkinId {
	try {
		return localStorage.getItem(SKIN_STORAGE_KEY) === "ryzik3489" ? "ryzik3489" : "classic"
	} catch {
		return "classic"
	}
}

export interface MenuCallbacks {
	onPlay: (act: 1 | 2) => void
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
		skins: requireElement("menu-skins"),
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
	private readonly difficultyInput = requireElement("set-difficulty") as HTMLSelectElement
	private readonly difficultyNote = requireElement("set-difficulty-note")
	private readonly sensitivityValue = requireElement("set-sensitivity-value")
	private readonly volumeValue = requireElement("set-volume-value")
	private readonly brightnessValue = requireElement("set-brightness-value")
	private readonly skinPreview = requireElement("skin-preview")
	private readonly skinPreviewName = requireElement("skin-preview-name")
	private readonly skinPreviewStatus = requireElement("skin-preview-status")
	private readonly skinCards = Array.from(document.querySelectorAll<HTMLButtonElement>(".skin-card"))

	settings: GameSettings
	private panel: Panel = "root"
	private visible = true
	private selectedSkin: PlayerSkinId = loadSkin()

	constructor(private readonly callbacks: MenuCallbacks) {
		this.settings = loadSettings()
		setText(this.versionEl, `версия ${GAME_VERSION}`)

		// Кнопка «Играть» ведёт на выбор акта, а не сразу в игру.
		this.playButton.addEventListener("click", () => this.showPanel("acts"))
		const actsNote = requireElement("acts-note")
		requireElement("act-1").addEventListener("click", () => {
			requestMobileLandscape()
			this.callbacks.onPlay(1)
		})
		requireElement("act-2").addEventListener("click", () => {
			setText(actsNote, "Запускаем бета-Акт II: второй этаж, динамит и 5 минут.")
			requestMobileLandscape()
			this.callbacks.onPlay(2)
		})
		this.bindPanel("menu-open-settings", "settings")
		this.bindPanel("menu-open-controls", "controls")
		this.bindPanel("menu-open-about", "about")
		this.bindPanel("menu-open-skins", "skins")
		requireElement("menu-open-online").addEventListener("click", () => {
			// В панели онлайна надо вводить имя и код комнаты, поэтому экран
			// не переворачиваем — альбомный режим включится уже при старте матча.
			this.showPanel("online")
			this.callbacks.onOnline()
		})
		for (const id of ["settings-back", "controls-back", "about-back", "acts-back", "skins-back"]) {
			requireElement(id).addEventListener("click", () => this.showPanel("root"))
		}
		for (const card of this.skinCards) {
			card.addEventListener("click", () => {
				this.selectedSkin = card.dataset.skin === "ryzik3489" ? "ryzik3489" : "classic"
				try {
					localStorage.setItem(SKIN_STORAGE_KEY, this.selectedSkin)
				} catch {
					// В приватном режиме скин работает до перезагрузки.
				}
				this.renderSkin()
			})
		}
		this.renderSkin()

		this.sensitivityInput.value = String(Math.round(this.settings.sensitivity * 100))
		this.volumeInput.value = String(Math.round(this.settings.volume * 100))
		this.brightnessInput.value = String(Math.round(this.settings.brightness * 100))
		this.invertInput.checked = this.settings.invertY
		this.fpsInput.checked = this.settings.showFps
		this.qualityInput.value = this.settings.quality
		this.difficultyInput.value = this.settings.difficulty
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
				difficulty: difficultyOf(this.difficultyInput.value),
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
			this.difficultyInput,
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
			this.difficultyInput.value = DEFAULT_SETTINGS.difficulty
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
		// Под списком сложности сразу пишем, что именно меняется.
		const preset = DIFFICULTY_PRESETS[this.settings.difficulty]
		setText(this.difficultyNote, `${preset.note} Жизней: ${preset.lives}.`)
	}

	private renderSkin(): void {
		this.skinPreview.dataset.skin = this.selectedSkin
		const ryzik = this.selectedSkin === "ryzik3489"
		setText(this.skinPreviewName, ryzik ? "ryzik3489" : "Обычный")
		setText(this.skinPreviewStatus, "Надет · бесплатно")
		for (const card of this.skinCards) {
			const active = card.dataset.skin === this.selectedSkin
			card.classList.toggle("skin-card--active", active)
			card.setAttribute("aria-pressed", String(active))
		}
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
