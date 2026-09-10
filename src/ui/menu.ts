/**
 * Главное меню и настройки.
 *
 * Настройки хранятся в localStorage, поэтому переживают перезагрузку.
 * Всё на обычных DOM-событиях — никаких фреймворков.
 */

import { requireElement, setHidden, setText } from "./dom.js"

export const GAME_VERSION = "1.1.1-beta"

export interface GameSettings {
	/** Чувствительность мыши, множитель 0.3…2.5. */
	sensitivity: number
	/** Общая громкость 0…1. */
	volume: number
	/** Яркость ночи 0.6…1.6 — чтобы на любом мониторе было видно. */
	brightness: number
	/** Инвертировать вертикальную ось. */
	invertY: boolean
}

const STORAGE_KEY = "school3d.settings.v1"

const DEFAULT_SETTINGS: GameSettings = {
	sensitivity: 1,
	volume: 0.8,
	brightness: 1,
	invertY: false,
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

type Panel = "root" | "settings" | "controls" | "about" | "online"

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
		about: requireElement("menu-about"),
		online: requireElement("menu-online"),
	}
	private readonly playButton = requireElement("menu-play")
	private readonly versionEl = requireElement("menu-version")
	private readonly sensitivityInput = requireElement("set-sensitivity") as HTMLInputElement
	private readonly volumeInput = requireElement("set-volume") as HTMLInputElement
	private readonly brightnessInput = requireElement("set-brightness") as HTMLInputElement
	private readonly invertInput = requireElement("set-invert") as HTMLInputElement
	private readonly sensitivityValue = requireElement("set-sensitivity-value")
	private readonly volumeValue = requireElement("set-volume-value")
	private readonly brightnessValue = requireElement("set-brightness-value")

	settings: GameSettings
	private panel: Panel = "root"
	private visible = true

	constructor(private readonly callbacks: MenuCallbacks) {
		this.settings = loadSettings()
		setText(this.versionEl, `версия ${GAME_VERSION}`)

		this.playButton.addEventListener("click", () => this.callbacks.onPlay())
		this.bindPanel("menu-open-settings", "settings")
		this.bindPanel("menu-open-controls", "controls")
		this.bindPanel("menu-open-about", "about")
		requireElement("menu-open-online").addEventListener("click", () => {
			this.showPanel("online")
			this.callbacks.onOnline()
		})
		for (const id of ["settings-back", "controls-back", "about-back"]) {
			requireElement(id).addEventListener("click", () => this.showPanel("root"))
		}

		this.sensitivityInput.value = String(Math.round(this.settings.sensitivity * 100))
		this.volumeInput.value = String(Math.round(this.settings.volume * 100))
		this.brightnessInput.value = String(Math.round(this.settings.brightness * 100))
		this.invertInput.checked = this.settings.invertY
		this.refreshLabels()

		const onInput = (): void => {
			this.settings = {
				sensitivity: clamp(Number(this.sensitivityInput.value) / 100, 0.3, 2.5),
				volume: clamp(Number(this.volumeInput.value) / 100, 0, 1),
				brightness: clamp(Number(this.brightnessInput.value) / 100, 0.6, 1.6),
				invertY: this.invertInput.checked,
			}
			this.refreshLabels()
			saveSettings(this.settings)
			this.callbacks.onSettingsChange(this.settings)
		}
		for (const input of [this.sensitivityInput, this.volumeInput, this.brightnessInput, this.invertInput]) {
			input.addEventListener("input", onInput)
			input.addEventListener("change", onInput)
		}
		requireElement("settings-reset").addEventListener("click", () => {
			this.settings = { ...DEFAULT_SETTINGS }
			this.sensitivityInput.value = "100"
			this.volumeInput.value = "80"
			this.brightnessInput.value = "100"
			this.invertInput.checked = false
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
