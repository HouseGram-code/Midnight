/**
 * Игровой интерфейс хоррор-режима: жизни, предметы, задача,
 * подсказка взаимодействия с прогрессом удержания, субтитры, виньетка,
 * затемнение и киношные полосы для кат-сцен.
 *
 * DOM дёргается только при реальном изменении значения — в игровом цикле
 * лишние записи в textContent заметно греют главный поток.
 */

import { requireElement, setHidden, setText } from "./dom.js"

export interface ItemSlotState {
	label: string
	found: boolean
}

/** Одна ячейка пояса предметов (клавиши 1…6). */
export interface HotbarSlotState {
	/** Номер клавиши. */
	key: string
	label: string
	/** Ячейка выбрана — этот предмет в руке. */
	active: boolean
	/** В ячейке есть предмет. */
	filled: boolean
}

export class GameHud {
	private readonly root = requireElement("game-hud")
	private readonly heartsEl = requireElement("hearts")
	private readonly itemsEl = requireElement("item-slots")
	private readonly hotbarEl = requireElement("hotbar")
	private readonly objectiveEl = requireElement("objective")
	private readonly promptEl = requireElement("prompt")
	private readonly promptTextEl = requireElement("prompt-text")
	private readonly holdEl = requireElement("hold")
	private readonly holdFillEl = requireElement("hold-fill")
	private readonly holdLabelEl = requireElement("hold-label")
	private readonly subtitleEl = requireElement("subtitle")
	private readonly handEl = requireElement("hand-label")
	private readonly vignetteEl = requireElement("vignette")
	private readonly damageEl = requireElement("damage")
	private readonly fadeEl = requireElement("fade")
	private readonly letterboxEl = requireElement("letterbox")
	private readonly skipEl = requireElement("skip-hint")
	private readonly toastEl = requireElement("toast")
	private readonly timerEl = requireElement("act2-timer")
	private readonly timerValueEl = requireElement("act2-timer-value")
	private readonly timerLabelEl = requireElement("act2-timer-label")

	private hearts = -1
	private maxHearts = 5
	private itemsSignature = ""
	private hotbarSignature = "-"
	private vignetteLevel = -1
	private fadeLevel = -1
	private holdValue = -1
	private damageTimer = 0
	private toastTimer = 0
	private timerSignature = "-"

	setVisible(visible: boolean): void {
		setHidden(this.root, !visible)
	}

	/**
	 * Таймер до взрыва (акт II).
	 * `null` — таймера нет; `defused` — система взломана.
	 */
	setTimer(text: string | null, label = "до взрыва", mode: "normal" | "warn" | "safe" = "normal"): void {
		const signature = text === null ? "-" : `${text}|${label}|${mode}`
		if (signature === this.timerSignature) return
		this.timerSignature = signature
		setHidden(this.timerEl, text === null)
		if (text === null) return
		setText(this.timerValueEl, text)
		setText(this.timerLabelEl, label)
		this.timerEl.classList.toggle("act2-timer--warn", mode === "warn")
		this.timerEl.classList.toggle("act2-timer--safe", mode === "safe")
	}

	setLives(current: number, max = 5): void {
		if (this.hearts === current && this.maxHearts === max) return
		this.hearts = current
		this.maxHearts = max
		this.heartsEl.textContent = ""
		for (let i = 0; i < max; i++) {
			const heart = document.createElement("span")
			heart.className = i < current ? "heart" : "heart heart--lost"
			heart.textContent = i < current ? "\u2665" : "\u2661"
			this.heartsEl.append(heart)
		}
	}

	setItems(slots: readonly ItemSlotState[]): void {
		const signature = slots.map((slot) => `${slot.label}:${slot.found ? 1 : 0}`).join("|")
		if (signature === this.itemsSignature) return
		this.itemsSignature = signature
		this.itemsEl.textContent = ""
		for (const slot of slots) {
			const chip = document.createElement("span")
			chip.className = slot.found ? "slot slot--found" : "slot"
			chip.textContent = slot.found ? slot.label : "\u2022 \u2022 \u2022"
			chip.title = slot.label
			this.itemsEl.append(chip)
		}
	}

	/** Пояс предметов: пустой список прячет панель. */
	setHotbar(slots: readonly HotbarSlotState[]): void {
		const signature = slots
			.map((slot) => `${slot.key}:${slot.label}:${slot.active ? 1 : 0}${slot.filled ? 1 : 0}`)
			.join("|")
		if (signature === this.hotbarSignature) return
		this.hotbarSignature = signature
		this.hotbarEl.textContent = ""
		setHidden(this.hotbarEl, slots.length === 0)
		for (const slot of slots) {
			const cell = document.createElement("span")
			cell.className = `cell${slot.filled ? " cell--filled" : ""}${slot.active ? " cell--active" : ""}`
			const key = document.createElement("i")
			key.className = "cell__key"
			key.textContent = slot.key
			const label = document.createElement("b")
			label.className = "cell__label"
			label.textContent = slot.filled ? slot.label : "\u2014"
			cell.append(key, label)
			this.hotbarEl.append(cell)
		}
	}

	setObjective(text: string): void {
		setText(this.objectiveEl, text)
	}

	setPrompt(text: string | null): void {
		if (text === null) {
			setHidden(this.promptEl, true)
			return
		}
		setText(this.promptTextEl, text)
		setHidden(this.promptEl, false)
	}

	/** progress — 0…1 или null, если ничего не делаем. */
	setHold(progress: number | null, label = ""): void {
		if (progress === null) {
			if (this.holdValue !== -1) {
				this.holdValue = -1
				setHidden(this.holdEl, true)
			}
			return
		}
		const clamped = Math.max(0, Math.min(1, progress))
		setHidden(this.holdEl, false)
		setText(this.holdLabelEl, label)
		if (Math.abs(clamped - this.holdValue) > 0.01) {
			this.holdValue = clamped
			this.holdFillEl.style.width = `${(clamped * 100).toFixed(1)}%`
		}
	}

	setSubtitle(text: string | null): void {
		if (text === null) {
			setHidden(this.subtitleEl, true)
			return
		}
		setText(this.subtitleEl, text)
		setHidden(this.subtitleEl, false)
	}

	setHandLabel(text: string | null): void {
		if (text === null) {
			setHidden(this.handEl, true)
			return
		}
		setText(this.handEl, text)
		setHidden(this.handEl, false)
	}

	/** 0 — спокойно, 1 — учительница рядом. */
	setVignette(level: number): void {
		const clamped = Math.max(0, Math.min(1, level))
		if (Math.abs(clamped - this.vignetteLevel) < 0.02) return
		this.vignetteLevel = clamped
		this.vignetteEl.style.opacity = clamped.toFixed(2)
	}

	/** Затемнение экрана: 0 — видно всё, 1 — чёрный экран. */
	setFade(level: number): void {
		const clamped = Math.max(0, Math.min(1, level))
		if (Math.abs(clamped - this.fadeLevel) < 0.01) return
		this.fadeLevel = clamped
		this.fadeEl.style.opacity = clamped.toFixed(3)
		this.fadeEl.style.pointerEvents = clamped > 0.95 ? "auto" : "none"
	}

	setLetterbox(active: boolean): void {
		setHidden(this.letterboxEl, !active)
	}

	setSkipHint(text: string | null): void {
		if (text === null) {
			setHidden(this.skipEl, true)
			return
		}
		setText(this.skipEl, text)
		setHidden(this.skipEl, false)
	}

	flashDamage(): void {
		this.damageTimer = 0.55
		this.damageEl.style.opacity = "1"
	}

	toast(text: string, seconds = 3.2): void {
		setText(this.toastEl, text)
		setHidden(this.toastEl, false)
		this.toastTimer = seconds
	}

	/** Вызывать каждый кадр: гасит вспышку урона и убирает уведомления. */
	update(dt: number): void {
		if (this.damageTimer > 0) {
			this.damageTimer -= dt
			const level = Math.max(0, this.damageTimer / 0.55)
			this.damageEl.style.opacity = level.toFixed(2)
		}
		if (this.toastTimer > 0) {
			this.toastTimer -= dt
			if (this.toastTimer <= 0) setHidden(this.toastEl, true)
		}
	}

	reset(): void {
		this.timerSignature = "-"
		this.setTimer(null)
		this.hotbarSignature = "-"
		this.setHotbar([])
		this.setFade(0)
		this.setVignette(0)
		this.setPrompt(null)
		this.setHold(null)
		this.setSubtitle(null)
		this.setHandLabel(null)
		this.setLetterbox(false)
		this.setSkipHint(null)
		setHidden(this.toastEl, true)
		this.damageEl.style.opacity = "0"
	}
}
