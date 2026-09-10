/**
 * Сборщик геометрии.
 *
 * Вся статика школы складывается в несколько больших буферов (чанков),
 * поэтому на кадр уходит десяток draw call'ов вместо тысяч объектов.
 * Формат вершины: позиция(3) + нормаль(3) + цвет(3) + emissive(1) = 10 float.
 */

export type Color = readonly [number, number, number]

export const VERTEX_FLOATS = 10

/** Битовые маски сторон куба — можно не строить невидимые грани. */
export const FACE = {
	PX: 1,
	NX: 2,
	PY: 4,
	NY: 8,
	PZ: 16,
	NZ: 32,
	ALL: 63,
} as const

export interface BoxOptions {
	/** Маска сторон, которые НЕ надо строить (экономия вершин). */
	skip?: number
	/** Светящаяся поверхность: не затемняется и не запекается. */
	emissive?: boolean
}

export class MeshBuilder {
	readonly positions: number[] = []
	readonly normals: number[] = []
	readonly colors: number[] = []
	readonly emissive: number[] = []
	readonly indices: number[] = []

	minX = Infinity
	minY = Infinity
	minZ = Infinity
	maxX = -Infinity
	maxY = -Infinity
	maxZ = -Infinity

	get vertexCount(): number {
		return this.positions.length / 3
	}

	get triangleCount(): number {
		return this.indices.length / 3
	}

	get isEmpty(): boolean {
		return this.indices.length === 0
	}

	private pushVertex(
		x: number,
		y: number,
		z: number,
		nx: number,
		ny: number,
		nz: number,
		color: Color,
		emit: number,
	): void {
		this.positions.push(x, y, z)
		this.normals.push(nx, ny, nz)
		this.colors.push(color[0], color[1], color[2])
		this.emissive.push(emit)
		if (x < this.minX) this.minX = x
		if (y < this.minY) this.minY = y
		if (z < this.minZ) this.minZ = z
		if (x > this.maxX) this.maxX = x
		if (y > this.maxY) this.maxY = y
		if (z > this.maxZ) this.maxZ = z
	}

	/** Четырёхугольник по вершинам против часовой стрелки (снаружи). */
	quad(
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
		cx: number,
		cy: number,
		cz: number,
		dx: number,
		dy: number,
		dz: number,
		color: Color,
		emissiveFlag = false,
	): void {
		const u1 = bx - ax
		const u2 = by - ay
		const u3 = bz - az
		const v1 = cx - ax
		const v2 = cy - ay
		const v3 = cz - az
		let nx = u2 * v3 - u3 * v2
		let ny = u3 * v1 - u1 * v3
		let nz = u1 * v2 - u2 * v1
		const len = Math.hypot(nx, ny, nz) || 1
		nx /= len
		ny /= len
		nz /= len

		const emit = emissiveFlag ? 1 : 0
		const base = this.vertexCount
		this.pushVertex(ax, ay, az, nx, ny, nz, color, emit)
		this.pushVertex(bx, by, bz, nx, ny, nz, color, emit)
		this.pushVertex(cx, cy, cz, nx, ny, nz, color, emit)
		this.pushVertex(dx, dy, dz, nx, ny, nz, color, emit)
		this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
	}

	/** Куб по двум углам. */
	box(
		x0: number,
		y0: number,
		z0: number,
		x1: number,
		y1: number,
		z1: number,
		color: Color,
		options?: BoxOptions,
	): void {
		const skip = options?.skip ?? 0
		const emit = options?.emissive ?? false
		const ax = Math.min(x0, x1)
		const bx = Math.max(x0, x1)
		const ay = Math.min(y0, y1)
		const by = Math.max(y0, y1)
		const az = Math.min(z0, z1)
		const bz = Math.max(z0, z1)

		if (!(skip & FACE.PZ))
			this.quad(ax, ay, bz, bx, ay, bz, bx, by, bz, ax, by, bz, color, emit)
		if (!(skip & FACE.NZ))
			this.quad(bx, ay, az, ax, ay, az, ax, by, az, bx, by, az, color, emit)
		if (!(skip & FACE.PX))
			this.quad(bx, ay, bz, bx, ay, az, bx, by, az, bx, by, bz, color, emit)
		if (!(skip & FACE.NX))
			this.quad(ax, ay, az, ax, ay, bz, ax, by, bz, ax, by, az, color, emit)
		if (!(skip & FACE.PY))
			this.quad(ax, by, bz, bx, by, bz, bx, by, az, ax, by, az, color, emit)
		if (!(skip & FACE.NY))
			this.quad(ax, ay, az, bx, ay, az, bx, ay, bz, ax, ay, bz, color, emit)
	}

	/** Куб с центром и поворотом вокруг вертикальной оси. */
	rotatedBox(
		centerX: number,
		bottomY: number,
		centerZ: number,
		sizeX: number,
		sizeY: number,
		sizeZ: number,
		angleY: number,
		color: Color,
		options?: BoxOptions,
	): void {
		const hx = sizeX / 2
		const hz = sizeZ / 2
		const c = Math.cos(angleY)
		const s = Math.sin(angleY)
		const y0 = bottomY
		const y1 = bottomY + sizeY
		const emit = options?.emissive ?? false
		const skip = options?.skip ?? 0

		const px = (lx: number, lz: number): number => centerX + lx * c + lz * s
		const pz = (lx: number, lz: number): number => centerZ - lx * s + lz * c

		const x00 = px(-hx, -hz)
		const z00 = pz(-hx, -hz)
		const x10 = px(hx, -hz)
		const z10 = pz(hx, -hz)
		const x11 = px(hx, hz)
		const z11 = pz(hx, hz)
		const x01 = px(-hx, hz)
		const z01 = pz(-hx, hz)

		if (!(skip & FACE.PZ))
			this.quad(x01, y0, z01, x11, y0, z11, x11, y1, z11, x01, y1, z01, color, emit)
		if (!(skip & FACE.NZ))
			this.quad(x10, y0, z10, x00, y0, z00, x00, y1, z00, x10, y1, z10, color, emit)
		if (!(skip & FACE.PX))
			this.quad(x11, y0, z11, x10, y0, z10, x10, y1, z10, x11, y1, z11, color, emit)
		if (!(skip & FACE.NX))
			this.quad(x00, y0, z00, x01, y0, z01, x01, y1, z01, x00, y1, z00, color, emit)
		if (!(skip & FACE.PY))
			this.quad(x01, y1, z01, x11, y1, z11, x10, y1, z10, x00, y1, z00, color, emit)
		if (!(skip & FACE.NY))
			this.quad(x00, y0, z00, x10, y0, z10, x11, y0, z11, x01, y0, z01, color, emit)
	}

	/** Горизонтальная плоскость (пол/разметка/потолок). */
	horizontalQuad(
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		y: number,
		color: Color,
		facingUp = true,
		emissiveFlag = false,
	): void {
		if (facingUp) {
			this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, color, emissiveFlag)
		} else {
			this.quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, color, emissiveFlag)
		}
	}

	/** Готовые типизированные массивы для загрузки в GPU. */
	toInterleaved(): { data: Float32Array; indices: Uint32Array } {
		const count = this.vertexCount
		const data = new Float32Array(count * VERTEX_FLOATS)
		for (let i = 0; i < count; i++) {
			const o = i * VERTEX_FLOATS
			data[o] = this.positions[i * 3]
			data[o + 1] = this.positions[i * 3 + 1]
			data[o + 2] = this.positions[i * 3 + 2]
			data[o + 3] = this.normals[i * 3]
			data[o + 4] = this.normals[i * 3 + 1]
			data[o + 5] = this.normals[i * 3 + 2]
			data[o + 6] = this.colors[i * 3]
			data[o + 7] = this.colors[i * 3 + 1]
			data[o + 8] = this.colors[i * 3 + 2]
			data[o + 9] = this.emissive[i]
		}
		return { data, indices: new Uint32Array(this.indices) }
	}
}

/** Слегка меняет яркость цвета — чтобы одинаковые предметы не сливались. */
export function shade(color: Color, factor: number): Color {
	return [
		Math.min(1, color[0] * factor),
		Math.min(1, color[1] * factor),
		Math.min(1, color[2] * factor),
	]
}

/** Детерминированный шум 0..1 — для лёгкого разнообразия без рандома в рантайме. */
export function hashNoise(seed: number): number {
	const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
	return x - Math.floor(x)
}
