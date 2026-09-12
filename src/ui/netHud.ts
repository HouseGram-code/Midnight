/**
 * Сетевой HUD: ники над головами, своя плашка сверху, пинг и чат.
 *
 * Ник стоит ровно над головой: позиция считается тем же базисом, что и у
 * камеры рендера, и не сглаживается по пикселям. За стеной ник не исчезает,
 * а просто тускнеет — по нему ищут друг друга.
 */

import { requireElement, setHidden, setText } from "./dom.js"

const CHAT_EMOJIS = new Map([
	[":hello-smile:", "./assets/ui/emoji-smile.svg"],
	[":hello-laugh:", "./assets/ui/emoji-laugh.svg"],
	[":hello-wink:", "./assets/ui/emoji-wink.svg"],
	[":hello-cool:", "./assets/ui/emoji-cool.svg"],
	[":hello-heart:", "./assets/ui/emoji-heart.svg"],
])

function appendChatContent(parent: HTMLElement, text: string): void {
	const parts = text.split(/(:hello-(?:smile|laugh|wink|cool|heart):)/g)
	for (const part of parts) {
		const src = CHAT_EMOJIS.get(part)
		if (!src) {
			if (part) parent.append(document.createTextNode(part))
			continue
		}
		const image = document.createElement("img")
		image.className = "net-chat__drawn-emoji"
		image.src = src
		image.alt = "смайлик"
		parent.append(image)
	}
}

export interface TagItem {
	id: string
	name: string
	owner: boolean
	host: boolean
	skinId?: string
	color: string
	x: number
	y: number
	distance: number
	visible: boolean
	/** Игрок за стеной: ник виден, но тусклее. */
	occluded: boolean
	/** Игрок сидит в шкафу — помечаем ник дверцей. */
	hiding: boolean
	/** Сколько жизней осталось у игрока. */
	lives: number
}

interface TagView {
	el: HTMLElement
	name: HTMLElement
	avatar: HTMLImageElement
	bar: HTMLElement | null
	x: number
	y: number
	/** Позиция ещё не задана — первый кадр ставим тег без сглаживания. */
	fresh: boolean
	shown: boolean
}

export class NetHud {
	private readonly root = requireElement("net-hud")
	private readonly tagLayer = requireElement("net-tags")
	private readonly selfTag = requireElement("net-self")
	private readonly selfName = requireElement("net-self-name")
	private readonly selfAvatar = requireElement("net-self-avatar") as HTMLImageElement
	private readonly selfInfo = requireElement("net-self-info")
	private readonly pingDot = requireElement("net-ping-dot")
	private readonly chat = requireElement("net-chat")
	private readonly chatLog = requireElement("net-chat-log")
	private readonly chatInput = requireElement("net-chat-input") as HTMLInputElement
	private readonly chatEntry = requireElement("net-chat-entry")
	private readonly chatEmojiButton = requireElement("net-chat-emoji") as HTMLButtonElement
	private readonly chatEmojis = requireElement("net-chat-emojis")
	private readonly chatHint = requireElement("net-chat-hint")

	private readonly tags = new Map<string, TagView>()
	private sendHandler: ((text: string) => void) | null = null
	private idle = 0
	private open = false

	constructor() {
		this.chatEmojiButton.addEventListener("click", (event) => {
			event.stopPropagation()
			setHidden(this.chatEmojis, !this.chatEmojis.hidden)
		})
		for (const button of this.chatEmojis.querySelectorAll<HTMLButtonElement>("[data-chat-emoji]")) {
			button.addEventListener("click", (event) => {
				event.stopPropagation()
				const code = button.dataset.chatEmoji ?? ""
				if (CHAT_EMOJIS.has(code)) this.sendHandler?.(`Привет! ${code}`)
				this.closeChat()
			})
		}
		this.chatInput.addEventListener("keydown", (event: KeyboardEvent) => {
			event.stopPropagation()
			if (event.key === "Enter") {
				const text = this.chatInput.value
				this.chatInput.value = ""
				this.closeChat()
				if (text.trim()) this.sendHandler?.(text)
			} else if (event.key === "Escape") {
				this.chatInput.value = ""
				this.closeChat()
			}
		})
		this.chatInput.addEventListener("keyup", (event: KeyboardEvent) => event.stopPropagation())
	}

	onSend(handler: (text: string) => void): void {
		this.sendHandler = handler
	}

	get chatOpen(): boolean {
		return this.open
	}

	setVisible(visible: boolean): void {
		setHidden(this.root, !visible)
		if (!visible) {
			this.closeChat()
			this.hideAllTags()
		}
	}

	setSelf(name: string, color: string, owner = false, host = false, skinId = "classic"): void {
		setText(this.selfName, name)
		this.selfTag.toggleAttribute("data-owner", owner)
		this.selfTag.toggleAttribute("data-host", host)
		setHidden(this.selfAvatar, skinId !== "ryzik3489")
		this.selfName.style.color = color
		this.selfTag.style.borderColor = `${color}55`
	}

	setInfo(players: number, ping: number, host: boolean): void {
		const pingText = ping > 0 ? `${ping} мс` : "…"
		setText(this.selfInfo, `${players} в школе · ${pingText}${host ? " · хост" : ""}`)
		const quality = ping <= 0 ? "wait" : ping < 90 ? "good" : ping < 200 ? "ok" : "bad"
		if (this.pingDot.dataset.q !== quality) this.pingDot.dataset.q = quality
	}

	openChat(): void {
		if (this.open) return
		this.open = true
		this.chat.dataset.open = "1"
		setHidden(this.chatEntry, false)
		this.idle = 0
		this.chatInput.focus({ preventScroll: true })
	}

	closeChat(): void {
		if (!this.open) return
		this.open = false
		delete this.chat.dataset.open
		setHidden(this.chatEntry, true)
		setHidden(this.chatEmojis, true)
		this.chatInput.blur()
	}

	toggleChat(): void {
		if (this.open) this.closeChat()
		else this.openChat()
	}

	addMessage(name: string, text: string, color: string, system = false): void {
		const line = document.createElement("div")
		line.className = system ? "net-chat__line net-chat__line--sys" : "net-chat__line"
		if (name) {
			const who = document.createElement("span")
			who.className = "net-chat__who"
			who.style.color = color
			who.textContent = `${name}: `
			line.append(who)
		}
		const body = document.createElement("span")
		appendChatContent(body, text)
		line.append(body)
		this.chatLog.append(line)
		while (this.chatLog.childElementCount > 40) this.chatLog.firstElementChild?.remove()
		this.chatLog.scrollTop = this.chatLog.scrollHeight
		this.idle = 0
		this.chat.dataset.live = "1"
	}

	/**
	 * Ники над головами. Позиция сглаживается, поэтому тег «прилипает»
	 * к голове и не дёргается между сетевыми пакетами.
	 */
	updateTags(items: TagItem[]): void {
		const seen = new Set<string>()
		for (const item of items) {
			seen.add(item.id)
			const view = this.viewFor(item.id)

			// За стеной ник не гаснет, а только тускнеет.
			const fade = !item.visible
				? 0
				: item.occluded
					? 0.5
					: item.distance > 30
						? 0.8
						: 0.95
			if (fade <= 0) {
				if (view.shown) {
					view.shown = false
					view.fresh = true
					view.el.style.display = "none"
				}
				continue
			}

			const label = item.hiding ? `${item.name} 🚪` : item.name
			view.el.toggleAttribute("data-owner", item.owner)
			view.el.toggleAttribute("data-host", item.host)
			setHidden(view.avatar, item.skinId !== "ryzik3489")
			if (view.name.textContent !== label) {
				view.name.textContent = label
				view.name.style.color = item.color
			}
			if (view.bar) {
				const part = Math.max(0, Math.min(1, item.lives / 5))
				view.bar.style.width = `${(part * 100).toFixed(0)}%`
				view.bar.style.background = item.color
			}

			// Сглаживания по экрану больше нет: тело уже интерполировано
			// по сети, а сглаживание пикселей заставляло ник отставать при повороте.
			view.x = item.x
			view.y = item.y
			view.fresh = false

			const scale = Math.max(0.7, Math.min(1.05, 11 / Math.max(5, item.distance)))
			if (!view.shown) {
				view.shown = true
				view.el.style.display = "block"
			}
			view.el.style.opacity = fade.toFixed(2)
			view.el.style.transform =
				`translate(-50%, -100%) translate(${view.x.toFixed(1)}px, ${view.y.toFixed(1)}px) ` +
				`scale(${scale.toFixed(2)})`
		}

		for (const [id, view] of this.tags) {
			if (seen.has(id)) continue
			view.el.remove()
			this.tags.delete(id)
		}
	}

	update(dt: number): void {
		if (this.open) return
		this.idle += dt
		if (this.idle > 9 && this.chat.dataset.live) delete this.chat.dataset.live
		setHidden(this.chatHint, this.idle < 9)
	}

	reset(): void {
		this.chatLog.replaceChildren()
		for (const view of this.tags.values()) view.el.remove()
		this.tags.clear()
		this.closeChat()
		this.idle = 0
		delete this.chat.dataset.live
	}

	private hideAllTags(): void {
		for (const view of this.tags.values()) {
			view.el.style.display = "none"
			view.shown = false
			view.fresh = true
		}
	}

	private viewFor(id: string): TagView {
		const existing = this.tags.get(id)
		if (existing) return existing
		const el = document.createElement("div")
		el.className = "net-tag"
		const name = document.createElement("span")
		name.className = "net-tag__name"
		const avatar = document.createElement("img")
		avatar.className = "net-tag__avatar"
		avatar.src = "./assets/art/skin-ryzik3489.jpg"
		avatar.alt = ""
		const barWrap = document.createElement("span")
		barWrap.className = "net-tag__bar"
		const bar = document.createElement("i")
		barWrap.append(bar)
		el.append(avatar, name, barWrap)
		this.tagLayer.append(el)
		const view: TagView = { el, name, avatar, bar, x: 0, y: 0, fresh: true, shown: false }
		this.tags.set(id, view)
		return view
	}
}
