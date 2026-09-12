/** Панель онлайна: случайный подбор или приватная комната по коду. */
import { isMockMode, LoopbackClient, RealtimeClient } from "../net/realtime.js"
import type { NetClient } from "../net/realtime.js"
import { MAX_PLAYERS, MIN_PLAYERS, OnlineSession, SEARCH_SECONDS } from "../net/session.js"
import type { LobbyMember, MatchInfo } from "../net/session.js"
import { onlineSkinFor } from "../net/remote.js"
import { requireElement, setHidden, setText } from "./dom.js"
import { DIFFICULTY_PRESETS, difficultyOf, type Difficulty } from "../game/difficulty.js"

const NAME_KEY = "school3d.name.v1"
const OWNER_KEY = "school3d.owner.v1"
const OWNER_NAME = "goh"
const OWNER_SETUP_HASH = "244c2a71139c6d6ba5b51cdcc5ce6fbed99013747dc89b14acdf41716bbac17d"
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
type OnlineMode = "random" | "code"

export interface OnlinePanelCallbacks {
	onMatch: (session: OnlineSession, match: MatchInfo) => void
	onBack: () => void
	onClick: () => void
	onSolo: () => void
}

function storedName(): string { try { return localStorage.getItem(NAME_KEY) ?? "" } catch { return "" } }
function rememberName(name: string): void { try { localStorage.setItem(NAME_KEY, name) } catch { /* ignore */ } }
function storedOwnerToken(): string { try { return localStorage.getItem(OWNER_KEY) ?? "" } catch { return "" } }
function rememberOwnerToken(token: string): void { try { localStorage.setItem(OWNER_KEY, token) } catch { /* ignore */ } }
function cleanUserName(raw: string): string { return raw.replace(/\s+/g, " ").trim().slice(0, 14) }
function isOwnerName(raw: string): boolean { return raw.normalize("NFKC").replace(/\s+/g, "").toLowerCase() === OWNER_NAME }
async function sha256(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
function roomCode(): string {
	const bytes = new Uint8Array(6)
	crypto.getRandomValues(bytes)
	return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("")
}
function cleanCode(raw: string): string { return raw.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6) }

export class OnlinePanel {
	private readonly nameInput = requireElement("online-name") as HTMLInputElement
	private readonly nameSaveButton = requireElement("online-name-save") as HTMLButtonElement
	private readonly ownerBadge = requireElement("online-owner-badge")
	private readonly startButton = requireElement("online-start") as HTMLButtonElement
	private readonly createRoomButton = requireElement("online-create-room") as HTMLButtonElement
	private readonly joinRoomButton = requireElement("online-join-room") as HTMLButtonElement
	private readonly roomStartButton = requireElement("online-room-start") as HTMLButtonElement
	private readonly cancelButton = requireElement("online-cancel") as HTMLButtonElement
	private readonly soloButton = requireElement("online-solo") as HTMLButtonElement
	private readonly randomModeButton = requireElement("online-mode-random") as HTMLButtonElement
	private readonly codeModeButton = requireElement("online-mode-code") as HTMLButtonElement
	private readonly codeBox = requireElement("online-code-box")
	private readonly codeSetup = requireElement("online-code-setup")
	private readonly codeCard = requireElement("online-code-card")
	private readonly roomCodeInput = requireElement("online-room-code") as HTMLInputElement
	private readonly codeValue = requireElement("online-code-value")
	private readonly copyCodeButton = requireElement("online-copy-code") as HTMLButtonElement
	private readonly statusEl = requireElement("online-status")
	private readonly hintEl = requireElement("online-hint")
	private readonly pingEl = requireElement("online-ping")
	private readonly loader = requireElement("online-loader")
	private readonly ring = requireElement("online-ring")
	private readonly ringLabel = requireElement("online-ring-label")
	private readonly rosterEl = requireElement("online-roster")
	private readonly searchBox = requireElement("online-search")
	private readonly diffChips = Array.from(
		document.querySelectorAll<HTMLButtonElement>("#online-difficulty [data-diff]"),
	)
	private readonly diffNote = requireElement("online-diff-note")
	private readonly actChips = [
		requireElement("online-act-1"),
		requireElement("online-act-2"),
	]
	private difficulty: Difficulty = "normal"
	private act: 1 | 2 = 1
	private session: OnlineSession | null = null
	private client: NetClient | null = null
	private readonly mock = isMockMode()
	private mode: OnlineMode = "random"
	private activeCode = ""
	private codeHost = false
	private raf = 0
	private lastFrame = 0
	private startAt = 0
	private pending: MatchInfo | null = null
	private ringValue = 0
	private savedName = storedName()
	private ownerAccess = false

	constructor(private readonly callbacks: OnlinePanelCallbacks) {
		this.nameInput.value = this.savedName
		void this.initOwner()
		this.nameInput.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") { if (this.profileSaved) this.startSearch(); else this.saveProfile() } })
		this.nameInput.addEventListener("keyup", (event) => event.stopPropagation())
		this.nameInput.addEventListener("input", () => { setText(this.nameSaveButton, "Сохранить"); setHidden(this.ownerBadge, true); this.refreshButtons() })
		this.nameSaveButton.addEventListener("click", () => { this.callbacks.onClick(); this.saveProfile() })
		this.roomCodeInput.addEventListener("input", () => { this.roomCodeInput.value = cleanCode(this.roomCodeInput.value) })
		this.roomCodeInput.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") void this.joinCodeRoom() })
		this.randomModeButton.addEventListener("click", () => this.switchMode("random"))
		this.codeModeButton.addEventListener("click", () => this.switchMode("code"))
		this.createRoomButton.addEventListener("click", () => void this.createCodeRoom())
		this.joinRoomButton.addEventListener("click", () => void this.joinCodeRoom())
		this.copyCodeButton.addEventListener("click", () => void this.copyCode())
		this.roomStartButton.addEventListener("click", () => { this.callbacks.onClick(); if (!this.session?.startCodeMatch()) this.setStatus("Нужен ещё игрок", "Друг должен войти по коду комнаты.") })
		this.startButton.addEventListener("click", () => { this.callbacks.onClick(); this.startSearch() })
		this.cancelButton.addEventListener("click", () => {
			this.callbacks.onClick()
			if (this.mode === "code") { this.leaveSession(); this.showCodeSetup(); this.setStatus("Комната закрыта", "Можно создать новую или войти по коду.") }
			else { this.session?.cancelSearch(); this.setStatus("Поиск отменён", "Можно попробовать снова.") }
			this.refreshButtons()
		})
		this.soloButton.addEventListener("click", () => { this.callbacks.onClick(); this.session?.cancelSearch(); this.callbacks.onSolo() })
		for (const chip of this.diffChips) {
			chip.addEventListener("click", () => this.chooseDifficulty(chip.dataset.diff ?? "normal"))
		}
		this.actChips[0]?.addEventListener("click", () => this.chooseAct(1))
		this.actChips[1]?.addEventListener("click", () => this.chooseAct(2))
		this.renderDifficulty()
		this.renderAct()
		requireElement("online-back").addEventListener("click", () => { this.callbacks.onClick(); this.leaveSession(); this.callbacks.onBack() })
	}

	get isSearching(): boolean { return this.session?.phase === "searching" }
	private get profileSaved(): boolean { return this.savedName.length >= 2 && cleanUserName(this.nameInput.value) === this.savedName }
	private get ownerActive(): boolean { return this.ownerAccess && isOwnerName(this.savedName) }
	open(): void { setHidden(this.soloButton, true); this.switchMode("random", false); this.renderDifficulty(); this.startLoop() }

	/** Сложность из общих настроек: в онлайне она же идёт по умолчанию. */
	setSoloDifficulty(value: string): void {
		this.difficulty = difficultyOf(value)
		this.session?.setDifficulty(this.difficulty)
		this.renderDifficulty()
	}

	/** Выбор акта для общего забега: его раздаёт хост. */
	private chooseAct(act: 1 | 2): void {
		this.callbacks.onClick()
		this.act = act
		this.session?.setAct(act)
		this.renderAct()
	}

	private renderAct(): void {
		this.actChips.forEach((chip, index) => {
			const active = index + 1 === this.act
			chip.classList.toggle("act-chip--active", active)
			chip.setAttribute("aria-selected", String(active))
		})
	}

	private chooseDifficulty(raw: string): void {
		this.callbacks.onClick()
		this.difficulty = difficultyOf(raw)
		this.session?.setDifficulty(this.difficulty)
		this.renderDifficulty()
	}

	/** В чужой комнате сложность только показываем: её выбирает создатель. */
	private renderDifficulty(): void {
		const locked = this.mode === "code" && this.activeCode.length > 0 && !this.codeHost
		for (const chip of this.diffChips) {
			const active = chip.dataset.diff === this.difficulty
			chip.classList.toggle("diff-chip--active", active)
			chip.setAttribute("aria-selected", String(active))
			chip.disabled = locked
		}
		const preset = DIFFICULTY_PRESETS[this.difficulty]
		setText(
			this.diffNote,
			locked
				? "Сложность выбирает создатель комнаты."
				: `${preset.note} Жизней: ${preset.lives}.`,
		)
	}
	close(): void { this.stopLoop() }
	reset(): void { this.leaveSession(); this.pending = null; this.startAt = 0; this.loader.dataset.mode = "idle"; this.rosterEl.replaceChildren(); this.showCodeSetup(); this.setStatus("Готовы к следующей игре", "Выберите случайную игру или комнату по коду."); this.refreshButtons() }

	private switchMode(mode: OnlineMode, click = true): void {
		if (click) this.callbacks.onClick()
		if (this.mode !== mode) this.leaveSession()
		this.mode = mode
		this.randomModeButton.classList.toggle("online__mode--active", mode === "random")
		this.codeModeButton.classList.toggle("online__mode--active", mode === "code")
		this.randomModeButton.setAttribute("aria-selected", String(mode === "random"))
		this.codeModeButton.setAttribute("aria-selected", String(mode === "code"))
		setHidden(this.codeBox, mode !== "code"); setHidden(this.startButton, mode !== "random"); setHidden(this.roomStartButton, true); setHidden(this.cancelButton, true); setHidden(this.soloButton, true); setHidden(this.searchBox, true)
		this.loader.dataset.mode = "idle"; this.rosterEl.replaceChildren()
		if (mode === "random") { this.setStatus("Случайная игра", "Введите имя и нажмите «Начать игру онлайн».") }
		else { this.showCodeSetup(); this.setStatus("Комната по коду", "Создайте комнату или введите код друга.") }
		if (!this.profileSaved) this.setStatus("Регистрация", "Введите имя и нажмите «Сохранить». Это всё — пароль не нужен.")
		this.refreshButtons()
	}

	private makeClient(): NetClient { return this.mock ? new LoopbackClient(35) : new RealtimeClient() }
	private makeSession(client: NetClient): OnlineSession {
		const session = new OnlineSession(client, this.savedName || "Игрок", {
			onPhase: (phase, detail) => { if (phase === "connecting") this.loader.dataset.mode = "connect"; if (detail) this.setStatus(detail, ""); this.refreshButtons() },
			onRoster: (members) => this.renderRoster(members),
			onCountdown: (left, found) => this.onCountdown(left, found),
			onAlone: () => { if (this.mode === "random") { setHidden(this.soloButton, false); this.setStatus("Пока никого нет…", "Продолжаем искать. Можно начать одному или позвать друга.") } },
			onMatch: (info) => this.onMatchFound(info),
		}, this.ownerActive)
		// Сложность уезжает вместе с матчем, если мы окажемся хостом.
		session.setDifficulty(this.difficulty)
		session.setAct(this.act)
		return session
	}

	private async ensureRandomSession(): Promise<void> {
		if (this.mode !== "random") return
		if (!this.session) { this.client = this.makeClient(); this.session = this.makeSession(this.client) }
		if (this.session.phase !== "idle") { this.refreshButtons(); return }
		this.loader.dataset.mode = "connect"
		if (!(await this.session.enter())) { this.showConnectionError(); return }
		this.loader.dataset.mode = "idle"; this.setStatus("Сеть на связ��", "Введите имя и начните случайный поиск."); this.refreshButtons()
	}

	private async createCodeRoom(): Promise<void> { if (this.validName()) await this.enterCodeRoom(roomCode(), true) }
	private async joinCodeRoom(): Promise<void> {
		if (!this.validName()) return
		const code = cleanCode(this.roomCodeInput.value)
		if (code.length !== 6) { this.setStatus("Неверный код", "Введите все 6 символов кода комнаты."); this.roomCodeInput.focus(); return }
		await this.enterCodeRoom(code, false)
	}
	private async enterCodeRoom(code: string, asHost: boolean): Promise<void> {
		this.callbacks.onClick(); this.leaveSession(); this.activeCode = code; this.codeHost = asHost
		this.client = this.makeClient(); this.session = this.makeSession(this.client); this.loader.dataset.mode = "connect"; this.showCodeCard(code)
		this.setStatus(asHost ? "Создаём комнату…" : "Входим в комнату…", `Код ${code}`)
		if (!(await this.session.enterCodeRoom(code, asHost))) { this.showConnectionError(); this.showCodeSetup(); return }
		this.loader.dataset.mode = "search"; setHidden(this.searchBox, false); setHidden(this.cancelButton, false); setHidden(this.roomStartButton, !asHost)
		this.setStatus(asHost ? `Комната ${code} создана` : `Вы в комнате ${code}`, asHost ? "Отправьте код друзьям. Выберите сложность и запустите игру." : "Ждём, когда создатель комнаты запустит игру.")
		this.renderDifficulty()
		this.refreshButtons()
	}

	private startSearch(): void {
		if (this.mode !== "random" || !this.validName()) return
		if (!this.session || this.session.phase === "idle") { void this.ensureRandomSession().then(() => { if (this.session?.phase === "lobby") this.startSearch() }); return }
		if (this.session.phase === "connecting") { this.setStatus("Ещё подключаемся…", "Секундочку."); return }
		this.session.setName(this.nameInput.value.trim()); this.session.startSearch(); this.loader.dataset.mode = "search"; setHidden(this.searchBox, false); setHidden(this.soloButton, true)
		this.setStatus("Собираем игроков…", `Максимум ${MAX_PLAYERS}. Начнём раньше, если комната заполнится.`); this.refreshButtons()
	}
	private validName(): boolean {
		if (this.profileSaved) return true
		this.setStatus("Сначала сохраните имя", "Введите имя и нажмите кнопку «Сохранить».")
		this.nameInput.focus()
		return false
	}
	private saveProfile(): boolean {
		const name = cleanUserName(this.nameInput.value)
		if (name.length < 2) { this.setStatus("Нужно имя", "Минимум 2 символа."); this.nameInput.focus(); return false }
		if (isOwnerName(name) && !this.ownerAccess) {
			this.setStatus("Имя goh занято", "Это имя навсегда закреплено за создателем игры.")
			this.nameInput.select()
			return false
		}
		this.savedName = name
		this.nameInput.value = name
		rememberName(name)
		this.session?.setName(name)
		setText(this.nameSaveButton, "Сохранено")
		setHidden(this.ownerBadge, !this.ownerActive)
		this.setStatus(this.ownerActive ? "Профиль создателя сохранён" : "Имя сохранено", "Теперь можно заходить в онлайн.")
		this.refreshButtons()
		return true
	}
	private async initOwner(): Promise<void> {
		let token = storedOwnerToken()
		const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""))
		const candidate = hashParams.get("owner") ?? ""
		try {
			if (candidate && await sha256(candidate) === OWNER_SETUP_HASH) {
				token = candidate
				rememberOwnerToken(candidate)
				history.replaceState(null, "", `${location.pathname}${location.search}`)
			}
			this.ownerAccess = Boolean(token) && await sha256(token) === OWNER_SETUP_HASH
		} catch { this.ownerAccess = false }
		setHidden(this.ownerBadge, !(this.ownerAccess && isOwnerName(this.savedName)))
		this.refreshButtons()
	}
	private showConnectionError(): void { this.loader.dataset.mode = "error"; this.setStatus("Сервер не отвечает", `${this.client?.lastError || "Не вышло подключиться"}. Попробуйте ещё раз.`); this.refreshButtons() }

	private onCountdown(left: number, found: number): void {
		if (this.mode === "code") {
			this.ringValue = Math.min(1, found / MAX_PLAYERS); setText(this.ringLabel, `${found}`)
			this.setStatus(`Комната ${this.activeCode} · игроков: ${found}`, this.codeHost ? (found >= MIN_PLAYERS ? "Можно запускать игру." : "Отправьте код другу и дождитесь подключения.") : "Ждём запуска создателем комнаты.")
			this.refreshButtons(); return
		}
		this.ringValue = 1 - left / SEARCH_SECONDS; setText(this.ringLabel, `${left}`)
		const word = found === 1 ? "игрок" : found < 5 ? "игрока" : "игроков"; this.setStatus("Собираем игроков…", `В очереди ${found} ${word} из ${MAX_PLAYERS}`)
	}
	private onMatchFound(info: MatchInfo): void {
		this.pending = info; this.loader.dataset.mode = "found"; const lag = Math.min(400, Math.round((this.session?.ping ?? 0) / 2)); this.startAt = performance.now() + Math.max(900, info.startIn - lag)
		this.difficulty = difficultyOf(info.difficulty)
		this.renderDifficulty()
		this.setStatus("Матч найден!", `Игроков: ${info.players.length} · сложность: ${DIFFICULTY_PRESETS[this.difficulty].short}. Заходим в школу…`); this.renderMatchRoster(info); setHidden(this.soloButton, true); setHidden(this.roomStartButton, true); this.refreshButtons()
	}
	private renderRoster(members: LobbyMember[]): void {
		if (this.pending) return
		const searching = members.filter((member) => member.searching && !member.playing); this.rosterEl.replaceChildren()
		searching.slice(0, MAX_PLAYERS).forEach((member, index) => this.rosterEl.append(this.rosterRow(member.name, index, member.skin, member.id === this.session?.id, member.owner)))
		for (let i = searching.length; i < MAX_PLAYERS; i += 1) { const empty = document.createElement("div"); empty.className = "online-slot online-slot--empty"; empty.textContent = "свободно"; this.rosterEl.append(empty) }
		this.refreshButtons()
	}
	private renderMatchRoster(info: MatchInfo): void { this.rosterEl.replaceChildren(); for (const player of info.players) this.rosterEl.append(this.rosterRow(player.name, player.index, player.skin, player.id === this.session?.id, player.owner)) }
	private rosterRow(name: string, index: number, skin: number, self: boolean, owner: boolean): HTMLElement { const row = document.createElement("div"); row.className = `${self ? "online-slot online-slot--me" : "online-slot"}${owner ? " online-slot--owner" : ""}`; const dot = document.createElement("i"); dot.style.background = onlineSkinFor(skin, index).tag; const label = document.createElement("span"); label.textContent = self ? `${name} (вы)` : name; row.append(dot); if (owner) { const mark = document.createElement("b"); mark.className = "creator-emblem creator-emblem--small"; mark.title = "Официальный создатель игры"; row.append(mark) } row.append(label); return row }
	private showCodeSetup(): void { this.activeCode = ""; this.codeHost = false; this.renderDifficulty(); setHidden(this.codeSetup, false); setHidden(this.codeCard, true); setHidden(this.roomStartButton, true); setHidden(this.cancelButton, true); setHidden(this.searchBox, true) }
	private showCodeCard(code: string): void { setText(this.codeValue, code); setHidden(this.codeSetup, true); setHidden(this.codeCard, false) }
	private async copyCode(): Promise<void> { if (!this.activeCode) return; try { await navigator.clipboard.writeText(this.activeCode); setText(this.copyCodeButton, "Скопировано"); setTimeout(() => setText(this.copyCodeButton, "Копировать"), 1400) } catch { this.setStatus(`Код комнаты: ${this.activeCode}`, "Выделите код и отправьте его друзьям.") } }
	private setStatus(title: string, hint: string): void { setText(this.statusEl, title); setText(this.hintEl, hint) }
	private refreshButtons(): void { const phase = this.session?.phase ?? "idle"; const searching = phase === "searching"; const busy = phase === "connecting" || phase === "found" || phase === "match"; const noProfile = !this.profileSaved; this.startButton.disabled = noProfile || this.mode !== "random" || searching || busy; this.createRoomButton.disabled = noProfile || busy; this.joinRoomButton.disabled = noProfile || busy; this.roomStartButton.disabled = !this.codeHost || (this.session?.searchers.length ?? 0) < MIN_PLAYERS || phase !== "searching"; if (this.mode === "random") setHidden(this.cancelButton, !searching) }
	private startLoop(): void { if (this.raf) return; this.lastFrame = performance.now(); const step = (now: number): void => { this.raf = requestAnimationFrame(step); const dt = Math.min(0.25, (now - this.lastFrame) / 1000); this.lastFrame = now; this.frame(dt, now) }; this.raf = requestAnimationFrame(step) }
	private stopLoop(): void { if (!this.raf) return; cancelAnimationFrame(this.raf); this.raf = 0 }
	private frame(dt: number, now: number): void {
		const session = this.session; if (!session) return; session.update(dt)
		const ping = session.ping
		const quality = ping <= 0 ? "wait" : ping < 180 ? "good" : ping < 500 ? "ok" : "bad"
		setText(this.pingEl, ping > 0 ? `${ping} мс` : "—")
		this.pingEl.dataset.q = quality
		if (session.phase === "searching") this.ring.style.setProperty("--fill", `${Math.round(this.ringValue * 360)}deg`)
		else if (this.pending) { const left = Math.max(0, this.startAt - now); setText(this.ringLabel, `${Math.ceil(left / 1000)}`); this.ring.style.setProperty("--fill", "360deg"); if (left <= 0) { const info = this.pending; this.pending = null; this.stopLoop(); this.callbacks.onMatch(session, info) } }
	}
	private leaveSession(): void { this.session?.leave(); this.session = null; this.client = null; this.pending = null }
	dispose(): void { this.stopLoop(); this.leaveSession() }
}
