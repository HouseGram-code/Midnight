/**
 * ВТОРОЙ ЭТАЖ ШКОЛЫ.
 *
 * Отдельный модуль: своя разметка, свои стены, свои коллайдеры и свой свет.
 * Пол второго этажа лежит на плите перекрытия (BASE = 3.6), потолок — на 6.8,
 * сверху ещё плоская крыша с парапетом, чтобы школа снаружи выглядела целой.
 *
 * План второго этажа:
 *
 *   z=0  ┌─лестница─┬─АРХИВ─┬─201 физика─┬─СЕРВЕРНАЯ─┬─УЧИТЕЛЬСКАЯ─┬─ДИРЕКТОР─┬КЛАД┐
 *   z=12 ├──────────────── К О Р И Д О Р   В Т О Р О Г О   Э Т А Ж А ────────────────┤
 *   z=18 └── стеклянная стена над вестибюлем ──┴─АКТОВЫЙ ЗАЛ─┐
 *                                              z=31 ├─206 информатика─┤ z=44
 *                                                  x=50            x=72
 */

import { shade, type Color, type MeshBuilder } from "../core/mesh.js"
import type { CollisionWorld } from "./collision.js"
import { BUILDING } from "./layout.js"
import type { Light } from "./lighting.js"
import { BOOK_COLORS, PALETTE } from "./palette.js"

/** Уровень пола второго этажа (верх плиты перекрытия первого). */
export const FLOOR2_Y = 3.6
/** Высота помещений второго этажа. */
export const FLOOR2_HEIGHT = 3.2
/** Уровень потолка второго этажа. */
export const FLOOR2_TOP = FLOOR2_Y + FLOOR2_HEIGHT

const BASE = FLOOR2_Y
const TOP = FLOOR2_TOP
const EXT = BUILDING.exteriorThickness
const INT = BUILDING.interiorThickness

const LAMP = { radius: 8.5, intensity: 0.55, color: [1, 0.95, 0.86] as Color }

export interface Floor2Ctx {
	get: (name: string) => MeshBuilder
	collision: CollisionWorld
	lights: Light[]
}

interface Ctx {
	mesh: MeshBuilder
	collision: CollisionWorld
}

/** Комната второго этажа — для миникарты и подсказок. */
export interface Floor2Room {
	id: string
	name: string
	x0: number
	z0: number
	x1: number
	z1: number
}

export const FLOOR2_ROOMS: readonly Floor2Room[] = [
	{ id: "landing2", name: "Лестничная площадка · 2 этаж", x0: 5.5, z0: 0, x1: 11, z1: 5.4 },
	{ id: "archive", name: "Архив", x0: 11, z0: 0, x1: 22, z1: 12 },
	{ id: "lab", name: "Кабинет 201 · физика", x0: 22, z0: 0, x1: 33, z1: 12 },
	{ id: "server", name: "Серверная", x0: 33, z0: 0, x1: 44, z1: 12 },
	{ id: "staff", name: "Учительская", x0: 44, z0: 0, x1: 55, z1: 12 },
	{ id: "principal", name: "Кабинет директора", x0: 55, z0: 0, x1: 66, z1: 12 },
	{ id: "store2", name: "Кладовая второго этажа", x0: 66, z0: 0, x1: 72, z1: 12 },
	{ id: "corridor2", name: "Коридор второго этажа", x0: 0, z0: 12, x1: 72, z1: 18 },
	{ id: "assembly", name: "Актовый зал", x0: 50, z0: 18, x1: 72, z1: 31 },
	{ id: "info", name: "Кабинет 206 · информатика", x0: 50, z0: 31, x1: 72, z1: 44 },
]

/** Какая комната второго этажа в точке (x, z). */
export function findFloor2RoomAt(x: number, z: number): Floor2Room | null {
	for (const room of FLOOR2_ROOMS) {
		if (x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1) return room
	}
	return null
}

// ─────────────────── примитивы ───────────────────

function solid(ctx: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: Color): void {
	ctx.mesh.box(x0, y0, z0, x1, y1, z1, color)
	ctx.collision.add(
		Math.min(x0, x1),
		Math.min(y0, y1),
		Math.min(z0, z1),
		Math.max(x0, x1),
		Math.max(y0, y1),
		Math.max(z0, z1),
	)
}

function decor(ctx: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: Color): void {
	ctx.mesh.box(x0, y0, z0, x1, y1, z1, color)
}

function glow(ctx: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: Color): void {
	ctx.mesh.box(x0, y0, z0, x1, y1, z1, color, { emissive: true })
}

/** Проём в стене: дверь (от пола) или окно (от подоконника). */
interface Opening {
	at: number
	width: number
	y0: number
	y1: number
	/** Заполнить стеклом. */
	glass?: boolean
}

function door(at: number, width = 1.1, height = 2.15): Opening {
	return { at, width, y0: BASE, y1: BASE + height }
}

function window2(at: number, width = 2.2, sill = 0.95, height = 1.75): Opening {
	return { at, width, y0: BASE + sill, y1: BASE + sill + height, glass: true }
}

/** Стена второго этажа с проёмами. */
function wallRun(
	ctx: Ctx,
	axis: "x" | "z",
	at: number,
	from: number,
	to: number,
	thickness: number,
	color: Color,
	openings: Opening[] = [],
	top = TOP,
): void {
	const half = thickness / 2
	const put = (u0: number, u1: number, y0: number, y1: number, c: Color, blocking = true): void => {
		if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return
		if (axis === "x") {
			if (blocking) solid(ctx, u0, y0, at - half, u1, y1, at + half, c)
			else decor(ctx, u0, y0, at - half, u1, y1, at + half, c)
		} else {
			if (blocking) solid(ctx, at - half, y0, u0, at + half, y1, u1, c)
			else decor(ctx, at - half, y0, u0, at + half, y1, u1, c)
		}
	}
	const sorted = openings.slice().sort((a, b) => a.at - b.at)
	let cursor = from
	for (const opening of sorted) {
		const a = opening.at - opening.width / 2
		const b = opening.at + opening.width / 2
		put(cursor, a, BASE, top, color)
		if (opening.y0 > BASE) put(a, b, BASE, opening.y0, color)
		if (opening.y1 < top) put(a, b, opening.y1, top, color)
		if (opening.glass) put(a, b, opening.y0, opening.y1, PALETTE.glass, false)
		cursor = Math.max(cursor, b)
	}
	put(cursor, to, BASE, top, color)
}

/** Плита пола второго этажа + потолок над помещением. */
function slab(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, floorColor: Color, tile = 1.4): void {
	// пол: плитка рисуется квадратами, чтобы был рисунок, а не одно пятно
	const columns = Math.max(1, Math.round((x1 - x0) / tile))
	const rows = Math.max(1, Math.round((z1 - z0) / tile))
	for (let r = 0; r < rows; r++) {
		const a = z0 + ((z1 - z0) * r) / rows
		const b = z0 + ((z1 - z0) * (r + 1)) / rows
		for (let c = 0; c < columns; c++) {
			const u = x0 + ((x1 - x0) * c) / columns
			const v = x0 + ((x1 - x0) * (c + 1)) / columns
			const tone = (r + c) % 2 === 0 ? floorColor : shade(floorColor, 0.94)
			ctx.mesh.horizontalQuad(u, a, v, b, BASE, tone, true)
		}
	}
	// сама плита: коллайдер, чтобы не провалиться и чтобы снизу был потолок
	ctx.collision.add(x0, BASE - 0.4, z0, x1, BASE, z1)
	ctx.mesh.horizontalQuad(x0, z0, x1, z1, TOP, PALETTE.ceiling, false)
	ctx.collision.add(x0, TOP, z0, x1, TOP + 0.4, z1)
}

/** Сетка потолочных ламп в помещении второго этажа. */
function lamps(
	ctx: Ctx,
	lights: Light[],
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	columns: number,
	rows: number,
	long = 1.3,
): void {
	const y = TOP - 0.16
	for (let r = 0; r < rows; r++) {
		const z = z0 + ((z1 - z0) * (r + 0.5)) / rows
		for (let c = 0; c < columns; c++) {
			const x = x0 + ((x1 - x0) * (c + 0.5)) / columns
			decor(ctx, x - long / 2 - 0.06, y - 0.1, z - 0.28, x + long / 2 + 0.06, y, z + 0.28, PALETTE.metal)
			glow(ctx, x - long / 2, y - 0.12, z - 0.22, x + long / 2, y - 0.1, z + 0.22, PALETTE.lamp)
			lights.push({ x, y: y - 0.25, z, ...LAMP })
		}
	}
}

// ─────────────────── мебель второго этажа ───────────────────

function desk2(ctx: Ctx, x: number, z: number): void {
	solid(ctx, x - 0.64, BASE + 0.7, z - 0.29, x + 0.64, BASE + 0.75, z + 0.29, PALETTE.woodLight)
	for (const side of [-1, 1]) {
		decor(ctx, x + side * 0.58, BASE, z - 0.25, x + side * 0.58 + 0.04, BASE + 0.7, z + 0.25, PALETTE.metalDark)
	}
}

function chair2(ctx: Ctx, x: number, z: number, color: Color = PALETTE.plasticBlue): void {
	solid(ctx, x - 0.22, BASE + 0.43, z - 0.22, x + 0.22, BASE + 0.48, z + 0.22, color)
	decor(ctx, x - 0.22, BASE + 0.48, z + 0.16, x + 0.22, BASE + 0.92, z + 0.22, color)
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			decor(ctx, x + sx * 0.19, BASE, z + sz * 0.19, x + sx * 0.19 + sx * 0.03, BASE + 0.43, z + sz * 0.19 + sz * 0.03, PALETTE.metalDark)
		}
	}
}

/** Стеллаж архива: высокий, плотный, за ним легко что-то потерять. */
function rackRow(ctx: Ctx, x0: number, z: number, x1: number, seed: number): void {
	const height = 2.25
	solid(ctx, x0, BASE, z - 0.26, x1, BASE + height, z + 0.26, PALETTE.metalDark)
	for (let s = 1; s <= 4; s++) {
		const y = BASE + (height / 5) * s
		decor(ctx, x0 + 0.03, y, z - 0.24, x1 - 0.03, y + 0.03, z + 0.24, PALETTE.metal)
		const boxes = Math.floor((x1 - x0) / 0.42)
		for (let b = 0; b < boxes; b++) {
			const n = ((seed * 31.7 + s * 7.1 + b * 3.3) % 1 + 1) % 1
			if (n < 0.18) continue
			const a = x0 + 0.08 + b * 0.42
			const color = BOOK_COLORS[Math.floor(n * BOOK_COLORS.length) % BOOK_COLORS.length]
			decor(ctx, a, y + 0.03, z - 0.2, a + 0.34, y + 0.03 + 0.26 + n * 0.12, z + 0.2, shade(color, 0.9 + n * 0.3))
		}
	}
}

/** Серверная стойка с мигающими диодами. */
function serverRack(ctx: Ctx, x: number, z: number, seed: number): void {
	solid(ctx, x - 0.42, BASE, z - 0.36, x + 0.42, BASE + 2.05, z + 0.36, PALETTE.black)
	for (let i = 0; i < 9; i++) {
		const y = BASE + 0.18 + i * 0.2
		decor(ctx, x - 0.38, y, z + 0.36, x + 0.38, y + 0.14, z + 0.38, PALETTE.metalDark)
		const n = ((seed * 13.7 + i * 5.1) % 1 + 1) % 1
		const color: Color = n > 0.62 ? [0.2, 1, 0.4] : n > 0.3 ? [1, 0.72, 0.2] : [0.25, 0.6, 1]
		glow(ctx, x + 0.24, y + 0.04, z + 0.38, x + 0.33, y + 0.1, z + 0.39, color)
	}
}

/** Диван в учительской. */
function sofa(ctx: Ctx, x0: number, z: number, x1: number): void {
	solid(ctx, x0, BASE, z - 0.38, x1, BASE + 0.44, z + 0.38, PALETTE.plasticGreen)
	decor(ctx, x0, BASE + 0.44, z + 0.22, x1, BASE + 0.96, z + 0.38, shade(PALETTE.plasticGreen, 1.08))
	for (const sx of [x0 + 0.06, x1 - 0.18]) {
		decor(ctx, sx, BASE + 0.44, z - 0.38, sx + 0.12, BASE + 0.72, z + 0.38, shade(PALETTE.plasticGreen, 0.86))
	}
}

/** Ограждение над пролётом и вдоль стеклянной стены. */
function railing(ctx: Ctx, axis: "x" | "z", at: number, from: number, to: number): void {
	const y = BASE + 1.05
	if (axis === "x") {
		solid(ctx, from, BASE, at - 0.05, to, BASE + 0.12, at + 0.05, PALETTE.metalDark)
		decor(ctx, from, y, at - 0.06, to, y + 0.08, at + 0.06, PALETTE.metal)
		for (let u = from + 0.4; u < to; u += 1.2) {
			decor(ctx, u - 0.04, BASE, at - 0.04, u + 0.04, y, at + 0.04, PALETTE.metal)
		}
		ctx.collision.add(from, BASE, at - 0.12, to, y + 0.08, at + 0.12)
	} else {
		solid(ctx, at - 0.05, BASE, from, at + 0.05, BASE + 0.12, to, PALETTE.metalDark)
		decor(ctx, at - 0.06, y, from, at + 0.06, y + 0.08, to, PALETTE.metal)
		for (let u = from + 0.4; u < to; u += 1.2) {
			decor(ctx, at - 0.04, BASE, u - 0.04, at + 0.04, y, u + 0.04, PALETTE.metal)
		}
		ctx.collision.add(at - 0.12, BASE, from, at + 0.12, y + 0.08, to)
	}
}

/** Доска на стене кабинета. */
function board2(ctx: Ctx, x: number, z0: number, z1: number, color: Color): void {
	decor(ctx, x, BASE + 1.0, z0, x + 0.06, BASE + 2.25, z1, color)
	decor(ctx, x, BASE + 0.92, z0 - 0.06, x + 0.1, BASE + 1.0, z1 + 0.06, PALETTE.woodMid)
}

// ─────────────────── помещения ───────────────────

function buildArchive(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 11, 0, 22, 12, PALETTE.floorLinoAlt)
	lamps(ctx, lights, 11, 0, 22, 12, 2, 3)
	// плотные ряды стеллажей: оружие спрятано в самом дальнем углу
	for (let i = 0; i < 5; i++) {
		const z = 1.5 + i * 2.2
		rackRow(ctx, 11.6, z, 17.4, i + 1)
		rackRow(ctx, 18.4, z, 21.4, i + 7)
	}
	// ящики и коробки: за ними и лежит свёрток
	solid(ctx, 19.6, BASE, 0.6, 20.4, BASE + 0.75, 1.4, PALETTE.woodMid)
	solid(ctx, 20.5, BASE, 0.55, 21.3, BASE + 0.5, 1.35, shade(PALETTE.woodLight, 0.9))
	decor(ctx, 11.2, BASE + 1.4, 11.2, 11.24, BASE + 2.1, 11.9, PALETTE.paper)
}

function buildLab(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 22, 0, 33, 12, PALETTE.floorLino)
	lamps(ctx, lights, 22, 0, 33, 12, 2, 3)
	board2(ctx, 22.13, 3.2, 8.6, PALETTE.chalkboard)
	for (const x of [25.6, 27.8, 30, 32.2]) {
		for (const z of [3, 5.2, 7.4, 9.6]) {
			desk2(ctx, x, z)
			chair2(ctx, x, z + 0.72)
		}
	}
	// лабораторный стол с приборами
	solid(ctx, 23.2, BASE, 1.2, 32, BASE + 0.85, 2, PALETTE.woodMid)
	for (const x of [24.4, 26.2, 28.6, 30.8]) {
		decor(ctx, x - 0.16, BASE + 0.85, 1.4, x + 0.16, BASE + 1.15, 1.72, PALETTE.glass)
		decor(ctx, x - 0.1, BASE + 1.15, 1.46, x + 0.1, BASE + 1.3, 1.66, PALETTE.metal)
	}
}

/** Серверная: здесь стоит блок управления взрывчаткой. */
function buildServer(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 33, 0, 44, 12, PALETTE.floorTile, 1.1)
	lamps(ctx, lights, 33, 0, 44, 12, 2, 2)
	for (let i = 0; i < 5; i++) serverRack(ctx, 34.4 + i * 1.05, 1.2, i + 2)
	for (let i = 0; i < 4; i++) serverRack(ctx, 40.2 + i * 1.05, 3.6, i + 9)
	// кабель-каналы по стенам
	decor(ctx, 33.15, BASE + 2.5, 0.4, 33.25, BASE + 2.62, 11.6, PALETTE.metalDark)
	decor(ctx, 33.2, BASE + 2.35, 0.4, 33.3, BASE + 2.45, 11.6, PALETTE.plasticRed)
	// щит управления: сюда ставится ноутбук (см. act2.ts)
	solid(ctx, 41.4, BASE + 0.9, 10.7, 43.4, BASE + 2.3, 11.6, PALETTE.metalDark)
	decor(ctx, 41.55, BASE + 1.05, 10.62, 43.25, BASE + 2.15, 10.7, shade(PALETTE.metal, 0.9))
	for (let i = 0; i < 6; i++) {
		glow(ctx, 41.7 + i * 0.28, BASE + 1.85, 10.58, 41.86 + i * 0.28, BASE + 1.95, 10.62, i % 2 === 0 ? [1, 0.25, 0.2] : [1, 0.6, 0.2])
	}
	solid(ctx, 41.6, BASE, 9.9, 43.2, BASE + 0.85, 10.6, PALETTE.woodMid)
}

/** Учительская: здесь лежит ноутбук. */
function buildStaff(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 44, 0, 55, 12, PALETTE.floorParquet, 1.6)
	lamps(ctx, lights, 44, 0, 55, 12, 2, 2)
	solid(ctx, 46, BASE, 4.4, 52.6, BASE + 0.78, 6.6, PALETTE.woodMid)
	decor(ctx, 45.9, BASE + 0.78, 4.3, 52.7, BASE + 0.84, 6.7, PALETTE.woodLight)
	for (const x of [46.8, 48.6, 50.4, 52]) {
		chair2(ctx, x, 3.9, PALETTE.woodMid)
		chair2(ctx, x, 7.1, PALETTE.woodMid)
	}
	sofa(ctx, 45.2, 10.8, 48.6)
	decor(ctx, 44.15, BASE + 1.3, 8.4, 44.2, BASE + 2.2, 10.4, PALETTE.paper)
	// рабочий стол с бумагами — на нём и стоит ноутбук
	solid(ctx, 52.6, BASE, 9.2, 54.4, BASE + 0.76, 10.6, PALETTE.woodMid)
	decor(ctx, 52.9, BASE + 0.76, 9.5, 53.6, BASE + 0.8, 10.2, PALETTE.paper)
	solid(ctx, 53.4, BASE, 1.2, 54.6, BASE + 1.9, 3.6, PALETTE.woodDark)
}

/** Кабинет директора: тут в сейфе лежит ключ от второго выхода. */
function buildPrincipal(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 55, 0, 66, 12, PALETTE.floorCarpet, 1.8)
	lamps(ctx, lights, 55, 0, 66, 12, 2, 2)
	solid(ctx, 58.4, BASE, 2.2, 62.6, BASE + 0.8, 3.6, PALETTE.woodDark)
	decor(ctx, 58.3, BASE + 0.8, 2.1, 62.7, BASE + 0.86, 3.7, PALETTE.woodMid)
	chair2(ctx, 60.5, 1.5, PALETTE.woodDark)
	chair2(ctx, 59.6, 4.4, PALETTE.plasticRed)
	chair2(ctx, 61.4, 4.4, PALETTE.plasticRed)
	// сейф в углу — открыт после взлома системы
	solid(ctx, 64.6, BASE, 0.6, 65.7, BASE + 1.1, 1.9, PALETTE.metalDark)
	decor(ctx, 64.55, BASE + 0.25, 0.7, 64.6, BASE + 0.95, 1.8, PALETTE.metal)
	glow(ctx, 64.52, BASE + 0.62, 1.16, 64.56, BASE + 0.7, 1.32, [1, 0.3, 0.22])
	// шкафы с папками и знамя школы
	solid(ctx, 55.2, BASE, 8.4, 56, BASE + 2, 11.6, PALETTE.woodDark)
	decor(ctx, 63.4, BASE + 1.2, 11.6, 65.4, BASE + 2.6, 11.66, PALETTE.plasticBlue)
}

function buildStore2(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 66, 0, 72, 12, PALETTE.floorLinoAlt, 1.2)
	lamps(ctx, lights, 66, 0, 72, 12, 1, 2)
	for (let i = 0; i < 7; i++) {
		const n = ((i * 17.3) % 1 + 1) % 1
		solid(ctx, 66.6 + (i % 3) * 1.5, BASE, 0.8 + Math.floor(i / 3) * 1.3, 67.9 + (i % 3) * 1.5, BASE + 0.5 + n * 0.6, 1.9 + Math.floor(i / 3) * 1.3, i % 2 === 0 ? PALETTE.woodMid : PALETTE.paper)
	}
	solid(ctx, 66.2, BASE, 8.4, 66.9, BASE + 2, 11.5, PALETTE.metalDark)
}

function buildCorridor2(ctx: Floor2Ctx): void {
	for (let i = 0; i < 6; i++) {
		const x0 = i * 12
		const ctx2: Ctx = { mesh: ctx.get(`floor2-corridor-${i}`), collision: ctx.collision }
		slab(ctx2, x0, 12, x0 + 12, 18, PALETTE.floorLinoAlt, 1.5)
		lamps(ctx2, ctx.lights, x0, 12, x0 + 12, 18, 2, 1, 1.4)
		// шкафчики и скамейки вдоль коридора
		if (i > 0) {
			solid(ctx2, x0 + 1.4, BASE, 12.3, x0 + 5.6, BASE + 1.85, 12.75, shade(PALETTE.lockerTeal, 0.8))
			for (let d = 0; d < 10; d++) {
				const a = x0 + 1.44 + d * 0.42
				decor(ctx2, a, BASE + 0.05, 12.75, a + 0.38, BASE + 1.8, 12.79, shade(PALETTE.lockerTeal, d % 2 === 0 ? 1.05 : 0.92))
				decor(ctx2, a + 0.3, BASE + 0.95, 12.79, a + 0.36, BASE + 1.05, 12.82, PALETTE.metal)
			}
		}
		if (i % 2 === 1) {
			solid(ctx2, x0 + 7, BASE + 0.42, 16.9, x0 + 10, BASE + 0.48, 17.3, PALETTE.woodLight)
			decor(ctx2, x0 + 7, BASE + 0.5, 17.2, x0 + 10, BASE + 0.95, 17.3, PALETTE.woodLight)
		}
		if (i === 2 || i === 4) {
			// фикус в кадке
			solid(ctx2, x0 + 5.7, BASE, 16.4, x0 + 6.2, BASE + 0.42, 16.9, PALETTE.plantPot)
			decor(ctx2, x0 + 5.9, BASE + 0.42, 16.6, x0 + 6, BASE + 1.6, 16.7, PALETTE.woodDark)
			decor(ctx2, x0 + 5.5, BASE + 1.2, 16.2, x0 + 6.4, BASE + 1.7, 17.1, PALETTE.plantLeaf)
		}
	}
}

function buildAssembly(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 50, 18, 72, 31, PALETTE.floorParquet, 1.8)
	lamps(ctx, lights, 50, 18, 72, 31, 3, 2, 1.6)
	// сцена у восточной стены
	solid(ctx, 67.4, BASE, 19, 71.6, BASE + 0.65, 30, shade(PALETTE.woodMid, 1.05))
	decor(ctx, 67.3, BASE + 0.65, 18.9, 71.7, BASE + 0.72, 30.1, PALETTE.woodLight)
	decor(ctx, 71.6, BASE + 0.72, 19, 71.68, BASE + 3, 30, PALETTE.plasticRed)
	// ряды кресел
	for (let row = 0; row < 6; row++) {
		const x = 51.6 + row * 2.3
		for (let seat = 0; seat < 7; seat++) {
			chair2(ctx, x, 20 + seat * 1.4, PALETTE.plasticRed)
		}
	}
	// трибуна и прожекторы
	solid(ctx, 68.6, BASE + 0.72, 24, 69.4, BASE + 1.8, 24.8, PALETTE.woodDark)
	for (const z of [21, 24.5, 28]) {
		decor(ctx, 63, TOP - 0.45, z - 0.2, 63.5, TOP - 0.1, z + 0.2, PALETTE.metalDark)
		glow(ctx, 63.1, TOP - 0.5, z - 0.14, 63.4, TOP - 0.45, z + 0.14, PALETTE.lamp)
	}
}

function buildInfo(ctx: Ctx, lights: Light[]): void {
	slab(ctx, 50, 31, 72, 44, PALETTE.floorLino, 1.4)
	lamps(ctx, lights, 50, 31, 72, 44, 3, 2)
	board2(ctx, 50.16, 33, 38, PALETTE.whiteboard)
	for (const x of [54, 57.5, 61, 64.5, 68]) {
		for (const z of [33.2, 36.4, 39.6, 42.4]) {
			desk2(ctx, x, z)
			chair2(ctx, x, z + 0.75)
			// монитор и клавиатура
			decor(ctx, x - 0.3, BASE + 0.75, z - 0.22, x + 0.3, BASE + 1.12, z - 0.15, PALETTE.black)
			decor(ctx, x - 0.26, BASE + 0.8, z - 0.15, x + 0.26, BASE + 1.08, z - 0.13, shade(PALETTE.glass, 0.7))
			decor(ctx, x - 0.22, BASE + 0.75, z + 0.02, x + 0.22, BASE + 0.78, z + 0.2, PALETTE.metalDark)
		}
	}
	solid(ctx, 70.6, BASE, 32, 71.6, BASE + 2, 35, PALETTE.metalDark)
}

/** Стены, фасад, крыша. */
function buildShell(ctx: Floor2Ctx): void {
	const north: Ctx = { mesh: ctx.get("floor2-shell-n"), collision: ctx.collision }
	const south: Ctx = { mesh: ctx.get("floor2-shell-s"), collision: ctx.collision }
	const inner: Ctx = { mesh: ctx.get("floor2-shell-i"), collision: ctx.collision }

	// северный фасад с окнами каждого кабинета
	const northWindows: Opening[] = []
	for (const x0 of [11, 22, 33, 44, 55]) {
		for (const at of [x0 + 2.1, x0 + 5.5, x0 + 8.9]) northWindows.push(window2(at))
	}
	northWindows.push(window2(8.25, 1.8, 1.1, 1.9))
	northWindows.push(window2(69, 1.4, 1.5, 1.1))
	wallRun(north, "x", 0, -EXT / 2, BUILDING.width + EXT / 2, EXT, PALETTE.wallCream, northWindows)

	// западный и восточный фасады
	wallRun(north, "z", 0, EXT / 2, 18, EXT, PALETTE.wallCream, [window2(8, 1.2, 1.5, 1.1), window2(15, 2.2)])
	wallRun(south, "z", 72, EXT / 2, BUILDING.depth - EXT / 2, EXT, PALETTE.wallSand, [
		window2(6, 1.4, 1.5, 1.1),
		window2(15, 2.2),
		window2(21, 2),
		window2(26, 2),
		window2(34, 2),
		window2(39, 2),
		window2(42.5, 2),
	])
	// южный фасад восточного крыла
	wallRun(south, "x", 44, 50, BUILDING.width + EXT / 2, EXT, PALETTE.wallBlue, [
		window2(54, 2),
		window2(58.5, 2),
		window2(63, 2),
		window2(67.5, 2),
	])

	// стена коридора над спортзалом и вестибюлем: стекло с видом вниз
	wallRun(inner, "x", 18, EXT / 2, 26, INT, PALETTE.wallMint, [
		{ at: 12, width: 5, y0: BASE + 1.1, y1: BASE + 2.6, glass: true },
		{ at: 20, width: 4, y0: BASE + 1.1, y1: BASE + 2.6, glass: true },
	])
	wallRun(inner, "x", 18, 26, 50, INT, PALETTE.wallSand, [
		{ at: 31, width: 6, y0: BASE + 1.1, y1: BASE + 2.7, glass: true },
		{ at: 45, width: 6, y0: BASE + 1.1, y1: BASE + 2.7, glass: true },
	])
	// над вестибюлем — балкон с ограждением по краю проёма
	railing(inner, "z", 50, 18.4, 30.8)

	// северная стена коридора: двери во все помещения
	wallRun(inner, "x", 12, EXT / 2, BUILDING.width - EXT / 2, INT, PALETTE.wallCream, [
		door(13.2, 1.1),
		door(24.2, 1.1),
		door(35.2, 1.1),
		door(46.2, 1.1),
		door(57.2, 1.1),
		door(69, 1),
	])

	// перегородки между помещениями второго этажа
	wallRun(inner, "z", 5.5, EXT / 2, 12, INT, PALETTE.wallCream)
	wallRun(inner, "z", 11, EXT / 2, 12, INT, PALETTE.wallCream, [door(2.6, 1.1)])
	for (const at of [22, 33, 44, 55, 66]) {
		wallRun(inner, "z", at, EXT / 2, 12, INT, PALETTE.wallCream)
	}
	// стена между актовым залом и информатикой
	wallRun(inner, "x", 31, 50, BUILDING.width - EXT / 2, INT, PALETTE.wallBlue, [
		{ at: 61, width: 2.2, y0: BASE, y1: BASE + 2.4 },
	])
	// стена между балконом и восточным крылом
	wallRun(inner, "z", 50, 18, 31, INT, PALETTE.wallSand, [door(24, 1.6, 2.3)])

	// потолок над лестничным колодцем: свет и коллайдер
	const stair: Ctx = { mesh: ctx.get("floor2-stairs"), collision: ctx.collision }
	stair.mesh.horizontalQuad(5.5, 0, 11, 12, TOP, PALETTE.ceiling, false)
	ctx.collision.add(5.5, TOP, 0, 11, TOP + 0.4, 12)
	lamps(stair, ctx.lights, 5.5, 5.4, 11, 12, 1, 1, 1.2)
	// площадка второго этажа: пол и ограждение над пролётом
	slab(stair, 5.63, 0.25, 10.87, 5.4, PALETTE.floorTile, 1.1)
	// ограждение только по краям колодца — марш поднимается по x 6.1..10.4,
	// поэтому выход с лестницы оставляем открытым
	railing(stair, "x", 5.4, 5.63, 6.05)
	railing(stair, "x", 5.4, 10.45, 10.87)

	// фасадные заглушки там, где второго этажа нет: спортзал и вестибюль
	const facade: Ctx = { mesh: ctx.get("floor2-facade"), collision: ctx.collision }
	solid(facade, -EXT / 2, BUILDING.gymHeight, 44 - EXT / 2, 26, TOP, 44 + EXT / 2, PALETTE.wallMint)
	solid(facade, 26, BUILDING.hallHeight, 44 - EXT / 2, 50, TOP, 44 + EXT / 2, PALETTE.wallSand)
	solid(facade, -EXT / 2, BUILDING.gymHeight, 18, EXT / 2, TOP, 44 + EXT / 2, PALETTE.wallMint)
	solid(facade, 26 - INT / 2, BUILDING.hallHeight, 18, 26 + INT / 2, TOP, 44, PALETTE.wallMint)
	solid(facade, 50 - INT / 2, BUILDING.hallHeight, 31, 50 + INT / 2, TOP, 44, PALETTE.wallSand)

	// крыша и парапет
	const roof: Ctx = { mesh: ctx.get("floor2-roof"), collision: ctx.collision }
	roof.mesh.horizontalQuad(-EXT / 2, -EXT / 2, BUILDING.width + EXT / 2, BUILDING.depth + EXT / 2, TOP + 0.4, shade(PALETTE.metalDark, 1.1), true)
	const parapet = 0.75
	solid(roof, -EXT / 2, TOP + 0.4, -EXT / 2 - 0.1, BUILDING.width + EXT / 2, TOP + 0.4 + parapet, -EXT / 2 + 0.25, PALETTE.wallCream)
	solid(roof, -EXT / 2, TOP + 0.4, BUILDING.depth + EXT / 2 - 0.25, BUILDING.width + EXT / 2, TOP + 0.4 + parapet, BUILDING.depth + EXT / 2 + 0.1, PALETTE.wallCream)
	solid(roof, -EXT / 2 - 0.1, TOP + 0.4, -EXT / 2, -EXT / 2 + 0.25, TOP + 0.4 + parapet, BUILDING.depth + EXT / 2, PALETTE.wallCream)
	solid(roof, BUILDING.width + EXT / 2 - 0.25, TOP + 0.4, -EXT / 2, BUILDING.width + EXT / 2 + 0.1, TOP + 0.4 + parapet, BUILDING.depth + EXT / 2, PALETTE.wallCream)
	// вентиляция на крыше — школа выглядит живой снаружи
	for (const [x, z] of [
		[16, 5],
		[30, 8],
		[46, 4],
		[58, 9],
		[62, 26],
		[56, 38],
	] as Array<[number, number]>) {
		decor(roof, x - 0.8, TOP + 0.4, z - 0.8, x + 0.8, TOP + 1.3, z + 0.8, PALETTE.metal)
		decor(roof, x - 0.9, TOP + 1.3, z - 0.9, x + 0.9, TOP + 1.45, z + 0.9, PALETTE.metalDark)
	}
}

/** Собрать весь второй этаж. */
export function buildFloor2(ctx: Floor2Ctx): void {
	buildShell(ctx)
	buildCorridor2(ctx)
	const room = (name: string): Ctx => ({ mesh: ctx.get(name), collision: ctx.collision })
	buildArchive(room("floor2-archive"), ctx.lights)
	buildLab(room("floor2-lab"), ctx.lights)
	buildServer(room("floor2-server"), ctx.lights)
	buildStaff(room("floor2-staff"), ctx.lights)
	buildPrincipal(room("floor2-principal"), ctx.lights)
	buildStore2(room("floor2-store"), ctx.lights)
	buildAssembly(room("floor2-assembly"), ctx.lights)
	buildInfo(room("floor2-info"), ctx.lights)
}
