/**
 * Лобби, матчмейкинг и канал матча.
 *
 * Как собирается игра (без сервера, только Realtime):
 *  1. Все сидят в общем лобби и держат presence: имя + ищу ли игру.
 *  2. Среди ищущих все считают одно и то же: самый ранний — хост.
 *  3. Хост ждёт 25 секунд (или пока не наберётся 5) и рассылает «match».
 *  4. Все из списка заходят в канал комнаты и играют.
 *
 * Серверных таблиц не нужно: всё живёт в presence и broadcast.
 */

import { randomId } from "./realtime.js"
import type { NetChannel, NetClient, NetPayload } from "./realtime.js"

export const LOBBY_NAME = "school3d-lobby-v1"
export const CODE_ROOM_PREFIX = "school3d-code-v1-"
export const MAX_PLAYERS = 5
export const MIN_PLAYERS = 2
export const SEARCH_SECONDS = 25

/** Как часто шлём своё положение и учительницу. */
export const STATE_HZ = 14
export const TEACHER_HZ = 14

export interface LobbyMember {
	id: string
	name: string
	searching: boolean
	playing: boolean
	since: number
}

export interface MatchPlayer {
	id: string
	name: string
	index: number
}

export interface MatchInfo {
	room: string
	host: string
	players: MatchPlayer[]
	/** Через сколько миллисекунд после получения начинать кат-сцену. */
	startIn: number
}

export interface ChatMessage {
	name: string
	text: string
	system: boolean
}

export type SessionPhase = "idle" | "connecting" | "lobby" | "searching" | "found" | "match"

export interface SessionEvents {
	onPhase?: (phase: SessionPhase, detail?: string) => void
	onRoster?: (members: LobbyMember[]) => void
	onCountdown?: (secondsLeft: number, found: number) => void
	onAlone?: () => void
	onMatch?: (info: MatchInfo) => void
	onChat?: (message: ChatMessage) => void
}

function cleanName(raw: string): string {
	const text = raw.replace(/\s+/g, " ").trim().slice(0, 14)
	return text.length > 0 ? text : "Игрок"
}

export class OnlineSession {
	readonly id: string
	name: string
	phase: SessionPhase = "idle"
	match: MatchInfo | null = null
	room: NetChannel | null = null

	private lobby: NetChannel | null = null
	private searchStart = 0
	private members: LobbyMember[] = []
	private tick = 0
	private lastCountdown = -1
	private alonePinged = false
	private codeRoom = ""
	private codeHost = false

	constructor(
		readonly client: NetClient,
		name: string,
		private readonly events: SessionEvents = {},
	) {
		this.id = client.id
		this.name = cleanName(name)
	}

	get ping(): number {
		return this.client.ping
	}

	get roster(): LobbyMember[] {
		return this.members
	}

	get searchers(): LobbyMember[] {
		return this.members
			.filter((member) => member.searching && !member.playing)
			.sort((a, b) => (a.since === b.since ? (a.id < b.id ? -1 : 1) : a.since - b.since))
	}

	get isHost(): boolean {
		return this.match ? this.match.host === this.id : false
	}

	get isCodeRoom(): boolean {
		return this.codeRoom.length > 0
	}

	get isCodeHost(): boolean {
		return this.isCodeRoom && this.codeHost
	}

	private setPhase(phase: SessionPhase, detail?: string): void {
		if (this.phase === phase && !detail) return
		this.phase = phase
		this.events.onPhase?.(phase, detail)
	}

	/** Подключиться и зайти в лобби. */
	async enter(lobbyName = LOBBY_NAME): Promise<boolean> {
		this.setPhase("connecting")
		const ok = await this.client.connect()
		if (!ok) {
			this.setPhase("idle", this.client.lastError || "Не вышло подключиться к серверу")
			return false
		}
		const lobby = this.client.channel(lobbyName)
		this.lobby = lobby
		lobby.onPresence(() => this.readPresence())
		lobby.on("match", (payload) => this.handleMatch(payload))
		this.publish()
		const joined = await Promise.race([
			lobby.ready(),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
		])
		if (!joined) {
			lobby.leave()
			this.lobby = null
			this.setPhase("idle", this.client.lastError || "Сервер не подтвердил вход в онлайн-комнату")
			return false
		}
		this.setPhase("lobby")
		return true
	}

	async enterCodeRoom(code: string, asHost: boolean): Promise<boolean> {
		this.codeRoom = code
		this.codeHost = asHost
		const ok = await this.enter(`${CODE_ROOM_PREFIX}${code}`)
		if (ok) this.startSearch()
		return ok
	}

	setName(raw: string): void {
		this.name = cleanName(raw)
		this.publish()
	}

	private publish(): void {
		this.lobby?.track({
			id: this.id,
			name: this.name,
			searching: this.phase === "searching" || this.phase === "found",
			playing: this.phase === "match",
			since: this.searchStart,
		})
	}

	private readPresence(): void {
		const list: LobbyMember[] = []
		for (const meta of this.lobby?.presence().values() ?? []) {
			const id = typeof meta.id === "string" ? meta.id : ""
			if (!id) continue
			list.push({
				id,
				name: typeof meta.name === "string" ? meta.name : "Игрок",
				searching: Boolean(meta.searching),
				playing: Boolean(meta.playing),
				since: typeof meta.since === "number" ? meta.since : 0,
			})
		}
		this.members = list
		this.events.onRoster?.(list)
	}

	/** Начать поиск игроков. */
	startSearch(): void {
		if (this.phase === "match") return
		this.searchStart = Date.now()
		this.alonePinged = false
		this.setPhase("searching")
		this.publish()
	}

	cancelSearch(): void {
		if (this.phase !== "searching" && this.phase !== "found") return
		this.searchStart = 0
		this.setPhase("lobby")
		this.publish()
	}

	/** Вызывается каждый кадр панели онлайна. */
	update(dt: number): void {
		if (this.phase !== "searching") return
		this.tick += dt
		const elapsed = (Date.now() - this.searchStart) / 1000
		const left = Math.max(0, Math.ceil(SEARCH_SECONDS - elapsed))
		const found = this.searchers.length
		if (left !== this.lastCountdown) {
			this.lastCountdown = left
			this.events.onCountdown?.(left, found)
		}
		if (this.tick < 0.4) return
		this.tick = 0
		if (this.isCodeRoom) return
		this.evaluate(elapsed)
	}

	startCodeMatch(): boolean {
		if (!this.isCodeHost || this.phase !== "searching") return false
		const group = this.searchers.slice(0, MAX_PLAYERS)
		if (group.length < MIN_PLAYERS) return false
		const info: MatchInfo = {
			room: `school3d-room-${this.codeRoom}-${randomId()}`,
			host: this.id,
			players: group.map((member, index) => ({ id: member.id, name: member.name, index })),
			startIn: 3200,
		}
		this.lobby?.send("match", info as unknown as NetPayload)
		return true
	}

	private evaluate(elapsed: number): void {
		const searchers = this.searchers
		const host = searchers[0]
		if (!host || host.id !== this.id) return
		const group = searchers.slice(0, MAX_PLAYERS)
		const full = group.length >= MAX_PLAYERS
		const ready = elapsed >= SEARCH_SECONDS && group.length >= MIN_PLAYERS
		if (!full && !ready) {
			if (elapsed >= SEARCH_SECONDS && !this.alonePinged) {
				// Никого не нашли — говорим об этом и ждём дальше.
				this.alonePinged = true
				this.searchStart = Date.now()
				this.events.onAlone?.()
			}
			return
		}
		const info: MatchInfo = {
			room: `school3d-room-${randomId()}`,
			host: this.id,
			players: group.map((member, index) => ({ id: member.id, name: member.name, index })),
			startIn: 3200,
		}
		this.lobby?.send("match", info as unknown as NetPayload)
	}

	private handleMatch(payload: NetPayload): void {
		if (this.phase === "match" || this.phase === "found") return
		const room = typeof payload.room === "string" ? payload.room : ""
		const host = typeof payload.host === "string" ? payload.host : ""
		const rawPlayers = Array.isArray(payload.players) ? payload.players : []
		const players: MatchPlayer[] = []
		for (const item of rawPlayers) {
			const entry = item as Partial<MatchPlayer>
			if (typeof entry.id !== "string") continue
			players.push({
				id: entry.id,
				name: typeof entry.name === "string" ? entry.name : "Игрок",
				index: typeof entry.index === "number" ? entry.index : players.length,
			})
		}
		if (!room || !players.some((player) => player.id === this.id)) return
		const info: MatchInfo = {
			room,
			host,
			players,
			startIn: typeof payload.startIn === "number" ? payload.startIn : 3200,
		}
		this.match = info
		this.setPhase("found")
		this.joinRoom(info)
		this.events.onMatch?.(info)
	}

	private joinRoom(info: MatchInfo): void {
		const channel = this.client.channel(info.room)
		this.room = channel
		channel.track({ id: this.id, name: this.name })
		channel.on("c", (payload) => {
			const text = typeof payload.m === "string" ? payload.m : ""
			if (!text) return
			this.events.onChat?.({
				name: typeof payload.n === "string" ? payload.n : "Игрок",
				text,
				system: Boolean(payload.s),
			})
		})
		this.setPhase("match")
		this.publish()
	}

	/** Сообщение в чат матча. */
	sendChat(text: string): void {
		const message = text.replace(/\s+/g, " ").trim().slice(0, 90)
		if (!message) return
		this.room?.send("c", { n: this.name, m: message, i: this.id })
	}

	sendSystem(text: string): void {
		this.room?.send("c", { n: "", m: text, s: 1, i: this.id })
	}

	leaveMatch(): void {
		if (this.room) {
			this.room.send("bye", { i: this.id })
			this.room.leave()
			this.room = null
		}
		this.match = null
		this.searchStart = 0
		this.setPhase(this.lobby ? "lobby" : "idle")
		this.publish()
	}

	leave(): void {
		this.leaveMatch()
		if (this.lobby) {
			this.lobby.leave()
			this.lobby = null
		}
		this.codeRoom = ""
		this.codeHost = false
		this.setPhase("idle")
		this.client.close()
	}
}
