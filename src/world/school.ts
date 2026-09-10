/**
 * СБОРКА ШКОЛЫ.
 *
 * План (layout.ts) + предметы (props.ts) → куски геометрии (чанки) + физика + свет.
 *
 * Почему чанки: каждый кусок — один VAO и один drawElements. Куски вне пирамиды
 * видимости отбрасываются целиком, поэтому в кадре обычно 8-25 вызовов рисования.
 */

import { MeshBuilder, hashNoise, shade, type Color } from "../core/mesh.js"
import { HIDE_SPOTS } from "../game/items.js"
import { CollisionWorld } from "./collision.js"
import {
	BUILDING,
	ROOMS,
	WALLS,
	findRoomAt,
	type DoorOpening,
	type Room,
	type Wall,
	type WindowOpening,
} from "./layout.js"
import { bakeConstant, bakeLighting, lightsForBounds, type Light } from "./lighting.js"
import { PALETTE } from "./palette.js"
import * as P from "./props.js"

export interface SchoolChunk {
	name: string
	mesh: MeshBuilder
}

export interface SchoolScene {
	chunks: SchoolChunk[]
	collision: CollisionWorld
	triangles: number
	vertices: number
	lightCount: number
	buildMs: number
}

/** Толщина невидимой плиты потолка для физики. */
const CEILING_SLAB = 0.4

const LAMP = { radius: 8.5, intensity: 0.55, color: [1, 0.95, 0.86] as Color }
const WINDOW_LIGHT = { radius: 13, intensity: 0.85, color: [0.82, 0.88, 1] as Color }

const GRASS: Color = [0.4, 0.47, 0.31]
const PAVEMENT: Color = [0.58, 0.575, 0.55]
const TRUNK: Color = [0.31, 0.24, 0.18]
const LEAVES: Color = [0.25, 0.39, 0.25]
const DISTANT: Color = [0.6, 0.61, 0.63]

class ChunkSet {
	readonly map = new Map<string, MeshBuilder>()

	get(name: string): MeshBuilder {
		let mesh = this.map.get(name)
		if (!mesh) {
			mesh = new MeshBuilder()
			this.map.set(name, mesh)
		}
		return mesh
	}
}

/** Свободные участки отрезка после вырезания проёмов. */
function freeSpans(
	from: number,
	to: number,
	blockers: Array<[number, number]>,
	margin: number,
): Array<[number, number]> {
	const sorted = blockers.slice().sort((a, b) => a[0] - b[0])
	const spans: Array<[number, number]> = []
	let cursor = from
	for (const [a, b] of sorted) {
		const start = a - margin
		if (start > cursor) spans.push([cursor, start])
		cursor = Math.max(cursor, b + margin)
	}
	if (to > cursor) spans.push([cursor, to])
	return spans
}

function wallsAt(axis: "x" | "z", at: number): Wall[] {
	return WALLS.filter((wall) => wall.axis === axis && wall.at === at)
}

function doorRanges(walls: readonly Wall[]): Array<[number, number]> {
	const ranges: Array<[number, number]> = []
	for (const wall of walls) {
		for (const door of wall.doors ?? []) {
			ranges.push([door.at - door.width / 2, door.at + door.width / 2])
		}
	}
	return ranges
}

// ──────────────────── СТЕНЫ ────────────────────

function chunkForWall(wall: Wall, along: number): string {
	return `wall-${wall.axis}${wall.at}-${Math.floor(along / 18)}`
}

function wallBox(
	mesh: MeshBuilder,
	wall: Wall,
	u0: number,
	u1: number,
	y0: number,
	y1: number,
	color: Color,
	expand = 0,
	emissive = false,
): void {
	if (u1 <= u0 || y1 <= y0) return
	const half = wall.thickness / 2 + expand
	if (wall.axis === "x") {
		mesh.box(u0, y0, wall.at - half, u1, y1, wall.at + half, color, { emissive })
	} else {
		mesh.box(wall.at - half, y0, u0, wall.at + half, y1, u1, color, { emissive })
	}
}

function wallCollider(
	collision: CollisionWorld,
	wall: Wall,
	u0: number,
	u1: number,
	y0: number,
	y1: number,
): void {
	if (u1 <= u0 || y1 <= y0) return
	const half = wall.thickness / 2
	if (wall.axis === "x") {
		collision.add(u0, y0, wall.at - half, u1, y1, wall.at + half)
	} else {
		collision.add(wall.at - half, y0, u0, wall.at + half, y1, u1)
	}
}

/** Куда смотрит внутренняя сторона внешней стены. */
function inwardSign(wall: Wall): 1 | -1 {
	if (wall.axis === "x") return wall.at < BUILDING.depth / 2 ? 1 : -1
	return wall.at < BUILDING.width / 2 ? 1 : -1
}

function buildWindow(mesh: MeshBuilder, wall: Wall, win: WindowOpening, lights: Light[]): void {
	const a = win.at - win.width / 2
	const b = win.at + win.width / 2
	const y0 = win.sill
	const y1 = win.sill + win.height
	const frame = PALETTE.doorFrame
	// косяки и верхняя перекладина
	wallBox(mesh, wall, a, a + 0.07, y0, y1, frame, 0.012)
	wallBox(mesh, wall, b - 0.07, b, y0, y1, frame, 0.012)
	wallBox(mesh, wall, a, b, y1 - 0.07, y1, frame, 0.012)
	// подоконник
	wallBox(mesh, wall, a - 0.07, b + 0.07, y0 - 0.06, y0, PALETTE.paper, 0.1)
	// стойка и поперечина — окно не кажется пустой дырой
	wallBox(mesh, wall, win.at - 0.04, win.at + 0.04, y0, y1, frame, 0.008)
	const mid = y0 + win.height * 0.62
	wallBox(mesh, wall, a, b, mid - 0.04, mid + 0.04, frame, 0.008)

	const inward = inwardSign(wall)
	const lightY = y0 + win.height * 0.5
	if (wall.axis === "x") {
		lights.push({ x: win.at, y: lightY, z: wall.at + inward * 1.1, ...WINDOW_LIGHT })
	} else {
		lights.push({ x: wall.at + inward * 1.1, y: lightY, z: win.at, ...WINDOW_LIGHT })
	}
}

function buildSolidSpan(
	ctx: P.Ctx,
	wall: Wall,
	u0: number,
	u1: number,
	windows: WindowOpening[],
	lights: Light[],
): void {
	// Окно — тоже преграда, поэтому коллайдер идёт на всю высоту.
	wallCollider(ctx.collision, wall, u0, u1, 0, wall.height)
	let cursor = u0
	for (const win of windows) {
		const a = win.at - win.width / 2
		const b = win.at + win.width / 2
		if (a > cursor) wallBox(ctx.mesh, wall, cursor, a, 0, wall.height, wall.color)
		wallBox(ctx.mesh, wall, a, b, 0, win.sill, wall.color)
		const top = win.sill + win.height
		if (top < wall.height) wallBox(ctx.mesh, wall, a, b, top, wall.height, wall.color)
		buildWindow(ctx.mesh, wall, win, lights)
		cursor = b
	}
	if (cursor < u1) wallBox(ctx.mesh, wall, cursor, u1, 0, wall.height, wall.color)
	if (wall.wainscot) {
		wallBox(ctx.mesh, wall, u0, u1, 0, 0.86, PALETTE.wainscot, 0.014)
		wallBox(ctx.mesh, wall, u0, u1, 0.86, 0.9, shade(PALETTE.woodMid, 1.05), 0.022)
	}
}

/** В какую сторону открывается дверь: всегда в помещение, а не в коридор. */
function doorSwing(wall: Wall, door: DoorOpening): 1 | -1 {
	const probe = 0.7
	const x = wall.axis === "x" ? door.at : wall.at
	const z = wall.axis === "x" ? wall.at : door.at
	const plus = wall.axis === "x" ? findRoomAt(x, z + probe) : findRoomAt(x + probe, z)
	const minus = wall.axis === "x" ? findRoomAt(x, z - probe) : findRoomAt(x - probe, z)
	const open = (room: Room | null): boolean =>
		room !== null && room.kind !== "corridor" && room.kind !== "hall"
	if (open(plus)) return 1
	if (open(minus)) return -1
	return 1
}

function buildDoorway(ctx: P.Ctx, wall: Wall, door: DoorOpening, lights: Light[]): void {
	const a = door.at - door.width / 2
	const b = door.at + door.width / 2
	const isArch = door.kind === "arch"
	const frameColor = isArch ? shade(wall.color, 0.9) : PALETTE.doorFrame
	const jamb = isArch ? 0.24 : 0.09

	// перекладина над проёмом
	if (door.height < wall.height) {
		wallBox(ctx.mesh, wall, a, b, door.height, wall.height, wall.color)
		wallCollider(ctx.collision, wall, a, b, door.height, wall.height)
	}
	// обрамление
	wallBox(ctx.mesh, wall, a, a + jamb, 0, door.height, frameColor, 0.02)
	wallBox(ctx.mesh, wall, b - jamb, b, 0, door.height, frameColor, 0.02)
	wallBox(ctx.mesh, wall, a, b, door.height - jamb * 0.6, door.height, frameColor, 0.02)

	if (door.kind === "glass") {
		// главный вход закрыт: витраж со светом с улицы
		wallCollider(ctx.collision, wall, a, b, 0, door.height)
		// Сами створки рисует игровой слой (они анимированные и открываются
		// в кат-сценах), здесь остаётся проём, коллайдер и свет с улицы.
		const mid = (a + b) / 2
		const inward = inwardSign(wall)
		if (wall.axis === "x") {
			lights.push({
				x: mid,
				y: door.height * 0.55,
				z: wall.at + inward * 1.3,
				radius: 15,
				intensity: 1,
				color: WINDOW_LIGHT.color,
			})
		}
		return
	}

	// порог
	if (!isArch) wallBox(ctx.mesh, wall, a, b, 0, 0.025, PALETTE.metal, 0.05)

	const side = doorSwing(wall, door)
	if (door.kind === "door") {
		P.openDoorLeaf(ctx, wall.axis, wall.at, a + jamb, -1, door.width - jamb, door.height - 0.06, side)
	} else if (door.kind === "double") {
		const half = door.width / 2
		P.openDoorLeaf(ctx, wall.axis, wall.at, a + jamb, -1, half - jamb, door.height - 0.06, side)
		P.openDoorLeaf(ctx, wall.axis, wall.at, b - jamb, 1, half - jamb, door.height - 0.06, side)
	} else {
		// арка: декоративные пилястры
		wallBox(ctx.mesh, wall, a - 0.1, a + jamb + 0.1, 0, 0.3, frameColor, 0.05)
		wallBox(ctx.mesh, wall, b - jamb - 0.1, b + 0.1, 0, 0.3, frameColor, 0.05)
	}
}

function buildWalls(chunks: ChunkSet, collision: CollisionWorld, lights: Light[]): void {
	for (const wall of WALLS) {
		const doors = (wall.doors ?? []).slice().sort((left, right) => left.at - right.at)
		const windows = (wall.windows ?? []).slice().sort((left, right) => left.at - right.at)
		const spans = freeSpans(
			wall.from,
			wall.to,
			doors.map((door): [number, number] => [door.at - door.width / 2, door.at + door.width / 2]),
			0,
		)
		for (const [u0, u1] of spans) {
			const mesh = chunks.get(chunkForWall(wall, (u0 + u1) / 2))
			const inside = windows.filter((win) => win.at > u0 && win.at < u1)
			buildSolidSpan({ mesh, collision }, wall, u0, u1, inside, lights)
		}
		for (const door of doors) {
			const mesh = chunks.get(chunkForWall(wall, door.at))
			buildDoorway({ mesh, collision }, wall, door, lights)
		}
	}
}

// ──────────────────── ПОМЕЩЕНИЯ ────────────────────

function floorTileSize(room: Room): number {
	switch (room.kind) {
		case "restroom":
			return 0.6
		case "cafeteria":
			return 1
		case "classroom":
			return 1.2
		case "corridor":
			return 1.5
		case "hall":
			return 2
		default:
			return 1.4
	}
}

function buildRoomShell(room: Room, ctx: P.Ctx, lights: Light[]): void {
	const mesh = ctx.mesh
	if (room.kind === "gym") {
		mesh.horizontalQuad(room.x0, room.z0, room.x1, room.z1, 0, room.floorColor, true)
	} else if (room.kind === "library") {
		mesh.horizontalQuad(room.x0, room.z0, room.x1, room.z1, 0, room.floorColor, true)
		P.floorRect(mesh, room.x0 + 0.8, room.z0 + 0.8, room.x1 - 0.8, room.z1 - 0.8, 0.3, shade(room.floorColor, 0.86))
	} else {
		P.tiledFloor(mesh, room.x0, room.z0, room.x1, room.z1, floorTileSize(room), room.floorColor)
	}
	mesh.horizontalQuad(room.x0, room.z0, room.x1, room.z1, room.height, PALETTE.ceiling, false)
	ctx.collision.add(room.x0, room.height, room.z0, room.x1, room.height + CEILING_SLAB, room.z1)

	const [columns, rows] = room.lamps
	const lampY = room.height - 0.16
	const long = room.kind === "gym" ? 1.7 : 1.2
	for (let r = 0; r < rows; r++) {
		const z = room.z0 + ((room.z1 - room.z0) * (r + 0.5)) / rows
		for (let c = 0; c < columns; c++) {
			const x = room.x0 + ((room.x1 - room.x0) * (c + 0.5)) / columns
			P.ceilingLamp(ctx, x, z, lampY, long)
			lights.push({ x, y: lampY - 0.25, z, ...LAMP })
		}
	}
}

function buildClassroom(room: Room, ctx: P.Ctx): void {
	const x0 = room.x0
	const boardColor = room.id === "105" ? PALETTE.whiteboard : PALETTE.chalkboard
	// доска на западной стене, ученики смотрят в -X
	P.wallBoard(ctx, "x0", x0 + 0.125, 3.2, 8.6, 1.02, 2.26, boardColor)
	P.decor(ctx, x0 + 0.13, 0.94, 3.1, x0 + 0.28, 1.02, 8.7, PALETTE.woodMid)
	P.teacherDesk(ctx, x0 + 2.3, 5.8, Math.PI / 2)
	P.chair(ctx, x0 + 3.15, 5.8, -Math.PI / 2, PALETTE.woodMid)

	const columns = [x0 + 3.7, x0 + 5.5, x0 + 7.7, x0 + 9.5]
	const rows = [2.9, 4.7, 6.5, 8.3]
	for (const cx of columns) {
		for (const rz of rows) {
			P.desk(ctx, cx, rz, Math.PI / 2)
			P.chair(ctx, cx + 0.62, rz, Math.PI / 2)
		}
	}

	// шкафы у задней и восточной стены
	P.cabinet(ctx, x0 + 7.4, 11.15, x0 + 10.7, 11.75, 1.95)
	P.cabinet(ctx, x0 + 10.25, 9.1, x0 + 10.87, 10.9, 1.75)
	// радиаторы под окнами
	for (const center of [x0 + 2.1, x0 + 5.5, x0 + 8.9]) {
		P.radiator(ctx, "x", 0.25, center - 0.85, center + 0.85, 1)
	}
	P.bin(ctx, x0 + 1.1, 10.9)
	P.plant(ctx, x0 + 1.2, 1.1, 1.4)
	P.wallClock(ctx, "x0", x0 + 0.13, 10.5, 2.45)
	// плакаты на восточной стене
	const posters: Color[] = [PALETTE.plasticGreen, PALETTE.plasticYellow, PALETTE.plasticBlue]
	for (let i = 0; i < 3; i++) {
		const z = 2.4 + i * 2.3
		P.decor(ctx, x0 + 10.85, 1.35, z, x0 + 10.87, 2.25, z + 0.7, posters[i])
	}
}

function buildCorridor(room: Room, chunks: ChunkSet, collision: CollisionWorld, lights: Light[]): void {
	const slice = (x: number): P.Ctx => ({
		mesh: chunks.get(`corridor-${Math.max(0, Math.min(5, Math.floor(x / 12)))}`),
		collision,
	})
	for (let i = 0; i < 6; i++) {
		const x0 = i * 12
		const x1 = x0 + 12
		const ctx = slice(x0 + 1)
		P.tiledFloor(ctx.mesh, x0, room.z0, x1, room.z1, 1.5, room.floorColor)
		ctx.mesh.horizontalQuad(x0, room.z0, x1, room.z1, room.height, PALETTE.ceiling, false)
		for (let bx = x0 + 2; bx < x1; bx += 4) {
			P.decor(ctx, bx - 0.08, room.height - 0.13, room.z0, bx + 0.08, room.height, room.z1, PALETTE.ceilingGrid)
		}
	}
	collision.add(room.x0, room.height, room.z0, room.x1, room.height + CEILING_SLAB, room.z1)

	const lampY = room.height - 0.16
	for (let i = 0; i < 10; i++) {
		const x = 3.6 + i * 7.2
		P.ceilingLamp(slice(x), x, 15, lampY, 1.4)
		lights.push({ x, y: lampY - 0.25, z: 15, ...LAMP })
	}

	const fill = (
		side: "z0" | "z1",
		at: number,
		facing: 1 | -1,
		spans: Array<[number, number]>,
		seed: number,
	): void => {
		let index = 0
		for (const [a, b] of spans) {
			const length = b - a
			const mid = (a + b) / 2
			const ctx = slice(mid)
			const color = (index + seed) % 2 === 0 ? PALETTE.lockerBlue : PALETTE.lockerTeal
			if (length >= 7) {
				P.lockerBank(ctx, "x", at, a + 0.1, a + length * 0.4, facing, color)
				P.lockerBank(ctx, "x", at, b - length * 0.4, b - 0.1, facing, color)
				P.noticeBoard(ctx, side, at, mid - 1.15, mid + 1.15, seed + index)
				P.bench(ctx, "x", at + facing * 0.5, mid - 1, mid + 1, -facing)
			} else if (length >= 3.4) {
				P.lockerBank(ctx, "x", at, a + 0.1, b - 0.1, facing, color)
			} else if (length >= 1.7) {
				P.noticeBoard(ctx, side, at, a + 0.2, b - 0.2, seed + index)
			}
			index++
		}
	}

	// Места укрытий держим свободными: там встанут шкафы-убежища.
	const hideRanges = (wall: "north" | "south"): Array<[number, number]> =>
		HIDE_SPOTS.filter((spot) => spot.wall === wall).map(
			(spot) => [spot.x - 0.9, spot.x + 0.9] as [number, number],
		)

	fill(
		"z0",
		12.125,
		1,
		freeSpans(0.45, 71.55, [...doorRanges(wallsAt("x", 12)), ...hideRanges("north")], 0.6),
		3,
	)
	fill(
		"z1",
		17.875,
		-1,
		freeSpans(0.45, 71.55, [...doorRanges(wallsAt("x", 18)), ...hideRanges("south")], 0.6),
		8,
	)

	// Шкафы-укрытия: внутри есть место стоять и смотреть в щель.
	for (const spot of HIDE_SPOTS) {
		const north = spot.wall === "north"
		P.hideLocker(slice(spot.x), north ? 12.125 : 17.875, spot.x, north ? 1 : -1)
	}

	// таблички над дверями кабинетов
	for (const wall of wallsAt("x", 12)) {
		for (const door of wall.doors ?? []) {
			const ctx = slice(door.at)
			P.decor(ctx, door.at - 0.26, 2.42, 12.125, door.at + 0.26, 2.76, 12.2, PALETTE.paper)
			P.decor(ctx, door.at - 0.26, 2.42, 12.2, door.at + 0.26, 2.53, 12.21, PALETTE.plasticBlue)
		}
	}

	// торцы коридора
	P.radiator(slice(1), "z", 0.25, 13.8, 16.2, 1)
	P.radiator(slice(71), "z", 71.75, 13.8, 16.2, -1)
	P.plant(slice(1), 1.3, 13.1, 1.6)
	P.plant(slice(71), 70.7, 16.9, 1.6)
	P.bin(slice(1), 1.2, 16.8)
	P.bin(slice(71), 70.8, 13.2)
	P.wallClock(slice(34), "z0", 12.13, 34.2, 2.55)
	// Урны ставим строго не напротив дверей кабинетов (двери на x0 + 2.2,
	// ширина 1.1 м): прежняя урна на 24.5 стояла в двери кабинета 102
	// и полностью закрывала выход из класса.
	for (const x of [26.6, 49.6]) {
		P.bin(slice(x), x, 12.95)
	}
}

function buildGym(room: Room, ctx: P.Ctx): void {
	const mesh = ctx.mesh
	const cx = 13
	P.floorRect(mesh, 6, 20.5, 20, 41.5, 0.1, PALETTE.paper)
	P.floorLine(mesh, 6, 31, 20, 31, 0.1, PALETTE.paper)
	P.floorCircle(mesh, cx, 31, 1.9, 0.1, PALETTE.red)
	P.floorRect(mesh, 10.1, 20.5, 15.9, 26.3, 0.1, PALETTE.paper)
	P.floorRect(mesh, 10.1, 35.7, 15.9, 41.5, 0.1, PALETTE.paper)
	P.floorCircle(mesh, cx, 26.3, 1.9, 0.1, PALETTE.paper)
	P.floorCircle(mesh, cx, 35.7, 1.9, 0.1, PALETTE.paper)

	P.basketballHoop(ctx, cx, 18.2, 1)
	P.basketballHoop(ctx, cx, 43.7, -1)
	P.bleachers(ctx, 0.35, 21, 39, 4)

	// маты на стенах
	for (const [z0, z1] of freeSpans(18.4, 43.6, doorRanges(wallsAt("z", 26)), 0.8)) {
		P.decor(ctx, 25.7, 0, z0, 25.87, 1.7, z1, PALETTE.plasticBlue)
	}
	P.decor(ctx, 3.5, 0, 18.13, 11, 1.7, 18.3, PALETTE.plasticBlue)
	P.decor(ctx, 15, 0, 18.13, 25.7, 1.7, 18.3, PALETTE.plasticBlue)
	P.decor(ctx, 3.5, 0, 43.58, 25.7, 1.7, 43.75, PALETTE.plasticBlue)

	// потолочные балки
	for (let z = 21; z < 43; z += 4) {
		P.decor(ctx, 0.25, 6.32, z - 0.11, 25.75, 6.52, z + 0.11, PALETTE.ceilingGrid)
	}

	// инвентарь в углу
	P.crates(ctx, 21.6, 19, 25.4, 20.8, 3)
	for (let i = 0; i < 6; i++) {
		const n = hashNoise(i * 4.7 + 2)
		const bx = 21.8 + n * 3.2
		const bz = 21.4 + hashNoise(i * 9.1) * 1.6
		P.decor(ctx, bx - 0.12, 0, bz - 0.12, bx + 0.12, 0.24, bz + 0.12, i % 2 === 0 ? PALETTE.plasticYellow : PALETTE.plasticRed)
	}
	P.bench(ctx, "z", 24.6, 30, 34, -1)
}

function buildHall(room: Room, ctx: P.Ctx): void {
	const mesh = ctx.mesh
	// узор на полу
	mesh.rotatedBox(38, 0.006, 31, 9, 0.012, 9, Math.PI / 4, shade(room.floorColor, 0.82))
	P.floorCircle(mesh, 38, 31, 5.4, 0.16, PALETTE.plasticBlue, 0.02)
	P.floorCircle(mesh, 38, 31, 2.6, 0.14, PALETTE.plasticYellow, 0.02)
	// входной коврик
	mesh.horizontalQuad(35.4, 41.6, 40.6, 43.4, 0.014, shade(PALETTE.floorCarpet, 0.7), true)

	// ресепшн и дежурный
	P.receptionDesk(ctx, 27.4, 25, 30.8, 26.6)
	P.chair(ctx, 29.1, 27.5, 0, PALETTE.woodMid)
	P.plant(ctx, 27, 28.6, 1.7)
	P.plant(ctx, 48.6, 20, 1.7)

	// колонны
	for (const [px, pz] of [
		[32, 25],
		[44, 25],
		[32, 37],
		[44, 37],
	] as Array<[number, number]>) {
		P.solid(ctx, px - 0.36, 0, pz - 0.36, px + 0.36, room.height, pz + 0.36, PALETTE.wallCream)
		P.decor(ctx, px - 0.44, 0, pz - 0.44, px + 0.44, 0.24, pz + 0.44, PALETTE.wainscot)
		P.decor(ctx, px - 0.44, room.height - 0.26, pz - 0.44, px + 0.44, room.height, pz + 0.44, PALETTE.wallCream)
	}

	// лестница на второй этаж (пока закрыт)
	const flight = P.stairFlight(ctx, 45, 49.4, 28.5, 14, 0.3, 0.186)
	P.solid(ctx, 45, 0, flight.topZ, 49.4, flight.topY, 35, PALETTE.floorTile)
	P.solid(ctx, 45, flight.topY, 34.85, 49.4, flight.topY + 1.05, 35, PALETTE.metalDark)
	P.decor(ctx, 45, flight.topY + 0.45, 34.8, 49.4, flight.topY + 0.75, 34.86, PALETTE.plasticYellow)
	// Столбики и перила повторяют уклон марша, иначе они торчат до потолка.
	const stepTopAt = (z: number): number =>
		Math.min(flight.topY, Math.max(0, ((z - 28.5) / 0.3) * 0.186))
	for (let i = 0; i < 5; i++) {
		const z = 28.6 + i * 1.55
		P.decor(ctx, 44.94, 0.2, z, 45.06, stepTopAt(z) + 1.05, z + 0.08, PALETTE.metal)
	}
	for (let i = 0; i < 22; i++) {
		const z0 = 28.5 + i * 0.3
		if (z0 >= 34.98) break
		const z1 = Math.min(35, z0 + 0.3)
		const top = stepTopAt(z1) + 1.05
		// Сегмент поручня на каждую ступень + вертикальная связка:
		// мелкий шаг читается как наклонные перила.
		P.decor(ctx, 44.94, top - 0.07, z0, 45.06, top, z1, PALETTE.metal)
		P.decor(ctx, 44.94, top - 0.26, z0, 45.06, top - 0.07, z0 + 0.09, PALETTE.metal)
	}

	// витрины и стенды на западной стене
	P.trophyCase(ctx, "x0", 26.13, 30, 34, 2)
	P.trophyCase(ctx, "x0", 26.13, 40.5, 43.5, 5)
	P.noticeBoard(ctx, "x0", 26.13, 19, 22.5, 9)

	// скамейки у входа
	P.bench(ctx, "x", 39.6, 30.4, 33.6, -1)
	P.bench(ctx, "x", 39.6, 42.4, 45.6, -1)

	// герб над аркой и баннеры под потолком
	P.schoolCrest(ctx, 38, 4.05, 18.13, 1.7)
	P.banner(ctx, 30.5, 21.5, room.height - 0.12, 2.3, PALETTE.plasticBlue)
	P.banner(ctx, 38, 21.5, room.height - 0.12, 2.3, PALETTE.plasticRed)
	P.banner(ctx, 45.5, 21.5, room.height - 0.12, 2.3, PALETTE.plasticGreen)
	P.wallClock(ctx, "z0", 18.13, 33, 3.9)
	P.bin(ctx, 34.6, 40.8)
	P.bin(ctx, 41.4, 40.8)
}

function buildCafeteria(room: Room, ctx: P.Ctx): void {
	P.servingCounter(ctx, 51.9, 19, 58.6, 20.3)
	for (const z of [23.5, 27]) {
		for (const x of [54, 58, 62, 67.5]) {
			P.canteenTable(ctx, x, z, 2.6)
		}
	}
	P.vendingMachine(ctx, 66.5, 18.5, "z1")
	P.vendingMachine(ctx, 68.1, 18.5, "z1")
	P.bin(ctx, 59.6, 21)
	P.bin(ctx, 51.2, 29.9)
	P.plant(ctx, 70.9, 29.8, 1.6)
	P.plant(ctx, 51.1, 21.4, 1.4)
	P.wallClock(ctx, "z1", 30.87, 61, 2.5)
	P.noticeBoard(ctx, "z1", 30.87, 65, 68.5, 4)
	for (const center of [21, 24.5, 28]) {
		P.radiator(ctx, "z", 71.75, center - 0.8, center + 0.8, -1)
	}
}

function buildLibrary(room: Room, ctx: P.Ctx): void {
	for (const z of [34, 36.5, 39, 41.5]) {
		P.bookshelf(ctx, "x", z, 57, 70, 0.55, 2.05, z)
	}
	for (const z of [34, 38, 42]) {
		P.readingTable(ctx, 53.5, z, 0.85)
		P.chair(ctx, 52.2, z, -Math.PI / 2, PALETTE.woodMid)
		P.chair(ctx, 54.8, z, Math.PI / 2, PALETTE.woodMid)
		P.chair(ctx, 53.5, z - 1.2, Math.PI, PALETTE.woodMid)
		P.chair(ctx, 53.5, z + 1.2, 0, PALETTE.woodMid)
	}
	P.receptionDesk(ctx, 56.6, 31.6, 59.6, 32.9)
	P.chair(ctx, 58.1, 33.6, Math.PI, PALETTE.woodMid)
	P.plant(ctx, 51.2, 43, 1.7)
	P.plant(ctx, 70.8, 32.2, 1.5)
	P.noticeBoard(ctx, "z0", 31.13, 66, 69.5, 6)
	P.wallClock(ctx, "z0", 31.13, 63, 2.5)
	for (const center of [34, 38, 42]) {
		P.radiator(ctx, "z", 71.75, center - 0.8, center + 0.8, -1)
	}
}

function buildRestroom(room: Room, ctx: P.Ctx): void {
	P.toiletStalls(ctx, 0.3, 1.6, 8.8, 1.5, 4)
	P.sinkRow(ctx, 2.6, 5.15, 0.25, 1)
	for (const z of [2.4, 3.4, 4.4]) {
		P.solid(ctx, 5.08, 0.62, z - 0.2, 5.37, 1.02, z + 0.2, PALETTE.floorTile)
		P.decor(ctx, 5.34, 1.02, z - 0.06, 5.37, 1.35, z + 0.06, PALETTE.metal)
	}
	P.bin(ctx, 4.9, 10.9)
	P.decor(ctx, 5.1, 1.55, 6.4, 5.37, 2.05, 7.6, PALETTE.plasticGreen)
}

function buildStairwell(room: Room, ctx: P.Ctx): void {
	// Марш поднимается на север: игрок входит с юга, от двери в коридор,
	// и сразу видит ступени, а не торец площадки.
	const steps = 7
	const run = 0.32
	const rise = 0.186
	const baseZ = 8
	const topY = rise * steps
	const topZ = baseZ - steps * run
	for (let i = 0; i < steps; i++) {
		const z1 = baseZ - i * run
		const tone = i % 2 === 0 ? PALETTE.floorTile : shade(PALETTE.floorTile, 0.94)
		P.solid(ctx, 6.1, 0, z1 - run, 10.4, rise * (i + 1), z1, tone)
	}
	// Площадка и заграждение — второй этаж пока закрыт.
	P.solid(ctx, 6.1, 0, 1.2, 10.4, topY, topZ, PALETTE.floorTile)
	P.solid(ctx, 6.1, topY, 1.2, 10.4, topY + 1.05, 1.32, PALETTE.metalDark)
	P.decor(ctx, 6.1, topY + 0.45, 1.32, 10.4, topY + 0.75, 1.39, PALETTE.plasticYellow)
	for (const x of [6.16, 10.34]) {
		for (let i = 0; i < steps; i += 2) {
			const z = baseZ - i * run - run / 2
			P.decor(ctx, x - 0.04, rise * (i + 1), z - 0.04, x + 0.04, rise * (i + 1) + 0.95, z + 0.04, PALETTE.metal)
		}
		P.decor(ctx, x - 0.04, topY + 0.9, 1.2, x + 0.04, topY + 1, topZ, PALETTE.metal)
	}
	P.plant(ctx, 6.4, 10.8, 1.6)
	P.bin(ctx, 10.2, 10.9)
	P.noticeBoard(ctx, "x1", 10.87, 7.6, 10.6, 7)
	P.decor(ctx, 5.88, 1.2, 2.5, 5.9, 2.3, 5.5, PALETTE.plasticBlue)
}

function buildStorage(room: Room, ctx: P.Ctx): void {
	P.cabinet(ctx, 66.15, 0.4, 66.78, 7.4, 2)
	P.crates(ctx, 67.4, 0.6, 71.6, 8.6, 4)
	P.bin(ctx, 71.2, 10.9)
	P.decor(ctx, 67.2, 0, 10.2, 68.4, 1.1, 11.4, PALETTE.plasticBlue)
}

// ──────────────────── УЛИЦА ЗА ОКНАМИ ────────────────────

function tree(mesh: MeshBuilder, x: number, z: number, seed: number): void {
	const n = hashNoise(seed)
	const height = 3.4 + n * 2.6
	mesh.box(x - 0.18, -0.05, z - 0.18, x + 0.18, height * 0.45, z + 0.18, TRUNK)
	const leaves = shade(LEAVES, 0.85 + n * 0.4)
	mesh.box(x - 1.5, height * 0.4, z - 1.5, x + 1.5, height * 0.72, z + 1.5, leaves)
	mesh.box(x - 1.1, height * 0.7, z - 1.1, x + 1.1, height * 0.92, z + 1.1, shade(leaves, 1.08))
	mesh.box(x - 0.6, height * 0.9, z - 0.6, x + 0.6, height, z + 0.6, shade(leaves, 0.92))
}

function buildExterior(chunks: ChunkSet): void {
	const mesh = chunks.get("outside")
	// земля и асфальт
	mesh.horizontalQuad(-150, -150, 222, 194, -0.06, GRASS, true)
	mesh.horizontalQuad(22, 44, 54, 58, -0.04, PAVEMENT, true)
	mesh.horizontalQuad(34, 58, 42, 96, -0.04, PAVEMENT, true)
	mesh.horizontalQuad(-16, -14, 88, -6, -0.04, PAVEMENT, true)
	// спортивное поле западнее спортзала
	mesh.horizontalQuad(-44, 8, -8, 42, -0.03, shade(GRASS, 1.08), true)
	P.floorRect(mesh, -42, 10, -10, 40, 0.16, PALETTE.paper, -0.02)
	P.floorLine(mesh, -42, 25, -10, 25, 0.16, PALETTE.paper, -0.02)
	P.floorCircle(mesh, -26, 25, 4.5, 0.16, PALETTE.paper, -0.02)

	const spots: Array<[number, number]> = [
		[-8, -10],
		[-17, 5],
		[-11, 20],
		[-15, 34],
		[-9, 49],
		[6, -13],
		[20, -15],
		[34, -12],
		[48, -14],
		[62, -11],
		[80, 4],
		[85, 21],
		[79, 36],
		[83, 51],
		[16, 52],
		[58, 53],
		[24, 64],
		[52, 66],
		[10, 70],
		[66, 72],
		[-24, 60],
		[92, 60],
	]
	spots.forEach(([x, z], index) => tree(mesh, x, z, index * 3.3 + 1))

	// ограждение вдоль улицы
	for (let x = -20; x <= 92; x += 3) {
		mesh.box(x - 0.05, -0.05, -20.05, x + 0.05, 1.5, -19.95, PALETTE.metalDark)
	}
	mesh.box(-20, 1.3, -20.03, 92, 1.4, -19.97, PALETTE.metalDark)
	mesh.box(-20, 0.6, -20.03, 92, 0.7, -19.97, PALETTE.metalDark)

	// уличные фонари у входа
	for (const [lx, lz] of [
		[33, 50],
		[43, 50],
		[33, 62],
		[43, 62],
	] as Array<[number, number]>) {
		mesh.box(lx - 0.12, -0.05, lz - 0.12, lx + 0.12, 4.2, lz + 0.12, PALETTE.metalDark)
		mesh.box(lx - 0.45, 4.2, lz - 0.25, lx + 0.45, 4.4, lz + 0.25, PALETTE.metal)
	}

	// дальние дома — город за окном
	const blocks: Array<[number, number, number, number, number]> = [
		[-120, -90, 34, 26, 22],
		[-70, -110, 26, 30, 30],
		[10, -120, 40, 24, 26],
		[90, -100, 30, 28, 20],
		[150, 10, 34, 40, 24],
		[130, 90, 30, 26, 18],
		[20, 130, 44, 30, 22],
		[-90, 110, 36, 28, 26],
	]
	for (const [bx, bz, w, d, h] of blocks) {
		mesh.box(bx, -0.05, bz, bx + w, h, bz + d, DISTANT)
		mesh.box(bx + 1, h, bz + 1, bx + w - 1, h + 1.2, bz + d - 1, shade(DISTANT, 0.86))
		for (let i = 0; i < 6; i++) {
			const y = 3 + i * 3
			if (y > h - 2) break
			mesh.box(bx - 0.05, y, bz + 2, bx + 0.01, y + 1.6, bz + d - 2, shade(DISTANT, 0.7))
			mesh.box(bx + 2, y, bz - 0.05, bx + w - 2, y + 1.6, bz + 0.01, shade(DISTANT, 0.7))
		}
	}
}

// ──────────────────── СБОРКА ────────────────────

export function buildSchool(): SchoolScene {
	const startedAt = performance.now()
	const chunks = new ChunkSet()
	const collision = new CollisionWorld(BUILDING.width, BUILDING.depth)
	const lights: Light[] = []

	buildWalls(chunks, collision, lights)

	for (const room of ROOMS) {
		if (room.kind === "corridor") {
			buildCorridor(room, chunks, collision, lights)
			continue
		}
		const ctx: P.Ctx = { mesh: chunks.get(`room-${room.id}`), collision }
		buildRoomShell(room, ctx, lights)
		switch (room.kind) {
			case "classroom":
				buildClassroom(room, ctx)
				break
			case "gym":
				buildGym(room, ctx)
				break
			case "hall":
				buildHall(room, ctx)
				break
			case "cafeteria":
				buildCafeteria(room, ctx)
				break
			case "library":
				buildLibrary(room, ctx)
				break
			case "restroom":
				buildRestroom(room, ctx)
				break
			case "stairwell":
				buildStairwell(room, ctx)
				break
			case "storage":
				buildStorage(room, ctx)
				break
			default:
				break
		}
	}

	buildExterior(chunks)
	collision.build()

	// Запекаем свет один раз — в реальном времени освещение бесплатное.
	const result: SchoolChunk[] = []
	let triangles = 0
	let vertices = 0
	for (const [name, mesh] of chunks.map) {
		if (mesh.isEmpty) continue
		if (name === "outside") {
			bakeConstant(mesh, 1.16)
		} else {
			bakeLighting(
				mesh,
				lightsForBounds(lights, mesh.minX, mesh.minY, mesh.minZ, mesh.maxX, mesh.maxY, mesh.maxZ),
			)
		}
		triangles += mesh.triangleCount
		vertices += mesh.vertexCount
		result.push({ name, mesh })
	}

	return {
		chunks: result,
		collision,
		triangles,
		vertices,
		lightCount: lights.length,
		buildMs: performance.now() - startedAt,
	}
}
