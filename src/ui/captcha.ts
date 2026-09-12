/**
 * Терминал системы детонации (акт II).
 *
 * Три шага капчи → кнопка «Взломать» → анимация взлома на минуту.
 * Время взлома считает игра — здесь только отрисовка и ввод.
 */

import { makeCaptcha, type CaptchaTask } from "../game/act2.js"
import { requireElement, setHidden, setText } from "./dom.js"

export interface CaptchaCallbacks {
	/** Капча пройдена и игрок нажал «Взломать». */
	onHack: () => void
	/** Игрок закрыл терминал. */
	onClose: () => void
	/** Звуковая обратная связь. */
	onSound?: (name: "click" | "ok" | "fail") => void
}

export class CaptchaPanel {
	private readonly root = requireElement("captcha")
	private readonly stepEl = requireElement("captcha-step")
	private readonly hintEl = requireElement("captcha-hint")
	private readonly questionEl = requireElement("captcha-question")
	private readonly optionsEl = requireElement("captcha-options")
	private readonly statusEl = requireElement("captcha-status")
	private readonly progressEl = requireElement("captcha-progress")
	private readonly barEl = requireElement("captcha-bar")
	private readonly progressLabelEl = requireElement("captcha-progress-label")
	private readonly hackButton = requireElement("captcha-hack") as HTMLButtonElement
	private readonly closeButton = requireElement("captcha-close") as HTMLButtonElement

	private tasks: CaptchaTask[] = []
	private index = 0
	private solved = false
	private hacking = false
	private open = false
	private lastPercent = -1

	constructor(private readonly callbacks: CaptchaCallbacks) {
		this.hackButton.addEventListener("click", () => {
			if (!this.solved || this.hacking) return
			this.hacking = true
			this.hackButton.disabled = true
			setText(this.hackButton, "Взлом идёт…")
			setHidden(this.progressEl, false)
			setText(this.statusEl, "Не выключайте ноутбук. До снятия блокировки — около минуты.")
			this.optionsEl.textContent = ""
			this.callbacks.onSound?.("ok")
			this.callbacks.onHack()
		})
		this.closeButton.addEventListener("click", () => {
			this.callbacks.onSound?.("click")
			this.callbacks.onClose()
		})
	}

	get isOpen(): boolean {
		return this.open
	}

	get isHacking(): boolean {
		return this.hacking
	}

	/** Новая сессия капчи. */
	start(): void {
		this.tasks = makeCaptcha()
		this.index = 0
		this.solved = false
		this.hacking = false
		this.lastPercent = -1
		this.hackButton.disabled = true
		setText(this.hackButton, "Взломать")
		setHidden(this.progressEl, true)
		setText(this.statusEl, "Пройдите проверку, чтобы получить доступ к каналу детонации.")
		this.render()
		this.show(true)
	}

	/** Режим уже идущего взлома (в онлайне взлом мог начать другой игрок). */
	showHacking(): void {
		this.tasks = []
		this.solved = true
		this.hacking = true
		this.optionsEl.textContent = ""
		setText(this.stepEl, "Доступ получен")
		setText(this.hintEl, "Канал детонации")
		setText(this.questionEl, "Идёт взлом системы…")
		this.hackButton.disabled = true
		setText(this.hackButton, "Взлом идёт…")
		setHidden(this.progressEl, false)
		this.show(true)
	}

	show(visible: boolean): void {
		this.open = visible
		setHidden(this.root, !visible)
	}

	/** Прогресс взлома 0…1. */
	setProgress(value: number): void {
		const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
		if (percent === this.lastPercent) return
		this.lastPercent = percent
		this.barEl.style.width = `${percent}%`
		setText(this.progressLabelEl, `Взлом: ${percent}%`)
	}

	/** Взлом завершён. */
	finish(): void {
		this.hacking = false
		setText(this.statusEl, "Система взломана. Детонаторы отключены.")
		setText(this.questionEl, "ДОСТУП ПОЛУЧЕН")
		this.setProgress(1)
		window.setTimeout(() => this.show(false), 900)
	}

	reset(): void {
		this.hacking = false
		this.solved = false
		this.tasks = []
		this.optionsEl.textContent = ""
		setHidden(this.progressEl, true)
		this.show(false)
	}

	private render(): void {
		const task = this.tasks[this.index]
		if (!task) {
			this.solved = true
			this.optionsEl.textContent = ""
			setText(this.stepEl, "Проверка пройдена")
			setText(this.hintEl, "Доступ к каналу детонации открыт")
			setText(this.questionEl, "Нажмите «Взломать»")
			setText(this.statusEl, "Взлом займёт около минуты — таймер продолжает идти.")
			this.hackButton.disabled = false
			return
		}
		setText(this.stepEl, `Шаг ${this.index + 1} из ${this.tasks.length}`)
		setText(this.hintEl, task.hint)
		setText(this.questionEl, task.question)
		this.optionsEl.textContent = ""
		for (const option of task.options) {
			const button = document.createElement("button")
			button.type = "button"
			button.className = "captcha__option"
			button.textContent = option
			button.addEventListener("click", () => this.answer(option, button))
			this.optionsEl.append(button)
		}
	}

	private answer(option: string, button: HTMLButtonElement): void {
		const task = this.tasks[this.index]
		if (!task || this.hacking) return
		if (option === task.answer) {
			this.callbacks.onSound?.("ok")
			button.classList.add("captcha__option--ok")
			this.index += 1
			setText(this.statusEl, "Верно. Следующая проверка…")
			window.setTimeout(() => this.render(), 260)
			return
		}
		this.callbacks.onSound?.("fail")
		button.classList.add("captcha__option--bad")
		setText(this.statusEl, "Неверно. Система сбросила проверку — шаг заново.")
		const fresh = makeCaptcha()
		this.tasks[this.index] = fresh[0]
		window.setTimeout(() => this.render(), 520)
	}
}
