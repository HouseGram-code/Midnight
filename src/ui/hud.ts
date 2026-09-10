/**
 * HUD: название помещения, координаты и техническая статистика.
 *
 * DOM обновляется не чаще 8 раз в секунду: каждый кадр трогать textContent
 * — лишняя нагрузка на главный поток.
 */

import { findRoomAt } from "../world/layout.js"
import { requireElement, setHidden, setText } from "./dom.js"

export interface HudState {
	x: number
	y: number
	z: number
	fps: number
	frameMs: number
	drawCalls: number
	triangles: number
	totalTriangles: number
	chunks: number
	totalChunks: number
	resolutionScale: number
	crouching: boolean
	sprinting: boolean
}

export class Hud {
	private readonly root = requireElement("hud")
	private readonly roomEl = requireElement("hud-room")
	private readonly positionEl = requireElement("hud-position")
	private readonly modeEl = requireElement("hud-mode")
	private readonly statsEl = requireElement("stats")
	private readonly helpEl = requireElement("help")
	private readonly fpsEl = requireElement("stat-fps")
	private readonly frameEl = requireElement("stat-frame")
	private readonly drawsEl = requireElement("stat-draws")
	private readonly trisEl = requireElement("stat-tris")
	private readonly scaleEl = requireElement("stat-scale")
	private nextUpdate = 0

	setVisible(visible: boolean): void {
		setHidden(this.root, !visible)
	}

	toggleStats(): void {
		setHidden(this.statsEl, !this.statsEl.hidden)
	}

	toggleHelp(): void {
		setHidden(this.helpEl, !this.helpEl.hidden)
	}

	update(state: HudState, now: number): void {
		if (now < this.nextUpdate) return
		this.nextUpdate = now + 125

		const room = findRoomAt(state.x, state.z)
		setText(this.roomEl, room ? room.name : "Улица")
		setText(
			this.positionEl,
			`X ${state.x.toFixed(1)} · Y ${state.y.toFixed(1)} · Z ${state.z.toFixed(1)}`,
		)
		setText(
			this.modeEl,
			state.crouching ? "присед" : state.sprinting ? "бег" : "шаг",
		)

		if (this.statsEl.hidden) return
		setText(this.fpsEl, `${Math.round(state.fps)}`)
		setText(this.frameEl, `${state.frameMs.toFixed(1)} мс`)
		setText(this.drawsEl, `${state.drawCalls} / ${state.totalChunks}`)
		setText(
			this.trisEl,
			`${formatCount(state.triangles)} / ${formatCount(state.totalTriangles)}`,
		)
		setText(this.scaleEl, `${Math.round(state.resolutionScale * 100)}%`)
	}
}

function formatCount(value: number): string {
	if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
	return `${value}`
}
