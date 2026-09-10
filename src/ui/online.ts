/** Панель онлайна: случайный подбор или приватная комната по коду. */
import { isMockMode, LoopbackClient, RealtimeClient } from "../net/realtime.js"
import type { NetClient } from "../net/realtime.js"
import { MAX_PLAYERS, MIN_PLAYERS, OnlineSession, SEARCH_SECONDS } from "../net/session.js"
import type { LobbyMember, MatchInfo } from "../net/session.js"
import { skinFor } from "../net/remote.js"
import { requireElement, setHidden, setText } from "./dom.js"

const NAME_KEY = "school3d.name.v1"
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
function roomCode(): string {
	const bytes = new Uint8Array(6)
	crypto.getRandomValues(bytes)
	return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("")
}
function cleanCode(raw: string): string { return raw.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6) }

export class OnlinePanel {
	private readonly nameInput = requireElement("online-name") as HTMLInputElement
	private readonly startButton = requireElement("online-start") as HTMLButtonElement
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

	constructor(private readonly callbacks: OnlinePanelCallbacks) {
		this.nameInput.value = storedName()
		this.nameInput.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") this.startSearch() })
		this.nameInput.addEventListener("keyup", (event) => event.stopPropagation())
		this.nameInput.addEventListener("input", () => { const name = this.nameInput.value.trim(); rememberName(name); this.session?.setName(name); this.refreshButtons() })
		this.roomCodeInput.addEventListener("input", () => { this.roomCodeInput.value = cleanCode(this.roomCodeInput.value) })
		this.roomCodeInput.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") void this.joinCodeRoom() })
		this.randomModeButton.addEventListener("click", () => this.switchMode("random"))
		this.codeModeButton.addEventListener("click", () => this.switchMode("code"))
		requireElement("online-create-room").addEventListener("click", () => void this.createCodeRoom())
		requireElement("online-join-room").addEventListener("click", () => void this.joinCodeRoom())
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
		requireElement("online-back").addEventListener("click", () => { this.callbacks.onClick(); this.leaveSession(); this.callbacks.onBack() })
	}

	get isSearching(): boolean { return this.session?.phase === "searching" }
	open(): void { setHidden(this.soloButton, true); this.switchMode("random", false); this.startLoop(); void this.ensureRandomSession() }
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
		if (mode === "random") { this.setStatus("Подключаемся к серверу…", "Затем можно искать случайных игроков."); void this.ensureRandomSession() }
		else { this.showCodeSetup(); this.setStatus("Комната по коду", "Создайте комнату или введите код друга.") }
		this.refreshButtons()
	}

	private makeClient(): NetClient { return this.mock ? new LoopbackClient(35) : new RealtimeClient() }
	private makeSession(client: NetClient): OnlineSession {
		return new OnlineSession(client, this.nameInput.value.trim() || "Игрок", {
			onPhase: (phase, detail) => { if (phase === "connecting") this.loader.dataset.mode = "connect"; if (detail) this.setStatus(detail, ""); this.refreshButtons() },
			onRoster: (members) => this.renderRoster(members),
			onCountdown: (left, found) => this.onCountdown(left, found),
			onAlone: () => { if (this.mode === "random") { setHidden(this.soloButton, false); this.setStatus("Пока никого нет…", "Продолжаем искать. Можно начать одному или позвать друга.") } },
			onMatch: (info) => this.onMatchFound(info),
		})
	}

	private async ensureRandomSession(): Promise<void> {
		if (this.mode !== "random") return
		if (!this.session) { this.client = this.makeClient(); this.session = this.makeSession(this.client) }
		if (this.session.phase !== "idle") { this.refreshButtons(); return }
		this.loader.dataset.mode = "connect"
		if (!(await this.session.enter())) { this.showConnectionError(); return }
		this.loader.dataset.mode = "idle"; this.setStatus("Сеть на связи", "Введите имя и начните случайный поиск."); this.refreshButtons()
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
		this.setStatus(asHost ? `Комната ${code} создана` : `Вы в комнате ${code}`, asHost ? "Отправьте код друзьям. Когда они войдут, запустите игру." : "Ждём, когда создатель комнаты запустит игру.")
		this.refreshButtons()
	}

	private startSearch(): void {
		if (this.mode !== "random" || !this.validName()) return
		if (!this.session || this.session.phase === "idle") { void this.ensureRandomSession().then(() => { if (this.session?.phase === "lobby") this.startSearch() }); return }
		if (this.session.phase === "connecting") { this.setStatus("Ещё подключаемся…", "Секундочку."); return }
		this.session.setName(this.nameInput.value.trim()); this.session.startSearch(); this.loader.dataset.mode = "search"; setHidden(this.searchBox, false); setHidden(this.soloButton, true)
		this.setStatus("Собираем игроков…", `Максимум ${MAX_PLAYERS}. Начнём раньше, если комната заполнится.`); this.refreshButtons()
	}
	private validName(): boolean { const name = this.nameInput.value.trim(); if (name.length >= 2) { rememberName(name); return true }; this.setStatus("Нужно имя", "Минимум 2 символа."); this.nameInput.focus(); return false }
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
		this.setStatus("Матч найден!", `Игроков: ${info.players.length}. Заходим в школу…`); this.renderMatchRoster(info); setHidden(this.soloButton, true); setHidden(this.roomStartButton, true); this.refreshButtons()
	}
	private renderRoster(members: LobbyMember[]): void {
		if (this.pending) return
		const searching = members.filter((member) => member.searching && !member.playing); this.rosterEl.replaceChildren()
		searching.slice(0, MAX_PLAYERS).forEach((member, index) => this.rosterEl.append(this.rosterRow(member.name, index, member.id === this.session?.id)))
		for (let i = searching.length; i < MAX_PLAYERS; i += 1) { const empty = document.createElement("div"); empty.className = "online-slot online-slot--empty"; empty.textContent = "свободно"; this.rosterEl.append(empty) }
		this.refreshButtons()
	}
	private renderMatchRoster(info: MatchInfo): void { this.rosterEl.replaceChildren(); for (const player of info.players) this.rosterEl.append(this.rosterRow(player.name, player.index, player.id === this.session?.id)) }
	private rosterRow(name: string, index: number, self: boolean): HTMLElement { const row = document.createElement("div"); row.className = self ? "online-slot online-slot--me" : "online-slot"; const dot = document.createElement("i"); dot.style.background = skinFor(index).tag; const label = document.createElement("span"); label.textContent = self ? `${name} (вы)` : name; row.append(dot, label); return row }
	private showCodeSetup(): void { this.activeCode = ""; this.codeHost = false; setHidden(this.codeSetup, false); setHidden(this.codeCard, true); setHidden(this.roomStartButton, true); setHidden(this.cancelButton, true); setHidden(this.searchBox, true) }
	private showCodeCard(code: string): void { setText(this.codeValue, code); setHidden(this.codeSetup, true); setHidden(this.codeCard, false) }
	private async copyCode(): Promise<void> { if (!this.activeCode) return; try { await navigator.clipboard.writeText(this.activeCode); setText(this.copyCodeButton, "Скопировано"); setTimeout(() => setText(this.copyCodeButton, "Копировать"), 1400) } catch { this.setStatus(`Код комнаты: ${this.activeCode}`, "Выделите код и отправьте его друзьям.") } }
	private setStatus(title: string, hint: string): void { setText(this.statusEl, title); setText(this.hintEl, hint) }
	private refreshButtons(): void { const phase = this.session?.phase ?? "idle"; const searching = phase === "searching"; const busy = phase === "connecting" || phase === "found" || phase === "match"; this.startButton.disabled = this.mode !== "random" || searching || busy; this.roomStartButton.disabled = !this.codeHost || (this.session?.searchers.length ?? 0) < MIN_PLAYERS || phase !== "searching"; if (this.mode === "random") setHidden(this.cancelButton, !searching) }
	private startLoop(): void { if (this.raf) return; this.lastFrame = performance.now(); const step = (now: number): void => { this.raf = requestAnimationFrame(step); const dt = Math.min(0.25, (now - this.lastFrame) / 1000); this.lastFrame = now; this.frame(dt, now) }; this.raf = requestAnimationFrame(step) }
	private stopLoop(): void { if (!this.raf) return; cancelAnimationFrame(this.raf); this.raf = 0 }
	private frame(dt: number, now: number): void {
		const session = this.session; if (!session) return; session.update(dt)
		const ping = session.ping; setText(this.pingEl, ping > 0 ? `${ping} мс` : "—"); this.pingEl.dataset.q = ping <= 0 ? "wait" : ping < 90 ? "good" : ping < 200 ? "ok" : "bad"
		if (session.phase === "searching") this.ring.style.setProperty("--fill", `${Math.round(this.ringValue * 360)}deg`)
		else if (this.pending) { const left = Math.max(0, this.startAt - now); setText(this.ringLabel, `${Math.ceil(left / 1000)}`); this.ring.style.setProperty("--fill", "360deg"); if (left <= 0) { const info = this.pending; this.pending = null; this.stopLoop(); this.callbacks.onMatch(session, info) } }
	}
	private leaveSession(): void { this.session?.leave(); this.session = null; this.client = null; this.pending = null }
	dispose(): void { this.stopLoop(); this.leaveSession() }
}
