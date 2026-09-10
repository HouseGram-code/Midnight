/**
 * Навигация для учительницы.
 *
 * Школа прямоугольная и предсказуемая, поэтому вместо тяжёлого A* по сетке
 * используется граф точек: коридор, дверные проёмы и центры помещений.
 * Поиск пути — обычный обход в ширину по ~45 узлам: микросекунды.
 */

export interface NavNode {
	id: string
	x: number
	z: number
	/** Связи достаточно указать в одну сторону — граф симметризуется сам. */
	links: readonly string[]
	/** Можно ли ставить сюда цель патрулирования. */
	roam?: boolean
}

export interface NavPoint {
	x: number
	z: number
}

export const NAV_NODES: readonly NavNode[] = [
	// Коридор во всю длину школы (z = 15).
	{ id: "c0", x: 2.5, z: 15, links: ["c1", "wc_d"], roam: true },
	{ id: "c1", x: 8.25, z: 15, links: ["c2", "st_d"], roam: true },
	{ id: "c2", x: 13.2, z: 15, links: ["c3", "r101_d"], roam: true },
	{ id: "c3", x: 18.6, z: 15, links: ["c4"], roam: true },
	{ id: "c4", x: 24.2, z: 15, links: ["c5", "r102_d", "gym_d"], roam: true },
	{ id: "c5", x: 30, z: 15, links: ["c6"], roam: true },
	{ id: "c6", x: 35.2, z: 15, links: ["c7", "r103_d"], roam: true },
	{ id: "c7", x: 38, z: 15, links: ["c8", "hall_d"], roam: true },
	{ id: "c8", x: 42, z: 15, links: ["c9"], roam: true },
	{ id: "c9", x: 46.2, z: 15, links: ["c10", "r104_d"], roam: true },
	{ id: "c10", x: 52, z: 15, links: ["c11"], roam: true },
	{ id: "c11", x: 57.2, z: 15, links: ["c12", "r105_d"], roam: true },
	{ id: "c12", x: 61, z: 15, links: ["c13", "caf_d"], roam: true },
	{ id: "c13", x: 65, z: 15, links: ["c14"], roam: true },
	{ id: "c14", x: 69.5, z: 15, links: ["stor_d"], roam: true },

	// Санузел и лестничная клетка.
	{ id: "wc_d", x: 3.4, z: 11.3, links: ["wc_1"] },
	{ id: "wc_1", x: 2.7, z: 7.5, links: [], roam: true },
	{ id: "st_d", x: 8.25, z: 11.3, links: ["st_1"] },
	{ id: "st_1", x: 8.25, z: 9.6, links: [], roam: true },

	// Кабинеты 101…105.
	{ id: "r101_d", x: 13.2, z: 11.3, links: ["r101_a"] },
	{ id: "r101_a", x: 15.5, z: 9.6, links: ["r101_b", "r101_c"], roam: true },
	{ id: "r101_b", x: 19.5, z: 6.5, links: [], roam: true },
	{ id: "r101_c", x: 16.5, z: 3.4, links: [], roam: true },
	{ id: "r102_d", x: 24.2, z: 11.3, links: ["r102_a"] },
	{ id: "r102_a", x: 26.5, z: 9.6, links: ["r102_b"], roam: true },
	{ id: "r102_b", x: 30.5, z: 6.5, links: [], roam: true },
	{ id: "r103_d", x: 35.2, z: 11.3, links: ["r103_a"] },
	{ id: "r103_a", x: 37.5, z: 9.6, links: ["r103_b"], roam: true },
	{ id: "r103_b", x: 41.5, z: 6.5, links: [], roam: true },
	{ id: "r104_d", x: 46.2, z: 11.3, links: ["r104_a"] },
	{ id: "r104_a", x: 48.5, z: 9.6, links: ["r104_b"], roam: true },
	{ id: "r104_b", x: 52.5, z: 6.5, links: [], roam: true },
	{ id: "r105_d", x: 57.2, z: 11.3, links: ["r105_a"] },
	{ id: "r105_a", x: 59.5, z: 9.6, links: ["r105_b"], roam: true },
	{ id: "r105_b", x: 63.5, z: 6.5, links: [], roam: true },
	{ id: "stor_d", x: 69, z: 11.3, links: ["stor_1"] },
	{ id: "stor_1", x: 69, z: 7.5, links: [], roam: true },

	// Спортзал.
	{ id: "gym_d", x: 22.5, z: 18.7, links: ["gym_a"] },
	{ id: "gym_a", x: 22.5, z: 21.5, links: ["gym_b", "gym_e"], roam: true },
	{ id: "gym_b", x: 13, z: 30, links: ["gym_c"], roam: true },
	{ id: "gym_c", x: 5.5, z: 38, links: [], roam: true },
	{ id: "gym_e", x: 23.5, z: 24, links: ["gym_hall"] },
	{ id: "gym_hall", x: 26, z: 24, links: ["hall_w"] },

	// Вестибюль.
	{ id: "hall_d", x: 38, z: 18.7, links: ["hall_a"] },
	{ id: "hall_a", x: 38, z: 22, links: ["hall_c"], roam: true },
	{ id: "hall_c", x: 38, z: 31, links: ["hall_w", "hall_e", "hall_x"], roam: true },
	{ id: "hall_w", x: 30, z: 31, links: [], roam: true },
	{ id: "hall_e", x: 46, z: 31, links: ["caf_hall", "lib_hall"], roam: true },
	{ id: "hall_x", x: 38, z: 41, links: [], roam: true },

	// Столовая.
	{ id: "caf_d", x: 61, z: 18.7, links: ["caf_a"] },
	{ id: "caf_a", x: 61, z: 22, links: ["caf_b", "caf_c"], roam: true },
	{ id: "caf_b", x: 55, z: 25, links: ["caf_hall"], roam: true },
	{ id: "caf_c", x: 67, z: 27, links: ["caf_lib"], roam: true },
	{ id: "caf_hall", x: 50, z: 24, links: [] },

	// Библиотека.
	{ id: "lib_hall", x: 50, z: 38.5, links: ["lib_a"] },
	{ id: "lib_a", x: 54, z: 38.5, links: ["lib_b"], roam: true },
	{ id: "lib_b", x: 60, z: 41.5, links: ["lib_c", "caf_lib"], roam: true },
	{ id: "lib_c", x: 67, z: 36, links: [], roam: true },
	{ id: "caf_lib", x: 61, z: 31, links: [] },
]

export class NavGraph {
	private readonly nodes = new Map<string, NavNode>()
	private readonly neighbours = new Map<string, string[]>()
	private readonly roamIds: string[] = []

	constructor(nodes: readonly NavNode[] = NAV_NODES) {
		for (const node of nodes) {
			this.nodes.set(node.id, node)
			if (!this.neighbours.has(node.id)) this.neighbours.set(node.id, [])
			if (node.roam) this.roamIds.push(node.id)
		}
		// Симметризация: связи хранятся один раз, а ходить надо в обе стороны.
		for (const node of nodes) {
			for (const other of node.links) {
				if (!this.nodes.has(other)) continue
				this.link(node.id, other)
				this.link(other, node.id)
			}
		}
	}

	private link(from: string, to: string): void {
		const list = this.neighbours.get(from)
		if (!list) {
			this.neighbours.set(from, [to])
			return
		}
		if (!list.includes(to)) list.push(to)
	}

	get size(): number {
		return this.nodes.size
	}

	node(id: string): NavNode | undefined {
		return this.nodes.get(id)
	}

	nearest(x: number, z: number): NavNode | undefined {
		let best: NavNode | undefined
		let bestDistance = Infinity
		for (const node of this.nodes.values()) {
			const distance = (node.x - x) ** 2 + (node.z - z) ** 2
			if (distance < bestDistance) {
				bestDistance = distance
				best = node
			}
		}
		return best
	}

	/** Ближайший узел, который проходит проверку (например, не занят геометрией). */
	nearestFree(
		x: number,
		z: number,
		test: (x: number, z: number) => boolean,
		maxDistance = 14,
	): NavNode | undefined {
		let best: NavNode | undefined
		let bestDistance = maxDistance * maxDistance
		for (const node of this.nodes.values()) {
			const distance = (node.x - x) ** 2 + (node.z - z) ** 2
			if (distance >= bestDistance) continue
			if (!test(node.x, node.z)) continue
			bestDistance = distance
			best = node
		}
		return best
	}

	/** Случайная точка для патрулирования, желательно не рядом с текущей. */
	roamTarget(
		fromX: number,
		fromZ: number,
		minDistance = 12,
		test?: (x: number, z: number) => boolean,
	): NavNode | undefined {
		if (this.roamIds.length === 0) return undefined
		let fallback: NavNode | undefined
		for (let attempt = 0; attempt < 24; attempt++) {
			const id = this.roamIds[Math.floor(Math.random() * this.roamIds.length)]
			const node = this.nodes.get(id)
			if (!node) continue
			if (test && !test(node.x, node.z)) continue
			fallback = node
			if (Math.hypot(node.x - fromX, node.z - fromZ) >= minDistance) return node
		}
		return fallback
	}

	/** Путь по узлам от точки до точки. Конечная точка всегда добавляется в конец. */
	path(fromX: number, fromZ: number, toX: number, toZ: number): NavPoint[] {
		const start = this.nearest(fromX, fromZ)
		const goal = this.nearest(toX, toZ)
		if (!start || !goal) return [{ x: toX, z: toZ }]
		if (start.id === goal.id) return [{ x: goal.x, z: goal.z }, { x: toX, z: toZ }]

		const previous = new Map<string, string>()
		const queue: string[] = [start.id]
		const seen = new Set<string>([start.id])
		let head = 0
		while (head < queue.length) {
			const current = queue[head]
			head += 1
			if (current === goal.id) break
			for (const next of this.neighbours.get(current) ?? []) {
				if (seen.has(next)) continue
				seen.add(next)
				previous.set(next, current)
				queue.push(next)
			}
		}
		if (!seen.has(goal.id)) return [{ x: toX, z: toZ }]

		const ids: string[] = [goal.id]
		let cursor = goal.id
		while (cursor !== start.id) {
			const parent = previous.get(cursor)
			if (!parent) break
			ids.push(parent)
			cursor = parent
		}
		ids.reverse()

		const points: NavPoint[] = []
		for (const id of ids) {
			const node = this.nodes.get(id)
			if (node) points.push({ x: node.x, z: node.z })
		}
		points.push({ x: toX, z: toZ })
		return points
	}
}
