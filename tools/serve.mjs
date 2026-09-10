/**
 * Микросервер для локального запуска (без зависимостей).
 *
 * ES-модули не работают при открытии index.html через file:// — браузер
 * блокирует их по CORS. Поэтому игру нужно отдавать по HTTP.
 *
 * Запуск:  node tools/serve.mjs [--port 5173] [--host 127.0.0.1]
 */

import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
}

function readArg(name, fallback) {
	const index = process.argv.indexOf(`--${name}`)
	if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
	return fallback
}

const port = Number(readArg("port", process.env.PORT ?? "5173"))
const host = readArg("host", "127.0.0.1")

async function resolveTarget(urlPath) {
	const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0])
	const relative = normalize(decoded).replace(/^([/\\])+/, "")
	const candidate = join(ROOT, relative)
	// Защита от выхода за корень проекта.
	if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
	try {
		const info = await stat(candidate)
		if (info.isDirectory()) {
			const index = join(candidate, "index.html")
			const indexInfo = await stat(index)
			return indexInfo.isFile() ? index : null
		}
		return info.isFile() ? candidate : null
	} catch {
		return null
	}
}

const server = createServer(async (request, response) => {
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed")
		return
	}
	const target = await resolveTarget(request.url ?? "/")
	if (!target) {
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
		response.end("404 — файл не найден")
		return
	}
	const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream"
	response.writeHead(200, {
		"Content-Type": type,
		// В разработке кэш только мешает.
		"Cache-Control": "no-cache",
	})
	if (request.method === "HEAD") {
		response.end()
		return
	}
	createReadStream(target).pipe(response)
})

server.listen(port, host, () => {
	console.log(`Школа 3D → http://${host}:${port}/`)
	console.log(`Корень: ${ROOT}`)
	console.log("Остановить: Ctrl+C")
})
