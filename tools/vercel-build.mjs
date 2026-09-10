/**
 * Собирает папку public/ для Vercel.
 *
 * Игра — обычная статика: index.html грузит ./dist/main.js, стили и звуки.
 * Скрипт запускается после tsc и раскладывает только то, что нужно браузеру:
 * исходники src/, tools/ и package.json на сайт не попадают.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "public")
const parts = ["index.html", "favicon.ico", "icon.svg", "apple-touch-icon.png", "dist", "styles", "assets"]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

function sizeOf(path) {
	const info = statSync(path)
	if (!info.isDirectory()) return info.size
	let total = 0
	for (const entry of readdirSync(path)) total += sizeOf(join(path, entry))
	return total
}

let total = 0
for (const part of parts) {
	const from = join(root, part)
	if (!existsSync(from)) {
		console.error(`[vercel-build] нет ${part} — сначала нужен npm run build`)
		process.exit(1)
	}
	cpSync(from, join(out, part), { recursive: true })
	const size = sizeOf(from)
	total += size
	console.log(`[vercel-build] ${part} → public/${part} (${(size / 1024).toFixed(0)} КБ)`)
}

if (!existsSync(join(out, "dist", "main.js"))) {
	console.error("[vercel-build] в dist нет main.js — сборка tsc не прошла")
	process.exit(1)
}

console.log(`[vercel-build] готово: ${(total / 1024 / 1024).toFixed(2)} МБ в public/`)
