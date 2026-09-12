/**
 * ТОЧКА ВХОДА.
 *
 * Собирает всё вместе: рендерер → геометрия школы → звук → игрок → меню → цикл кадра.
 *
 * Параметры URL (удобно для отладки и скриншотов):
 *   ?autostart=1   — сразу начать игру, без меню и без захвата мыши
 *   ?skipintro=1   — пропустить вступительную кат-сцену
 *   ?night=1       — сразу ночь, фонарь и разбуженная учительница
 *   ?debug=1       — технический HUD с координатами и счётчиками
 *   ?spawn=gym     — точка старта из SPAWNS (только вместе с debug)
 *   ?nosound=1     — запуск без загрузки звука
 *   ?warmup=8      — быстро прокрутить N секунд игрового времени без отрисовки
 */

import { AudioManager } from "./audio/audio.js"
import { MenuMusic } from "./audio/music.js"
import { CONFIG } from "./config.js"
import { Clock } from "./core/clock.js"
import { Input } from "./core/input.js"
import { Renderer } from "./core/renderer.js"
import { Game } from "./game/game.js"
import { PlayerController } from "./player/controller.js"
import { requireCanvas, requireElement, setHidden, setText } from "./ui/dom.js"
import { GameHud } from "./ui/gameHud.js"
import { Hud } from "./ui/hud.js"
import {
	GAME_VERSION,
	Menu,
	requestMobileLandscape,
	saveSettings,
	type GameSettings,
} from "./ui/menu.js"
import { Minimap } from "./ui/minimap.js"
import { NetHud } from "./ui/netHud.js"
import { OnlinePanel } from "./ui/online.js"
import { TouchControls, isTouchDevice } from "./ui/touch.js"
import { onlineSkinFor } from "./net/remote.js"
import { Overlay } from "./ui/overlay.js"
import { SPAWNS, findSpawn } from "./world/layout.js"
import { buildSchool } from "./world/school.js"

const overlay = new Overlay()
const NO_MOUSE = { x: 0, y: 0 }

function describe(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}

window.addEventListener("error", (event: ErrorEvent) => {
	overlay.showError(event.message || describe(event.error))
})
window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
	const text = describe(event.reason)
	// Отказ захвата мыши — не ошибка игры: браузер требует клика пользователя.
	if (/pointer\s*lock/i.test(text)) {
		event.preventDefault()
		return
	}
	overlay.showError(text)
})

function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve())
	})
}

async function boot(): Promise<void> {
	const params = new URLSearchParams(window.location.search)
	const debug = params.get("debug") === "1"
	// В режиме скриншотов мышь не захватывается — иначе браузер ругается.
	const freeLook = params.get("autostart") === "1"
	// На телефоне мыши нет вовсе: захват курсора не просим и паузу по blur не ставим.
	const touchMode = isTouchDevice()
	const wantsPointerLock = !freeLook && !touchMode
	const canvas = requireCanvas("scene")

	let renderer: Renderer
	try {
		renderer = new Renderer(canvas)
	} catch (error) {
		overlay.showError(`Не удалось запустить графику игры. ${describe(error)}`)
		return
	}

	// Даём браузеру отрисовать экран загрузки до тяжёлой сборки геометрии.
	overlay.setLoading("Строим школу…")
	await nextFrame()
	await nextFrame()

	const scene = buildSchool()
	for (const chunk of scene.chunks) renderer.uploadChunk(chunk.name, chunk.mesh)
	renderer.resize()

	const spawn = findSpawn(debug ? params.get("spawn") : null)
	const player = new PlayerController(scene.collision, spawn)
	const input = new Input(canvas, CONFIG.camera.sensitivity)
	const clock = new Clock()
	const gameHud = new GameHud()
	const debugHud = new Hud()
	const minimap = new Minimap(requireCanvas("minimap"))
	const audio = new AudioManager()
	// Музыка звучит только в меню и живёт отдельно от WebAudio.
	const menuMusic = new MenuMusic()
	const soundOff = params.get("nosound") === "1"
	const playMenuMusic = (): void => {
		if (!soundOff) menuMusic.play()
	}

	// ?nosound=1 — быстрый запуск без звука: для скриншотов и очень слабых машин.
	if (soundOff) {
		console.info("[school3d] звук отключён параметром ?nosound=1")
	} else {
		overlay.setLoading("Загружаем звук… 0%")
		await audio.load((loaded, total) => {
			const percent = total > 0 ? Math.round((loaded / total) * 100) : 100
			overlay.setLoading(`Загружаем звук… ${percent}%`)
		})
	}
	overlay.setLoading(null)

	// Цифры сборки остаются только в консоли разработчика:
	// в меню «Об игре» их больше не показываем.
	console.info(
		`[school3d] v${GAME_VERSION} · ${scene.chunks.length} чанков · ` +
			`${scene.triangles} треугольников · ${scene.collision.count} коллайдеров · ` +
			`сборка ${scene.buildMs.toFixed(0)} мс`,
	)

	const fpsMeter = requireElement("fps")
	const fpsValue = requireElement("fps-value")
	const deathScreen = requireElement("death")
	const deathText = requireElement("death-text")
	const winScreen = requireElement("win")
	const hideEndScreens = (): void => {
		setHidden(deathScreen, true)
		setHidden(winScreen, true)
	}

	let invertY = false
	let gameRef: Game | null = null
	// Панель онлайна создаётся ниже, а настройки применяются раньше.
	let onlinePanelRef: OnlinePanel | null = null

	/**
	 * Профили качества. На слабых ПК и ноутах самое важное — не рендерить
	 * в ретина-разрешении и разрешить автоподбору уронить буфер пониже.
	 */
	const qualityPreset = (quality: GameSettings["quality"]) => {
		if (quality === "low") {
			return {
				maxPixelRatio: 1,
				minScale: 0.45,
				maxScale: 0.7,
				adaptive: true,
				targetFrameMs: 20,
				extraLights: 0,
			}
		}
		if (quality === "medium") {
			return {
				maxPixelRatio: touchMode ? 1.35 : 1.5,
				minScale: 0.6,
				maxScale: 0.85,
				adaptive: true,
				targetFrameMs: 17.5,
				extraLights: 2,
			}
		}
		if (quality === "high") {
			return {
				maxPixelRatio: touchMode ? 1.75 : 2,
				minScale: 0.85,
				maxScale: 1,
				adaptive: false,
				targetFrameMs: 16.7,
				extraLights: 3,
			}
		}
		// Авто: телефоны и слабые машины стартуют скромнее.
		const cores = navigator.hardwareConcurrency ?? 4
		const weak = touchMode || cores <= 4
		return {
			maxPixelRatio: touchMode ? 1.4 : weak ? 1.25 : 2,
			minScale: weak ? 0.5 : 0.62,
			maxScale: weak ? 0.9 : 1,
			adaptive: true,
			targetFrameMs: weak ? 17.5 : 16.7,
			extraLights: weak ? 2 : 3,
		}
	}

	const applySettings = (settings: GameSettings): void => {
		invertY = settings.invertY
		renderer.setQuality(qualityPreset(settings.quality))
		setHidden(fpsMeter, !settings.showFps)
		input.sensitivity = CONFIG.camera.sensitivity * settings.sensitivity
		audio.setMasterVolume(settings.volume)
		menuMusic.setVolume(settings.volume * 0.5)
		gameRef?.setBrightness(settings.brightness)
		// Сложность из настроек идёт в одиночную игру; в онлайне её задаёт хост.
		onlinePanelRef?.setSoloDifficulty(settings.difficulty)
		gameRef?.setDifficulty(settings.difficulty)
		saveSettings(settings)
	}

	// Сетевой HUD живёт поверх игры и молчит, пока мы не в онлайне.
	const netHud = new NetHud()

	// Управление с телефона: стик слева, обзор пальцем справа, крупные кнопки.
	const touch = new TouchControls(input, { isTyping: () => netHud.chatOpen })

	const menu = new Menu({
		onPlay: (act) => startGame(act),
		onSettingsChange: applySettings,
		onOnline: () => onlinePanel.open(),
		onOnlineClose: () => onlinePanel.close(),
	})

	// Звук на каждой кнопке меню: щелчок при нажатии и тихий тик при наведении.
	const uiClick = (volume: number, rate: number): void => {
		audio.resume()
		audio.play("click", { volume, rate })
	}
	for (const button of Array.from(document.querySelectorAll("button"))) {
		button.addEventListener("pointerenter", () => uiClick(0.14, 1.5))
		button.addEventListener("click", () => uiClick(0.55, 1))
	}
	for (const control of Array.from(
		document.querySelectorAll(".setting__range, .setting__check"),
	)) {
		control.addEventListener("change", () => uiClick(0.3, 1.25))
	}

	const game = new Game({
		renderer,
		audio,
		hud: gameHud,
		input,
		player,
		collision: scene.collision,
		callbacks: {
			onDead: (reason?: string) => {
				input.exitPointerLock()
				touch.setVisible(false)
				setText(deathText, reason ?? "Учительница нашла вас. ���кола не ��тпустила.")
				setHidden(deathScreen, false)
			},
			onWon: () => {
				input.exitPointerLock()
				touch.setVisible(false)
				setHidden(winScreen, false)
			},
			onPlayStart: () => {
				if (!wantsPointerLock) return
				if (input.pointerLocked) return
				// Браузер даёт захват мыши только в ответ на жест, а кат-сцена идёт
				// больше минуты. Если отказал — ходьба работает, мышь берётся щелчком.
				void input.requestPointerLock().then((locked) => {
					if (!locked) {
						gameHud.toast("Щёлкните по экрану, чтобы взять мышь. Идти можно на WASD", 6)
					}
				})
			},
		},
	})
	gameRef = game
	applySettings(menu.settings)

	const startGame = (act: 1 | 2 = 1): void => {
		hideEndScreens()
		// Обычная одиночная игра — сеть отключаем.
		game.leaveOnlineGame()
		netHud.setVisible(false)
		overlay.hidePause()
		overlay.hideStart()
		menu.hide()
		// Поворот и полный экран — только на старте игры, не в меню.
		requestMobileLandscape()
		// Внутри игры музыки нет — только шаги и шорохи.
		menuMusic.stop()
		audio.resume()
		game.paused = false
		game.startNewGame(act)
		clock.resume(performance.now())
		touch.setOnline(false)
		touch.setVisible(true)
		// Мышь просим прямо в жесте «Играть»: тогда з��хват доживёт до конца заставки.
		if (wantsPointerLock) void input.requestPointerLock()
	}

	const backToMenu = (): void => {
		hideEndScreens()
		game.leaveOnlineGame()
		netHud.setVisible(false)
		touch.setVisible(false)
		onlinePanel.reset()
		overlay.hidePause()
		input.exitPointerLock()
		game.paused = false
		game.enterMenu()
		menu.show()
		playMenuMusic()
		clock.resume(performance.now())
	}

	const pauseGame = (): void => {
		if (menu.isVisible || game.paused) return
		if (game.state === "dead" || game.state === "won") return
		game.paused = true
		audio.suspend()
		overlay.showPause()
		touch.setVisible(false)
		input.exitPointerLock()
	}

	const resumeGame = (): void => {
		if (menu.isVisible) return
		game.paused = false
		overlay.hidePause()
		audio.resume()
		clock.resume(performance.now())
		touch.setVisible(true)
		if (wantsPointerLock) void input.requestPointerLock()
	}

	// ---- Онлайн-бета: имя → поиск игроков → общий забег с чатом.
	const onlinePanel = new OnlinePanel({
		onClick: () => audio.resume(),
		onBack: () => menu.showPanel("root"),
		onSolo: () => {
			menu.showPanel("root")
			startGame()
		},
		onMatch: (session, match) => {
			hideEndScreens()
			overlay.hidePause()
			overlay.hideStart()
			menu.hide()
			// Альбомный режим просим только когда матч реально начался.
			requestMobileLandscape()
			menuMusic.stop()
			audio.resume()
			game.paused = false
			game.startOnlineGame(session, match, {
				onChat: (name, text, color, system) => netHud.addMessage(name, text, color, system),
				onToast: () => {},
			})
			const me = match.players.find((player) => player.id === session.id)
			netHud.reset()
			netHud.setSelf(
				session.name,
				onlineSkinFor(me?.skin ?? 0, me?.index ?? 0).tag,
				session.owner,
				match.host === session.id,
			)
			netHud.setVisible(true)
			netHud.addMessage(
				"Школа",
				`В классе ${match.players.length} человек. Чат — клавиша T`,
				"#9fd6ff",
				true,
			)
			clock.resume(performance.now())
			touch.setOnline(true)
			touch.setVisible(true)
			if (wantsPointerLock) void input.requestPointerLock()
		},
	})

	netHud.onSend((text) => {
		game.online?.sendChat(text)
	})
	input.onKey("KeyT", () => {
		if (!game.online || menu.isVisible || game.paused) return
		netHud.toggleChat()
	})
	onlinePanelRef = onlinePanel
	onlinePanel.setSoloDifficulty(menu.settings.difficulty)
	window.addEventListener("beforeunload", () => onlinePanel.dispose())

	requireElement("death-retry").addEventListener("click", () => startGame())
	requireElement("death-menu").addEventListener("click", () => backToMenu())
	requireElement("win-again").addEventListener("click", () => startGame())
	requireElement("win-menu").addEventListener("click", () => backToMenu())
	overlay.onStart(() => startGame())
	overlay.onResume(() => resumeGame())

	// Щелчок в любом месте экрана возвращает мышь в игру: попасть точно по холсту
	// мешают подсказки HUD, а без захвата не работает обзор.
	const grabMouse = (): void => {
		if (menu.isVisible || !wantsPointerLock) return
		// Пишем в чат — мышь не забираем.
		if (netHud.chatOpen) return
		if (game.state === "dead" || game.state === "won") return
		if (input.pointerLocked) return
		if (game.paused) resumeGame()
		else void input.requestPointerLock()
	}

	canvas.addEventListener("click", grabMouse)
	window.addEventListener("pointerdown", grabMouse)

	document.addEventListener("pointerlockchange", () => {
		if (menu.isVisible || !wantsPointerLock) return
		if (input.pointerLocked) {
			overlay.hidePause()
			game.paused = false
			clock.resume(performance.now())
			return
		}
		// Во время заставки Esc отпускает курсор — это не повод ставить игру на паузу.
		if (game.state === "intro" || game.state === "outro" || game.state === "hurt") return
		pauseGame()
	})

	window.addEventListener("keydown", (event: KeyboardEvent) => {
		if (event.code !== "Escape") return
		if (menu.isVisible) {
			menu.handleEscape()
			return
		}
		if (game.skipCutscene()) return
		if (game.paused) resumeGame()
		else pauseGame()
	})

	input.onKey("KeyM", () => minimap.toggle())
	input.onKey("Tab", () => minimap.toggle())
	input.onKey("KeyP", () => debugHud.toggleStats())
	input.onKey("KeyH", () => debugHud.toggleHelp())
	if (debug) {
		input.onKey("KeyR", () => player.teleport(spawn))
		// Цифры те��е��ь — пояс предметов, поэтому телепорт просим явно: ?teleport=1
		if (params.get("teleport") === "1") {
			SPAWNS.forEach((point, index) => {
				if (index > 8) return
				input.onKey(`Digit${index + 1}`, () => player.teleport(point))
			})
		}
	}
	debugHud.setVisible(debug)
	if (debug) {
		// QA-хук: только при ?debug=1 — автотесты читают состояние движка.
		(window as unknown as { __qa?: unknown }).__qa = {
			game,
			player,
			input,
			clock,
			menu,
			collision: scene.collision,
		}
	}

	window.addEventListener("resize", () => renderer.resize())
	// Переключились ��а другое окно — ставим паузу (но не в режиме скриншотов).
	if (!freeLook) {
		// На телефоне фокус теряется от любой мелочи — там пауза только при
		// реальном уходе со вкладки.
		if (!touchMode) window.addEventListener("blur", () => pauseGame())
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) pauseGame()
		})
	}

	let lastFpsPaint = 0
	const loop = (now: number): void => {
		requestAnimationFrame(loop)
		const steps = clock.tick(now)
		const mouse = input.consumeMouseDelta()
		// Шагать можно всегда, пока игра идёт: клавиатуре захват курсора не нужен.
		// Обзор мышью — только когда курсор действительно захвачен.
		const canPlay = !menu.isVisible && !game.paused
		const canLook =
			canPlay && !netHud.chatOpen && (input.pointerLocked || freeLook || touchMode)
		game.frame(
			clock.frameMs / 1000,
			canPlay ? steps : 0,
			clock.fixedStep,
			canLook ? mouse : NO_MOUSE,
			invertY,
		)

		// Плавный обзор пальцем на телефоне.
		touch.frame()

		const stats = renderer.render(game.camera, clock.frameMs, game.environment)

		// Счётчик FPS обновляем четыре раза в секунду: DOM — дорого.
		if (menu.settings.showFps && now - lastFpsPaint > 250) {
			lastFpsPaint = now
			const fps = Math.round(clock.fps)
			setText(fpsValue, String(fps))
			fpsMeter.dataset.low = fps < 25 ? "2" : fps < 45 ? "1" : "0"
		}

		if (debug) {
			debugHud.update(
				{
					x: player.x,
					y: player.y,
					z: player.z,
					fps: clock.fps,
					frameMs: clock.frameMs,
					drawCalls: stats.drawCalls,
					triangles: stats.triangles,
					totalTriangles: renderer.totalTriangles,
					chunks: stats.chunks,
					totalChunks: renderer.chunkCount,
					resolutionScale: stats.resolutionScale,
					crouching: player.crouching,
					sprinting: player.sprinting,
				},
				now,
			)
		}
		if (minimap.visible) minimap.render(player.x, player.z, player.yaw, now)

		if (game.online) {
			netHud.setInfo(game.online.playerCount, game.online.ping, game.online.isHost)
			netHud.updateTags(game.netTags(window.innerWidth, window.innerHeight))
			netHud.update(clock.frameMs / 1000)
		}
	}

	game.enterMenu()
	menu.show()
	playMenuMusic()
	requestAnimationFrame(loop)

	if (params.get("autostart") === "1") {
		startGame(params.get("act") === "2" ? 2 : 1)
		if (params.get("skipintro") === "1") game.skipCutscene()
		if (params.get("night") === "1") game.forceNight()

		// Быстрая прокрутка игрового времени без отрисовки: нужна для скриншотов
		// и для проверки поздних состояний (ночь, погоня) на слабой машине.
		const warmup = Math.max(0, Math.min(120, Number(params.get("warmup") ?? "0") || 0))
		if (warmup > 0) {
			const step = 1 / 60
			const frames = Math.round(warmup / step)
			const substeps = Math.max(1, Math.round(step / clock.fixedStep))
			for (let i = 0; i < frames; i++) {
				game.frame(step, substeps, clock.fixedStep, NO_MOUSE, invertY)
			}
			console.info(`[school3d] прокрутили ${warmup} с игрового времени (${frames} кадров)`)
		}
	}
}

void boot().catch((error: unknown) => overlay.showError(describe(error)))
