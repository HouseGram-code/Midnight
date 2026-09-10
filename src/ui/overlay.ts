/** Экраны поверх игры: загрузка, старт, пауза, ошибка. */

import { requireElement, setHidden, setText } from "./dom.js"

export class Overlay {
	private readonly loading = requireElement("loading")
	private readonly loadingText = requireElement("loading-text")
	private readonly start = requireElement("start")
	private readonly startButton = requireElement("start-play")
	private readonly pause = requireElement("pause")
	private readonly pauseButton = requireElement("pause-resume")
	private readonly error = requireElement("error")
	private readonly errorText = requireElement("error-text")

	setLoading(text: string | null): void {
		if (text === null) {
			setHidden(this.loading, true)
			return
		}
		setText(this.loadingText, text)
		setHidden(this.loading, false)
	}

	showStart(): void {
		setHidden(this.start, false)
	}

	hideStart(): void {
		setHidden(this.start, true)
	}

	showPause(): void {
		setHidden(this.pause, false)
	}

	hidePause(): void {
		setHidden(this.pause, true)
	}

	get pauseVisible(): boolean {
		return !this.pause.hidden
	}

	showError(message: string): void {
		setText(this.errorText, message)
		setHidden(this.error, false)
		setHidden(this.loading, true)
	}

	onStart(handler: () => void): void {
		this.startButton.addEventListener("click", handler)
	}

	onResume(handler: () => void): void {
		this.pauseButton.addEventListener("click", handler)
	}
}
