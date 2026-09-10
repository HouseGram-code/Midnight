/**
 * Учительница — единственный живой персонаж школы.
 *
 * Модель собрана из прямоугольных блоков (~30 штук, ~350 треугольников) и
 * пересобирается каждый кадр — так работает анимация без скелета и без шейдерных
 * трюков. Глаза помечены emissive, поэтому в темноте горят красным.
 *
 * Поведение: патруль → заметила → погоня → удар дубиной → поиск → патруль.
 */

import { MeshBuilder, shade, type Color } from "../core/mesh.js"
import type { NavPoint } from "../game/nav.js"
import type { NavGraph } from "../game/nav.js"
import type { CollisionWorld } from "../world/collision.js"
import { BUILDING } from "../world/layout.js"

export type TeacherState = "sleep" | "patrol" | "chase" | "attack" | "search" | "stunned"

export const TEACHER = {
	radius: 0.36,
	/** Радиус для проверки проходов: уже плеч, чтобы пролезать в двери 1.1 м. */
	navRadius: 0.24,
	/** Радиус тела при ходьбе: держим дистанцию от стен, чтобы не входить в них. */
	moveRadius: 0.32,
	/** Полоса тела, которой она цепляется за геометрию: пояс → макушка. */
	bodyLow: 0.98,
	bodyHigh: 1.68,
	height: 1.72,
	eyeHeight: 1.58,
	patrolSpeed: 1.7,
	/** Погоня быстрее шага игрока (3.4), но спринтом от неё можно уйти. */
	chaseSpeed: 3.8,
	/** Рывок, когда игрок бежит или далеко. Спринт игрока (6.0) всё равно быстрее. */
	sprintSpeed: 4.35,
	searchSpeed: 2,
	/** Дальность зрения и половина угла обзора. */
	sightRange: 17,
	sightHalfAngle: 0.78,
	/** Внутри этого радиуса заметит даже за спиной (но только если между вами нет стены). */
	feelRange: 1.8,
	/** Сколько игрок должен продержаться у неё на виду, чтобы она его заметила. */
	noticeTime: 0.5,
	hearRange: 10,
	attackRange: 2.2,
	attackDuration: 0.6,
	/** Когда в анимации удара наносится урон. */
	attackImpact: 0.28,
	attackCooldown: 1,
	/** Выпад в момент замаха: она бросается вперёд, иначе удар всегда мимо. */
	lungeSpeed: 6.4,
	/** Радиус, в котором замах засчитывается как попадание. */
	attackReach: 3.1,
	/** Короткий рывок на последних метрах — иначе от неё всегда убегают спринтом. */
	catchSpeed: 6.2,
	catchTime: 1.1,
	catchCooldown: 4.5,
	catchRange: 5,
	/** Крик при обнаружении: длительность анимации и пауза на месте. */
	screamTime: 1.2,
	screamHold: 0.35,
	/** Сколько гонится после потери игрока из виду. */
	chaseMemory: 4.5,
	searchTime: 8,
	/** Сколько секунд у неё есть, чтобы вытащить игрока из шкафчика. */
	hiddenHunt: 7,
} as const

// Столкновения проверяем только по полосе «пояс … макушка»: парты, стулья и
// мусорки ниже неё, поэтому она больше не цепляется за каждый стол.
const BODY_FEET = TEACHER.bodyLow - 0.06
const BODY_HEIGHT = TEACHER.bodyHigh - BODY_FEET

/** Сторона клетки сетки проходимости. 0.5 м — дверь 1.1 м всё ещё даёт проход. */
const CELL = 0.5
/**
 * Радиус для сетки чуть меньше боевого: в узкие двери (туалет, кладовка)
 * она втискивается боком, и без этого запаса половина школы считалась тупиком.
 */
const GRID_RADIUS = 0.24
/** 8 направлений: пары (di, dj). */
const NEIGHBOURS: number[] = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1]

const SKIN: Color = [0.86, 0.76, 0.7]
const SKIN_DARK: Color = [0.68, 0.58, 0.55]
const DRESS: Color = [0.17, 0.15, 0.2]
const DRESS_LIGHT: Color = [0.26, 0.23, 0.3]
const BLOUSE: Color = [0.79, 0.78, 0.8]
const HAIR: Color = [0.11, 0.1, 0.12]
const SHOE: Color = [0.09, 0.08, 0.09]
const EYE: Color = [1, 0.12, 0.1]
const CLUB: Color = [0.42, 0.28, 0.16]
const CLUB_TAPE: Color = [0.13, 0.13, 0.14]
/** Маска, которая появляется после кат-сцены: чёрное лицо и светящиеся черты. */
const MASK: Color = [0.02, 0.02, 0.025]
const MASK_GLOW: Color = [0.97, 0.97, 0.93]

export interface TeacherSenses {
	playerX: number
	playerZ: number
	playerEyeY: number
	/** Игрок в шкафчике. */
	playerHidden: boolean
	/** 0 — стоит, 0.5 — идёт, 1 — бежит. */
	playerNoise: number
	/** Включённый фонарь выдаёт игрока издалека. */
	flashlightOn: boolean
	/** Она своими глазами видела, в какой шкафчик залез игрок. */
	playerHiddenSpotted: boolean
}

export interface TeacherEvents {
	onStep?: (x: number, z: number) => void
	onSwing?: () => void
	onImpact?: () => void
	onNotice?: () => void
	onLost?: () => void
}

export class Teacher {
	x = 17.5
	y = 0
	z = 6
	yaw = 0
	state: TeacherState = "sleep"
	/** Рисовать ли модель. */
	visible = false
	/** Агресси�� 0…1 — используется для звука и виньетки. */
	alert = 0
	/** Видит ли игрока сейчас. */
	seesPlayer = false

	private path: NavPoint[] = []
	private pathTimer = 0
	private targetX = 17.5
	private targetZ = 6
	private lastSeenX = 0
	private lastSeenZ = 0
	private memory = 0
	private searchTimer = 0
	private attackTimer = 0
	private attackDone = false
	/** Самое близкое расстояние до игрока за текущий замах. */
	private attackClosest = 99
	/** Сколько ещё длится рывок и когда будет следующий. */
	private catchTimer = 0
	private catchCooldown = 0
	/** Крик: таймер анимации тела. */
	private screamTimer = 0
	/** Общее смещение всей позы (дрожь и рывок вверх во время крика). */
	private poseX = 0
	private poseY = 0
	private poseZ = 0
	private cooldown = 0
	private stunTimer = 0
	private walkPhase = 0
	private stepPhase = 0
	private waitTimer = 0
	private speed = 0

	/** Текущая скорость шага — нужна для сетевой синхронизации. */
	get moveSpeed(): number {
		return this.speed
	}

	/** Сила крика 0...1: на неё завязана вся анимация тела. */
	get screaming(): number {
		if (this.screamTimer <= 0) return 0
		return Math.min(1, (this.screamTimer / TEACHER.screamTime) * 1.4)
	}

	/** Заорать: вызывается в момент, когда она заметила игрока. */
	scream(): void {
		this.screamTimer = TEACHER.screamTime
	}
	private lookTimer = 0
	/** Сколько времени она фактически не двигается. */
	private stuckTimer = 0
	/** Сколько времени её тело вообще пересекается с геометрией. */
	private trappedTimer = 0
	/** Сколько секунд игрок непрерывно на виду. */
	private sightTime = 0
	/** Сколько секунд игрок сидит в шкафчике. */
	private hiddenTimer = 0
	/** Куда она оглядывается на остановке. */
	private lookYaw = 0
	/** В какую сторону обходить препятствие. */
	private slideSign: 1 | -1 = 1
	// Сетка проходимости и буферы поиска пути (строятся при первом маршруте).
	private gridW = 0
	private gridH = 0
	private grid: Uint8Array | null = null
	private gridFrom: Int32Array | null = null
	private gridQueue: Int32Array | null = null

	constructor(
		private readonly collision: CollisionWorld,
		private readonly nav: NavGraph,
	) {}

	placeAt(x: number, z: number, yaw = 0): void {
		this.x = x
		this.z = z
		this.yaw = yaw
		this.path = []
		this.pathTimer = 0
		this.speed = 0
		this.stuckTimer = 0
		this.lookYaw = yaw
	}

	/** Пробуждение: начинает охоту. */
	awaken(x: number, z: number, yaw = 0): void {
		this.placeAt(x, z, yaw)
		this.visible = true
		this.state = "patrol"
		this.alert = 0
		this.memory = 0
		this.waitTimer = 0
	}

	sleep(): void {
		this.state = "sleep"
		this.visible = false
		this.alert = 0
		this.seesPlayer = false
	}

	/** Для кат-сцен: задать скорость анимации вручную (шагают ноги). */
	setAnimationSpeed(value: number, dt = 0): void {
		this.speed = value
		if (value > 0.1) this.walkPhase += dt * value * 3.2
	}

	stun(seconds: number): void {
		this.stunTimer = Math.max(this.stunTimer, seconds)
		this.state = "stunned"
		this.path = []
	}

	/** Отбросить учительницу подальше от игрока (после удара и респавна). */
	retreatFrom(x: number, z: number, minDistance = 26): void {
		const node = this.nav.roamTarget(x, z, minDistance)
		if (node) this.placeAt(node.x, node.z, this.yaw)
		this.state = "patrol"
		this.alert = 0
		this.memory = 0
		this.seesPlayer = false
		this.cooldown = 1.5
	}

	distanceTo(x: number, z: number): number {
		return Math.hypot(this.x - x, this.z - z)
	}

	get attacking(): boolean {
		return this.state === "attack"
	}

	/** Свободна ли прямая видимость между двумя точками на уровне груди. */
	private hasLineOfSight(toX: number, toZ: number, eyeY: number): boolean {
		const dx = toX - this.x
		const dz = toZ - this.z
		const distance = Math.hypot(dx, dz)
		if (distance < 0.15) return true
		// Шаг проверки был 0.45 м — луч перескакивал через межкомнатные
		// стены (они всего 0.25 м) и она замечала игрока сквозь стену.
		const steps = Math.min(260, Math.max(4, Math.ceil(distance / 0.12)))
		const y = Math.min(eyeY, TEACHER.eyeHeight)
		for (let i = 1; i < steps; i++) {
			const t = i / steps
			const px = this.x + dx * t
			const pz = this.z + dz * t
			if (this.collision.overlaps(px, y - 0.25, pz, 0.05, 0.5)) return false
		}
		return true
	}

	private canSee(senses: TeacherSenses): boolean {
		const dx = senses.playerX - this.x
		const dz = senses.playerZ - this.z
		const distance = Math.hypot(dx, dz)
		// Включённый фонарь видно гораздо дальше.
		const sightRange = senses.flashlightOn ? TEACHER.sightRange + 4 : TEACHER.sightRange
		if (distance > sightRange) return false
		if (senses.playerHidden) {
			// Шкафчик спасает только того, кто спрятался незаметно. Если она
			// видела, куда игрок залез, — идёт прямо к дверце и достаёт рукой.
			// Сквозь дверцу шкафчика она игрока не видит вообще: раньше,
			// проходя рядом, она замечала сидящего внутри через щель.
			// Исключение одно: она своими глазами видела, куда игрок залез,
			// и тогда у неё есть несколько секунд, чтобы достать его рукой.
			return senses.playerHiddenSpotted && this.hiddenTimer < TEACHER.hiddenHunt
		}
		if (distance > TEACHER.feelRange) {
			// Взгляд вперёд = (−sin yaw, −cos yaw), как у игрока.
			const forwardX = -Math.sin(this.yaw)
			const forwardZ = -Math.cos(this.yaw)
			const dot = (dx * forwardX + dz * forwardZ) / (distance || 1)
			const limit = Math.cos(senses.flashlightOn ? TEACHER.sightHalfAngle + 0.35 : TEACHER.sightHalfAngle)
			if (dot < limit) return false
		}
		return this.hasLineOfSight(senses.playerX, senses.playerZ, senses.playerEyeY)
	}

	private canHear(senses: TeacherSenses): boolean {
		if (senses.playerNoise <= 0.05) return false
		const distance = this.distanceTo(senses.playerX, senses.playerZ)
		const range = TEACHER.hearRange * (0.35 + 0.65 * senses.playerNoise)
		// За закрытой стеной звук больше не превращается во всевидение.
		// Через дверной проём луч остаётся свободным и бег всё ещё слышен.
		return distance <= range && this.hasLineOfSight(senses.playerX, senses.playerZ, 1.25)
	}

	private setTarget(x: number, z: number, force = false): void {
		const moved = Math.hypot(x - this.targetX, z - this.targetZ)
		if (!force && moved < 2 && this.path.length > 0) return
		this.targetX = x
		this.targetZ = z
		// Путь — по сетке проходимости: она знает про парты, стеллажи и столы,
		// а не только про коридоры и центры комнат.
		this.path = this.findPath(x, z)
		// Сетка не нашла проход (узкая дверь толще клетки, зажатый угол) —
		// падаем на старый граф коридоро��, чтобы она вообще не вставала столбом.
		if (this.path.length === 0) this.path = this.nav.path(this.x, this.z, x, z)
		this.pathTimer = 0
	}

	/**
	 * Сетка проходимости строится один раз: для каждой клетки 0.5 × 0.5 м
	 * проверяем, пролезает ли в неё её тело. Около 12 ��ыс��ч проверок — одна
	 * миллисекунда ��а старте и ни одного тупика потом.
	 */
	private buildGrid(): void {
		this.gridW = Math.ceil(BUILDING.width / CELL) + 1
		this.gridH = Math.ceil(BUILDING.depth / CELL) + 1
		const total = this.gridW * this.gridH
		const grid = new Uint8Array(total)
		for (let j = 0; j < this.gridH; j++) {
			for (let i = 0; i < this.gridW; i++) {
				const x = (i + 0.5) * CELL
				const z = (j + 0.5) * CELL
				grid[j * this.gridW + i] = this.blocked(x, z, GRID_RADIUS) ? 0 : 1
			}
		}
		this.grid = grid
		this.gridFrom = new Int32Array(total)
		this.gridQueue = new Int32Array(total)
	}

	/** Маршрут по сетке (поиск в ширину). Пустой массив — пройти нельзя. */
	private findPath(goalX: number, goalZ: number): NavPoint[] {
		if (!this.grid) this.buildGrid()
		const grid = this.grid
		const from = this.gridFrom
		const queue = this.gridQueue
		if (!grid || !from || !queue) return []
		const w = this.gridW
		const h = this.gridH
		let startI = Math.max(0, Math.min(w - 1, Math.floor(this.x / CELL)))
		let startJ = Math.max(0, Math.min(h - 1, Math.floor(this.z / CELL)))
		// Стоит в клетке, центр которой занят мебелью (узкий проход, кабинка,
		// проём двери) — начинаем поиск от ближайшей свободной клетки.
		if (grid[startJ * w + startI] === 0) {
			const free = this.freeCell(this.x, this.z)
			if (!free) return []
			startI = Math.max(0, Math.min(w - 1, Math.floor(free.x / CELL)))
			startJ = Math.max(0, Math.min(h - 1, Math.floor(free.z / CELL)))
		}
		let goalI = Math.max(0, Math.min(w - 1, Math.floor(goalX / CELL)))
		let goalJ = Math.max(0, Math.min(h - 1, Math.floor(goalZ / CELL)))
		// Цель внутри мебели — берём ближайшую свободную клетку рядом.
		if (grid[goalJ * w + goalI] === 0) {
			let found = false
			for (let ring = 1; ring <= 10 && !found; ring++) {
				for (let dj = -ring; dj <= ring && !found; dj++) {
					for (let di = -ring; di <= ring && !found; di++) {
						if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue
						const ni = goalI + di
						const nj = goalJ + dj
						if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue
						if (grid[nj * w + ni] === 0) continue
						goalI = ni
						goalJ = nj
						found = true
					}
				}
			}
			if (!found) return []
		}
		const start = startJ * w + startI
		const goal = goalJ * w + goalI
		if (start === goal) return [{ x: goalX, z: goalZ }]
		from.fill(-1)
		from[start] = start
		let head = 0
		let tail = 0
		queue[tail++] = start
		let reached = false
		while (head < tail && !reached) {
			const current: number = queue[head++]
			const ci: number = current % w
			const cj: number = (current - ci) / w
			for (let k = 0; k < 8; k++) {
				const ni: number = ci + NEIGHBOURS[k * 2]
				const nj: number = cj + NEIGHBOURS[k * 2 + 1]
				if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue
				const next = nj * w + ni
				if (from[next] !== -1 || grid[next] === 0) continue
				// Диагональ разрешена только когда свободны обе соседние клетки.
				if (ni !== ci && nj !== cj) {
					if (grid[cj * w + ni] === 0 || grid[nj * w + ci] === 0) continue
				}
				from[next] = current
				queue[tail++] = next
				if (next === goal) {
					reached = true
					break
				}
			}
		}
		if (!reached) return []
		// Разворачиваем путь и выкидываем точки на одной прямой.
		const cells: number[] = []
		let node: number = goal
		for (let guard = 0; guard < 20000 && node !== start; guard++) {
			cells.push(node)
			node = from[node]
		}
		cells.reverse()
		const points: NavPoint[] = []
		let lastDi = 99
		let lastDj = 99
		let prev = start
		for (const index of cells) {
			const i = index % w
			const j = (index - i) / w
			const pi = prev % w
			const pj = (prev - pi) / w
			const di = Math.sign(i - pi)
			const dj = Math.sign(j - pj)
			const point = { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL }
			if (di !== lastDi || dj !== lastDj || points.length === 0) {
				points.push(point)
				lastDi = di
				lastDj = dj
			} else {
				points[points.length - 1] = point
			}
			prev = index
		}
		// Точная цель в конец, если в неё вообще можно встать.
		if (!this.blocked(goalX, goalZ)) points.push({ x: goalX, z: goalZ })
		return points
	}

	/** Мешает ли геометрия стоять в этой точке. */
	private blocked(x: number, z: number, radius: number = TEACHER.navRadius): boolean {
		return this.collision.overlaps(x, BODY_FEET, z, radius, BODY_HEIGHT)
	}

	/** Есть ли прямой проход между двумя точками (по той же полосе тела). */
	private walkClear(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
		const dx = toX - fromX
		const dz = toZ - fromZ
		const distance = Math.hypot(dx, dz)
		if (distance < 0.001) return !this.blocked(toX, toZ)
		const steps = Math.min(64, Math.max(2, Math.ceil(distance / 0.28)))
		for (let i = 1; i <= steps; i++) {
			const t = i / steps
			if (this.blocked(fromX + dx * t, fromZ + dz * t)) return false
		}
		return true
	}

	private tryMove(dx: number, dz: number): boolean {
		if (dx === 0 && dz === 0) return false
		const length = Math.hypot(dx, dz)
		// Шаг дробим на кусочки по 5 см: на бегу целый шаг мог перескочить
		// через тонкую стену и она оказывалась в соседнем кабинете.
		const steps = Math.max(1, Math.ceil(length / 0.05))
		const sx = dx / steps
		const sz = dz / steps
		// В узких местах плечи сжимаются до navRadius, но никогда уже — иначе
		// протискивалась сквозь стену толщиной 0.25 м.
		let moved = false
		for (let i = 0; i < steps; i++) {
			const nx = this.x + sx
			const nz = this.z + sz
			if (this.blocked(nx, nz, TEACHER.moveRadius)) {
				if (this.blocked(nx, nz, TEACHER.navRadius)) return moved
			}
			this.x = nx
			this.z = nz
			moved = true
		}
		return moved
	}


	/** Осмотреться ��а месте: плавный поворот вместо вращения юлой. */
	private startLook(seconds: number): void {
		this.waitTimer = seconds
		this.lookYaw = this.yaw + (Math.random() * 2 - 1) * 0.9
	}

	/** Зажало: короткий сдвиг в свободную сторону. Телепорты запрещены. */
	private unstuck(): void {
		this.stuckTimer = 0
		this.path = []
		this.pathTimer = 99
		// Если тело уже в геометрии — выталкиваемся наружу совсем немного.
		const embedded = this.blocked(this.x, this.z, TEACHER.navRadius)
		for (const radius of [0.3, 0.55, 0.85]) {
			if (embedded && radius > 0.6) break
			for (let i = 0; i < 16; i++) {
				const angle = (i / 16) * Math.PI * 2 + this.yaw
				const nx = this.x + Math.cos(angle) * radius
				const nz = this.z + Math.sin(angle) * radius
				if (this.blocked(nx, nz)) continue
				// Сквозь стену не прыгаем: до новой точки нужен чистый проход.
				if (!embedded && !this.walkClear(this.x, this.z, nx, nz)) continue
				this.x = nx
				this.z = nz
				return
			}
		}
		// Рядом свободного места нет — стоим и оглядываемся, но не сквозь стены.
		this.startLook(0.35)
	}

	/** Ближайшая свободная клетка сетки — последний выход из геометрии. */
	private freeCell(fromX: number, fromZ: number): NavPoint | null {
		if (!this.grid) this.buildGrid()
		const grid = this.grid
		if (!grid) return null
		const w = this.gridW
		const h = this.gridH
		const ci = Math.max(0, Math.min(w - 1, Math.floor(fromX / CELL)))
		const cj = Math.max(0, Math.min(h - 1, Math.floor(fromZ / CELL)))
		for (let ring = 0; ring <= 28; ring++) {
			for (let dj = -ring; dj <= ring; dj++) {
				for (let di = -ring; di <= ring; di++) {
					if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue
					const i = ci + di
					const j = cj + dj
					if (i < 0 || j < 0 || i >= w || j >= h) continue
					if (grid[j * w + i] === 0) continue
					return { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL }
				}
			}
		}
		return null
	}


	/** Шаг по маршруту: срезаем углы, скользим вдоль стен и не залипаем. */
	private advance(dt: number, speed: number, events: TeacherEvents): void {
		// 1. Срезаем углы: если до следующей точки есть прямой проход — промежуточная не нужна.
		for (let guard = 0; guard < 8 && this.path.length > 1; guard++) {
			const next = this.path[1]
			if (!this.walkClear(this.x, this.z, next.x, next.z)) break
			this.path.shift()
		}
		let waypoint = this.path[0]
		// Дверные проёмы всего 0.4–0.5 м шириной. Если выкидывать точки
		// пути в радиусе 0.6 м, точка в самом проёме теряется и она
		// лезет в стену рядом с дверью вместо выхода из класса.
		while (waypoint && Math.hypot(waypoint.x - this.x, waypoint.z - this.z) < 0.25) {
			this.path.shift()
			waypoint = this.path[0]
		}
		if (!waypoint) {
			this.speed = 0
			return
		}
		const dx = waypoint.x - this.x
		const dz = waypoint.z - this.z
		const distance = Math.hypot(dx, dz) || 1
		const dirX = dx / distance
		const dirZ = dz / distance
		const step = Math.min(speed * dt, 0.32)
		const startX = this.x
		const startZ = this.z

		// 2. Сначала прямо, потом по осям, потом боком вдоль препятствия.
		let moved = this.tryMove(dirX * step, dirZ * step)
		if (!moved) {
			const movedX = this.tryMove(dirX * step, 0)
			const movedZ = this.tryMove(0, dirZ * step)
			moved = movedX || movedZ
		}
		if (!moved) {
			const other: 1 | -1 = this.slideSign === 1 ? -1 : 1
			for (const sign of [this.slideSign, other]) {
				if (this.tryMove(-dirZ * step * sign, dirX * step * sign)) {
					this.slideSign = sign
					moved = true
					break
				}
			}
		}

		// 3. Залипание: сначала новый маршрут, через полсекунды — вылезаем силой.
		const travelled = Math.hypot(this.x - startX, this.z - startZ)
		if (travelled < step * 0.35) {
			this.stuckTimer += dt
			if (this.stuckTimer > 0.2) this.pathTimer = 99
			if (this.stuckTimer > 0.6) this.unstuck()
		} else {
			this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2)
		}

		// 4. Поворот ограничен по скорости — иначе на месте это выглядит как юла.
		const desiredYaw = Math.atan2(-dirX, -dirZ)
		let delta = desiredYaw - this.yaw
		while (delta > Math.PI) delta -= Math.PI * 2
		while (delta < -Math.PI) delta += Math.PI * 2
		const maxTurn = dt * 4.5
		this.yaw += Math.max(-maxTurn, Math.min(maxTurn, delta))

		this.speed = speed
		this.walkPhase += dt * speed * 2.4
		this.stepPhase += dt * speed * 1.35
		if (this.stepPhase >= 1) {
			this.stepPhase -= 1
			events.onStep?.(this.x, this.z)
		}
	}


	update(dt: number, senses: TeacherSenses, events: TeacherEvents = {}): void {
		if (this.state === "sleep") return
		this.cooldown = Math.max(0, this.cooldown - dt)
		this.pathTimer += dt
		this.lookTimer += dt
		if (this.screamTimer > 0) this.screamTimer = Math.max(0, this.screamTimer - dt)

		if (this.state === "stunned") {
			this.stunTimer -= dt
			this.speed = 0
			if (this.stunTimer <= 0) this.state = "chase"
			return
		}

		// Страховка: если тело вдавило в геометрию дольше полусекунды — вылезаем.
		// Каждый кадр дергать unstuck нельзя: он стирает маршрут и она кружит.
		if (this.blocked(this.x, this.z)) {
			this.trappedTimer += dt
			if (this.trappedTimer > 0.5) {
				this.trappedTimer = 0
				this.unstuck()
			}
		} else {
			this.trappedTimer = 0
		}

		// Пока игрок в шкафчике, у неё есть только ограниченное время на то,
		// чтобы его оттуда вытащить. Потом она теряет интерес и уходит.
		if (senses.playerHidden) this.hiddenTimer += dt
		else this.hiddenTimer = 0

		const inSight = this.canSee(senses)
		// Реакция не мгновенная: в проёме двери она больше не «щёлкает» на
		// игрока мгновенно — надо продержаться у неё на виду. В погоне — сразу.
		if (inSight) this.sightTime += dt
		else this.sightTime = Math.max(0, this.sightTime - dt * 2)
		const locked = this.state === "chase" || this.state === "attack"
		const sees = inSight && (locked || this.sightTime >= TEACHER.noticeTime)
		this.seesPlayer = sees
		const hears = !sees && this.canHear(senses)
		const distance = this.distanceTo(senses.playerX, senses.playerZ)

		if (sees || hears) {
			if (this.state !== "chase" && this.state !== "attack") {
				events.onNotice?.()
				this.state = "chase"
			}
			this.memory = TEACHER.chaseMemory
			this.lastSeenX = senses.playerX
			this.lastSeenZ = senses.playerZ
			this.alert = Math.min(1, this.alert + dt * 2.2)
		} else {
			// Не видит и не слышит. Если игрок в шкафчике — интерес гаснет
			// быстро: она ещё пару секунд топчется рядом и уходит искать дальше.
			if (senses.playerHidden) this.memory = Math.min(this.memory, 2)
			this.memory = Math.max(0, this.memory - dt * (senses.playerHidden ? 3 : 1))
			this.alert = Math.max(0, this.alert - dt * 0.35)
		}

		switch (this.state) {
			case "attack": {
				this.attackTimer += dt
				this.speed = 0
				const turnTo = Math.atan2(-(senses.playerX - this.x), -(senses.playerZ - this.z))
				let delta = turnTo - this.yaw
				while (delta > Math.PI) delta -= Math.PI * 2
				while (delta < -Math.PI) delta += Math.PI * 2
				this.yaw += delta * Math.min(1, dt * 6)
				// Выпад: она бросается вперёд вместе с замахом. Без этого игрок
				// просто отбегает на два шага, а она машет и машет вхолостую.
				if (this.attackTimer < TEACHER.attackDuration * 0.62) {
					const gap = this.distanceTo(senses.playerX, senses.playerZ)
					if (gap > 0.85) {
						this.tryMove(
							-Math.sin(this.yaw) * TEACHER.lungeSpeed * dt,
							-Math.cos(this.yaw) * TEACHER.lungeSpeed * dt,
						)
						this.speed = TEACHER.lungeSpeed
					}
				}
				// Попадание считаем по самому близкому моменту замаха, а не по
				// одному кадру: иначе любой шаг назад отменяет удар.
				this.attackClosest = Math.min(
					this.attackClosest,
					this.distanceTo(senses.playerX, senses.playerZ),
				)
				const reachable =
					this.attackClosest <= TEACHER.attackReach &&
					(!senses.playerHidden || senses.playerHiddenSpotted)
				if (
					!this.attackDone &&
					reachable &&
					this.attackTimer >= TEACHER.attackDuration * TEACHER.attackImpact
				) {
					this.attackDone = true
					events.onImpact?.()
				}
				if (this.attackTimer >= TEACHER.attackDuration) {
					this.state = "chase"
					// Промахнулась — не машет снова сразу, а сначала догоняет.
					this.cooldown = this.attackDone
						? TEACHER.attackCooldown
						: TEACHER.attackCooldown * 1.25
					this.attackClosest = 99
				}
				break
			}
			case "chase": {
				if (
					distance <= TEACHER.attackRange &&
					this.cooldown <= 0 &&
					(!senses.playerHidden || senses.playerHiddenSpotted)
				) {
					this.state = "attack"
					this.attackTimer = 0
					this.attackDone = false
					this.attackClosest = distance
					events.onSwing?.()
					break
				}
				if (this.memory <= 0) {
					this.state = "search"
					this.searchTimer = TEACHER.searchTime
					events.onLost?.()
					break
				}
				const goalX = sees ? senses.playerX : this.lastSeenX
				const goalZ = sees ? senses.playerZ : this.lastSeenZ
				// Пока между нами нет стен — идём напрямую. Именно это и есть «догоняет».
				if (distance < 22 && this.walkClear(this.x, this.z, goalX, goalZ)) {
					this.path = [{ x: goalX, z: goalZ }]
					this.targetX = goalX
					this.targetZ = goalZ
					this.pathTimer = 0
				} else if (this.pathTimer > 0.4 || this.path.length === 0) {
					this.setTarget(goalX, goalZ, true)
					// Маршрута нет (игрок в шкафчике или за мебелью) — идём напролом.
					if (this.path.length === 0) this.path = [{ x: goalX, z: goalZ }]
				}
				// Короткий рывок на последних метрах: в обычном темпе она медленнее
				// спринта (6.0), поэтому без рывка догнать и ударить невозможно.
				if (this.catchTimer > 0) this.catchTimer = Math.max(0, this.catchTimer - dt)
				else if (this.catchCooldown > 0) this.catchCooldown = Math.max(0, this.catchCooldown - dt)
				else if (sees && distance < TEACHER.catchRange) {
					this.catchTimer = TEACHER.catchTime
					this.catchCooldown = TEACHER.catchCooldown
				}
				// Заметила издалека — первые мгновения стоит на месте и орёт.
				// Вблизи паузы нет: иначе она снова станет недогоняемой.
				if (this.screamTimer > TEACHER.screamTime - TEACHER.screamHold && distance > 8) {
					this.speed = 0
					break
				}
				const rush = senses.playerNoise > 0.5 || distance > 5
				const chaseSpeed =
					this.catchTimer > 0
						? TEACHER.catchSpeed
						: rush
							? TEACHER.sprintSpeed
							: TEACHER.chaseSpeed
				this.advance(dt, chaseSpeed, events)
				break
			}

			case "search": {
				this.searchTimer -= dt
				if (this.searchTimer <= 0) {
					this.state = "patrol"
					this.path = []
					break
				}
				if (this.path.length === 0 || this.pathTimer > 3) {
					// Точку осмотра берём свободную, иначе она тыкается в мебель.
					let picked = false
					for (let attempt = 0; attempt < 8 && !picked; attempt++) {
						const angle = Math.random() * Math.PI * 2
						const radius = 2.5 + Math.random() * 4.5
						const tx = this.lastSeenX + Math.cos(angle) * radius
						const tz = this.lastSeenZ + Math.sin(angle) * radius
						if (this.blocked(tx, tz)) continue
						this.setTarget(tx, tz, true)
						picked = true
					}
					if (!picked) this.setTarget(this.lastSeenX, this.lastSeenZ, true)
					if (this.path.length === 0) {
						this.startLook(0.4)
						break
					}
				}
				this.advance(dt, TEACHER.searchSpeed, events)
				break
			}

			case "patrol":
			default: {
				if (this.waitTimer > 0) {
					this.waitTimer -= dt
					this.speed = 0
					// Плавно доворачивается к выбранной стороне, а не крутится бесконечно.
					let look = this.lookYaw - this.yaw
					while (look > Math.PI) look -= Math.PI * 2
					while (look < -Math.PI) look += Math.PI * 2
					const maxLook = dt * 1.6
					this.yaw += Math.max(-maxLook, Math.min(maxLook, look))
					break
				}
				if (this.path.length === 0 || this.pathTimer > 8) {
					const node = this.nav.roamTarget(this.x, this.z, 14, (x, z) => !this.blocked(x, z))
					if (node) this.setTarget(node.x, node.z, true)
					if (this.path.length === 0) {
						this.startLook(0.4)
						break
					}
				}
				this.advance(dt, TEACHER.patrolSpeed, events)
				// Дошла — короткая пауза с осмотром, дальше сразу новый маршрут.
				if (this.path.length === 0 && this.waitTimer <= 0) {
					this.startLook(0.5 + Math.random() * 0.7)
				}
				break
			}

		}
	}

	/** Смещение в локальных координатах тела (−Z — лицо). */
	private part(
		mesh: MeshBuilder,
		lx: number,
		ly: number,
		lz: number,
		sx: number,
		sy: number,
		sz: number,
		color: Color,
		emissive = false,
	): void {
		const cos = Math.cos(this.yaw)
		const sin = Math.sin(this.yaw)
		// Общее смещение позы: им трясёт всю фигуру во время крика.
		const ox = lx + this.poseX
		const oy = ly + this.poseY
		const oz = lz + this.poseZ
		const wx = this.x + ox * cos + oz * sin
		const wz = this.z - ox * sin + oz * cos
		mesh.rotatedBox(
			wx,
			this.y + oy,
			wz,
			sx,
			sy,
			sz,
			this.yaw,
			color,
			emissive ? { emissive: true } : undefined,
		)
	}

	/**
	 * Собирает модель в переданный меш.
	 * @param writing — режим кат-сцены: пишет на доске без дубины.
	 * @param human — до крика она обычный человек: тёмные глаза, без дубины.
	 */
	/**
	 * Маска на лице, которая появляется после кат-сцены: чёрное лицо,
	 * белые светящиеся глаза с чёрными зрачками и широкая зубастая улыбка.
	 */
	private faceMask(
		mesh: MeshBuilder,
		bob: number,
		headTurn: number,
		scream = 0,
	): void {
		// Голова занимает по высоте 1.5...1.77, плоскость лица — z = -0.125.
		const base = 1.5 + bob
		const plateZ = headTurn - 0.13
		const faceZ = headTurn - 0.145
		// Боксы задаются нижней границей, поэтому центр переводим сами.
		const box = (
			cx: number,
			cy: number,
			cz: number,
			sx: number,
			sy: number,
			sz: number,
			color: Color,
			glow = false,
		): void => {
			this.part(mesh, cx, cy - sy / 2, cz, sx, sy, sz, color, glow)
		}
		// Чёрная пластина вместо лица.
		box(0, base + 0.135, plateZ, 0.248, 0.258, 0.022, MASK)
		// Глаза: светящееся кольцо и чёрный зрачок внутри.
		const pulse = 1 + Math.sin(this.lookTimer * 3.1) * 0.04 + this.alert * 0.06
		const r = 0.055 * pulse * (1 + scream * 0.22)
		for (const side of [-1, 1]) {
			const ex = side * 0.058
			const ey = base + 0.16
			box(ex, ey + r * 0.66, faceZ, r * 1.6, r * 0.5, 0.014, MASK_GLOW, true)
			box(ex, ey - r * 0.66, faceZ, r * 1.6, r * 0.5, 0.014, MASK_GLOW, true)
			box(ex - r * 0.62, ey, faceZ, r * 0.5, r * 1.45, 0.014, MASK_GLOW, true)
			box(ex + r * 0.62, ey, faceZ, r * 0.5, r * 1.45, 0.014, MASK_GLOW, true)
			box(ex, ey, faceZ - 0.004, r * 0.85, r * 0.85, 0.012, MASK)
		}
		// Улыбка: ряд зубов дугой, к краям она поднимается.
		// Во время крика пасть распахивается: зубы вытягиваются вниз.
		const open = scream * 0.045
		const teeth = 9
		for (let i = 0; i < teeth; i += 1) {
			const t = i / (teeth - 1) - 0.5
			const lift = t * t * 0.05
			const tall = (0.03 - Math.abs(t) * 0.012) * (1 + scream * 1.4)
			box(
				t * 0.19,
				base + 0.05 + lift - open * 0.4,
				faceZ,
				0.017,
				tall,
				0.013,
				MASK_GLOW,
				true,
			)
		}
		// Тёмная щель под зубами — во время крика это распахнутая пасть.
		box(0, base + 0.028 - open, faceZ + 0.004, 0.205, 0.016 + open * 1.2, 0.013, MASK)
	}

	buildMesh(
		mesh: MeshBuilder,
		options: { writing?: boolean; writePhase?: number; human?: boolean } = {},
	): void {
		const writing = options.writing ?? false
		// Красные глаза и дубина — только когда она уже не человек.
		const hostile = !writing && !(options.human ?? false)
		const moving = this.speed > 0.1
		const swing = moving ? Math.sin(this.walkPhase) : 0
		// Крик: тело вскидывается вверх, его мелко трясёт и откидывает назад.
		const screamPow = hostile ? this.screaming : 0
		this.poseX = Math.sin(this.lookTimer * 47) * 0.022 * screamPow
		this.poseY = 0
		this.poseZ = 0.025 * screamPow
		const bob =
			(moving ? Math.abs(Math.cos(this.walkPhase)) * 0.035 : 0) + screamPow * 0.05
		const attackProgress = this.state === "attack" ? this.attackTimer / TEACHER.attackDuration : 0

		// Ноги и обувь: шаг показан смещением вперёд/назад.
		const legSwing = swing * 0.19
		this.part(mesh, -0.13, 0.09, -legSwing, 0.17, 0.72, 0.19, DRESS)
		this.part(mesh, 0.13, 0.09, legSwing, 0.17, 0.72, 0.19, DRESS)
		this.part(mesh, -0.13, 0, -legSwing - 0.03, 0.19, 0.1, 0.29, SHOE)
		this.part(mesh, 0.13, 0, legSwing - 0.03, 0.19, 0.1, 0.29, SHOE)

		// Платье и торс.
		this.part(mesh, 0, 0.72 + bob, 0, 0.54, 0.34, 0.36, DRESS)
		this.part(mesh, 0, 1.04 + bob, 0, 0.46, 0.32, 0.3, DRESS_LIGHT)
		this.part(mesh, 0, 1.34 + bob, 0, 0.44, 0.14, 0.29, BLOUSE)
		this.part(mesh, 0, 1.3 + bob, -0.13, 0.16, 0.2, 0.06, BLOUSE)
		// Брошь — маленькая деталь, которая сильно оживляет силуэт.
		this.part(mesh, 0.13, 1.26 + bob, -0.15, 0.05, 0.05, 0.02, [0.72, 0.6, 0.2])

		// Голова, волосы, пучок.
		const headTurn =
			(writing ? 0 : Math.sin(this.lookTimer * 0.7) * 0.02) + screamPow * 0.055
		this.part(mesh, 0, 1.44 + bob, 0, 0.12, 0.08, 0.12, SKIN_DARK)
		this.part(mesh, 0, 1.5 + bob, headTurn, 0.25, 0.27, 0.25, SKIN)
		this.part(mesh, 0, 1.68 + bob, headTurn, 0.27, 0.08, 0.27, HAIR)
		this.part(mesh, 0, 1.5 + bob, headTurn + 0.11, 0.27, 0.2, 0.06, HAIR)
		this.part(mesh, 0, 1.56 + bob, headTurn + 0.16, 0.16, 0.16, 0.14, HAIR)
		this.part(mesh, -0.135, 1.52 + bob, headTurn, 0.03, 0.22, 0.2, HAIR)
		this.part(mesh, 0.135, 1.52 + bob, headTurn, 0.03, 0.22, 0.2, HAIR)

		// До крика — обычное лицо. После кат-сцены на нём маска.
		if (hostile) {
			this.faceMask(mesh, bob, headTurn, screamPow)
		} else {
			this.part(mesh, -0.062, 1.55 + bob, headTurn - 0.125, 0.035, 0.028, 0.03, [0.16, 0.14, 0.14])
			this.part(mesh, 0.062, 1.55 + bob, headTurn - 0.125, 0.035, 0.028, 0.03, [0.16, 0.14, 0.14])
			this.part(mesh, 0, 1.46 + bob, headTurn - 0.125, 0.07, 0.02, 0.02, [0.35, 0.16, 0.16])
		}

		// Руки.
		if (writing) {
			const phase = options.writePhase ?? 0
			// Рука по��нята к середине доски (доска висит на 1.02…2.26).
			const reach = 0.2 + 0.07 * Math.sin(phase * 3.1)
			const hand = 1.42 + 0.1 * Math.sin(phase * 1.3)
			// лева�� рука с журналом
			this.part(mesh, -0.28, 0.94, 0.04, 0.13, 0.46, 0.14, DRESS_LIGHT)
			this.part(mesh, -0.28, 0.83, 0.06, 0.12, 0.12, 0.13, SKIN)
			this.part(mesh, -0.31, 0.86, -0.1, 0.22, 0.28, 0.04, [0.26, 0.3, 0.38])
			// правая рука: плечо вниз, предплечье к доске
			this.part(mesh, 0.27, hand - 0.34, -0.05, 0.13, 0.4, 0.14, DRESS_LIGHT)
			this.part(mesh, 0.27, hand, -reach * 0.5, 0.13, 0.13, 0.42, DRESS_LIGHT)
			this.part(mesh, 0.27, hand, -reach - 0.2, 0.11, 0.11, 0.12, SKIN)
			// мел у самой доски
			this.part(mesh, 0.27, hand + 0.01, -reach - 0.3, 0.04, 0.04, 0.1, [0.95, 0.95, 0.92])
			return
		}

		const armSwing = swing * 0.16
		if (!hostile) {
			// Кат-сцена: идёт с журналом в руке, дубина ещё не появилась.
			this.part(mesh, -0.28, 0.98, armSwing, 0.13, 0.5, 0.15, DRESS_LIGHT)
			this.part(mesh, -0.28, 0.92, armSwing, 0.12, 0.12, 0.13, SKIN)
			this.part(mesh, 0.28, 0.98, -armSwing, 0.13, 0.5, 0.15, DRESS_LIGHT)
			this.part(mesh, 0.28, 0.92, -armSwing, 0.12, 0.12, 0.13, SKIN)
			this.part(mesh, 0.3, 0.95, -armSwing - 0.12, 0.2, 0.26, 0.04, [0.26, 0.3, 0.38])
			return
		}
		// Крик: обе руки вскинуты над головой, дубина поднята — поза монстра.
		if (screamPow > 0.2 && attackProgress <= 0) {
			const spread = 0.3 + screamPow * 0.08
			const raise = 1.06 + screamPow * 0.14
			for (const side of [-1, 1]) {
				this.part(mesh, side * spread, raise, 0.03, 0.14, 0.48, 0.15, DRESS_LIGHT)
				this.part(mesh, side * spread, raise + 0.46, 0.03, 0.12, 0.12, 0.13, SKIN)
			}
			this.part(mesh, spread, raise + 0.54, 0.03, 0.1, 0.68, 0.1, CLUB)
			this.part(mesh, spread, raise + 0.56, 0.03, 0.11, 0.14, 0.11, CLUB_TAPE)
			return
		}
		this.part(mesh, -0.28, 0.98, armSwing, 0.13, 0.5, 0.15, DRESS_LIGHT)
		this.part(mesh, -0.28, 0.92, armSwing, 0.12, 0.12, 0.13, SKIN)

		// Правая рука с дубиной: замах вверх → удар вперёд.
		if (attackProgress > 0) {
			const raise = attackProgress < 0.42
			if (raise) {
				const t = attackProgress / 0.42
				this.part(mesh, 0.3, 1.1 + t * 0.22, -0.02, 0.14, 0.48, 0.16, DRESS_LIGHT)
				this.part(mesh, 0.3, 1.52 + t * 0.24, -0.02, 0.12, 0.12, 0.13, SKIN)
				this.part(mesh, 0.3, 1.6 + t * 0.3, -0.02, 0.1, 0.66, 0.1, CLUB)
				this.part(mesh, 0.3, 1.62 + t * 0.3, -0.02, 0.11, 0.14, 0.11, CLUB_TAPE)
			} else {
				const t = (attackProgress - 0.42) / 0.58
				const forward = 0.2 + t * 0.5
				const drop = 1.42 - t * 0.5
				this.part(mesh, 0.3, 1.06, -forward * 0.4, 0.14, 0.46, 0.18, DRESS_LIGHT)
				this.part(mesh, 0.3, drop, -forward * 0.55, 0.12, 0.12, 0.13, SKIN)
				this.part(mesh, 0.3, drop, -forward - 0.2, 0.1, 0.1, 0.7, CLUB)
				this.part(mesh, 0.3, drop, -forward + 0.08, 0.11, 0.11, 0.14, CLUB_TAPE)
			}
		} else {
			const ready = this.state === "chase"
			const armY = ready ? 1.04 : 0.98
			this.part(mesh, 0.28, armY, -armSwing - (ready ? 0.14 : 0), 0.13, 0.5, 0.15, DRESS_LIGHT)
			this.part(mesh, 0.28, armY - 0.06, -armSwing - (ready ? 0.2 : 0), 0.12, 0.12, 0.13, SKIN)
			if (ready) {
				this.part(mesh, 0.28, armY - 0.04, -armSwing - 0.5, 0.1, 0.1, 0.66, CLUB)
				this.part(mesh, 0.28, armY - 0.04, -armSwing - 0.24, 0.11, 0.11, 0.14, CLUB_TAPE)
			} else {
				this.part(mesh, 0.28, armY - 0.66, -armSwing, 0.09, 0.62, 0.09, shade(CLUB, 0.95))
				this.part(mesh, 0.28, armY - 0.14, -armSwing, 0.1, 0.13, 0.1, CLUB_TAPE)
			}
		}
	}
}
