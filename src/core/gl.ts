/** Низкоуровневые хелперы WebGL2: контекст, шейдеры, программы. */

export class GlError extends Error {}

export function createContext(canvas: HTMLCanvasElement, antialias: boolean): WebGL2RenderingContext {
	const gl = canvas.getContext("webgl2", {
		antialias,
		depth: true,
		stencil: false,
		alpha: false,
		premultipliedAlpha: false,
		preserveDrawingBuffer: false,
		powerPreference: "high-performance",
		desynchronized: false,
		failIfMajorPerformanceCaveat: false,
	})
	if (!gl) {
		throw new GlError(
			"Браузер не поддерживает графику игры. Нужен Chrome, Edge, Firefox или Safari свежей версии.",
		)
	}
	return gl
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)
	if (!shader) throw new GlError("Не удалось создать шейдер")
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? "неизвестная ошибка"
		gl.deleteShader(shader)
		const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment"
		throw new GlError(`Ошибка компиляции ${kind} шейдера: ${log}`)
	}
	return shader
}

export function createProgram(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSource: string,
): WebGLProgram {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
	const program = gl.createProgram()
	if (!program) throw new GlError("Не удалось создать программу")
	gl.attachShader(program, vertex)
	gl.attachShader(program, fragment)
	gl.linkProgram(program)
	gl.deleteShader(vertex)
	gl.deleteShader(fragment)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) ?? "неизвестная ошибка"
		gl.deleteProgram(program)
		throw new GlError(`Ошибка связывания шейдерной программы: ${log}`)
	}
	return program
}

export function getUniforms<T extends string>(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	names: readonly T[],
): Record<T, WebGLUniformLocation | null> {
	const result = {} as Record<T, WebGLUniformLocation | null>
	for (const name of names) {
		result[name] = gl.getUniformLocation(program, name)
	}
	return result
}
