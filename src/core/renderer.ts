/**
 * Рендерер.
 *
 * Идеи, которые делают картинку быстрой:
 *  1. Вся статичная геометрия склеена в чанки (по помещениям) — десятки draw call'ов.
 *  2. Frustum culling по AABB чанка — невидимые комнаты не рисуются.
 *  3. Свет запечён в вершины — в рантайме нет ни теней, ни проходов света.
 *  4. Адаптивное разрешение: при просадке FPS буфер рендера уменьшается.
 *
 * Динамичные объекты (учительница, предметы, баррикада, двери) живут в отдельных
 * буферах с DYNAMIC_DRAW: каждый кадр они пересобираются через bufferSubData
 * без пересоздания VAO.
 */

import { CONFIG } from "../config.js"
import {
	createFrustum,
	createMat4,
	extractFrustum,
	frustumIntersectsAabb,
	multiply,
	perspective,
	viewFromYawPitch,
	type Frustum,
	type Mat4,
} from "./math.js"
import { createContext, createProgram, getUniforms } from "./gl.js"
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders.js"
import { VERTEX_FLOATS, type MeshBuilder } from "./mesh.js"

export interface CameraState {
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
	fov: number
}

interface GpuChunk {
	name: string
	vao: WebGLVertexArrayObject
	indexCount: number
	minX: number
	minY: number
	minZ: number
	maxX: number
	maxY: number
	maxZ: number
}

interface DynamicChunk {
	name: string
	vao: WebGLVertexArrayObject
	vbo: WebGLBuffer
	ibo: WebGLBuffer
	/** Вместимость в байтах — буфер растёт только когда не хватает места. */
	vertexBytes: number
	indexBytes: number
	indexCount: number
	visible: boolean
}

const UNIFORM_NAMES = [
	"uViewProjection",
	"uEye",
	"uSunDirection",
	"uFogColor",
	"uFogDensity",
	"uLightMul",
	"uFlashOrigin",
	"uFlashDirection",
	"uFlashCone",
	"uExtraCount",
	"uExtraOrigin[0]",
	"uExtraDirection[0]",
	"uExtraCone[0]",
] as const

/** Сколько чужих фонарей умеет шейдер. */
export const MAX_EXTRA_FLASHES = 3

export interface RenderStats {
	drawCalls: number
	triangles: number
	chunks: number
	resolutionScale: number
}

/** Свет фонарика в мировых координатах. */
export interface FlashlightState {
	x: number
	y: number
	z: number
	dirX: number
	dirY: number
	dirZ: number
	range?: number
	power?: number
	inner?: number
	outer?: number
}

/** Окружение кадра: день/ночь, туман, фонарь. */
export interface RenderEnvironment {
	lightMul?: number
	fogColor?: readonly number[]
	fogDensity?: number
	clearColor?: readonly number[]
	flash?: FlashlightState | null
	/** Фонари других игроков — берём не больше MAX_EXTRA_FLASHES ближайших. */
	extraFlashes?: ReadonlyArray<FlashlightState>
}

/** Настройки качества: их меняет меню или автоподбор под устройство. */
export interface QualityOptions {
	maxPixelRatio?: number
	minScale?: number
	maxScale?: number
	adaptive?: boolean
	targetFrameMs?: number
	/** Сколько чужих фонарей считать (0 — отключить). */
	extraLights?: number
}

export class Renderer {
	readonly gl: WebGL2RenderingContext
	private readonly canvas: HTMLCanvasElement
	private readonly program: WebGLProgram
	private readonly uniforms: Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>
	private readonly chunks: GpuChunk[] = []
	private readonly dynamic = new Map<string, DynamicChunk>()
	private readonly projection: Mat4 = createMat4()
	private readonly view: Mat4 = createMat4()
	private readonly viewProjection: Mat4 = createMat4()
	private readonly frustum: Frustum = createFrustum()

	private width = 1
	private height = 1
	private scale: number = CONFIG.render.maxScale
	private frameTimeAverage = 16
	private sinceScaleCheck = 0
	// Качество: по умолчанию берём значения из конфига.
	private pixelRatioCap: number = CONFIG.render.maxPixelRatio
	private minScale: number = CONFIG.render.minScale
	private maxScale: number = CONFIG.render.maxScale
	private adaptive: boolean = CONFIG.render.adaptiveResolution
	private targetFrameMs = 16.7
	private extraLightLimit: number = MAX_EXTRA_FLASHES
	private readonly extraOrigin = new Float32Array(MAX_EXTRA_FLASHES * 3)
	private readonly extraDirection = new Float32Array(MAX_EXTRA_FLASHES * 3)
	private readonly extraCone = new Float32Array(MAX_EXTRA_FLASHES * 4)
	private clearR: number = CONFIG.render.clearColor[0]
	private clearG: number = CONFIG.render.clearColor[1]
	private clearB: number = CONFIG.render.clearColor[2]

	readonly stats: RenderStats = {
		drawCalls: 0,
		triangles: 0,
		chunks: 0,
		resolutionScale: 1,
	}

	totalTriangles = 0
	totalVertices = 0

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas
		this.gl = createContext(canvas, CONFIG.render.antialias)
		this.program = createProgram(this.gl, VERTEX_SHADER, FRAGMENT_SHADER)
		this.uniforms = getUniforms(this.gl, this.program, UNIFORM_NAMES)

		const gl = this.gl
		gl.enable(gl.DEPTH_TEST)
		gl.depthFunc(gl.LEQUAL)
		gl.enable(gl.CULL_FACE)
		gl.cullFace(gl.BACK)
		gl.frontFace(gl.CCW)
		gl.clearColor(this.clearR, this.clearG, this.clearB, 1)
		this.resize()
	}

	/** Настраивает атрибуты вершины для текущего VAO. */
	private setupAttributes(): void {
		const gl = this.gl
		const stride = VERTEX_FLOATS * 4
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0)
		gl.enableVertexAttribArray(1)
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12)
		gl.enableVertexAttribArray(2)
		gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24)
		gl.enableVertexAttribArray(3)
		gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36)
	}

	/** Загружает готовый чанк в видеопамять. Называется один раз на старте. */
	uploadChunk(name: string, mesh: MeshBuilder): void {
		if (mesh.isEmpty) return
		const gl = this.gl
		const { data, indices } = mesh.toInterleaved()

		const vao = gl.createVertexArray()
		const vbo = gl.createBuffer()
		const ibo = gl.createBuffer()
		if (!vao || !vbo || !ibo) throw new Error("Не удалось создать GPU-буфер��")

		gl.bindVertexArray(vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
		this.setupAttributes()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
		gl.bindVertexArray(null)

		this.chunks.push({
			name,
			vao,
			indexCount: indices.length,
			minX: mesh.minX,
			minY: mesh.minY,
			minZ: mesh.minZ,
			maxX: mesh.maxX,
			maxY: mesh.maxY,
			maxZ: mesh.maxZ,
		})
		this.totalTriangles += mesh.triangleCount
		this.totalVertices += mesh.vertexCount
	}

	/**
	 * Обновляет (или создаёт) динамичный чанк. Вызывается каждый кадр.
	 * Пустой меш просто скрывает объект.
	 */
	upsertDynamic(name: string, mesh: MeshBuilder): void {
		const gl = this.gl
		let chunk = this.dynamic.get(name)
		if (mesh.isEmpty) {
			if (chunk) {
				chunk.indexCount = 0
				chunk.visible = false
			}
			return
		}
		const { data, indices } = mesh.toInterleaved()

		if (!chunk) {
			const vao = gl.createVertexArray()
			const vbo = gl.createBuffer()
			const ibo = gl.createBuffer()
			if (!vao || !vbo || !ibo) throw new Error("Не удалось создать динамические GPU-буферы")
			chunk = {
				name,
				vao,
				vbo,
				ibo,
				vertexBytes: 0,
				indexBytes: 0,
				indexCount: 0,
				visible: true,
			}
			this.dynamic.set(name, chunk)
			gl.bindVertexArray(vao)
			gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
			gl.bufferData(gl.ARRAY_BUFFER, data.byteLength * 2, gl.DYNAMIC_DRAW)
			chunk.vertexBytes = data.byteLength * 2
			this.setupAttributes()
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.byteLength * 2, gl.DYNAMIC_DRAW)
			chunk.indexBytes = indices.byteLength * 2
			gl.bindVertexArray(null)
		}

		gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vbo)
		if (data.byteLength > chunk.vertexBytes) {
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
			chunk.vertexBytes = data.byteLength
		} else {
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
		}
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.ibo)
		if (indices.byteLength > chunk.indexBytes) {
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW)
			chunk.indexBytes = indices.byteLength
		} else {
			gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices)
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, null)
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)

		chunk.indexCount = indices.length
		chunk.visible = true
	}

	setDynamicVisible(name: string, visible: boolean): void {
		const chunk = this.dynamic.get(name)
		if (chunk) chunk.visible = visible
	}

	hideAllDynamic(): void {
		for (const chunk of this.dynamic.values()) chunk.visible = false
	}

	removeDynamic(name: string): void {
		const chunk = this.dynamic.get(name)
		if (!chunk) return
		const gl = this.gl
		gl.deleteBuffer(chunk.vbo)
		gl.deleteBuffer(chunk.ibo)
		gl.deleteVertexArray(chunk.vao)
		this.dynamic.delete(name)
	}

	get chunkCount(): number {
		return this.chunks.length
	}

	/**
	 * Профиль качества. На слабых ПК и ноутах режем pixel ratio и
	 * разрешаем буферу упасть ниже — это самый дешёвый выигрыш FPS.
	 */
	setQuality(options: QualityOptions): void {
		if (options.maxPixelRatio !== undefined) {
			this.pixelRatioCap = Math.max(0.5, Math.min(3, options.maxPixelRatio))
		}
		if (options.minScale !== undefined) this.minScale = Math.max(0.3, Math.min(1, options.minScale))
		if (options.maxScale !== undefined) this.maxScale = Math.max(0.4, Math.min(1, options.maxScale))
		if (this.maxScale < this.minScale) this.maxScale = this.minScale
		if (options.adaptive !== undefined) this.adaptive = options.adaptive
		if (options.targetFrameMs !== undefined) {
			this.targetFrameMs = Math.max(8, Math.min(40, options.targetFrameMs))
		}
		if (options.extraLights !== undefined) {
			this.extraLightLimit = Math.max(0, Math.min(MAX_EXTRA_FLASHES, Math.round(options.extraLights)))
		}
		this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale))
		this.resize()
	}

	resize(): void {
		const ratio = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap)
		const cssWidth = this.canvas.clientWidth || window.innerWidth
		const cssHeight = this.canvas.clientHeight || window.innerHeight
		this.width = Math.max(1, Math.round(cssWidth * ratio * this.scale))
		this.height = Math.max(1, Math.round(cssHeight * ratio * this.scale))
		if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
			this.canvas.width = this.width
			this.canvas.height = this.height
		}
	}

	/** Следит за временем кадра и плавно подбирает внутреннее разрешение. */
	private updateAdaptiveResolution(frameMs: number): void {
		if (!this.adaptive) return
		// Длинные фризы (загрузка, свёрнутая вкладка) не должны ронять картинку.
		const sample = Math.min(frameMs, 80)
		this.frameTimeAverage += (sample - this.frameTimeAverage) * 0.12
		this.sinceScaleCheck++
		if (this.sinceScaleCheck < 20) return
		this.sinceScaleCheck = 0

		const previous = this.scale
		const slow = this.targetFrameMs * 1.18
		const fast = this.targetFrameMs * 0.8
		if (this.frameTimeAverage > slow && this.scale > this.minScale) {
			// Чем сильнее просадка, тем резче сбрасываем разрешение.
			const step = this.frameTimeAverage > this.targetFrameMs * 1.6 ? 0.14 : 0.07
			this.scale = Math.max(this.minScale, this.scale - step)
		} else if (this.frameTimeAverage < fast && this.scale < this.maxScale) {
			this.scale = Math.min(this.maxScale, this.scale + 0.04)
		}
		if (previous !== this.scale) this.resize()
	}

	render(camera: CameraState, frameMs: number, env?: RenderEnvironment): RenderStats {
		const gl = this.gl
		this.updateAdaptiveResolution(frameMs)

		const aspect = this.width / this.height
		perspective(
			this.projection,
			(camera.fov * Math.PI) / 180,
			aspect,
			CONFIG.camera.near,
			CONFIG.camera.far,
		)
		viewFromYawPitch(this.view, camera.x, camera.y, camera.z, camera.yaw, camera.pitch)
		multiply(this.viewProjection, this.projection, this.view)
		extractFrustum(this.frustum, this.viewProjection)

		const clear = env?.clearColor ?? env?.fogColor ?? CONFIG.render.clearColor
		const r = clear[0] ?? 0
		const g = clear[1] ?? 0
		const b = clear[2] ?? 0
		if (r !== this.clearR || g !== this.clearG || b !== this.clearB) {
			this.clearR = r
			this.clearG = g
			this.clearB = b
			gl.clearColor(r, g, b, 1)
		}

		gl.viewport(0, 0, this.width, this.height)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.useProgram(this.program)
		gl.uniformMatrix4fv(this.uniforms.uViewProjection, false, this.viewProjection)
		gl.uniform3f(this.uniforms.uEye, camera.x, camera.y, camera.z)
		const sun = CONFIG.light.sunDir
		const sunLength = Math.hypot(sun[0], sun[1], sun[2])
		gl.uniform3f(
			this.uniforms.uSunDirection,
			sun[0] / sunLength,
			sun[1] / sunLength,
			sun[2] / sunLength,
		)
		const fog = env?.fogColor ?? CONFIG.light.fogColor
		gl.uniform3f(this.uniforms.uFogColor, fog[0] ?? 0, fog[1] ?? 0, fog[2] ?? 0)
		gl.uniform1f(this.uniforms.uFogDensity, env?.fogDensity ?? CONFIG.light.fogDensity)
		gl.uniform1f(this.uniforms.uLightMul, env?.lightMul ?? 1)

		const flash = env?.flash
		if (flash) {
			const length = Math.hypot(flash.dirX, flash.dirY, flash.dirZ) || 1
			gl.uniform3f(this.uniforms.uFlashOrigin, flash.x, flash.y, flash.z)
			gl.uniform3f(
				this.uniforms.uFlashDirection,
				flash.dirX / length,
				flash.dirY / length,
				flash.dirZ / length,
			)
			gl.uniform4f(
				this.uniforms.uFlashCone,
				Math.cos(flash.outer ?? CONFIG.horror.flashOuter),
				Math.cos(flash.inner ?? CONFIG.horror.flashInner),
				flash.range ?? CONFIG.horror.flashRange,
				flash.power ?? CONFIG.horror.flashPower,
			)
		} else {
			gl.uniform4f(this.uniforms.uFlashCone, 0.9, 0.99, 1, 0)
		}

		// Фонари товарищей: один проход, без лишних draw call'ов.
		const extras = env?.extraFlashes
		const extraCount = Math.min(extras?.length ?? 0, this.extraLightLimit)
		if (extras && extraCount > 0) {
			for (let i = 0; i < extraCount; i++) {
				const light = extras[i]
				if (!light) continue
				const length = Math.hypot(light.dirX, light.dirY, light.dirZ) || 1
				this.extraOrigin[i * 3] = light.x
				this.extraOrigin[i * 3 + 1] = light.y
				this.extraOrigin[i * 3 + 2] = light.z
				this.extraDirection[i * 3] = light.dirX / length
				this.extraDirection[i * 3 + 1] = light.dirY / length
				this.extraDirection[i * 3 + 2] = light.dirZ / length
				this.extraCone[i * 4] = Math.cos(light.outer ?? CONFIG.horror.flashOuter)
				this.extraCone[i * 4 + 1] = Math.cos(light.inner ?? CONFIG.horror.flashInner)
				this.extraCone[i * 4 + 2] = light.range ?? CONFIG.horror.flashRange
				this.extraCone[i * 4 + 3] = light.power ?? CONFIG.horror.flashPower
			}
			gl.uniform1i(this.uniforms.uExtraCount, extraCount)
			gl.uniform3fv(this.uniforms["uExtraOrigin[0]"], this.extraOrigin)
			gl.uniform3fv(this.uniforms["uExtraDirection[0]"], this.extraDirection)
			gl.uniform4fv(this.uniforms["uExtraCone[0]"], this.extraCone)
		} else {
			gl.uniform1i(this.uniforms.uExtraCount, 0)
		}

		let drawCalls = 0
		let triangles = 0
		for (const chunk of this.chunks) {
			if (
				!frustumIntersectsAabb(
					this.frustum,
					chunk.minX,
					chunk.minY,
					chunk.minZ,
					chunk.maxX,
					chunk.maxY,
					chunk.maxZ,
				)
			) {
				continue
			}
			gl.bindVertexArray(chunk.vao)
			gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0)
			drawCalls++
			triangles += chunk.indexCount / 3
		}

		// Динамика рисуется после статики: объектов мало, culling не нужен.
		for (const chunk of this.dynamic.values()) {
			if (!chunk.visible || chunk.indexCount === 0) continue
			gl.bindVertexArray(chunk.vao)
			gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0)
			drawCalls++
			triangles += chunk.indexCount / 3
		}
		gl.bindVertexArray(null)

		this.stats.drawCalls = drawCalls
		this.stats.triangles = triangles
		this.stats.chunks = this.chunks.length
		this.stats.resolutionScale = this.scale
		return this.stats
	}
}
