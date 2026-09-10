/**
 * Запечённый свет (baked vertex lighting).
 *
 * Свет считается ОДИН раз при сборке уровня и записывается в цвет вершин.
 * В реальном времени стоимость равна нулю — именно поэтому игра не тормозит,
 * но в коридоре видны светлые пятна от ламп и засветка от окон.
 */

import { CONFIG } from "../config.js"
import type { Color, MeshBuilder } from "../core/mesh.js"

export interface Light {
	x: number
	y: number
	z: number
	/** За этим радиусом светильник не влияет ни на что. */
	radius: number
	intensity: number
	color: Color
}

/** Базовая освещённость помещения (множитель к цвету вершины). */
const AMBIENT_LEVEL = 0.74

const ambient = CONFIG.light.ambient
const ambientAverage = (ambient[0] + ambient[1] + ambient[2]) / 3
const AMBIENT_R = (ambient[0] / ambientAverage) * AMBIENT_LEVEL
const AMBIENT_G = (ambient[1] / ambientAverage) * AMBIENT_LEVEL
const AMBIENT_B = (ambient[2] / ambientAverage) * AMBIENT_LEVEL

export function bakeLighting(mesh: MeshBuilder, lights: readonly Light[]): void {
	const max = CONFIG.light.maxBaked
	const vertices = mesh.emissive.length
	const positions = mesh.positions
	const normals = mesh.normals
	const colors = mesh.colors
	for (let i = 0; i < vertices; i++) {
		if (mesh.emissive[i] > 0.5) continue
		const v = i * 3
		const px = positions[v]
		const py = positions[v + 1]
		const pz = positions[v + 2]
		const nx = normals[v]
		const ny = normals[v + 1]
		const nz = normals[v + 2]
		let r = AMBIENT_R
		let g = AMBIENT_G
		let b = AMBIENT_B
		for (let li = 0; li < lights.length; li++) {
			const light = lights[li]
			const dx = light.x - px
			const dy = light.y - py
			const dz = light.z - pz
			const distanceSquared = dx * dx + dy * dy + dz * dz
			if (distanceSquared > light.radius * light.radius) continue
			const distance = Math.sqrt(distanceSquared) + 1e-5
			const falloff = 1 - distance / light.radius
			const ndl = (dx * nx + dy * ny + dz * nz) / distance
			const k = falloff * falloff * light.intensity * (Math.max(ndl, 0) * 0.82 + 0.18)
			r += k * light.color[0]
			g += k * light.color[1]
			b += k * light.color[2]
		}
		colors[v] *= r < max ? r : max
		colors[v + 1] *= g < max ? g : max
		colors[v + 2] *= b < max ? b : max
	}
}

/** Ровный свет — для улицы, где источник один (солнце). */
export function bakeConstant(mesh: MeshBuilder, factor: number): void {
	const vertices = mesh.emissive.length
	for (let i = 0; i < vertices; i++) {
		if (mesh.emissive[i] > 0.5) continue
		const v = i * 3
		mesh.colors[v] *= factor
		mesh.colors[v + 1] *= factor
		mesh.colors[v + 2] *= factor
	}
}

/** Отбор светильников, которые реально достают до куска геометрии. */
export function lightsForBounds(
	lights: readonly Light[],
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
): Light[] {
	const result: Light[] = []
	for (const light of lights) {
		const r = light.radius
		if (light.x + r < minX || light.x - r > maxX) continue
		if (light.y + r < minY || light.y - r > maxY) continue
		if (light.z + r < minZ || light.z - r > maxZ) continue
		result.push(light)
	}
	return result
}
