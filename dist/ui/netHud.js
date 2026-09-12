/**
 * Сетевой HUD: ники над головами, своя плашка сверху, пинг и чат.
 *
 * Ник стоит ровно над головой: позиция считается тем же базисом, что и у
 * камеры рендера, и не сглаживается по пикселям. За стеной ник не исчезает,
 * а просто тускнеет — по нему ищут друг друга.
 */
import { requireElement, setHidden, setText } from "./dom.js";
const CHAT_EMOJIS = new Map([
    [":hello-smile:", "./assets/ui/emoji-smile.svg"],
    [":hello-laugh:", "./assets/ui/emoji-laugh.svg"],
    [":hello-wink:", "./assets/ui/emoji-wink.svg"],
    [":hello-cool:", "./assets/ui/emoji-cool.svg"],
    [":hello-heart:", "./assets/ui/emoji-heart.svg"],
]);
function appendChatContent(parent, text) {
    const parts = text.split(/(:hello-(?:smile|laugh|wink|cool|heart):)/g);
    for (const part of parts) {
        const src = CHAT_EMOJIS.get(part);
        if (!src) {
            if (part)
                parent.append(document.createTextNode(part));
            continue;
        }
        const image = document.createElement("img");
        image.className = "net-chat__drawn-emoji";
        image.src = src;
        image.alt = "смайлик";
        parent.append(image);
    }
}
export class NetHud {
    root = requireElement("net-hud");
    tagLayer = requireElement("net-tags");
    selfTag = requireElement("net-self");
    selfName = requireElement("net-self-name");
    selfAvatar = requireElement("net-self-avatar");
    selfInfo = requireElement("net-self-info");
    pingDot = requireElement("net-ping-dot");
    chat = requireElement("net-chat");
    chatLog = requireElement("net-chat-log");
    chatInput = requireElement("net-chat-input");
    chatEntry = requireElement("net-chat-entry");
    chatEmojiButton = requireElement("net-chat-emoji");
    chatEmojis = requireElement("net-chat-emojis");
    chatHint = requireElement("net-chat-hint");
    tags = new Map();
    sendHandler = null;
    idle = 0;
    open = false;
    constructor() {
        this.chatEmojiButton.addEventListener("click", (event) => {
            event.stopPropagation();
            setHidden(this.chatEmojis, !this.chatEmojis.hidden);
        });
        for (const button of this.chatEmojis.querySelectorAll("[data-chat-emoji]")) {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                const code = button.dataset.chatEmoji ?? "";
                if (CHAT_EMOJIS.has(code))
                    this.sendHandler?.(`Привет! ${code}`);
                this.closeChat();
            });
        }
        this.chatInput.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
                const text = this.chatInput.value;
                this.chatInput.value = "";
                this.closeChat();
                if (text.trim())
                    this.sendHandler?.(text);
            }
            else if (event.key === "Escape") {
                this.chatInput.value = "";
                this.closeChat();
            }
        });
        this.chatInput.addEventListener("keyup", (event) => event.stopPropagation());
    }
    onSend(handler) {
        this.sendHandler = handler;
    }
    get chatOpen() {
        return this.open;
    }
    setVisible(visible) {
        setHidden(this.root, !visible);
        if (!visible) {
            this.closeChat();
            this.hideAllTags();
        }
    }
    setSelf(name, color, owner = false, host = false, skinId = "classic") {
        setText(this.selfName, name);
        this.selfTag.toggleAttribute("data-owner", owner);
        this.selfTag.toggleAttribute("data-host", host);
        setHidden(this.selfAvatar, skinId !== "ryzik3489");
        this.selfName.style.color = color;
        this.selfTag.style.borderColor = `${color}55`;
    }
    setInfo(players, ping, host) {
        const pingText = ping > 0 ? `${ping} мс` : "…";
        setText(this.selfInfo, `${players} в школе · ${pingText}${host ? " · хост" : ""}`);
        const quality = ping <= 0 ? "wait" : ping < 90 ? "good" : ping < 200 ? "ok" : "bad";
        if (this.pingDot.dataset.q !== quality)
            this.pingDot.dataset.q = quality;
    }
    openChat() {
        if (this.open)
            return;
        this.open = true;
        this.chat.dataset.open = "1";
        setHidden(this.chatEntry, false);
        this.idle = 0;
        this.chatInput.focus({ preventScroll: true });
    }
    closeChat() {
        if (!this.open)
            return;
        this.open = false;
        delete this.chat.dataset.open;
        setHidden(this.chatEntry, true);
        setHidden(this.chatEmojis, true);
        this.chatInput.blur();
    }
    toggleChat() {
        if (this.open)
            this.closeChat();
        else
            this.openChat();
    }
    addMessage(name, text, color, system = false) {
        const line = document.createElement("div");
        line.className = system ? "net-chat__line net-chat__line--sys" : "net-chat__line";
        if (name) {
            const who = document.createElement("span");
            who.className = "net-chat__who";
            who.style.color = color;
            who.textContent = `${name}: `;
            line.append(who);
        }
        const body = document.createElement("span");
        appendChatContent(body, text);
        line.append(body);
        this.chatLog.append(line);
        while (this.chatLog.childElementCount > 40)
            this.chatLog.firstElementChild?.remove();
        this.chatLog.scrollTop = this.chatLog.scrollHeight;
        this.idle = 0;
        this.chat.dataset.live = "1";
    }
    /**
     * Ники над головами. Позиция сглаживается, поэтому тег «прилипает»
     * к голове и не дёргается между сетевыми пакетами.
     */
    updateTags(items) {
        const seen = new Set();
        for (const item of items) {
            seen.add(item.id);
            const view = this.viewFor(item.id);
            // За стеной ник не гаснет, а только тускнеет.
            const fade = !item.visible
                ? 0
                : item.occluded
                    ? 0.5
                    : item.distance > 30
                        ? 0.8
                        : 0.95;
            if (fade <= 0) {
                if (view.shown) {
                    view.shown = false;
                    view.fresh = true;
                    view.el.style.display = "none";
                }
                continue;
            }
            const label = item.hiding ? `${item.name} 🚪` : item.name;
            view.el.toggleAttribute("data-owner", item.owner);
            view.el.toggleAttribute("data-host", item.host);
            setHidden(view.avatar, item.skinId !== "ryzik3489");
            if (view.name.textContent !== label) {
                view.name.textContent = label;
                view.name.style.color = item.color;
            }
            if (view.bar) {
                const part = Math.max(0, Math.min(1, item.lives / 5));
                view.bar.style.width = `${(part * 100).toFixed(0)}%`;
                view.bar.style.background = item.color;
            }
            // Сглаживания по экрану больше нет: тело уже интерполировано
            // по сети, а сглаживание пикселей заставляло ник отставать при повороте.
            view.x = item.x;
            view.y = item.y;
            view.fresh = false;
            const scale = Math.max(0.7, Math.min(1.05, 11 / Math.max(5, item.distance)));
            if (!view.shown) {
                view.shown = true;
                view.el.style.display = "block";
            }
            view.el.style.opacity = fade.toFixed(2);
            view.el.style.transform =
                `translate(-50%, -100%) translate(${view.x.toFixed(1)}px, ${view.y.toFixed(1)}px) ` +
                    `scale(${scale.toFixed(2)})`;
        }
        for (const [id, view] of this.tags) {
            if (seen.has(id))
                continue;
            view.el.remove();
            this.tags.delete(id);
        }
    }
    update(dt) {
        if (this.open)
            return;
        this.idle += dt;
        if (this.idle > 9 && this.chat.dataset.live)
            delete this.chat.dataset.live;
        setHidden(this.chatHint, this.idle < 9);
    }
    reset() {
        this.chatLog.replaceChildren();
        for (const view of this.tags.values())
            view.el.remove();
        this.tags.clear();
        this.closeChat();
        this.idle = 0;
        delete this.chat.dataset.live;
    }
    hideAllTags() {
        for (const view of this.tags.values()) {
            view.el.style.display = "none";
            view.shown = false;
            view.fresh = true;
        }
    }
    viewFor(id) {
        const existing = this.tags.get(id);
        if (existing)
            return existing;
        const el = document.createElement("div");
        el.className = "net-tag";
        const name = document.createElement("span");
        name.className = "net-tag__name";
        const avatar = document.createElement("img");
        avatar.className = "net-tag__avatar";
        avatar.src = "./assets/art/skin-ryzik3489.jpg";
        avatar.alt = "";
        const barWrap = document.createElement("span");
        barWrap.className = "net-tag__bar";
        const bar = document.createElement("i");
        barWrap.append(bar);
        el.append(avatar, name, barWrap);
        this.tagLayer.append(el);
        const view = { el, name, avatar, bar, x: 0, y: 0, fresh: true, shown: false };
        this.tags.set(id, view);
        return view;
    }
}
//# sourceMappingURL=netHud.js.map