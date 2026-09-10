/**
 * Панель «Онлайн — бета» в главном меню.
 *
 * Шаги: имя → подключение (анимация загрузки) → поиск игроков (25 секунд,
 * максимум 5, хватит и двоих) → «Матч найден» → игра.
 * Пинг настоящий: RTT хартбита до Supabase Realtime.
 */

import { isMockMode, LoopbackClient, RealtimeClient } from "../net/realtime.js"
import type { NetClient } from "../net/realtime.js"
import { MAX_PLAYERS, OnlineSession, SEARCH_SECONDS } from "../net/session.js"
import type { LobbyMember, MatchInfo } from "../net/session.js"
import { skinFor } from "../net/remote.js"
import { requireElement, setHidden, setText } from "./dom.js"

const NAME_KEY = "school3d.name.v1"

export interface OnlinePanelCallbacks {
	/** Матч собран — запускаем игру. */
	onMatch: (session: OnlineSession, match: MatchInfo) => void
	/** Кнопка «Назад». */
	onBack: () => void
	/** Звук клика. */
	onClick: () => void
	/** Никого не нашлось — играем одни. */
	onSolo: () => void
}

function storedName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? ""
	} catch {
		return ""
	}
}

function rememberName(name: string): void {
	try {
		localStorage.setItem(NAME_KEY, name)
	} catch {
		// Приватный режим — не страшно.
	}
}

export class OnlinePanel {
	private readonly root = requireElement("menu-online")
	private readonly nameInput = requireElement("online-name") as HTMLInputElement
	private readonly startButton = requireElement("online-start") as HTMLButtonElement
	private readonly cancelButton = requireElement("online-cancel") as HTMLButtonElement
	private readonly soloButton = requireElement("online-solo") as HTMLButtonElement
	private readonly backButton = requireElement("online-back") as HTMLButtonElement
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
	/** ?netmock=1 — локальная сеть без интернета. */
	private readonly mock = isMockMode()
	private raf = 0
	private lastFrame = 0
	private visible = false
	private startAt = 0
	private pending: MatchInfo | null = null
	private ringValue = 0

	constructor(private readonly callbacks: OnlinePanelCallbacks) {
		this.nameInput.value = storedName()
		this.nameInput.addEventListener("keydown", (event: KeyboardEvent) => {
			event.stopPropagation()
			if (event.key === "Enter") this.startSearch()
		})
		this.nameInput.addEventListener("keyup", (event: KeyboardEvent) => event.stopPropagation())
		this.nameInput.addEventListener("input", () => {
			const name = this.nameInput.value.trim()
			rememberName(name)
			this.session?.setName(name)
			this.refreshButtons()
		})

		this.startButton.addEventListener("click", () => {
			this.callbacks.onClick()
			this.startSearch()
		})
		this.cancelButton.addEventListener("click", () => {
			this.callbacks.onClick()
			this.session?.cancelSearch()
			this.setStatus("Поиск отменён", "Можно попробовать снова в любой момент.")
			this.refreshButtons()
		})
		this.soloButton.addEventListener("click", () => {
			this.callbacks.onClick()
			this.session?.cancelSearch()
			this.callbacks.onSolo()
		})
		this.backButton.addEventListener("click", () => {
			this.callbacks.onClick()
			this.session?.cancelSearch()
			this.callbacks.onBack()
		})
	}

	get isSearching(): boolean {
		return this.session?.phase === "searching"
	}

	/** Открыть панель и сразу начать подключение. */
	open(): void {
		this.visible = true
		setHidden(this.soloButton, true)
		this.setStatus(
			this.mock ? "Локальная сеть (netmock)…" : "Подключаемся к серверу…",
			this.mock
				? "Видны только вкладки этого браузера и профиля."
				: "Первый вход занимает пару секунд.",
		)
		this.loader.dataset.mode = "connect"
		this.refreshButtons()
		void this.ensureSession()
		this.startLoop()
	}

	close(): void {
		this.visible = false
		this.stopLoop()
	}

	/** После выхода из матча вернуть панель в исходное состояние. */
	reset(): void {
		this.pending = null
		this.startAt = 0
		this.loader.dataset.mode = "idle"
		this.rosterEl.replaceChildren()
		setHidden(this.searchBox, true)
		setHidden(this.soloButton, true)
		this.setStatus("Готовы к следующей игре", "Нажмите «Начать игру онлайн».")
		this.refreshButtons()
	}

	private async ensureSession(): Promise<void> {
		if (this.session) {
			this.refreshButtons()
			return
		}
		const client: NetClient = this.mock ? new LoopbackClient(35) : new RealtimeClient()
		this.client = client
		const session = new OnlineSession(client, this.nameInput.value.trim() || "Игрок", {
			onPhase: (phase, detail) => this.onPhase(phase, detail),
			onRoster: (members) => this.renderRoster(members),
			onCountdown: (left, found) => this.onCountdown(left, found),
			onAlone: () => {
				setHidden(this.soloButton, false)
				this.setStatus(
					"Пока никого нет…",
					this.mock
						? "netmock видит только вкладки одного браузера и профиля. Для второго аккаунта или другого компьютера открой адрес без ?netmock=1."
						: "Продолжаем искать. Можно начать одному или позвать друга — вам нужен один и тот же сайт.",
				)
			},
			onMatch: (info) => this.onMatchFound(info),
		})
		this.session = session
		const ok = await session.enter()
		if (!ok) {
			this.loader.dataset.mode = "error"
			const reason = client.lastError
			this.setStatus(
				"Сервер не отвечает",
				reason
					? `${reason}. Офлайн-игра работает всегда.`
					: "Проверьте интернет и попробуйте снова — офлайн-игра работает всегда.",
			)
			this.refreshButtons()
			return
		}
		this.loader.dataset.mode = "idle"
		if (this.mock) {
			const linked = client.transport === "broadcast" || client.transport === "storage"
			this.setStatus(
				linked ? "Локальная сеть на связи" : "Локальная сеть только в этом окне",
				linked
					? "Открой вторую вкладку с тем же адресом — она появится в списке. Разные профили браузера так не видны."
					: "Браузер не дал связать вкладки. Для игры с другом открой адрес без ?netmock=1.",
			)
		} else {
			this.setStatus("Сеть на связи", "Придумайте имя и жмите «Начать игру онлайн».")
		}
		this.refreshButtons()
	}

	private startSearch(): void {
		const name = this.nameInput.value.trim()
		if (name.length < 2) {
			this.setStatus("Нужно имя", "Минимум 2 символа — оно будет висеть над вашим игроком.")
			this.nameInput.focus()
			return
		}
		rememberName(name)
		if (!this.session) {
			void this.ensureSession().then(() => {
				if (this.session?.phase === "lobby") this.startSearch()
			})
			return
		}
		if (this.session.phase === "connecting") {
			this.setStatus("Ещё подключаемся…", "Секундочку.")
			return
		}
		this.session.setName(name)
		this.session.startSearch()
		this.loader.dataset.mode = "search"
		setHidden(this.searchBox, false)
		setHidden(this.soloButton, true)
		this.setStatus("Собираем игроков…", `Максимум ${MAX_PLAYERS}. Начнём раньше, если комната заполнится.`)
		this.refreshButtons()
	}

	private onPhase(phase: string, detail?: string): void {
		if (phase === "connecting") this.loader.dataset.mode = "connect"
		if (detail) this.setStatus(detail, "")
		this.refreshButtons()
	}

	private onCountdown(left: number, found: number): void {
		this.ringValue = 1 - left / SEARCH_SECONDS
		setText(this.ringLabel, `${left}`)
		const word = found === 1 ? "игрок" : found < 5 ? "игрока" : "игроков"
		this.setStatus("Собираем игроков…", `В очереди ${found} ${word} из ${MAX_PLAYERS}`)
	}

	private onMatchFound(info: MatchInfo): void {
		this.pending = info
		this.loader.dataset.mode = "found"
		// Половина пинга — грубая, но честная поправка на задержку сети.
		const lag = Math.min(400, Math.round((this.session?.ping ?? 0) / 2))
		this.startAt = performance.now() + Math.max(900, info.startIn - lag)
		this.setStatus("Матч найден!", `Игроков: ${info.players.length}. Заходим в школу…`)
		this.renderMatchRoster(info)
		setHidden(this.soloButton, true)
		this.refreshButtons()
	}

	private renderRoster(members: LobbyMember[]): void {
		if (this.pending) return
		const searching = members.filter((member) => member.searching && !member.playing)
		this.rosterEl.replaceChildren()
		searching.slice(0, MAX_PLAYERS).forEach((member, index) => {
			this.rosterEl.append(this.rosterRow(member.name, index, member.id === this.session?.id))
		})
		for (let i = searching.length; i < MAX_PLAYERS; i += 1) {
			const empty = document.createElement("div")
			empty.className = "online-slot online-slot--empty"
			empty.textContent = "свободно"
			this.rosterEl.append(empty)
		}
	}

	private renderMatchRoster(info: MatchInfo): void {
		this.rosterEl.replaceChildren()
		for (const player of info.players) {
			this.rosterEl.append(this.rosterRow(player.name, player.index, player.id === this.session?.id))
		}
	}

	private rosterRow(name: string, index: number, self: boolean): HTMLElement {
		const row = document.createElement("div")
		row.className = self ? "online-slot online-slot--me" : "online-slot"
		const dot = document.createElement("i")
		dot.style.background = skinFor(index).tag
		const label = document.createElement("span")
		label.textContent = self ? `${name} (вы)` : name
		row.append(dot, label)
		return row
	}

	private setStatus(title: string, hint: string): void {
		setText(this.statusEl, title)
		setText(this.hintEl, hint)
	}

	private refreshButtons(): void {
		const phase = this.session?.phase ?? "idle"
		const searching = phase === "searching"
		const busy = phase === "connecting" || phase === "found" || phase === "match"
		this.startButton.disabled = searching || busy
		setHidden(this.cancelButton, !searching)
		setHidden(this.searchBox, !searching && phase !== "found")
	}

	private startLoop(): void {
		if (this.raf) return
		this.lastFrame = performance.now()
		const step = (now: number): void => {
			this.raf = requestAnimationFrame(step)
			const dt = Math.min(0.25, (now - this.lastFrame) / 1000)
			this.lastFrame = now
			this.frame(dt, now)
		}
		this.raf = requestAnimationFrame(step)
	}

	private stopLoop(): void {
		if (!this.raf) return
		cancelAnimationFrame(this.raf)
		this.raf = 0
	}

	private frame(dt: number, now: number): void {
		const session = this.session
		if (!session) return
		session.update(dt)

		const ping = session.ping
		setText(this.pingEl, ping > 0 ? `${ping} мс` : "—")
		this.pingEl.dataset.q = ping <= 0 ? "wait" : ping < 90 ? "good" : ping < 200 ? "ok" : "bad"

		if (session.phase === "searching") {
			this.ring.style.setProperty("--fill", `${Math.round(this.ringValue * 360)}deg`)
		} else if (this.pending) {
			const left = Math.max(0, this.startAt - now)
			setText(this.ringLabel, `${Math.ceil(left / 1000)}`)
			this.ring.style.setProperty("--fill", "360deg")
			if (left <= 0) {
				const info = this.pending
				this.pending = null
				this.stopLoop()
				this.callbacks.onMatch(session, info)
			}
		}
	}

	/** Полное отключение (например, при закрытии вкладки). */
	dispose(): void {
		this.stopLoop()
		this.session?.leave()
		this.session = null
		this.client = null
	}
}
