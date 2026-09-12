/**
 * Игровой цикл и вся логика хоррора.
 *
 * Здесь собраны: состояния игры, две кат-сцены, поиск предметов, разбор
 * баррикады на выходе, прятки в шкафчиках, жизни и весь звук.
 *
 * Физика игрока считается фиксированным шагом, всё остальное — по времени кадра.
 */

import { CONFIG } from "../config.js"
import { MeshBuilder } from "../core/mesh.js"
import type { Input } from "../core/input.js"
import {
	MAX_EXTRA_FLASHES,
	type CameraState,
	type FlashlightState,
	type RenderEnvironment,
	type Renderer,
} from "../core/renderer.js"

/** Дальше этого расстояния чужой фонарь уже не считаем. */
const REMOTE_FLASH_VIEW = 46
/** Общий пустой массив — чтобы не сорить в GC каждый кадр. */
const EMPTY_FLASHES: FlashlightState[] = []
import type { PlayerController } from "../player/controller.js"
import type { CollisionWorld } from "../world/collision.js"
import { FLOOR2_Y } from "../world/floor2.js"
import { BUILDING } from "../world/layout.js"
import type { AudioManager, SoundName } from "../audio/audio.js"
import type { GameHud } from "../ui/gameHud.js"
import { Teacher } from "../entities/teacher.js"
import { NavGraph } from "./nav.js"
import { DIFFICULTY_PRESETS, difficultyOf, type Difficulty, type DifficultyPreset } from "./difficulty.js"
import {
	EXIT_DOOR,
	FLASHLIGHT_ITEM,
	HIDE_SPOTS,
	QUEST_ITEMS,
	buildBarricade,
	buildClassDoor,
	buildExitDoors,
	buildHeldItem,
	buildItemModel,
	buildItemPickup,
	type HideSpot,
	type ItemDef,
	type ItemKind,
} from "./items.js"
import { Timeline, easeInOut, easeOut, mix, mixAngle, type SceneStep } from "./timeline.js"
import {
	ACT2_EXIT,
	ACT2_HACK_SECONDS,
	ACT2_ITEMS,
	ACT2_PANEL,
	ACT2_TIMER,
	ACT2_WARNINGS,
	formatTimer,
	objectiveFor,
	stageCode,
	stageFromCode,
	type Act2Stage,
} from "./act2.js"
import { CaptchaPanel } from "../ui/captcha.js"
import { OnlineGame } from "../net/online.js"
import type { LocalSnapshot } from "../net/online.js"
import type { MatchInfo, OnlineSession } from "../net/session.js"
import { projectToScreen } from "../net/remote.js"
import type { TagItem } from "../ui/netHud.js"

export type GameState =
	| "menu"
	| "intro"
	| "play"
	| "hiding"
	| "hurt"
	| "dead"
	/** Онлайн: погиб и летает призраком внутри школы. */
	| "ghost"
	| "outro"
	| "won"

/** Куда игра отдаёт сетевые сообщения интерфейса. */
export interface OnlineUi {
	onChat: (name: string, text: string, color: string, system: boolean) => void
	onToast: (text: string) => void
}

export interface GameCallbacks {
	/** Поражение. reason — чем всё кончилось, если причина не обычная. */
	onDead: (reason?: string) => void
	onWon: () => void
	onPlayStart: () => void
}

export interface GameDeps {
	renderer: Renderer
	audio: AudioManager
	hud: GameHud
	input: Input
	player: PlayerController
	collision: CollisionWorld
	callbacks: GameCallbacks
}

interface TargetInfo {
	kind: "item" | "exit" | "hide"
	label: string
	/** Сколько держать E. */
	hold: number
	item?: ItemDef
	spot?: HideSpot
	/** Какой предмет нужен для действия. */
	needs?: ItemKind
	ready: boolean
}

/** Выход разбирается в пять приёмов — на каждый свой предмет. */
const EXIT_STAGES: ReadonlyArray<{
	item: ItemKind
	label: string
	progress: number
	sound: SoundName
}> = [
	{ item: "crowbar", label: "Сорвать доски ломом", progress: 0.36, sound: "hit" },
	{ item: "cutters", label: "Перекусить цепь", progress: 0.62, sound: "place_item" },
	{ item: "key", label: "Открыть навесной замок", progress: 0.78, sound: "unlock" },
	{ item: "handle", label: "Поставить ручку", progress: 0.9, sound: "place_item" },
	{ item: "fuse", label: "Вставить предохранитель", progress: 1, sound: "unlock" },
]

/** После удара игрок приходит в себя на полу ближайшего кабинета. */
const WAKE_POINTS: ReadonlyArray<{ x: number; z: number; yaw: number; room: string }> = [
	{ x: 17.5, z: 6, yaw: Math.PI / 2, room: "Кабинет 101" },
	{ x: 28.5, z: 6, yaw: Math.PI / 2, room: "Кабинет 102" },
	{ x: 39.5, z: 6, yaw: Math.PI / 2, room: "Кабинет 103" },
	{ x: 50.5, z: 6, yaw: Math.PI / 2, room: "Кабинет 104" },
	{ x: 61.5, z: 6, yaw: Math.PI / 2, room: "Кабинет 105" },
]

/** Наша парта в 101 кабинете, место учительницы у доски и дверь кабинета. */
const SEAT = { x: 17.12, y: 1.15, z: 6.5, yaw: Math.PI / 2 }
/** Доска висит на западной стене (x0 + 0.125), поэтому лицом она стоит в −X. */
const BOARD_SPOT = { x: 11.8, z: 5.9, yaw: Math.PI / 2 }
const CLASS_DOOR = { x: 13.2, z: 11.35 }
/** Куда она уходит, скрываясь в коридоре. */
const CLASS_DOOR_OUT = { x: 13.2, z: 13.1 }
const STAND_SPOT = { x: 17.5, z: 6, yaw: 1.1 }

function labelOf(kind: ItemKind): string {
	if (kind === "flashlight") return FLASHLIGHT_ITEM.label
	const found = QUEST_ITEMS.find((item) => item.id === kind)
	return found ? found.label : kind
}

/** Подпись под рукой: название и зачем предмет нужен. */
function handLabel(kind: ItemKind): string {
	if (kind === "flashlight") return `${FLASHLIGHT_ITEM.label} — ${FLASHLIGHT_ITEM.use}`
	const found = QUEST_ITEMS.find((item) => item.id === kind)
	return found ? `${found.label} — ${found.use}` : labelOf(kind)
}

/** Плавное затемнение в конце шага: 0 до start, дальше растёт до 1. */
function fadeAfter(progress: number, start: number): number {
	if (progress <= start) return 0
	return easeInOut((progress - start) / (1 - start))
}

/** Коробка, за которую призрак не вылетает: строго внутри школы. */
const GHOST_MIN_X = 1.6
const GHOST_MAX_X = BUILDING.width - 1.6
const GHOST_MIN_Z = 1.6
const GHOST_MAX_Z = BUILDING.depth - 1.6
const GHOST_MIN_Y = 0.6
const GHOST_MAX_Y = BUILDING.standardHeight - 0.3
/** Скорость полёта призрака и ускорение на Shift. */
const GHOST_SPEED = 5
const GHOST_FAST = 9.5

export class Game {
	readonly camera: CameraState = {
		x: 38,
		y: 2.3,
		z: 34,
		yaw: Math.PI,
		pitch: -0.02,
		fov: CONFIG.camera.fov,
	}

	state: GameState = "menu"
	lives: number = CONFIG.horror.lives
	/** Сложность текущего забега. */
	difficulty: Difficulty = "normal"
	private preset: DifficultyPreset = DIFFICULTY_PRESETS.normal
	/** Сколько жизней всего — зависит от сложности. */
	private maxLives: number = CONFIG.horror.lives
	paused = false
	readonly teacher: Teacher

	private readonly renderer: Renderer
	private readonly audio: AudioManager
	private readonly hud: GameHud
	private readonly input: Input
	private readonly player: PlayerController
	private readonly callbacks: GameCallbacks
	private readonly nav = new NavGraph()

	private readonly collected = new Set<ItemKind>()
	private flashlightOwned = false
	private flashlightOn = false
	private exitStage = 0
	private barricade = 0
	/** Переиспользуемый буфер для чужих фонарей. */
	private readonly flashBuffer: Array<{ distance: number; light: FlashlightState }> = []
	private barricadeTarget = 0
	private exitAngle = 0
	private night = 0
	private nightTarget = 0
	private lightsOut = false
	private playTime = 0
	private time = 0
	private shake = 0
	/** Сдвиг камеры кат-сцены из геометрии: держим между кадрами. */
	private sceneShiftX = 0
	private sceneShiftZ = 0
	private sceneLastX = 0
	private sceneLastZ = 0
	private grace = 0
	/** Призрак: высота глаз в свободном полёте и время с момента смерти. */
	private ghostY: number = CONFIG.player.eyeHeight
	private ghostTimer = 0
	private holdProgress = 0
	private holdActive = false
	private holdKey = false
	private target: TargetInfo | null = null
	private heldItem: ItemKind | null = null
	private heldTimer = 0
	/** Пояс предметов как в Minecraft: слот 1 — фонарь, дальше — находки. */
	private readonly hotbar: (ItemKind | null)[] = [null, null, null, null, null, null]
	private slot = 0
	/** Фонарь в кармане: помним, горел ли он до смены предмета. */
	private lightArmed = true
	/** Пауза между сигналами «она рядом». */
	private nearCue = 0
	/** Сколько мы в воздухе — для звука падения. */
	private airTime = 0
	private hideSpot: HideSpot | null = null
	private hideYaw = 0
	/** Она видела, в какой шкафчик мы залезли — такой шкафчик не спасёт. */
	private hideSpotted = false
	private timeline: Timeline | null = null
	private teacherWriting = false
	private writePhase = 0
	private stepTimer = 0
	private stepsOn = false
	private wasOnGround = true
	private whisperTimer = 32
	private brightness = 1
	private fade = 0
	private exitVisible = false
	private itemsVisible = false
	/** Доски на выходе появляются только после вступительной кат-сцены. */
	private barricadeVisible = false
	private classDoorVisible = false
	private classDoorAngle = 0
	private classDoorTarget = 0
	/** До крика учительница — обычный человек без красных глаз и дубины. */
	private teacherHuman = false

	/** Онлайн-бета: если связка жива, мир общий на всю команду. */
	online: OnlineGame | null = null
	private onlineUi: OnlineUi | null = null
	/** Кого сейчас ведёт учительница (только у ведущего игрока). */
	private teacherTarget: string | null = null
	/** Кэш прямой видимости для ников: луч считаем 8 раз в секунду, не чаще. */
	private readonly tagSight = new Map<string, { at: number; clear: boolean }>()

	private readonly collision: CollisionWorld

	constructor(deps: GameDeps) {
		this.collision = deps.collision
		this.renderer = deps.renderer
		this.audio = deps.audio
		this.hud = deps.hud
		this.input = deps.input
		this.player = deps.player
		this.callbacks = deps.callbacks
		this.teacher = new Teacher(deps.collision, this.nav)
		window.addEventListener("keydown", this.handleKeyDown)
		window.addEventListener("keyup", this.handleKeyUp)
		window.addEventListener("blur", this.handleBlur)
	}

	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		if (event.code === "KeyE") this.holdKey = true
		if (event.code === "KeyF" && !event.repeat) this.toggleFlashlight()
		// Цифры 1…6 — берём предмет с пояса в руку.
		if (!event.repeat && event.code.startsWith("Digit")) {
			const index = Number(event.code.slice(5)) - 1
			if (index >= 0 && index < this.hotbar.length) this.selectSlot(index)
		}
		if (event.code === "Enter" && !event.repeat && this.timeline && !this.paused) {
			this.timeline.skipStep()
		}
	}

	private readonly handleKeyUp = (event: KeyboardEvent): void => {
		if (event.code === "KeyE") this.holdKey = false
	}

	private readonly handleBlur = (): void => {
		this.holdKey = false
	}

	/**
	 * Сложность: жизни и поведение учительницы.
	 * В одиночной игре берётся из настроек, в онлайне — из матча.
	 */
	setDifficulty(value: Difficulty | string): void {
		const id = difficultyOf(value)
		this.difficulty = id
		this.preset = DIFFICULTY_PRESETS[id]
		this.teacher.setTuning(this.preset)
		// Призрачный режим: её вообще нет в школе.
		if (this.preset.absent && this.state !== "menu") {
			this.teacher.sleep()
			this.teacher.visible = false
			this.teacherTarget = null
		}
		// Жизни меняем только вне забега — в игре цифра не должна прыгать.
		if (this.state === "menu") {
			this.maxLives = this.preset.lives
			this.lives = this.preset.lives
		}
	}

	/** Название текущей сложности для интерфейса. */
	get difficultyLabel(): string {
		return this.preset.short
	}

	/** Учительницы нет в школе. */
	get teacherAbsent(): boolean {
		return this.preset.absent
	}

	// ------------------------------------------------------------------- акт II

	/** Какой акт идёт: 1 — «Ночь в школе», 2 — «Взрыв». */
	act: 1 | 2 = 1
	private act2Stage: Act2Stage = "weapon"
	private act2Timer = ACT2_TIMER
	private act2Running = false
	private act2Defused = false
	private act2Hack = 0
	private act2Hacking = false
	private act2LaptopPlaced = false
	private readonly act2Warned = new Set<number>()
	private captchaPanel: CaptchaPanel | null = null

	private resetAct2(): void {
		this.act2Stage = "weapon"
		this.act2Timer = ACT2_TIMER
		this.act2Running = false
		this.act2Defused = false
		this.act2Hack = 0
		this.act2Hacking = false
		this.act2LaptopPlaced = false
		this.act2Warned.clear()
		this.captchaPanel?.reset()
		this.hud.setTimer(null)
	}

	/** Открыт терминал: управление уходит в капчу, игрок стоит на месте. */
	get inTerminal(): boolean {
		return this.captchaPanel?.isOpen === true
	}

	private captcha(): CaptchaPanel {
		if (!this.captchaPanel) {
			this.captchaPanel = new CaptchaPanel({
				onHack: () => this.startHack(),
				onClose: () => this.closeTerminal(),
				onSound: (name) => {
					if (name === "ok") this.audio.play("unlock", { volume: 0.45 })
					else if (name === "fail") this.audio.play("locked", { volume: 0.6 })
					else this.audio.play("click", { volume: 0.45 })
				},
			})
		}
		return this.captchaPanel
	}

	private openTerminal(): void {
		const panel = this.captcha()
		if (this.act2Hacking) panel.showHacking()
		else panel.start(this.difficulty)
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.audio.play("click", { volume: 0.5 })
		document.exitPointerLock?.()
	}

	private closeTerminal(): void {
		this.captchaPanel?.show(false)
		const canvas = document.querySelector("canvas")
		canvas?.requestPointerLock?.()
	}

	/** Предметы акта II появляются строго по ходу миссии. */
	private act2ItemAvailable(def: ItemDef): boolean {
		if (def.id === "weapon") return this.act2Stage === "weapon"
		if (def.id === "laptop") return this.act2Stage === "laptop" || this.act2Stage === "panel"
		if (def.id === "key") return this.act2Stage === "key" || this.act2Stage === "escape"
		return false
	}

	private startHack(): void {
		if (this.act2Hacking || this.act2Defused) return
		this.act2Hacking = true
		this.act2Hack = 0
		this.act2Stage = "hack"
		this.online?.sendStage(stageCode("hack"))
		this.audio.play("place_item", { volume: 0.7 })
		this.audio.startLoop("pickup_loop", { volume: 0.22, fade: 0.3 })
		this.hud.toast("Взлом пошёл. Минута — и детонаторы замолчат", 5)
		this.netSay("Взлом системы детонации начался")
	}

	private defuseAct2(): void {
		if (this.act2Defused) return
		this.act2Hacking = false
		this.act2Defused = true
		this.act2Running = false
		this.act2Stage = "key"
		this.audio.stopLoop("pickup_loop", 0.2)
		this.audio.stopLoop("heartbeat", 1.2)
		this.audio.play("unlock", { volume: 1 })
		this.audio.play("win", { volume: 0.5, delay: 0.3 })
		this.hud.setTimer(null)
		this.hud.toast("Молодцы, успели! Система взломана. Осталось найти ключ", 6.5)
		this.captchaPanel?.finish()
		this.online?.sendStage(stageCode("key"))
		this.netSay("Взрывчатка обезврежена — ищем ключ!")
	}

	private explodeAct2(): void {
		this.act2Running = false
		this.act2Timer = 0
		this.act2Hacking = false
		this.hud.setTimer(null)
		this.captchaPanel?.reset()
		this.audio.stopAllLoops(0.2)
		this.audio.play("stinger", { volume: 1 })
		this.audio.play("fall", { volume: 0.9, delay: 0.2 })
		this.shake = 1
		this.state = "dead"
		this.timeline = null
		this.fade = 1
		this.hud.setVisible(false)
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.say(null)
		this.online?.sendDown()
		this.callbacks.onDead("Школа взлетела на воздух — вы не успели")
	}

	/** Таймер до взрыва, предупреждения и анимация взлома. */
	private updateAct2(dt: number): void {
		if (this.state !== "play" && this.state !== "hiding") return
		if (this.act2Hacking) {
			this.act2Hack += dt
			this.captchaPanel?.setProgress(this.act2Hack / ACT2_HACK_SECONDS)
			if (this.act2Hack >= ACT2_HACK_SECONDS) this.defuseAct2()
		}
		if (!this.act2Running) return
		this.act2Timer -= dt
		for (const warning of ACT2_WARNINGS) {
			if (this.act2Timer <= warning.at && !this.act2Warned.has(warning.at)) {
				this.act2Warned.add(warning.at)
				this.hud.toast(warning.text, 4.2)
				this.audio.play(warning.at <= 30 ? "stinger" : "whisper", { volume: 0.5 })
			}
		}
		if (this.act2Timer <= 0) {
			this.explodeAct2()
			return
		}
		this.hud.setTimer(
			formatTimer(this.act2Timer),
			"до взрыва",
			this.act2Timer <= 60 ? "warn" : "normal",
		)
	}

	/** Действия акта II: предметы, щит, терминал и служебный выход. */
	private completeAct2(target: TargetInfo): void {
		if (target.kind === "item" && target.item) {
			const item = target.item
			this.audio.play("pickup_done", { volume: 0.9 })
			this.heldItem = item.id
			this.heldTimer = 5
			this.hud.setHandLabel(`${item.label} — ${item.use}`)
			const slot = this.addToHotbar(item.id)
			this.collected.add(item.id)
			this.online?.sendItem(item.id)
			this.refreshHotbarHud()
			this.hud.toast(`${item.label} у вас · клавиша ${slot + 1} — взять в руку`, 3.6)
			this.netSay(`Вы нашли: ${item.label}`)
			if (item.id === "weapon") {
				this.startLockdown()
				return
			}
			if (item.id === "laptop") {
				this.act2Stage = "panel"
				this.online?.sendStage(stageCode("panel"))
				this.hud.toast(`Система взрывчатки — щит в серверной: ${ACT2_PANEL.name}`, 6.5)
				this.audio.play("whisper", { volume: 0.4, delay: 0.6 })
				return
			}
			if (item.id === "key") {
				this.act2Stage = "escape"
				this.online?.sendStage(stageCode("escape"))
				this.hud.toast(`Ключ есть! Служебный выход: ${ACT2_EXIT.name}`, 5.5)
			}
			return
		}

		if (target.kind !== "exit") return
		if (this.act2Stage === "panel") {
			this.act2LaptopPlaced = true
			this.act2Stage = "captcha"
			this.online?.sendStage(stageCode("captcha"))
			this.audio.play("place_item", { volume: 0.9 })
			this.hud.toast("Ноутбук подключён к щиту детонации", 3.4)
			this.openTerminal()
			return
		}
		if (this.act2Stage === "captcha" || this.act2Stage === "hack") {
			this.openTerminal()
			return
		}
		if (this.act2Stage === "escape") this.startAct2Outro()
	}

	/** Онлайн: шаги миссии акта II приходят по сети. */
	private remoteAct2Stage(code: number, who: string): void {
		const stage = stageFromCode(code)
		if (stageCode(stage) <= stageCode(this.act2Stage)) return
		this.act2Stage = stage
		if (stage === "laptop") {
			if (!this.act2Running && !this.act2Defused) {
				this.act2Running = true
				this.act2Timer = ACT2_TIMER
				this.act2Warned.clear()
			}
			this.hud.toast(`${who} нашёл оружие. Она заперла школу — 5:00 до взрыва!`, 6)
			return
		}
		if (stage === "hack") {
			this.act2Hacking = true
			this.act2Hack = 0
			this.act2LaptopPlaced = true
			this.hud.toast(`${who} запустил взлом системы — ждём минуту`, 5)
			return
		}
		if (stage === "key") {
			this.act2Hacking = false
			this.act2Defused = true
			this.act2Running = false
			this.hud.setTimer(null)
			this.captchaPanel?.finish()
			this.hud.toast("Взрывчатка обезврежена! Осталось найти ключ", 5)
			return
		}
		this.hud.toast(`${who}: ${objectiveFor(stage, this.collected.has("laptop"))}`, 4)
	}

	/** Кат-сцена прихода в ночную школу. */
	private startIntroAct2(): void {
		this.state = "intro"
		this.hud.setLetterbox(true)
		this.hud.setSkipHint("Enter — дальше · Esc — пропустить заставку")
		this.night = 1
		this.nightTarget = 1
		this.fade = 0
		this.teacher.visible = false
		this.teacherWriting = false
		this.teacherHuman = false
		this.exitVisible = true
		this.itemsVisible = false
		this.barricadeVisible = false
		this.classDoorVisible = false
		this.exitAngle = 0
		this.renderer.setDynamicVisible("items", false)
		this.renderer.setDynamicVisible("held", false)
		this.renderer.setDynamicVisible("classdoor", false)

		const steps: SceneStep[] = [
			{
				id: "night",
				duration: 4.6,
				onEnter: () => {
					this.audio.startLoop("ambience", { volume: CONFIG.audio.ambience * 0.8, fade: 1.6 })
					this.say("Акт II. Школа № 3, 01:12. Мы вернулись за тем, что она спрятала.")
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(38, 1.72, mix(56, 47.5, t), 0, mix(0.06, -0.02, t), 74)
				},
			},
			{
				id: "doors",
				duration: 3.2,
				onEnter: () => {
					this.audio.play("door_full", { volume: 0.95 })
					this.say("Двери снова открыты. Как приглашение.")
				},
				onUpdate: (progress) => {
					this.exitAngle = easeOut(progress) * 1.35
					this.sceneCamera(38, 1.7, mix(47.5, 44.2, easeInOut(progress)), 0, -0.02, 72)
				},
			},
			{
				id: "inside",
				duration: 3.4,
				onEnter: () => {
					this.say("Внутри пусто. Учительницы нет — но школа дышит.")
					this.audio.play("whisper", { volume: 0.45, delay: 0.8 })
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(38, 1.7, mix(44.2, 38.5, t), mix(0, 0.2, t), -0.02, 72)
					this.fade = fadeAfter(progress, 0.62)
				},
				onExit: () => {
					this.fade = 1
					this.exitAngle = 0
					this.exitVisible = false
				},
			},
			{
				id: "stairs",
				duration: 3.8,
				onEnter: () => {
					this.say("Лестница на второй этаж открыта. Раньше её всегда запирали.")
					this.audio.play("door_open", { volume: 0.6 })
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.fade = 1 - easeOut(Math.min(1, progress * 1.8))
					this.sceneCamera(8.2, mix(1.6, 1.8, t), mix(7.4, 4.6, t), 0, mix(0.18, 0.05, t), 72)
				},
			},
			{
				id: "task",
				duration: 3,
				onEnter: () => {
					this.say("Оружие где-то на втором этаже. Найти будет непросто.")
				},
				onUpdate: (progress) => {
					this.sceneCamera(8.2, 1.8, mix(4.6, 3.6, easeInOut(progress)), 0, 0.05, 72)
				},
			},
		]

		this.timeline = new Timeline(steps, () => this.beginPlayAct2())
	}

	private beginPlayAct2(): void {
		this.state = "play"
		this.timeline = null
		this.fade = 0
		this.shake = 0
		this.night = 1
		this.nightTarget = 1
		this.lightsOut = true
		this.flashlightOwned = true
		this.flashlightOn = true
		this.lightArmed = true
		this.addToHotbar("flashlight")
		this.slot = 0
		// Кат-сцена заканчивается на площадке второго этажа. Раньше placePlayer
		// всегда сбрасывал Y в ноль, поэтому игрок оказывался под площадкой,
		// за лестничным маршем, и не мог выйти из лестничной клетки.
		this.placePlayer(8.2, 3.4, 0, FLOOR2_Y)
		this.hud.setLetterbox(false)
		this.hud.setSkipHint(null)
		this.say(null)
		this.hud.setVisible(true)
		this.hud.setLives(this.lives, this.maxLives)
		this.refreshHotbarHud()
		this.hud.toast("Лестница рядом. Оружие — на втором этаже. F — фонарь", 5.5)
		this.itemsVisible = true
		this.exitVisible = true
		this.barricadeVisible = false
		this.classDoorVisible = false
		this.renderer.setDynamicVisible("items", true)
		this.audio.startLoop("ambience", { volume: CONFIG.audio.ambience, fade: 1 })
		this.playTime = 0
		this.grace = 2
		this.callbacks.onPlayStart()
	}

	/** Кат-сцена: она заперла школу и оставила динамит. */
	private startLockdown(): void {
		this.state = "intro"
		this.holdProgress = 0
		this.holdActive = false
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.hud.setVisible(false)
		this.hud.setLetterbox(true)
		this.hud.setSkipHint("Enter — дальше · Esc — пропустить")
		this.audio.stopLoop("steps", 0.1)
		this.stepsOn = false
		const atX = this.player.x
		const atZ = this.player.z
		const eye = this.player.eyeY
		const yaw = this.player.yaw

		const steps: SceneStep[] = [
			{
				id: "black",
				duration: 2.2,
				onEnter: () => {
					this.fade = 1
					this.exitVisible = true
					this.exitAngle = 1.35
					this.teacherHuman = false
					this.teacher.visible = true
					this.teacher.placeAt(EXIT_DOOR.x + 0.85, EXIT_DOOR.z + 0.8, Math.PI)
					this.audio.play("stinger", { volume: 0.85 })
					this.say("Обрез у нас. Внизу хлопнула главная дверь…")
				},
				onUpdate: () => {
					this.fade = 1
				},
			},
			{
				id: "locked",
				duration: 5.2,
				onEnter: () => {
					this.audio.play("door_full", { volume: 0.9 })
					this.audio.play("locked", { volume: 0.95, delay: 2.7 })
					this.say("Она сама закрывает двери и запирает школу снаружи.")
				},
				onUpdate: (progress) => {
					const close = easeInOut(Math.max(0, Math.min(1, (progress - 0.18) / 0.58)))
					const reveal = 1 - easeOut(Math.min(1, progress * 4.5))
					const hide = easeInOut(Math.max(0, Math.min(1, (progress - 0.82) / 0.18)))
					this.fade = Math.max(reveal, hide)
					this.exitAngle = mix(1.35, 0, close)
					this.teacher.placeAt(
						EXIT_DOOR.x + mix(0.95, 0.55, close),
						EXIT_DOOR.z + mix(1.15, 0.7, close),
						Math.PI,
					)
					this.sceneCamera(EXIT_DOOR.x, 1.68, mix(EXIT_DOOR.z + 5.6, EXIT_DOOR.z + 4.6, easeInOut(progress)), 0, -0.03, 68)
				},
				onExit: () => {
					this.exitAngle = 0
					this.teacher.visible = false
					this.fade = 1
				},
			},
			{
				id: "gone",
				duration: 3.4,
				onEnter: () => {
					this.say("Шаги за стеной. Она ушла через другой выход.")
					this.audio.play("teacher_step", { volume: 0.7 })
					this.audio.play("teacher_step", { volume: 0.6, delay: 0.5 })
					this.audio.play("door_open", { volume: 0.55, delay: 1.4 })
				},
				onUpdate: (progress) => {
					this.fade = 1 - easeOut(Math.min(1, progress * 2.4))
					this.sceneCamera(
						atX,
						eye,
						atZ,
						mixAngle(yaw + 0.9, yaw - 0.8, easeInOut(progress)),
						-0.02,
						70,
					)
				},
			},
			{
				id: "dynamite",
				duration: 4,
				onEnter: () => {
					this.say("В коридоре — динамит и красные цифры: 5:00.")
					this.audio.play("click", { volume: 0.7 })
					this.audio.play("heartbeat", { volume: 0.6, delay: 0.4 })
					this.shake = 0.5
				},
				onUpdate: (progress) => {
					this.shake = Math.max(this.shake, 0.3 * (1 - progress))
					this.sceneCamera(atX, mix(eye, 1.35, easeInOut(progress)), atZ, yaw - 0.8, -0.3, 64)
				},
			},
			{
				id: "plan",
				duration: 3.4,
				onEnter: () => {
					this.say("Пять минут. Систему можно взломать — нужен ноутбук.")
				},
				onUpdate: (progress) => {
					this.sceneCamera(atX, mix(1.35, eye, easeInOut(progress)), atZ, yaw, -0.05, 70)
				},
			},
		]

		this.timeline = new Timeline(steps, () => this.beginAct2Race())
	}

	private beginAct2Race(): void {
		this.state = "play"
		this.timeline = null
		this.fade = 0
		this.shake = 0
		this.teacher.visible = false
		this.hud.setLetterbox(false)
		this.hud.setSkipHint(null)
		this.say(null)
		this.hud.setVisible(true)
		if (stageCode(this.act2Stage) < stageCode("laptop")) this.act2Stage = "laptop"
		this.act2Running = true
		this.act2Timer = ACT2_TIMER
		this.act2Warned.clear()
		this.grace = 1.5
		this.online?.sendStage(stageCode("laptop"))
		this.hud.toast("5:00 до взрыва. Найдите ноутбук!", 5.5)
		this.audio.startLoop("heartbeat", { volume: 0.3, fade: 1 })
		this.netSay("Она заперла школу и оставила динамит — 5 минут!")
	}

	/** Финал акта II: ключ, служебный выход и бег от школы. */
	private startAct2Outro(): void {
		this.state = "outro"
		this.act2Stage = "done"
		this.holdProgress = 0
		this.holdActive = false
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.hud.setVisible(false)
		this.hud.setTimer(null)
		this.hud.setLetterbox(true)
		this.hud.setSkipHint("Enter — дальше · Esc — пропустить")
		this.hud.setSubtitle(null)
		this.audio.stopLoop("steps", 0.1)
		this.audio.stopLoop("heartbeat", 0.8)
		this.audio.stopLoop("pickup_loop", 0.05)
		const startX = this.player.x
		const startZ = this.player.z

		const steps: SceneStep[] = [
			{
				id: "unlock",
				duration: 2.8,
				onEnter: () => {
					this.audio.play("unlock", { volume: 1 })
					this.say("Ключ завхоза подошёл к служебной двери.")
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(
						mix(startX, ACT2_EXIT.x, t),
						mix(CONFIG.player.eyeHeight, 1.5, t),
						mix(startZ, ACT2_EXIT.standZ, t),
						mixAngle(this.player.yaw, Math.PI, t),
						mix(this.player.pitch, -0.16, t),
						mix(74, 60, t),
					)
				},
			},
			{
				id: "out",
				duration: 3.2,
				onEnter: () => {
					this.audio.play("door_full", { volume: 1 })
					this.audio.startLoop("steps", { volume: 0.5, rate: 1.4, fade: 0.1 })
					this.say("Холодный воздух. Мы снаружи.")
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.nightTarget = 1 - t * 0.45
					this.sceneCamera(
						ACT2_EXIT.x,
						mix(1.5, CONFIG.player.eyeHeight, t) + Math.sin(progress * 26) * 0.03,
						mix(ACT2_EXIT.standZ, -4.5, t),
						Math.PI,
						0.02,
						mix(60, 84, t),
					)
				},
				onExit: () => {
					this.audio.stopLoop("steps", 0.25)
				},
			},
			{
				id: "look",
				duration: 3.8,
				onEnter: () => {
					this.audio.play("stinger", { volume: 0.7 })
					this.say("Школа стоит целая. Динамит молчит. А она — где-то там.")
				},
				onUpdate: (progress) => {
					const t = easeInOut(Math.min(1, progress / 0.6))
					this.sceneCamera(
						ACT2_EXIT.x,
						CONFIG.player.eyeHeight,
						-4.5,
						mix(Math.PI, 0, t),
						0.04,
						mix(84, 70, t),
					)
					this.fade = fadeAfter(progress, 0.78)
				},
			},
			{
				id: "end",
				duration: 3,
				onEnter: () => {
					this.audio.play("win", { volume: 0.5 })
					this.audio.play("win_fanfare", { volume: 0.95, delay: 0.12 })
					this.say("Акт II пройден. Продолжение — в акте III.")
					this.fade = 1
				},
				onUpdate: () => {
					this.fade = 1
				},
			},
		]

		this.timeline = new Timeline(steps, () => {
			this.state = "won"
			this.online?.sendEscape()
			this.timeline = null
			this.fade = 1
			this.say(null)
			this.audio.stopAllLoops(0.5)
			this.hud.setLetterbox(false)
			this.hud.setSkipHint(null)
			this.callbacks.onWon()
		})
	}

	/** Яркость из настроек: ночь должна быть видна на любом мониторе. */
	setBrightness(value: number): void {
		this.brightness = Math.max(0.6, Math.min(1.6, value))
	}

	/** Пропустить всю текущую кат-сцену (Esc). */
	skipCutscene(): boolean {
		if (!this.timeline) return false
		if (this.state !== "intro" && this.state !== "outro") return false
		this.timeline.skipAll()
		return true
	}

	/** QA и отладка: сразу ночь, фонарь в руке и разбуженная учительница. */
	forceNight(withFlashlight = true): void {
		if (withFlashlight) {
			this.flashlightOwned = true
			this.flashlightOn = true
		}
		if (!this.lightsOut) this.triggerLightsOut()
	}

	get inCutscene(): boolean {
		return this.state === "intro" || this.state === "outro" || this.state === "hurt"
	}

	get itemsFound(): number {
		return this.collected.size
	}

	/** Меню: тёмный вестибюль и силуэт учительницы в глубине кадра. */
	enterMenu(): void {
		this.state = "menu"
		this.timeline = null
		this.night = 0.6
		this.nightTarget = 0.6
		this.fade = 0
		this.flashlightOn = false
		this.paused = false
		this.hud.setVisible(false)
		this.hud.reset()
		this.audio.stopAllLoops(0.3)
		this.teacher.sleep()
		this.teacher.placeAt(38, 23.5, Math.PI)
		this.teacher.visible = true
		this.teacherWriting = false
		this.teacherHuman = false
		this.exitVisible = false
		this.itemsVisible = false
		this.barricadeVisible = false
		this.classDoorVisible = false
		this.classDoorAngle = 0
		this.classDoorTarget = 0
		this.renderer.setDynamicVisible("items", false)
		this.renderer.setDynamicVisible("held", false)
		this.renderer.setDynamicVisible("exit", false)
		this.renderer.setDynamicVisible("classdoor", false)
		this.renderer.setDynamicVisible("players", false)
	}

	startNewGame(act: 1 | 2 = 1): void {
		this.act = act
		this.resetAct2()
		this.collected.clear()
		this.maxLives = this.preset.lives
		this.lives = this.preset.lives
		this.flashlightOwned = false
		this.flashlightOn = false
		this.exitStage = 0
		this.barricade = 0
		this.barricadeTarget = 0
		this.exitAngle = 0
		this.classDoorAngle = 0
		this.classDoorTarget = 0
		this.night = 0
		this.nightTarget = 0
		this.lightsOut = false
		this.playTime = 0
		this.shake = 0
		this.grace = 0
		this.ghostTimer = 0
		this.ghostY = CONFIG.player.eyeHeight
		this.holdProgress = 0
		this.holdActive = false
		this.heldItem = null
		this.heldTimer = 0
		this.hideSpotted = false
		this.hotbar.fill(null)
		this.slot = 0
		this.lightArmed = true
		this.nearCue = 0
		this.airTime = 0
		this.hideSpot = null
		this.whisperTimer = 32
		this.paused = false
		this.teacher.sleep()
		this.hud.reset()
		this.hud.setVisible(false)
		this.hud.setLives(this.lives, this.maxLives)
		this.refreshItemsHud()
		this.refreshHotbarHud()
		this.audio.stopAllLoops(0.2)
		if (this.act === 2) this.startIntroAct2()
		else this.startIntro()
	}

	// ------------------------------------------------------------- онлайн-бета

	/** Запуск общего забега: все в одной школе, учительница одна на всех. */
	startOnlineGame(session: OnlineSession, match: MatchInfo, ui: OnlineUi): OnlineGame {
		this.leaveOnlineGame()
		const online = new OnlineGame(session, match, {
			onItem: (kind, who) => this.remoteItem(kind, who),
			onStage: (stage, who) => this.remoteStage(stage, who),
			onHit: () => this.hitPlayer(),
			onLightsOut: () => {
				if (!this.lightsOut) this.triggerLightsOut()
			},
			onChat: (name, text, color, system) => ui.onChat(name, text, color, system),
			onToast: (text) => {
				this.hud.toast(text, 3.4)
				ui.onToast(text)
				// Всё важное остаётся в чате: тост улетает, строка — нет.
				ui.onChat("", text, "#9fd6ff", true)
			},
		})
		this.online = online
		this.onlineUi = ui
		// Сложность в онлайне одна на всех — её задаёт создатель комнаты.
		this.setDifficulty(match.difficulty)
		this.startNewGame(match.act === 2 ? 2 : 1)
		return online
	}

	/** Выход из онлайна: остаёмся в обычной одиночной игре. */
	leaveOnlineGame(): void {
		if (!this.online) return
		this.online.leave()
		this.online = null
		this.onlineUi = null
		this.teacherTarget = null
		this.renderer.setDynamicVisible("players", false)
	}

	get onlineActive(): boolean {
		return this.online !== null
	}

	/** В вступлении каждый сидит за своей партой. */
	private seatFor(index: number): { x: number; z: number } {
		const offsets = [
			{ x: 0, z: 0 },
			{ x: 1.8, z: 0 },
			{ x: -1.8, z: 0 },
			{ x: 0.9, z: 2 },
			{ x: -0.9, z: 2 },
		]
		const seat = offsets[index % offsets.length] ?? offsets[0]
		return { x: SEAT.x + seat.x, z: SEAT.z + seat.z }
	}

	/** Кто-то из команды поднял предмет — он общий. */
	private remoteItem(kind: string, who: string): void {
		const def = (this.act === 2 ? ACT2_ITEMS : QUEST_ITEMS).find((item) => item.id === kind)
		if (!def) return
		if (this.collected.has(def.id)) return
		this.collected.add(def.id)
		if (this.act === 2) {
			this.hud.toast(`${who} нашёл: ${def.label}`, 3.4)
			this.netSay(`${who} нашёл: ${def.label}`)
			return
		}
		this.refreshItemsHud()
		this.hud.toast(`${who}: ${def.label.toLowerCase()} — найдено ${this.collected.size} из 5`, 3.4)
		this.netSay(`${who} нашёл предмет: ${def.label} (${this.collected.size}/5)`)
		if (!this.lightsOut && this.state !== "menu" && this.state !== "intro") {
			this.triggerLightsOut()
		}
	}

	/** Кто-то разобрал часть баррикады. */
	private remoteStage(stage: number, who: string): void {
		if (this.act === 2) {
			this.remoteAct2Stage(stage, who)
			return
		}
		if (stage <= this.exitStage) return
		this.exitStage = Math.min(stage, EXIT_STAGES.length)
		const done = EXIT_STAGES[this.exitStage - 1]
		if (done) this.barricadeTarget = done.progress
		if (this.exitStage >= EXIT_STAGES.length) {
			this.barricadeTarget = 1
			// Важно для онлайна: баррикада разобрана и у нас тоже,
			// так что у двери появится подсказка «E — выбежать из школы».
			this.barricade = Math.max(this.barricade, 0.9)
			this.hud.toast(`${who} открыл выход! Бегите к дверям`, 5)
			this.netSay(`${who} открыл выход — все к дверям!`)
			return
		}
		const next = EXIT_STAGES[this.exitStage]
		this.hud.toast(`${who} помог: дальше ${next.label.toLowerCase()}`, 3.6)
		this.netSay(`${who} разобрал баррикаду: дальше ${next.label.toLowerCase()}`)
	}

	/** Отправляем себя и сглаживаем чужие тела; хост ещё и учительницу. */
	private updateOnline(dt: number): void {
		const online = this.online
		if (!online || !online.live) return
		const intro = this.state === "intro"
		const seat = this.seatFor(online.localIndex)
		const snapshot: LocalSnapshot = {
			x: intro ? seat.x : this.player.x,
			y: intro ? 0 : this.player.y,
			z: intro ? seat.z : this.player.z,
			yaw: intro ? SEAT.yaw : this.state === "hiding" ? this.hideYaw : this.player.yaw,
			speed: intro ? 0 : this.player.speed,
			crouching: this.player.crouching,
			hidden: this.state === "hiding",
			sitting: intro,
			flashlight: this.flashlightOn && this.flashlightOwned,
			// Предмет в руке тот же, что мы рисуем себе от первого лица.
			held: intro
				? null
				: (this.heldItem ??
					this.hotbar[this.slot] ??
					(this.flashlightOn && this.flashlightOwned ? "flashlight" : null)),
			lives: this.lives,
			items: this.collected.size,
			escaped: this.state === "won" || this.state === "outro",
			// Призрак для всех остальных — выбывший: его не рисуют и не ловят.
			down: this.state === "dead" || this.state === "ghost",
			// Ведущего учительницы выбираем среди тех, кто реально бегает по школе.
			active: (this.state === "play" || this.state === "hiding") && !this.paused,
		}
		online.update(dt, snapshot)
		if (online.authority) {
			online.pushTeacher(dt, {
				x: this.teacher.x,
				z: this.teacher.z,
				yaw: this.teacher.yaw,
				speed: this.teacher.moveSpeed,
				visible: this.teacher.visible,
				alert: this.teacher.alert,
			})
		}
	}

	/** Ники над головами — считаются каждый кадр под текущую камеру. */
	netTags(width: number, height: number): TagItem[] {
		const online = this.online
		if (!online) return []
		// На экранах конца, в выходной кат-сцене и на паузе ники только мешают.
		if (this.paused) return []
		if (this.state === "outro" || this.state === "dead" || this.state === "won") return []
		const tags: TagItem[] = []
		for (const player of online.players.values()) {
			// Спрятавшихся в шкафу тоже показываем — иначе не понять, где команда.
			const gone = player.escaped || player.down
			if (gone) {
				tags.push({
					id: player.id,
					name: player.name,
					owner: player.owner,
					host: player.host,
					skinId: player.skin.id,
					color: player.skin.tag,
					x: 0,
					y: 0,
					distance: 0,
					lives: player.lives,
					visible: false,
					occluded: true,
					hiding: false,
				})
				continue
			}
			const head = {
				x: player.x,
				y:
					player.y +
					(player.sitting || player.hidden ? 1.5 : player.crouching ? 1.4 : 2.02),
				z: player.z,
			}
			const point = projectToScreen(this.camera, head, width, height)
			// Ник виден даже через стены — именно так ищут друг друга.
			// Прячем только то, что физически не попадает в кадр.
			const onScreen =
				point.visible &&
				point.x > -40 &&
				point.y > -40 &&
				point.x < width + 40 &&
				point.y < height + 40 &&
				point.distance < 70
			tags.push({
				id: player.id,
				name: player.name,
				owner: player.owner,
				host: player.host,
				skinId: player.skin.id,
				color: player.skin.tag,
				x: point.x,
				y: point.y,
				distance: point.distance,
				lives: player.lives,
				visible: onScreen,
				occluded: !onScreen || !this.tagInSight(player.id, head),
				hiding: player.hidden,
			})
		}
		return tags
	}

	/**
	 * Прямая видимость до чужой головы. Луч по коллизиям стоит денег, поэтому
	 * ответ держим в кэше и обновляем примерно 8 раз в секунду.
	 */
	/** Системная строка в общий чат (в одиночной игре ничего не делает). */
	private netSay(text: string): void {
		this.onlineUi?.onChat("", text, "#9fd6ff", true)
	}

	private tagInSight(id: string, head: { x: number; y: number; z: number }): boolean {
		const now = performance.now()
		let probe = this.tagSight.get(id)
		if (!probe) {
			probe = { at: -1e9, clear: true }
			this.tagSight.set(id, probe)
		}
		if (now - probe.at < 120) return probe.clear
		probe.at = now
		probe.clear = !this.collision.blocked(
			this.camera.x,
			this.camera.y,
			this.camera.z,
			head.x,
			head.y,
			head.z,
		)
		return probe.clear
	}

	private refreshItemsHud(): void {
		this.hud.setItems(
			QUEST_ITEMS.map((item) => ({ label: item.label, found: this.collected.has(item.id) })),
		)
	}

	private say(text: string | null): void {
		this.hud.setSubtitle(text)
	}

	private setCamera(
		x: number,
		y: number,
		z: number,
		yaw: number,
		pitch: number,
		fov?: number,
	): void {
		this.camera.x = x
		this.camera.y = y
		this.camera.z = z
		this.camera.yaw = yaw
		this.camera.pitch = pitch
		this.camera.fov = fov ?? CONFIG.camera.fov
	}

	/**
	 * Камера кат-сцены. Если точка оказалась внутри стены, створки или мебели,
	 * отодвигаем её в ближайшее свободное место — иначе кадр проваливается в геометрию
	 * и видно изнутрь полигоны.
	 */
	private sceneCamera(
		x: number,
		y: number,
		z: number,
		yaw: number,
		pitch: number,
		fov?: number,
	): void {
		// Кадр сменился (камера прыгнула) — сдвиг начинаем заново.
		if (Math.hypot(x - this.sceneLastX, z - this.sceneLastZ) > 1.5) {
			this.sceneShiftX = 0
			this.sceneShiftZ = 0
		}
		this.sceneLastX = x
		this.sceneLastZ = z

		let targetX = this.sceneShiftX
		let targetZ = this.sceneShiftZ
		if (!this.collision.overlaps(x, y - 0.2, z, 0.2, 0.4)) {
			// Точка свободная — сдвиг больше не нужен.
			targetX = 0
			targetZ = 0
		} else if (this.collision.overlaps(x + targetX, y - 0.2, z + targetZ, 0.2, 0.4)) {
			// Прошлый сдвиг больше не спасает — ищем новый. Раньше поиск шёл
			// каждый кадр заново, и картинка дрожала на входе и выходе из школы.
			targetX = 0
			targetZ = 0
			outer: for (let ring = 1; ring <= 12; ring++) {
				const distance = ring * 0.14
				for (let step = 0; step < 12; step++) {
					const angle = (step / 12) * Math.PI * 2
					const nx = Math.cos(angle) * distance
					const nz = Math.sin(angle) * distance
					if (!this.collision.overlaps(x + nx, y - 0.2, z + nz, 0.2, 0.4)) {
						targetX = nx
						targetZ = nz
						break outer
					}
				}
			}
		}
		// К нужному сдвигу подходим плавно, без рывков между кадрами.
		this.sceneShiftX += (targetX - this.sceneShiftX) * 0.16
		this.sceneShiftZ += (targetZ - this.sceneShiftZ) * 0.16
		this.setCamera(x + this.sceneShiftX, y, z + this.sceneShiftZ, yaw, pitch, fov)
	}

	private placePlayer(x: number, z: number, yaw: number, y = 0): void {
		// Если точка оказалась внутри геометрии (парта, стул), игрок не смог бы
		// сделать ни шага: шаг разрешён только в свободную клетку.
		const spot = this.findFreeSpot(x, z, y)
		this.player.x = spot.x
		this.player.z = spot.z
		this.player.y = y
		this.player.yaw = yaw
		this.player.pitch = 0
		this.player.velocityX = 0
		this.player.velocityY = 0
		this.player.velocityZ = 0
		this.player.onGround = true
	}

	/** Ближайшая свободная точка: идём кольцами вокруг заданной. */
	private findFreeSpot(x: number, z: number, y = 0): { x: number; z: number } {
		const radius = CONFIG.player.radius
		const height = CONFIG.player.height
		if (!this.collision.overlaps(x, y, z, radius, height)) return { x, z }
		for (let ring = 1; ring <= 24; ring++) {
			const distance = ring * 0.2
			for (let step = 0; step < 24; step++) {
				const angle = (step / 24) * Math.PI * 2
				const nx = x + Math.cos(angle) * distance
				const nz = z + Math.sin(angle) * distance
				if (!this.collision.overlaps(nx, y, nz, radius, height)) return { x: nx, z: nz }
			}
		}
		return { x, z }
	}

	/** Микродвижение головы за партой: без него кадр выглядит мёртвым. */
	private seatSway(lookAt?: { x: number; z: number }, weight = 1): void {
		const sway = Math.sin(this.time * 0.9) * 0.02 + Math.sin(this.time * 0.31) * 0.01
		let yaw = SEAT.yaw
		if (lookAt && weight > 0) {
			// Взгляд из-за парты: направление — (−sin yaw, −cos yaw), отсюда atan2(−dx, −dz).
			const target = Math.atan2(-(lookAt.x - SEAT.x), -(lookAt.z - SEAT.z))
			yaw = mixAngle(SEAT.yaw, target, Math.max(0, Math.min(1, weight)))
		}
		this.setCamera(
			SEAT.x + Math.sin(this.time * 0.6) * 0.012,
			SEAT.y + Math.sin(this.time * 1.3) * 0.006,
			SEAT.z + Math.cos(this.time * 0.5) * 0.012,
			yaw + sway,
			-0.06 + Math.sin(this.time * 0.7) * 0.012,
			70,
		)
	}

	/**
	 * Поза у доски: стоит лицом к доске и медленно ведёт мелом вдоль неё,
	 * а не висит в одной точке спиной к ученикам и боком к доске.
	 */
	private updateWriting(): void {
		this.teacher.x = BOARD_SPOT.x + Math.sin(this.writePhase * 0.31) * 0.05
		this.teacher.z = BOARD_SPOT.z + Math.sin(this.writePhase * 0.47) * 0.42
		this.teacher.yaw = BOARD_SPOT.yaw
		this.teacher.setAnimationSpeed(0)
	}

	// ------------------------------------------------------------- вступительная сцена

	private startIntro(): void {
		this.state = "intro"
		this.hud.setLetterbox(true)
		this.hud.setSkipHint("Enter — дальше · Esc — пропустить заставку")
		this.night = 0.3
		this.nightTarget = 0.3
		this.fade = 0
		this.teacher.visible = false
		this.teacherWriting = false
		// Во вступлении она ещё человек, а школа ещё не забита досками.
		this.teacherHuman = true
		this.exitVisible = true
		this.itemsVisible = false
		this.barricadeVisible = false
		this.classDoorVisible = false
		this.classDoorAngle = 0
		this.classDoorTarget = 0
		this.renderer.setDynamicVisible("items", false)
		this.renderer.setDynamicVisible("held", false)
		this.renderer.setDynamicVisible("classdoor", false)

		// Звук двери кабинета дол��ен сыграть ровно один раз.
		let doorSoundPlayed = false

		const steps: SceneStep[] = [
			{
				id: "approach",
				duration: 4,
				onEnter: () => {
					this.audio.startLoop("ambience", { volume: CONFIG.audio.ambience * 0.75, fade: 1.6 })
					this.say("Школа № 3, 20:41. Мы вернулись за забытой тетрадью…")
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(38, 1.68, mix(50.5, 45.8, t), 0, mix(0.05, -0.02, t), 72)
				},
			},
			{
				id: "doors",
				duration: 3.2,
				onEnter: () => {
					this.audio.play("door_full", { volume: 0.95 })
					this.say("Двери открылись сами.")
				},
				onUpdate: (progress) => {
					this.exitAngle = easeOut(progress) * 1.35
					this.sceneCamera(38, 1.68, mix(45.8, 43.1, easeInOut(progress)), 0, -0.02, 72)
				},
			},
			{
				id: "enter",
				duration: 2.2,
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(38, 1.68, mix(43.1, 40.4, t), mix(0, 0.14, t), -0.02, 72)
					this.fade = fadeAfter(progress, 0.45)
				},
				onExit: () => {
					this.fade = 1
					this.say(null)
					this.exitAngle = 0
					this.exitVisible = false
				},
			},
			{
				id: "seated",
				duration: 1.6,
				onEnter: () => {
					this.teacher.placeAt(BOARD_SPOT.x, BOARD_SPOT.z, BOARD_SPOT.yaw)
					this.teacher.visible = true
					this.teacherWriting = true
					this.teacherHuman = true
					// Дверь кабинета закрыта — идёт урок.
					this.classDoorVisible = true
					this.classDoorAngle = 0
					this.classDoorTarget = 0
					this.night = 0.05
					this.nightTarget = 0.05
					this.updateWriting()
					this.seatSway()
				},
				onUpdate: (progress, dt) => {
					this.writePhase += dt * 2.4
					this.updateWriting()
					this.seatSway()
					this.fade = 1 - easeInOut(progress)
				},
			},
			{
				id: "lesson",
				duration: 5.4,
				onEnter: () => {
					this.fade = 0
					this.audio.play("chalk", { volume: 0.6 })
					this.say("— Запишите тему урока: «Тишина в коридорах».")
					this.stepTimer = 2.7
				},
				onUpdate: (progress, dt) => {
					this.writePhase += dt * 2.6
					this.updateWriting()
					this.seatSway()
					this.stepTimer -= dt
					if (this.stepTimer <= 0) {
						this.stepTimer = 2.7
						this.audio.play("chalk", { volume: 0.5, rate: 1.08 })
					}
				},
			},
			{
				id: "lesson2",
				duration: 4.4,
				onEnter: () => {
					this.say("— Кто не успеет — останется после уроков. Навсегда.")
					this.audio.play("chalk", { volume: 0.55, rate: 0.92 })
				},
				onUpdate: (progress, dt) => {
					this.writePhase += dt * 2.2
					this.updateWriting()
					this.seatSway()
				},
			},
			{
				id: "called",
				duration: 3.2,
				onEnter: () => {
					this.audio.play("knock", { volume: 0.85 })
					this.say("— Мария Петровна! Подойдите, пожалуйста…")
					this.teacherWriting = false
					// Она ещё человек: поворот без красных глаз и без дубины.
					this.teacherHuman = true
					this.teacher.setAnimationSpeed(0)
				},
				onUpdate: (progress) => {
					this.teacher.x = BOARD_SPOT.x
					this.teacher.z = BOARD_SPOT.z
					// mixAngle — разворот коротким путём, а не на три четверти круга.
					this.teacher.yaw = mixAngle(BOARD_SPOT.yaw, Math.PI, easeInOut(progress))
					this.seatSway()
				},
			},
			{
				id: "leaves",
				duration: 4.6,
				onEnter: () => {
					this.say("Она вышла и прикрыла дверь.")
					this.teacher.setAnimationSpeed(1.5)
					this.stepTimer = 0
					doorSoundPlayed = false
				},
				onUpdate: (progress, dt) => {
					// До 0.62 идёт к двери, потом выходит в коридор.
					const walk = Math.min(1, progress / 0.62)
					const leave = easeOut(Math.max(0, (progress - 0.62) / 0.38))
					const t = easeInOut(walk)
					this.teacher.x =
						mix(BOARD_SPOT.x, CLASS_DOOR.x, t) + (CLASS_DOOR_OUT.x - CLASS_DOOR.x) * leave
					this.teacher.z =
						mix(BOARD_SPOT.z, CLASS_DOOR.z, t) + (CLASS_DOOR_OUT.z - CLASS_DOOR.z) * leave
					this.teacher.yaw = Math.PI
					this.teacher.setAnimationSpeed(1.5, dt)

					// Створка открывается ровно тогда, когда она берётся за ручку.
					const opening = easeOut(Math.min(1, Math.max(0, (progress - 0.44) / 0.26)))
					this.classDoorAngle = opening * 1.28
					this.classDoorTarget = this.classDoorAngle
					if (!doorSoundPlayed && progress >= 0.42) {
						doorSoundPlayed = true
						// Сначала щелчок ручки, потом сам скрип — дверь читается лучше.
						this.audio.play("click", { volume: 0.5 })
						this.audio.play("door_open", { volume: 0.85, delay: 0.16 })
					}

					this.stepTimer -= dt
					if (this.stepTimer <= 0) {
						this.stepTimer = 0.46
						this.audio.playAt(
							"teacher_step",
							{ x: this.teacher.x, z: this.teacher.z },
							{ x: this.camera.x, z: this.camera.z, yaw: this.camera.yaw },
							{ volume: 0.75, range: 20 },
						)
					}
					// Провожаем её взглядом — иначе весь уход проходит за краем кадра.
					this.seatSway({ x: this.teacher.x, z: this.teacher.z }, Math.min(1, progress / 0.22))
				},
				onExit: () => {
					this.teacher.visible = false
					this.teacher.setAnimationSpeed(0)
					// «Прикрыла дверь»: створка почти закрыта, слышен замок.
					this.classDoorAngle = 0.1
					this.classDoorTarget = 0.1
					this.audio.play("click", { volume: 0.5 })
				},
			},
			{
				id: "silence",
				duration: 3.2,
				onEnter: () => {
					this.say("В школе стало очень тихо…")
				},
				onUpdate: (progress) => {
					// Взгляд ещё держится на двери и плавно возвращается к доске.
					this.seatSway(CLASS_DOOR, Math.max(0, 1 - progress / 0.5))
					// Лампы начинают моргать — первый звонок тревоги.
					this.night = 0.05 + Math.abs(Math.sin(this.time * 11)) * 0.16 * progress
					this.nightTarget = this.night
				},
			},
			{
				id: "scream",
				duration: 3.6,
				onEnter: () => {
					this.audio.play("scream", { volume: 1 })
					this.say("— ААААА!!!")
					this.shake = 1
					// После крика она уже не человек — глаза загораются красным.
					this.teacherHuman = false
				},
				onUpdate: (progress) => {
					this.seatSway()
					this.night = 0.05 + progress * 0.55
					this.nightTarget = this.night
					this.shake = Math.max(this.shake, 0.7 * (1 - progress))
					this.fade = fadeAfter(progress, 0.6)
				},
				onExit: () => {
					this.fade = 1
					this.shake = 0
				},
			},
			{
				id: "breath",
				duration: 5.6,
				onEnter: () => {
					this.audio.play("breath", { volume: 1 })
					this.audio.startLoop("heartbeat", { volume: 0.5, rate: 1.15, fade: 0.4 })
					this.say("(мы не можем отдышаться)")
					this.fade = 1
				},
				onUpdate: () => {
					this.fade = 1
				},
				onExit: () => {
					this.say(null)
					this.audio.setLoopVolume("heartbeat", 0.22)
				},
			},
			{
				id: "standup",
				duration: 2.8,
				onEnter: () => {
					this.placePlayer(STAND_SPOT.x, STAND_SPOT.z, STAND_SPOT.yaw)
					this.night = 0.05
					this.nightTarget = 0.05
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.fade = 1 - easeOut(Math.min(1, progress * 1.6))
					this.sceneCamera(
						mix(SEAT.x, STAND_SPOT.x, t),
						mix(SEAT.y, CONFIG.player.eyeHeight, t),
						mix(SEAT.z, STAND_SPOT.z, t),
						mix(SEAT.yaw, STAND_SPOT.yaw, t),
						mix(-0.06, 0, t),
					)
				},
			},
		]

		this.timeline = new Timeline(steps, () => this.beginPlay())
	}

	private beginPlay(): void {
		this.state = "play"
		this.timeline = null
		this.fade = 0
		this.shake = 0
		this.placePlayer(STAND_SPOT.x, STAND_SPOT.z, STAND_SPOT.yaw)
		this.hud.setLetterbox(false)
		this.hud.setSkipHint(null)
		this.say(null)
		this.hud.setVisible(true)
		this.hud.setLives(this.lives, this.maxLives)
		this.refreshItemsHud()
		this.refreshHotbarHud()
		this.hud.toast("Дверь кабинета открыта. А школа — нет.", 4.5)
		this.playTime = 0
		this.grace = 2
		this.exitVisible = true
		this.itemsVisible = true
		// Теперь видны доски на выходе, а дверь кабинета сама скрипит и открывается.
		this.barricadeVisible = true
		this.teacherHuman = false
		this.classDoorVisible = true
		// Дверь доигрывает кат-с��ену: скрип, хлопок створки и шёпот вслед.
		this.classDoorTarget = 1.35
		this.audio.play("door_open", { volume: 0.7, delay: 0.3 })
		this.audio.play("door_full", { volume: 0.4, delay: 1.15 })
		this.audio.play("whisper", { volume: 0.35, delay: 1.7 })
		this.renderer.setDynamicVisible("items", true)
		this.audio.startLoop("ambience", { volume: CONFIG.audio.ambience, fade: 1 })
		this.callbacks.onPlayStart()
	}

	// ------------------------------------------------------------- ��инальная сцена

	private startOutro(): void {
		this.state = "outro"
		this.holdProgress = 0
		this.holdActive = false
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.hud.setVisible(false)
		this.hud.setLetterbox(true)
		this.hud.setSkipHint("Enter — дальше · Esc — пропустить")
		this.audio.stopLoop("steps", 0.1)
		this.audio.stopLoop("heartbeat", 0.8)
		this.audio.stopLoop("pickup_loop", 0.05)
		this.teacher.sleep()
		// Створки выхода и доски должны быть в кадре — иначе дверь открывается «в пустоте».
		this.exitVisible = true
		this.barricadeVisible = true
		this.hud.setSubtitle(null)
		const startX = this.player.x
		const startZ = this.player.z

		const steps: SceneStep[] = [
			{
				id: "unlock",
				duration: 2.6,
				onEnter: () => {
					this.audio.play("unlock", { volume: 1 })
					this.audio.stopLoop("heartbeat", 1.4)
					this.say("Последний замок поддался…")
					this.barricadeTarget = 1
					this.shake = 0.14
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					// Камера подходит к двери и опускает взгляд на замок.
					this.sceneCamera(
						mix(startX, EXIT_DOOR.x, t),
						mix(CONFIG.player.eyeHeight, 1.45, t),
						mix(startZ, EXIT_DOOR.standZ - 0.4, t),
						mixAngle(this.player.yaw, 0, t),
						mix(this.player.pitch, -0.22, t),
						mix(74, 58, t),
					)
				},
			},
			{
				id: "open",
				duration: 3,
				onEnter: () => {
					this.audio.play("door_full", { volume: 1 })
					this.audio.play("whisper", { volume: 0.5, delay: 1 })
					this.say("Замок щёлкнул. Дверь поддалась!")
				},
				onUpdate: (progress) => {
					const t = easeOut(progress)
					this.exitAngle = t * 1.5
					// Свет с улицы постепенно заливает вестибюль.
					this.nightTarget = 1 - t * 0.55
					this.sceneCamera(
						EXIT_DOOR.x,
						mix(1.45, CONFIG.player.eyeHeight, t),
						mix(EXIT_DOOR.standZ - 0.4, EXIT_DOOR.standZ + 0.6, t),
						0,
						mix(-0.22, 0.02, t),
						mix(58, 74, t),
					)
				},
			},
			{
				id: "step",
				duration: 2.2,
				onEnter: () => {
					this.say("Порог. Ещё один шаг…")
					this.audio.startLoop("steps", { volume: 0.42, rate: 0.9, fade: 0.1 })
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(
						EXIT_DOOR.x + Math.sin(progress * 4) * 0.05,
						CONFIG.player.eyeHeight + Math.sin(progress * 12) * 0.02,
						mix(EXIT_DOOR.standZ + 0.6, 45.8, t),
						Math.sin(progress * 3) * 0.03,
						0.01,
						mix(74, 78, t),
					)
				},
			},
			{
				id: "run",
				duration: 3,
				onEnter: () => {
					this.say("Бежим!")
					this.audio.setLoopRate("steps", 1.55)
					this.audio.setLoopVolume("steps", 0.55)
					this.audio.play("breath", { volume: 0.7 })
					this.nightTarget = 0.35
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(
						EXIT_DOOR.x + Math.sin(progress * 9) * 0.13,
						CONFIG.player.eyeHeight + Math.sin(progress * 34) * 0.035,
						mix(45.8, 52.5, t),
						Math.sin(progress * 5) * 0.05,
						0.02,
						mix(78, 86, t),
					)
				},
				onExit: () => {
					this.audio.stopLoop("steps", 0.25)
				},
			},
			{
				id: "lookback",
				duration: 3.6,
				onEnter: () => {
					this.teacher.placeAt(EXIT_DOOR.x, 43.85, Math.PI)
					this.teacher.visible = true
					this.audio.play("stinger", { volume: 0.85 })
					this.say("Она стоит в дверях и смотрит нам вслед…")
				},
				onUpdate: (progress) => {
					const t = easeInOut(Math.min(1, progress / 0.55))
					this.sceneCamera(
						EXIT_DOOR.x,
						CONFIG.player.eyeHeight,
						52.5,
						mix(0, Math.PI, t),
						0.02,
						mix(86, 70, t),
					)
					// На последних кадрах силуэт растворяется в темноте.
					if (progress > 0.74) this.teacher.visible = false
				},
				onExit: () => {
					this.teacher.visible = false
					this.audio.play("whisper", { volume: 0.55 })
				},
			},
			{
				id: "away",
				duration: 3.2,
				onEnter: () => {
					this.say("В школе больше никого. Мы свободны.")
					this.audio.play("bell", { volume: 0.5, delay: 0.9 })
					this.nightTarget = 0.28
				},
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.sceneCamera(
						EXIT_DOOR.x + mix(0, 2.6, t),
						CONFIG.player.eyeHeight + mix(0, 0.32, t),
						mix(52.5, 57.5, t),
						mix(Math.PI, Math.PI * 0.82, t),
						mix(0.02, 0.06, t),
						70,
					)
					this.fade = fadeAfter(progress, 0.7)
				},
			},
			{
				id: "end",
				duration: 2.8,
				onEnter: () => {
					this.audio.play("win", { volume: 0.5 })
					// Фанфары победы — сразу после выхода и�� школы.
					this.audio.play("win_fanfare", { volume: 0.95, delay: 0.12 })
					this.say("Игра пройдена!")
					this.fade = 1
				},
				onUpdate: () => {
					this.fade = 1
				},
			},
		]

		this.timeline = new Timeline(steps, () => {
			this.state = "won"
			this.online?.sendEscape()
			this.timeline = null
			this.fade = 1
			this.say(null)
			this.audio.stopAllLoops(0.5)
			this.hud.setLetterbox(false)
			this.hud.setSkipHint(null)
			this.callbacks.onWon()
		})
	}

	// ------------------------------------------------------------- удары и жизни

	private hitPlayer(): void {
		if (this.state !== "play" && this.state !== "hiding") return
		if (this.grace > 0) return
		this.lives -= 1
		this.hud.setLives(this.lives, this.maxLives)
		this.hud.flashDamage()
		this.shake = 1
		// Звук 1: удар учительницы.
		this.audio.play("teacher_hit", { volume: 1 })
		this.audio.play("hit", { volume: 0.7 })
		this.audio.play("hurt", { volume: 0.85, delay: 0.12 })
		this.holdProgress = 0
		this.holdActive = false
		this.hideSpot = null
		this.hideSpotted = false
		this.audio.stopLoop("pickup_loop", 0.05)
		this.audio.stopLoop("steps", 0.05)
		this.stepsOn = false

		if (this.lives <= 0) {
			// В онлайне погибший не вылетает из игры, а становится призраком.
			if (this.online?.live) {
				this.startGhost()
				return
			}
			this.state = "dead"
			this.online?.sendDown()
			this.timeline = null
			this.fade = 1
			this.audio.stopAllLoops(0.4)
			this.audio.play("fall", { volume: 0.95 })
			this.audio.play("lose", { volume: 0.9, delay: 0.25 })
			this.hud.setVisible(false)
			this.hud.setPrompt(null)
			this.hud.setHold(null)
			this.say(null)
			this.callbacks.onDead()
			return
		}
		this.startRespawn()
	}

	/**
	 * Онлайн: смерть не выкидывает из забега. Игрок проиграл, но остаётся
	 * при����раком: летает внутри школы, смотрит за своими, но ничего не трогает
	 * и учительница его больше не видит.
	 */
	private startGhost(): void {
		this.state = "ghost"
		this.online?.sendDown()
		this.timeline = null
		this.fade = 0
		this.grace = 0
		this.ghostTimer = 0
		this.ghostY = this.player.eyeY
		this.teacherTarget = null
		this.hideSpot = null
		this.hideSpotted = false
		this.heldItem = null
		this.heldTimer = 0
		this.target = null
		this.holdProgress = 0
		this.holdActive = false
		this.flashlightOn = false
		this.stepsOn = false
		this.audio.stopAllLoops(0.4)
		this.audio.play("fall", { volume: 0.95 })
		this.audio.play("lose", { volume: 0.8, delay: 0.3 })
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.hud.setLives(0, this.maxLives)
		this.hud.setVignette(0)
		this.hud.toast("Вы проиграли. Теперь вы призрак и можете только смотреть", 6)
		this.say(
			"Призрак: WASD — полёт, пробел — вверх, Ctrl — вниз. Из школы не выйти",
		)
		this.netSay("Вы погибли — теперь вы призрак и просто смотрите за своими")
	}

	/** Полёт призрака: без физики, без предметов и строго внутри здания. */
	private updateGhost(
		dt: number,
		mouse: { x: number; y: number },
		invertY: boolean,
	): void {
		if (mouse.x !== 0 || mouse.y !== 0) {
			this.player.applyLook(mouse.x, invertY ? -mouse.y : mouse.y)
		}
		this.ghostTimer += dt
		let forward = 0
		let strafe = 0
		let lift = 0
		if (this.input.isDown("forward")) forward += 1
		if (this.input.isDown("back")) forward -= 1
		if (this.input.isDown("right")) strafe += 1
		if (this.input.isDown("left")) strafe -= 1
		if (this.input.isDown("jump")) lift += 1
		if (this.input.isDown("crouch")) lift -= 1
		const step = (this.input.isDown("sprint") ? GHOST_FAST : GHOST_SPEED) * dt
		// Летим туда, куда смотрим.
		const cosPitch = Math.cos(this.player.pitch)
		const dirX = -Math.sin(this.player.yaw) * cosPitch
		const dirZ = -Math.cos(this.player.yaw) * cosPitch
		const dirY = Math.sin(this.player.pitch)
		const rightX = Math.cos(this.player.yaw)
		const rightZ = -Math.sin(this.player.yaw)
		this.player.x += (dirX * forward + rightX * strafe) * step
		this.player.z += (dirZ * forward + rightZ * strafe) * step
		this.ghostY += (dirY * forward + lift) * step
		// Школа не отпускает: наружу и сквозь крышу призрак не улетит.
		this.player.x = Math.max(GHOST_MIN_X, Math.min(GHOST_MAX_X, this.player.x))
		this.player.z = Math.max(GHOST_MIN_Z, Math.min(GHOST_MAX_Z, this.player.z))
		this.ghostY = Math.max(GHOST_MIN_Y, Math.min(GHOST_MAX_Y, this.ghostY))
		this.player.y = this.ghostY - CONFIG.player.eyeHeight
		this.player.velocityX = 0
		this.player.velocityY = 0
		this.player.velocityZ = 0
		this.setCamera(
			this.player.x,
			this.ghostY,
			this.player.z,
			this.player.yaw,
			this.player.pitch,
			CONFIG.camera.fov + 4,
		)
		// Забег окончен, когда в школе никого живого не осталось.
		if (this.ghostTimer < 2.5) return
		const online = this.online
		if (!online || !online.live) {
			this.finishDead("Связь с забегом потеряна. Школа вас не отпустила.")
			return
		}
		let alive = 0
		for (const other of online.players.values()) {
			if (!other.down && !other.escaped) alive += 1
		}
		if (alive === 0) {
			this.finishDead("Забег окончен. Вы проиграли: учительница вас догнала.")
		}
	}

	/** Призрак учительницу не считает — только смотрит за ней по сети. */
	private updateTeacherSpectate(dt: number): void {
		const online = this.online
		if (!online) return
		const net = online.teacherView ?? online.teacherNet
		if (!net) return
		this.teacher.placeAt(net.x, net.z, net.yaw)
		this.teacher.visible = net.visible
		this.teacher.setAnimationSpeed(net.speed, dt)
	}

	/** Экран поражен��я: сразу в одиночной игре или после полёта призраком. */
	private finishDead(reason?: string): void {
		this.state = "dead"
		this.timeline = null
		this.fade = 1
		this.audio.stopAllLoops(0.4)
		this.hud.setVisible(false)
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.say(null)
		this.callbacks.onDead(reason)
	}

	/** Просыпаемся на полу ближайшего кабинета. */
	private startRespawn(): void {
		this.state = "hurt"
		this.hud.setPrompt(null)
		this.hud.setHold(null)
		this.hud.setVisible(false)
		const spot = this.nearestWakePoint()
		const fromPitch = this.player.pitch

		const steps: SceneStep[] = [
			{
				id: "knockdown",
				duration: 0.85,
				onEnter: () => {
					// Звук 2: мы упали на пол.
					this.audio.play("fall", { volume: 0.95, delay: 0.06 })
					this.shake = Math.max(this.shake, 1)
				},
				onUpdate: (progress) => {
					// Удар сбивает с ног: камера падает на пол и заваливается вбок.
					const t = easeOut(progress)
					this.fade = t * 0.28
					this.setCamera(
						this.player.x,
						mix(this.player.eyeY, 0.42, t),
						this.player.z,
						this.player.yaw + t * 0.55,
						mix(fromPitch, -0.85, t),
					)
				},
			},
			{
				id: "blackout",
				duration: 0.8,
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.fade = 0.28 + t * 0.72
					this.setCamera(
						this.player.x,
						mix(0.42, 0.32, t),
						this.player.z,
						this.player.yaw + 0.55,
						-0.85,
					)
				},
				onExit: () => {
					this.fade = 1
					this.placePlayer(spot.x, spot.z, spot.yaw)
					this.teacher.retreatFrom(spot.x, spot.z, 30)
					this.audio.play("breath", { volume: 0.85 })
				},
			},
			{
				id: "dark",
				duration: 2.4,
				onEnter: () => {
					this.say(`Мы очнулись на полу. ${spot.room}. Жизней осталось: ${this.lives}`)
				},
				onUpdate: () => {
					this.fade = 1
				},
			},
			{
				id: "getup",
				duration: 2.8,
				onUpdate: (progress) => {
					const t = easeInOut(progress)
					this.fade = 1 - easeOut(Math.min(1, progress * 1.5))
					this.setCamera(
						spot.x,
						mix(0.3, CONFIG.player.eyeHeight, t),
						spot.z,
						spot.yaw,
						mix(-0.8, 0, t),
					)
				},
				onExit: () => {
					this.say(null)
				},
			},
		]

		this.timeline = new Timeline(steps, () => {
			this.timeline = null
			this.state = "play"
			this.fade = 0
			this.grace = CONFIG.horror.respawnGrace
			this.hud.setVisible(true)
		})
	}

	private nearestWakePoint(): { x: number; z: number; yaw: number; room: string } {
		let best = WAKE_POINTS[0]
		let bestDistance = Infinity
		for (const point of WAKE_POINTS) {
			const distance = Math.hypot(point.x - this.player.x, point.z - this.player.z)
			if (distance < bestDistance) {
				bestDistance = distance
				best = point
			}
		}
		return best
	}

	// ------------------------------------------------------------- взаимодействие

	private toggleFlashlight(): void {
		if (!this.flashlightOwned) return
		if (this.state !== "play" && this.state !== "hiding") return
		// Если в руке другой предмет — F сначала возвращает фонарь.
		if (this.slot !== 0) {
			this.lightArmed = true
			this.selectSlot(0)
			return
		}
		this.flashlightOn = !this.flashlightOn
		this.lightArmed = this.flashlightOn
		this.audio.play("click", { volume: 0.7 })
		if (this.flashlightOn && this.heldTimer <= 0) this.heldItem = "flashlight"
	}

	// ------------------------------------------------------------ пояс предметов

	/** Кладём находку в первую свободную ячейку и возвращаем её номер. */
	private addToHotbar(kind: ItemKind): number {
		const existing = this.hotbar.indexOf(kind)
		if (existing >= 0) return existing
		if (kind === "flashlight") {
			this.hotbar[0] = kind
			return 0
		}
		for (let i = 1; i < this.hotbar.length; i += 1) {
			if (!this.hotbar[i]) {
				this.hotbar[i] = kind
				return i
			}
		}
		this.hotbar[this.hotbar.length - 1] = kind
		return this.hotbar.length - 1
	}

	/**
	 * Смена предмета в руке цифрами 1…6.
	 * Взяли не фонарь — свет гаснет; вернулись на слот 1 — фонарь снова горит.
	 */
	private selectSlot(index: number): void {
		if (this.state !== "play" && this.state !== "hiding") return
		if (index < 0 || index >= this.hotbar.length) return
		const kind = this.hotbar[index]
		if (!kind) {
			this.hud.toast("Эта ячейка пустая", 1.4)
			return
		}
		const changed = index !== this.slot
		this.slot = index
		this.heldItem = null
		this.heldTimer = 0
		if (kind === "flashlight") {
			this.flashlightOn = this.flashlightOwned && this.lightArmed
		} else {
			if (this.flashlightOn) this.lightArmed = true
			this.flashlightOn = false
		}
		if (changed) this.audio.play("click", { volume: 0.55, rate: 1.15 })
		this.hud.setHandLabel(handLabel(kind))
		this.refreshHotbarHud()
	}

	private refreshHotbarHud(): void {
		if (!this.hotbar.some((kind) => kind !== null)) {
			this.hud.setHotbar([])
			return
		}
		this.hud.setHotbar(
			this.hotbar.map((kind, index) => ({
				key: String(index + 1),
				label: kind ? labelOf(kind) : "",
				filled: kind !== null,
				active: kind !== null && index === this.slot,
			})),
		)
	}

	private findTarget(): TargetInfo | null {
		const eyeX = this.player.x
		const eyeZ = this.player.z
		const eyeY = this.player.eyeY
		const forwardX = -Math.sin(this.player.yaw)
		const forwardZ = -Math.cos(this.player.yaw)
		let best: TargetInfo | null = null
		let bestScore = -Infinity

		const consider = (x: number, y: number, z: number, make: () => TargetInfo): void => {
			const dx = x - eyeX
			const dz = z - eyeZ
			const distance = Math.hypot(dx, dz)
			if (distance > CONFIG.horror.reach) return
			if (Math.abs(y - eyeY) > 1.8) return
			const dot = distance > 0.001 ? (dx * forwardX + dz * forwardZ) / distance : 1
			if (dot < 0.3) return
			const score = dot * 2 - distance * 0.2
			if (score > bestScore) {
				bestScore = score
				best = make()
			}
		}

		if (this.act === 2) {
			for (const def of ACT2_ITEMS) {
				if (this.collected.has(def.id)) continue
				if (!this.act2ItemAvailable(def)) continue
				consider(def.x, def.y, def.z, () => ({
					kind: "item",
					label: `забрать: ${def.label}`,
					hold: CONFIG.horror.holdSeconds,
					item: def,
					ready: true,
				}))
			}
			const stage = this.act2Stage
			if (stage === "panel" || stage === "captcha" || stage === "hack") {
				const hasLaptop = this.collected.has("laptop")
				const label =
					stage === "panel"
						? hasLaptop
							? "поставить ноутбук на щит"
							: "нужен предмет: Ноутбук"
						: stage === "hack"
							? "посмотреть на взлом"
							: "сесть за ноутбук"
				consider(ACT2_PANEL.x, ACT2_PANEL.y, ACT2_PANEL.standZ, () => ({
					kind: "exit",
					label,
					hold: stage === "panel" ? 1.2 : 0.35,
					ready: stage !== "panel" || hasLaptop,
				}))
			}
			if (stage === "escape") {
				consider(ACT2_EXIT.x, ACT2_EXIT.y, ACT2_EXIT.standZ, () => ({
					kind: "exit",
					label: "открыть служебный выход",
					hold: 1,
					ready: true,
				}))
			}
			return best
		}

		for (const item of QUEST_ITEMS) {
			if (this.collected.has(item.id)) continue
			consider(item.x, item.y, item.z, () => ({
				kind: "item",
				label: `забрать: ${item.label}`,
				hold: CONFIG.horror.holdSeconds,
				item,
				ready: true,
			}))
		}
		if (!this.flashlightOwned) {
			consider(FLASHLIGHT_ITEM.x, FLASHLIGHT_ITEM.y, FLASHLIGHT_ITEM.z, () => ({
				kind: "item",
				label: `забрать: ${FLASHLIGHT_ITEM.label}`,
				hold: 1.4,
				item: FLASHLIGHT_ITEM,
				ready: true,
			}))
		}
		if (this.exitStage < EXIT_STAGES.length) {
			const stage = EXIT_STAGES[this.exitStage]
			const has = this.collected.has(stage.item)
			consider(EXIT_DOOR.x, 1.4, EXIT_DOOR.z - 0.15, () => ({
				kind: "exit",
				label: has ? stage.label.toLowerCase() : `нужен предмет: ${labelOf(stage.item)}`,
				hold: CONFIG.horror.holdSeconds,
				needs: stage.item,
				ready: has,
			}))
		} else if (this.online) {
			// Дверь уже открыта (сами или товарищ) — выйти может любой.
			consider(EXIT_DOOR.x, 1.4, EXIT_DOOR.z - 0.15, () => ({
				kind: "exit",
				label: "выбежать из школы",
				hold: 0.45,
				ready: true,
			}))
		}
		for (const spot of HIDE_SPOTS) {
			consider(spot.x, 1.2, spot.z, () => ({
				kind: "hide",
				label: "спрятаться в шкафчике",
				hold: 0.4,
				spot,
				ready: true,
			}))
		}
		return best
	}

	private completeInteraction(target: TargetInfo): void {
		if (this.act === 2) {
			this.completeAct2(target)
			return
		}
		if (target.kind === "item" && target.item) {
			const item = target.item
			this.audio.play("pickup_done", { volume: 0.85 })
			this.heldItem = item.id
			this.heldTimer = 5
			this.hud.setHandLabel(`${item.label} — ${item.use}`)
			const slot = this.addToHotbar(item.id)
			if (item.id === "flashlight") {
				this.flashlightOwned = true
				this.flashlightOn = true
				this.lightArmed = true
				this.slot = 0
				this.refreshHotbarHud()
				this.hud.toast("Фонарь взят. F — свет, 1 — фонарь в руку", 4.5)
				this.netSay(`Вы нашли предмет: ${item.label}`)
				return
			}
			this.collected.add(item.id)
			this.online?.sendItem(item.id)
			this.refreshItemsHud()
			this.refreshHotbarHud()
			this.hud.toast(
				`${item.label}: найдено ${this.collected.size} из 5 · клавиша ${slot + 1} — взять в руку`,
				3.8,
			)
			this.netSay(`Вы нашли предмет: ${item.label} (${this.collected.size}/5)`)
			if (!this.lightsOut) this.triggerLightsOut()
			return
		}

		if (target.kind === "exit") {
			const stage = EXIT_STAGES[this.exitStage]
			if (!stage) {
				// Онлайн: баррикаду разобрала команда — просто убегаем.
				if (this.online) this.startOutro()
				return
			}
			this.audio.play(stage.sound, { volume: 0.9 })
			this.barricadeTarget = stage.progress
			this.exitStage += 1
			this.online?.sendStage(this.exitStage)
			this.netSay(`Вы разобрали баррикаду: ${stage.label.toLowerCase()}`)
			this.heldItem = stage.item
			this.heldTimer = 2.5
			if (this.exitStage >= EXIT_STAGES.length) {
				this.startOutro()
				return
			}
			const next = EXIT_STAGES[this.exitStage]
			this.hud.toast(`Дальше: ${next.label.toLowerCase()}`, 3.5)
			return
		}

		if (target.kind === "hide" && target.spot) {
			this.hideSpot = target.spot
			this.hideYaw = target.spot.yaw
			this.state = "hiding"
			this.player.yaw = target.spot.yaw
			this.player.pitch = 0
			// В шкафчике предмет убираем в карман — раньше рука торчала сквозь дверцу.
			this.heldItem = null
			this.heldTimer = 0
			this.audio.play("locker_open", { volume: 0.8 })
			this.audio.play("locker_close", { volume: 0.7, delay: 0.5 })
			this.audio.stopLoop("steps", 0.05)
			this.stepsOn = false
			// Если она в этот момент смотрела на нас и была рядом — она видела
			// шкафчик и придёт вытаскивать: нужно ускользнуть до её руки.
			const seenFrom = Math.hypot(this.teacher.x - this.player.x, this.teacher.z - this.player.z)
			// Было 12 м: она ��видела» почти всегда, и шкафчик не спасал.
			this.hideSpotted = this.teacher.visible && this.teacher.seesPlayer && seenFrom < 7
			if (this.hideSpotted) {
				this.hud.toast("Она видела, куда вы спрятались! Бегите!", 4)
				this.audio.play("teacher_near", { volume: 0.95, delay: 0.45 })
			} else {
				this.hud.toast("Нажмите E, чтобы выйти", 3)
			}
		}
	}

	private leaveLocker(): void {
		const spot = this.hideSpot
		if (!spot) return
		this.audio.play("locker_open", { volume: 0.8 })
		this.placePlayer(spot.x, spot.z, spot.yaw + Math.PI)
		this.hideSpot = null
		this.hideSpotted = false
		this.state = "play"
		this.holdProgress = 0
		this.holdActive = false
	}

	private triggerLightsOut(): void {
		this.lightsOut = true
		this.online?.sendLightsOut()
		this.nightTarget = 1
		this.audio.play("lights_out", { volume: 0.95 })
		this.audio.play("stinger", { volume: 0.7, delay: 1.4 })
		this.audio.startLoop("heartbeat", { volume: 0.22, fade: 1.5 })
		this.hud.toast(
			this.flashlightOwned
				? "Свет погас. Фонарь — F"
				: "Свет погас! Фонарь остался в кабинете 101",
			6,
		)
		// Режим «Призрак»: свет гаснет, но будить некого — она ушла из школы.
		if (this.preset.absent) {
			this.teacher.sleep()
			this.teacher.visible = false
			return
		}
		const node = this.nav.roamTarget(this.player.x, this.player.z, 30)
		if (node) this.teacher.awaken(node.x, node.z, Math.PI)
		else this.teacher.awaken(69, 15, Math.PI)
	}

	// -------------------------------------------------------------------- кадр

	/**
	 * Один кадр игры.
	 *
	 * Физику игрока считает главный цикл фиксированным шагом и передаёт сюда
	 * количество шагов; вся остальная логика идёт по времени кадра.
	 *
	 * @param frameSeconds длительность кадра в секундах
	 * @param steps сколько шагов физики нужно выполнить
	 * @param fixedStep длительность одного шага физики
	 * @param mouse накопленное смещение мыши (уже в радианах)
	 * @param invertY инверсия вертикали из настроек
	 */
	frame(
		frameSeconds: number,
		steps: number,
		fixedStep: number,
		mouse: { x: number; y: number },
		invertY: boolean,
	): void {
		const dt = Math.min(frameSeconds, CONFIG.physics.maxFrameDelta)
		this.time += dt
		if (this.paused) {
			this.hud.update(dt)
			return
		}

		if (this.grace > 0) this.grace = Math.max(0, this.grace - dt)
		if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.7)
		this.night += (this.nightTarget - this.night) * Math.min(1, dt * 0.9)
		this.barricade += (this.barricadeTarget - this.barricade) * Math.min(1, dt * 2.2)
		// Во вступлении углом двери управляет таймлайн, дальше — плавный доворот.
		if (this.state !== "intro") {
			this.classDoorAngle += (this.classDoorTarget - this.classDoorAngle) * Math.min(1, dt * 2.4)
		}
		if (this.heldTimer > 0) {
			this.heldTimer -= dt
			if (this.heldTimer <= 0) {
				this.heldItem = null
				// В руку возвращается то, что выбрано на поясе.
				const equipped = this.hotbar[this.slot]
				this.hud.setHandLabel(equipped ? handLabel(equipped) : null)
			}
		}

		switch (this.state) {
			case "menu":
				this.updateMenuCamera()
				break
			case "intro":
			case "outro":
			case "hurt":
				if (this.timeline) this.timeline.update(dt)
				break
			case "play":
				this.updatePlay(dt, steps, fixedStep, mouse, invertY)
				break
			case "hiding":
				this.updateHiding(dt, mouse, invertY)
				break
			case "ghost":
				this.updateGhost(dt, mouse, invertY)
				break
			case "dead":
			case "won":
				break
		}

		if (this.state === "play" || this.state === "hiding") this.updateTeacher(dt)
		else if (this.state === "ghost") this.updateTeacherSpectate(dt)
		if (this.act === 2) this.updateAct2(dt)
		this.updateOnline(dt)
		this.applyShake()
		this.updateDynamicMeshes()
		this.hud.setFade(this.fade)
		this.hud.update(dt)
	}

	/** В меню камера медленно плывёт по тёмному вестибюлю к силуэту у стены. */
	private updateMenuCamera(): void {
		const t = this.time * 0.11
		this.setCamera(
			38 + Math.sin(t) * 1.6,
			1.72 + Math.sin(t * 0.7) * 0.04,
			34.8 + Math.cos(t * 0.55) * 1.1,
			Math.sin(t * 0.45) * 0.1,
			-0.015 + Math.sin(t * 0.8) * 0.012,
			70,
		)
		this.fade = 0
	}

	// ------------------------------------------------------------------- игр��

	private updatePlay(
		dt: number,
		steps: number,
		fixedStep: number,
		mouse: { x: number; y: number },
		invertY: boolean,
	): void {
		// Пока открыт терминал взлома, игрок не ходит и не вертит камерой.
		if (!this.inTerminal) {
			if (mouse.x !== 0 || mouse.y !== 0) {
				this.player.applyLook(mouse.x, invertY ? -mouse.y : mouse.y)
			}
			for (let i = 0; i < steps; i += 1) this.player.update(fixedStep, this.input)
		}

		this.playTime += dt
		if (this.act === 1 && !this.lightsOut && this.playTime > LIGHTS_OUT_AFTER) {
			this.triggerLightsOut()
		}

		this.setCamera(
			this.player.x,
			this.player.eyeY,
			this.player.z,
			this.player.yaw,
			this.player.pitch,
			CONFIG.camera.fov + (this.player.speed > 4.4 ? 3.5 : 0),
		)

		this.updateFootsteps(dt)
		this.updateInteraction(dt)
		this.updateObjective()
		this.updateAtmosphere(dt)
	}

	/** В шкафчике: обзор заперт в узком секторе, выйти — тем же E. */
	private updateHiding(dt: number, mouse: { x: number; y: number }, invertY: boolean): void {
		const spot = this.hideSpot
		if (!spot) {
			this.state = "play"
			return
		}
		if (mouse.x !== 0 || mouse.y !== 0) {
			this.player.applyLook(mouse.x, invertY ? -mouse.y : mouse.y)
		}
		const delta = Math.atan2(
			Math.sin(this.player.yaw - this.hideYaw),
			Math.cos(this.player.yaw - this.hideYaw),
		)
		// Смотрим только в щель: узкий сектор, чтобы не видеть сквозь стенки.
		this.player.yaw = this.hideYaw + Math.max(-0.5, Math.min(0.5, delta))
		this.player.pitch = Math.max(-0.26, Math.min(0.26, this.player.pitch))

		this.setCamera(
			spot.insideX,
			1.42 + Math.sin(this.time * 1.7) * 0.005,
			spot.insideZ,
			this.player.yaw,
			this.player.pitch,
			60,
		)

		this.target = null
		this.hud.setHold(null)
		this.hud.setPrompt("E — выйти из шкафчика")
		this.hud.setObjective(
			this.hideSpotted
				? "Она видела вас! Выбирайтесь из шкафчика"
				: "Сидите тихо, пока она не уйдёт",
		)
		if (this.holdKey) {
			this.holdKey = false
			this.leaveLocker()
			return
		}
		this.updateAtmosphere(dt)
	}

	/** Ш��ги — зациклённая запись игрока, скорость зависит от режима движения. */
	private updateFootsteps(dt: number): void {
		const moving = this.player.onGround && this.player.speed > 0.7
		if (moving && !this.stepsOn) {
			this.stepsOn = true
			this.audio.startLoop("steps", { volume: CONFIG.audio.steps, fade: 0.06 })
		} else if (!moving && this.stepsOn) {
			this.stepsOn = false
			this.audio.stopLoop("steps", 0.12)
		}
		if (this.stepsOn) {
			const crouching = this.player.crouching
			const sprinting = this.player.sprinting && !crouching
			const rate = crouching
				? CONFIG.audio.stepsCrouchRate
				: sprinting
					? CONFIG.audio.stepsSprintRate
					: CONFIG.audio.stepsWalkRate
			this.audio.setLoopRate("steps", rate)
			this.audio.setLoopVolume(
				"steps",
				CONFIG.audio.steps * (crouching ? 0.4 : sprinting ? 1.15 : 1),
			)
		}

		if (this.wasOnGround && !this.player.onGround && this.player.velocityY > 0.5) {
			this.audio.play("jump", { volume: 0.45 })
		}
		if (this.player.onGround) {
			if (!this.wasOnGround) {
				this.audio.play("land", { volume: 0.4 })
				// Звук 2: падение — только после настоящего полёта, а не после каждого шага.
				if (this.airTime > 0.55) {
					this.audio.play("fall", { volume: 0.9, duration: 2.4 })
					this.shake = Math.max(this.shake, 0.45)
				}
			}
			this.airTime = 0
		} else {
			this.airTime += dt
		}
		this.wasOnGround = this.player.onGround
	}

	/** Удержание E: 2.5 секунды на предмет, столько же на разбор выхода. */
	private updateInteraction(dt: number): void {
		const target = this.findTarget()
		this.target = target

		if (target && this.holdKey && !target.ready) {
			this.holdKey = false
			this.audio.play("locked", { volume: 0.7 })
			this.hud.toast(target.label, 2.8)
		}

		const holding = target !== null && target.ready && this.holdKey
		if (holding && target) {
			if (!this.holdActive) {
				this.holdActive = true
				this.audio.startLoop("pickup_loop", { volume: 0.4, fade: 0.05 })
			}
			this.holdProgress += dt / Math.max(0.25, target.hold)
		} else {
			if (this.holdActive) {
				this.holdActive = false
				this.audio.stopLoop("pickup_loop", 0.1)
			}
			this.holdProgress = Math.max(0, this.holdProgress - dt * 2.2)
		}

		if (target && this.holdProgress >= 1) {
			this.holdProgress = 0
			this.holdActive = false
			this.holdKey = false
			this.audio.stopLoop("pickup_loop", 0.08)
			this.hud.setHold(null)
			this.hud.setPrompt(null)
			this.target = null
			this.completeInteraction(target)
			return
		}

		if (!target) {
			this.hud.setPrompt(null)
			this.hud.setHold(null)
			return
		}
		this.hud.setPrompt(target.ready ? `E — ${target.label}` : target.label)
		this.hud.setHold(this.holdProgress > 0.01 ? this.holdProgress : null, target.label)
	}

	private updateObjective(): void {
		if (this.act === 2) {
			this.hud.setObjective(objectiveFor(this.act2Stage, this.collected.has("laptop")))
			return
		}
		if (this.exitStage >= EXIT_STAGES.length) {
			this.hud.setObjective("Выход свободен — уходите!")
			return
		}
		if (this.lightsOut && !this.flashlightOwned) {
			this.hud.setObjective("Возьмите фонарь в кабинете 101")
			return
		}
		const stage = EXIT_STAGES[this.exitStage]
		if (stage && this.collected.has(stage.item)) {
			this.hud.setObjective(`Выход: ${stage.label.toLowerCase()}`)
			return
		}
		this.hud.setObjective(`Найдите предметы: ${this.collected.size} из ${QUEST_ITEMS.length}`)
	}

	/** Сердцебиение ближе к учительнице, шёпот в темноте и виньетка страха. */
	private updateAtmosphere(dt: number): void {
		if (!this.audio.isLooping("ambience")) {
			this.audio.startLoop("ambience", { volume: CONFIG.audio.ambience, fade: 1.2 })
		}

		const distance = this.teacher.distanceTo(this.player.x, this.player.z)

		// Звук 3: она совсем рядом. С паузой, чтобы не звучал без конца.
		this.nearCue -= dt
		if (this.lightsOut && this.state === "play" && distance < 8.5 && this.nearCue <= 0) {
			this.nearCue = 9
			this.audio.play("teacher_near", { volume: 0.8, duration: 4.5 })
		}

		if (this.lightsOut) {
			const near = Math.max(0, 1 - distance / 20)
			const volume = Math.min(0.85, 0.12 + near * near * 0.6 + this.teacher.alert * 0.2)
			if (!this.audio.isLooping("heartbeat")) {
				this.audio.startLoop("heartbeat", { volume, fade: 0.8 })
			} else {
				this.audio.setLoopVolume("heartbeat", volume)
			}
			this.audio.setLoopRate("heartbeat", 0.8 + near * 0.7)
		}

		this.whisperTimer -= dt
		if (this.whisperTimer <= 0) {
			this.whisperTimer = 25 + Math.random() * 20
			if (this.lightsOut) {
				const angle = Math.random() * Math.PI * 2
				this.audio.playAt(
					"whisper",
					{ x: this.player.x + Math.cos(angle) * 6, z: this.player.z + Math.sin(angle) * 6 },
					this.player,
					{ volume: 0.45, range: 15 },
				)
			}
		}

		const danger = Math.max(this.teacher.alert, this.teacher.seesPlayer ? 0.9 : 0)
		const lowLife = this.lives <= 2 ? 0.22 : 0
		this.hud.setVignette(Math.min(1, danger * 0.85 + lowLife + (this.lightsOut ? 0.12 : 0)))
	}

	/** Чувства учительницы: шум зависит от того, как игрок двигается. */
	private updateTeacher(dt: number): void {
		const online = this.online
		// В онлайне учительницу считает один игрок — тот, кто сейчас за неё
		// отвечает. Остальные видят сгла��енную позу с сети.
		// Режим «Призрак» и весь акт II: её нет в школе — никаких чувств и движения.
		if (this.preset.absent || this.act === 2) {
			if (this.teacher.state !== "sleep") this.teacher.sleep()
			this.teacher.visible = false
			this.teacher.alert = 0
			this.teacher.seesPlayer = false
			this.teacherTarget = null
			return
		}
		if (online && !online.authority) {
			const net = online.teacherView ?? online.teacherNet
			if (net) {
				this.teacher.placeAt(net.x, net.z, net.yaw)
				this.teacher.visible = net.visible
				this.teacher.setAnimationSpeed(net.speed, dt)
			}
			return
		}
		// Приняли эстафету (прошлый ведущий вышел, погиб или ушёл в кат-сцену):
		// подхватываем учительницу там, где её видели остальные, и будим.
		if (online && online.takeAuthority()) {
			const net = online.teacherView ?? online.teacherNet
			if (net) {
				if (this.lightsOut) this.teacher.awaken(net.x, net.z, net.yaw)
				else this.teacher.placeAt(net.x, net.z, net.yaw)
				this.teacher.visible = net.visible
			} else if (this.lightsOut && this.teacher.state === "sleep") {
				const node = this.nav.roamTarget(this.player.x, this.player.z, 26)
				if (node) this.teacher.awaken(node.x, node.z, Math.PI)
			}
		}
		const hidden = this.state === "hiding"
		const noise = hidden
			? 0
			: !this.player.onGround
				? 0.5
				: this.player.speed < 0.4
					? 0
					: this.player.crouching
						? 0.12
						: this.player.sprinting
							? 1
							: 0.35

		// Хост выбирает цель: ближайший неспрятавшийся игрок. В одиночной игре это всегда мы.
		let senseX = this.player.x
		let senseZ = this.player.z
		let senseEye = this.player.eyeY
		let senseHidden = hidden || this.grace > 0
		let senseSpotted = hidden && this.hideSpotted && this.grace <= 0
		let senseNoise = noise
		let senseFlash = this.flashlightOn
		this.teacherTarget = null
		if (online) {
			let best = senseHidden
				? Infinity
				: Math.hypot(this.teacher.x - this.player.x, this.teacher.z - this.player.z)
			for (const other of online.players.values()) {
				if (other.hidden || other.escaped || other.down) continue
				const dist = Math.hypot(this.teacher.x - other.x, this.teacher.z - other.z)
				if (dist >= best) continue
				best = dist
				this.teacherTarget = other.id
				senseX = other.x
				senseZ = other.z
				senseEye = other.y + CONFIG.player.eyeHeight
				senseHidden = false
				senseSpotted = false
				senseNoise =
					other.speed > 4.4 ? 1 : other.speed > 0.5 ? (other.crouching ? 0.12 : 0.35) : 0
				senseFlash = other.flashlight
			}
		}

		this.teacher.update(
			dt,
			{
				playerX: senseX,
				playerZ: senseZ,
				playerEyeY: senseEye,
				playerHidden: senseHidden,
				playerHiddenSpotted: senseSpotted,
				playerNoise: senseNoise,
				flashlightOn: senseFlash,
			},
			{
				onStep: (x: number, z: number) => {
					this.audio.playAt("teacher_step", { x, z }, this.player, {
						volume: 0.6,
						range: 17,
					})
				},
				onSwing: () => {
					this.audio.playAt(
						"swing",
						{ x: this.teacher.x, z: this.teacher.z },
						this.player,
						{ volume: 0.8, range: 12 },
					)
				},
				onImpact: () => {
					// Удар достаётся тому, кого она догнала: считает хост.
					const victim = this.teacherTarget
					if (this.online && victim) {
						this.online.sendHit(victim)
						return
					}
					this.hitPlayer()
				},
				onNotice: () => {
					// Один звук на обнаружение — её крик, плюс анимация крика телом.
					this.teacher.scream()
					this.audio.playAt(
						"teacher_scream",
						{ x: this.teacher.x, z: this.teacher.z },
						this.player,
						{ volume: 1, range: 45 },
					)
					this.shake = Math.max(this.shake, 0.8)
					// В онлайне она могла заметить другого игрока — тогда и пишем имя,
					// а не «вас». Это был старый баг: сообщение пугало не того, кого надо.
					const spotted = this.teacherTarget
					if (this.online && spotted) {
						this.hud.toast(`Она заметила ${this.online.nameOf(spotted)}!`, 2.6)
					} else {
						this.hud.toast("Она вас увидела!", 2.6)
					}
				},
				onLost: () => {
					const chased = this.teacherTarget
					if (this.online && chased) {
						this.hud.toast(`Она потеряла ${this.online.nameOf(chased)}`, 2.6)
						return
					}
					// Потеряла нас — значит и про наш шкафчик забыла.
					this.hideSpotted = false
					this.hud.toast("Кажется, потеряла...", 2.6)
				},
			},
		)
	}

	/** Тряска камеры от удара и крика. */
	private applyShake(): void {
		if (this.shake <= 0) return
		// В кат-сценах трясём заметно слабее: там кадр ведёт камера,
		// и дрожь читалась как баг.
		const scene = this.state === "intro" || this.state === "outro"
		const power = this.shake * this.shake * (scene ? 0.3 : 1)
		this.camera.x += Math.sin(this.time * 41.3) * 0.05 * power
		this.camera.y += Math.sin(this.time * 37.7 + 1.7) * 0.06 * power
		this.camera.yaw += Math.cos(this.time * 33.1) * 0.022 * power
		this.camera.pitch += Math.sin(this.time * 29.4) * 0.018 * power
	}

	// -------------------------------------------------------- динамическая геометрия

	/**
	 * Всё, что двигается, пересобирается каждый кадр в отдельные буферы:
	 * учительница, предметы на полу, предмет в руке, двери и баррикада.
	 */
	private updateDynamicMeshes(): void {
		if (this.teacher.visible) {
			const mesh = new MeshBuilder()
			this.teacher.buildMesh(mesh, {
				writing: this.teacherWriting,
				writePhase: this.writePhase,
				human: this.teacherHuman,
			})
			this.renderer.upsertDynamic("teacher", mesh)
			this.renderer.setDynamicVisible("teacher", true)
		} else {
			this.renderer.setDynamicVisible("teacher", false)
		}

		if (this.online) {
			const others = new MeshBuilder()
			this.online.buildMesh(others)
			this.renderer.upsertDynamic("players", others)
			this.renderer.setDynamicVisible("players", !others.isEmpty)
		} else {
			this.renderer.setDynamicVisible("players", false)
		}

		if (this.itemsVisible) {
			const items = new MeshBuilder()
			const highlighted = this.target && this.target.kind === "item" ? this.target.item : null
			if (!this.flashlightOwned && this.act === 1) {
				buildItemPickup(items, FLASHLIGHT_ITEM, this.time, highlighted?.id === "flashlight")
			}
			for (const def of this.act === 2 ? ACT2_ITEMS : QUEST_ITEMS) {
				if (this.collected.has(def.id)) continue
				if (this.act === 2 && !this.act2ItemAvailable(def)) continue
				buildItemPickup(items, def, this.time, highlighted?.id === def.id)
			}
			if (this.act === 2 && this.act2LaptopPlaced) {
				// Поставленный на щит ноутбук светится экраном — маяк в темноте.
				buildItemModel(
					items,
					"laptop",
					{ x: ACT2_PANEL.x, y: ACT2_PANEL.laptopY, z: ACT2_PANEL.laptopZ, yaw: Math.PI },
					1.15,
					true,
				)
			}
			this.renderer.upsertDynamic("items", items)
			this.renderer.setDynamicVisible("items", !items.isEmpty)
		} else {
			this.renderer.setDynamicVisible("items", false)
		}

		const held = new MeshBuilder()
		const walking = this.state === "play" && this.player.speed > 0.6
		const sway =
			Math.sin(this.time * 1.7) * 0.006 + (walking ? Math.sin(this.time * 9.4) * 0.018 : 0)
		// В шкафчике руку не рисуем вовсе, иначе она видна снаружи.
		const inHand = this.state === "play" ? (this.heldItem ?? this.hotbar[this.slot]) : null
		if (inHand) {
			buildHeldItem(held, inHand, this.camera, sway, this.flashlightOn)
		} else if (this.state === "play" && this.flashlightOn && this.flashlightOwned) {
			buildHeldItem(held, "flashlight", this.camera, sway, true)
		}
		this.renderer.upsertDynamic("held", held)
		this.renderer.setDynamicVisible("held", !held.isEmpty)

		if (this.exitVisible || this.state === "intro") {
			const exit = new MeshBuilder()
			buildExitDoors(exit, this.exitAngle)
			// Во вступлении школа ещё целая: доски появляются только в игре.
			if (this.barricadeVisible && this.barricade < 0.995) {
				buildBarricade(exit, this.barricade, this.time)
			}
			this.renderer.upsertDynamic("exit", exit)
			this.renderer.setDynamicVisible("exit", !exit.isEmpty)
		} else {
			this.renderer.setDynamicVisible("exit", false)
		}

		if (this.classDoorVisible) {
			const door = new MeshBuilder()
			// Отрицательный угол — створка уходит в коридор, а не в класс.
			buildClassDoor(door, -this.classDoorAngle)
			this.renderer.upsertDynamic("classdoor", door)
			this.renderer.setDynamicVisible("classdoor", !door.isEmpty)
		} else {
			this.renderer.setDynamicVisible("classdoor", false)
		}
	}

	/** Освещение кадра: день, ночь, туман и конус фонарика. */
	get environment(): RenderEnvironment {
		const night = Math.max(0, Math.min(1, this.night))
		const fade = Math.max(0, Math.min(1, this.fade))
		const light = mix(CONFIG.horror.dayLight, CONFIG.horror.nightLight, night) * this.brightness
		const fog = [
			mix(CONFIG.horror.dayFog[0], CONFIG.horror.nightFog[0], night),
			mix(CONFIG.horror.dayFog[1], CONFIG.horror.nightFog[1], night),
			mix(CONFIG.horror.dayFog[2], CONFIG.horror.nightFog[2], night),
		]
		const cosPitch = Math.cos(this.camera.pitch)
		return {
			lightMul: light,
			fogColor: fog,
			fogDensity: mix(CONFIG.light.fogDensity, CONFIG.horror.nightFogDensity, night),
			clearColor: [fog[0] * (1 - fade), fog[1] * (1 - fade), fog[2] * (1 - fade)],
			flash:
				this.flashlightOn && this.flashlightOwned
					? {
							x: this.camera.x,
							y: this.camera.y - 0.1,
							z: this.camera.z,
							dirX: -Math.sin(this.camera.yaw) * cosPitch,
							dirY: Math.sin(this.camera.pitch),
							dirZ: -Math.cos(this.camera.yaw) * cosPitch,
							range: CONFIG.horror.flashRange,
							power: CONFIG.horror.flashPower,
							inner: CONFIG.horror.flashInner,
							outer: CONFIG.horror.flashOuter,
						}
					: null,
			extraFlashes: this.remoteFlashes(),
		}
	}

	/**
	 * Фонари других игроков. Шейдер умеет три источника, поэтому
	 * берём ближайшие и только в радиусе, где свет вообще видно.
	 */
	private remoteFlashes(): FlashlightState[] {
		const online = this.online
		if (!online || !online.live) return EMPTY_FLASHES
		this.flashBuffer.length = 0
		for (const player of online.players.values()) {
			if (!player.flashlight || player.hidden || player.down || player.escaped) continue
			const dx = player.x - this.camera.x
			const dz = player.z - this.camera.z
			const distance = Math.hypot(dx, dz)
			if (distance > REMOTE_FLASH_VIEW) continue
			this.flashBuffer.push({
				distance,
				light: {
					x: player.x,
					y: player.y + (player.crouching ? 1.18 : 1.55),
					z: player.z,
					// Питч по сети не гоняем — светим чуть вниз, как в руке.
					dirX: -Math.sin(player.yaw) * 0.985,
					dirY: -0.17,
					dirZ: -Math.cos(player.yaw) * 0.985,
					range: CONFIG.horror.flashRange * 0.85,
					power: CONFIG.horror.flashPower * 0.8,
					inner: CONFIG.horror.flashInner,
					outer: CONFIG.horror.flashOuter,
				},
			})
		}
		if (this.flashBuffer.length === 0) return EMPTY_FLASHES
		this.flashBuffer.sort((a, b) => a.distance - b.distance)
		return this.flashBuffer.slice(0, MAX_EXTRA_FLASHES).map((entry) => entry.light)
	}
}

/** Через сколько секунд после начала игры свет гаснет сам. */
const LIGHTS_OUT_AFTER = 22
