/**
 * Мини-карта этажа на обычном 2D canvas.
 *
 * План рисуется один раз в оффскрин-canvas, каждый кадр копируется готовая
 * картинка плюс маркер игрока. Так миникарта почти ничего не стоит.
 */

import { EXIT_DOOR, HIDE_SPOTS } from "../game/items.js"
import { BUILDING, ROOMS, WALLS } from "../world/layout.js"
import { setHidden } from "./dom.js"

/** Цвет пола внутри самого проёма двери. */
const DOOR_GAP = "#f4f0e8"

const ROOM_FILL: Record<string, string> = {
	classroom: "#e8eef6",
	corridor: "#f3efe6",
	gym: "#e6efe4",
	hall: "#f6f0e4",
	cafeteria: "#f7ece6",
	library: "#efe9f4",
	restroom: "#e4f0f2",
	stairwell: "#eceaea",
	storage: "#eae8e4",
}

const LABELS: Record<string, string> = {
	wc: "С/У",
	stairs: "ЛЕСТНИЦА",
	storage: "СКЛАД",
	corridor: "КОРИДОР",
	gym: "СПОРТЗАЛ",
	hall: "ВЕСТИБЮЛЬ",
	cafeteria: "СТОЛОВАЯ",
	library: "БИБЛИОТЕКА",
}

export class Minimap {
	private readonly context: CanvasRenderingContext2D
	private readonly base: HTMLCanvasElement
	private readonly scale: number
	private readonly offsetX: number
	private readonly offsetY: number
	private nextUpdate = 0

	constructor(private readonly canvas: HTMLCanvasElement) {
		const context = canvas.getContext("2d")
		if (!context) throw new Error("Не удалось создать 2D контекст миникарты")
		this.context = context

		const padding = 10
		this.scale = Math.min(
			(canvas.width - padding * 2) / BUILDING.width,
			(canvas.height - padding * 2) / BUILDING.depth,
		)
		this.offsetX = (canvas.width - BUILDING.width * this.scale) / 2
		this.offsetY = (canvas.height - BUILDING.depth * this.scale) / 2

		this.base = document.createElement("canvas")
		this.base.width = canvas.width
		this.base.height = canvas.height
		this.drawPlan()
	}

	toggle(): void {
		setHidden(this.canvas, !this.canvas.hidden)
	}

	get visible(): boolean {
		return !this.canvas.hidden
	}

	private mapX(x: number): number {
		return this.offsetX + x * this.scale
	}

	private mapY(z: number): number {
		return this.offsetY + z * this.scale
	}

	private drawPlan(): void {
		const ctx = this.base.getContext("2d")
		if (!ctx) return
		ctx.clearRect(0, 0, this.base.width, this.base.height)

		// помещения
		for (const room of ROOMS) {
			ctx.fillStyle = ROOM_FILL[room.kind] ?? "#eeeeee"
			ctx.fillRect(
				this.mapX(room.x0),
				this.mapY(room.z0),
				(room.x1 - room.x0) * this.scale,
				(room.z1 - room.z0) * this.scale,
			)
		}

		// стены
		ctx.strokeStyle = "#3c3a38"
		ctx.lineCap = "butt"
		for (const wall of WALLS) {
			ctx.lineWidth = Math.max(1.4, wall.thickness * this.scale)
			ctx.beginPath()
			if (wall.axis === "x") {
				ctx.moveTo(this.mapX(wall.from), this.mapY(wall.at))
				ctx.lineTo(this.mapX(wall.to), this.mapY(wall.at))
			} else {
				ctx.moveTo(this.mapX(wall.at), this.mapY(wall.from))
				ctx.lineTo(this.mapX(wall.at), this.mapY(wall.to))
			}
			ctx.stroke()
		}

		// Проёмы. На плане дверь — это дырка в стене, полотно и дуга открывания.
		// Раньше проём заливался цветной плашкой и выглядел как кусок стены.
		for (const wall of WALLS) {
			for (const door of wall.doors ?? []) {
				const horizontal = wall.axis === "x"
				const thickness = Math.max(2, wall.thickness * this.scale)
				// Двери рисуем чуть крупнее реальных — иначе на маленькой карте их не видно.
				const length = Math.max(9, door.width * this.scale * 1.1)
				const cx = this.mapX(horizontal ? door.at : wall.at)
				const cy = this.mapY(horizontal ? wall.at : door.at)
				// Створка открывается внутрь помещения, то есть от середины здания.
				const dir = horizontal
					? wall.at < BUILDING.depth / 2
						? -1
						: 1
					: wall.at < BUILDING.width / 2
						? -1
						: 1

				// 1. Проём: стираем стену на всю ширину двери.
				ctx.fillStyle = DOOR_GAP
				if (horizontal) {
					ctx.fillRect(cx - length / 2, cy - thickness / 2 - 1, length, thickness + 2)
				} else {
					ctx.fillRect(cx - thickness / 2 - 1, cy - length / 2, thickness + 2, length)
				}

				// 2. Косяки — тёмные штрихи по краям проёма.
				ctx.fillStyle = "#3c3a38"
				if (horizontal) {
					ctx.fillRect(cx - length / 2 - 0.9, cy - thickness / 2, 1.8, thickness)
					ctx.fillRect(cx + length / 2 - 0.9, cy - thickness / 2, 1.8, thickness)
				} else {
					ctx.fillRect(cx - thickness / 2, cy - length / 2 - 0.9, thickness, 1.8)
					ctx.fillRect(cx - thickness / 2, cy + length / 2 - 0.9, thickness, 1.8)
				}

				const color =
					door.kind === "glass" ? "#2783de" : door.kind === "arch" ? "#9a958c" : "#d2691e"

				// 3. Арка — просто широкий проём с тонкой перемычкой, без створок.
				if (door.kind === "arch") {
					ctx.strokeStyle = "rgba(120,116,110,0.8)"
					ctx.lineWidth = 1
					ctx.beginPath()
					if (horizontal) {
						ctx.moveTo(cx - length / 2, cy)
						ctx.lineTo(cx + length / 2, cy)
					} else {
						ctx.moveTo(cx, cy - length / 2)
						ctx.lineTo(cx, cy + length / 2)
					}
					ctx.stroke()
					continue
				}

				// 4. Створки: одна у обычной двери, две у двойной и стеклянной.
				const single = door.kind === "door"
				const leaves: Array<1 | -1> = single ? [1] : [1, -1]
				const leafLength = single ? length * 0.9 : length * 0.46
				const swing = 1.05
				const orient = horizontal ? 1 : -1
				for (const sweep of leaves) {
					const hinge = (-length / 2) * sweep
					const hx = horizontal ? cx + hinge : cx
					const hy = horizontal ? cy : cy + hinge
					const base = horizontal
						? sweep > 0
							? 0
							: Math.PI
						: sweep > 0
							? Math.PI / 2
							: -Math.PI / 2
					const open = base + swing * dir * sweep * orient
					// Полотно двери.
					ctx.strokeStyle = color
					ctx.lineWidth = 2.2
					ctx.lineCap = "round"
					ctx.beginPath()
					ctx.moveTo(hx, hy)
					ctx.lineTo(hx + Math.cos(open) * leafLength, hy + Math.sin(open) * leafLength)
					ctx.stroke()
					// Дуга открывания: сразу понятно, в какую сторону ведёт дверь.
					ctx.strokeStyle = "rgba(60,58,54,0.4)"
					ctx.lineWidth = 1
					ctx.beginPath()
					ctx.arc(hx, hy, leafLength, base, open, open < base)
					ctx.stroke()
				}
				ctx.lineCap = "butt"
			}
		}


		// подписи
		ctx.fillStyle = "#5c5954"
		ctx.textAlign = "center"
		ctx.textBaseline = "middle"
		for (const room of ROOMS) {
			const label = LABELS[room.id] ?? room.id.toUpperCase()
			const width = (room.x1 - room.x0) * this.scale
			const height = (room.z1 - room.z0) * this.scale
			if (width < 26 || height < 12) continue
			const size = Math.max(9, Math.min(15, Math.round(Math.min(width / 6, height / 2.2))))
			ctx.font = `600 ${size}px system-ui, sans-serif`
			ctx.fillText(
				label,
				this.mapX((room.x0 + room.x1) / 2),
				this.mapY((room.z0 + room.z1) / 2),
				width - 8,
			)
		}

		// шкафчики, в которых можно спрятаться
		ctx.fillStyle = "#7a5cc0"
		for (const spot of HIDE_SPOTS) {
			ctx.fillRect(this.mapX(spot.x) - 2.5, this.mapY(spot.z) - 2.5, 5, 5)
		}

		// выход из школы
		const exitX = this.mapX(EXIT_DOOR.x)
		const exitY = this.mapY(EXIT_DOOR.z)
		ctx.fillStyle = "#2f9e5f"
		ctx.beginPath()
		ctx.arc(exitX, exitY, 4.5, 0, Math.PI * 2)
		ctx.fill()
		ctx.fillStyle = "#1f6b40"
		ctx.font = "700 11px system-ui, sans-serif"
		ctx.fillText("ВЫХОД", exitX, exitY - 12)
		// рамка здания
		ctx.strokeStyle = "#2c2c2b"
		ctx.lineWidth = 1
		ctx.strokeRect(
			this.mapX(0) - 0.5,
			this.mapY(0) - 0.5,
			BUILDING.width * this.scale + 1,
			BUILDING.depth * this.scale + 1,
		)
	}

	render(x: number, z: number, yaw: number, now: number): void {
		if (this.canvas.hidden || now < this.nextUpdate) return
		this.nextUpdate = now + 60
		const ctx = this.context
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
		ctx.drawImage(this.base, 0, 0)

		const px = this.mapX(x)
		const py = this.mapY(z)
		// взгляд вперёд в мире = (-sin yaw, -cos yaw)
		const angle = Math.atan2(-Math.cos(yaw), -Math.sin(yaw))
		const spread = 0.55
		const reach = 26

		ctx.fillStyle = "rgba(39, 131, 222, 0.22)"
		ctx.beginPath()
		ctx.moveTo(px, py)
		ctx.arc(px, py, reach, angle - spread, angle + spread)
		ctx.closePath()
		ctx.fill()

		ctx.fillStyle = "#2783de"
		ctx.strokeStyle = "#ffffff"
		ctx.lineWidth = 2
		ctx.beginPath()
		ctx.arc(px, py, 5, 0, Math.PI * 2)
		ctx.fill()
		ctx.stroke()
	}
}
