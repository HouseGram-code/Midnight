/** Панель онлайна: случайный подбор или приватная комната по коду. */
import { isMockMode, LoopbackClient, RealtimeClient } from "../net/realtime.js";
import { MAX_PLAYERS, MIN_PLAYERS, OnlineSession, SEARCH_SECONDS } from "../net/session.js";
import { skinFor } from "../net/remote.js";
import { requireElement, setHidden, setText } from "./dom.js";
const NAME_KEY = "school3d.name.v1";
const OWNER_KEY = "school3d.owner.v1";
const OWNER_NAME = "goh";
const OWNER_SETUP_HASH = "244c2a71139c6d6ba5b51cdcc5ce6fbed99013747dc89b14acdf41716bbac17d";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function storedName() { try {
    return localStorage.getItem(NAME_KEY) ?? "";
}
catch {
    return "";
} }
function rememberName(name) { try {
    localStorage.setItem(NAME_KEY, name);
}
catch { /* ignore */ } }
function storedOwnerToken() { try {
    return localStorage.getItem(OWNER_KEY) ?? "";
}
catch {
    return "";
} }
function rememberOwnerToken(token) { try {
    localStorage.setItem(OWNER_KEY, token);
}
catch { /* ignore */ } }
function cleanUserName(raw) { return raw.replace(/\s+/g, " ").trim().slice(0, 14); }
function isOwnerName(raw) { return raw.normalize("NFKC").replace(/\s+/g, "").toLowerCase() === OWNER_NAME; }
async function sha256(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function roomCode() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}
function cleanCode(raw) { return raw.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); }
export class OnlinePanel {
    callbacks;
    nameInput = requireElement("online-name");
    nameSaveButton = requireElement("online-name-save");
    ownerBadge = requireElement("online-owner-badge");
    startButton = requireElement("online-start");
    createRoomButton = requireElement("online-create-room");
    joinRoomButton = requireElement("online-join-room");
    roomStartButton = requireElement("online-room-start");
    cancelButton = requireElement("online-cancel");
    soloButton = requireElement("online-solo");
    randomModeButton = requireElement("online-mode-random");
    codeModeButton = requireElement("online-mode-code");
    codeBox = requireElement("online-code-box");
    codeSetup = requireElement("online-code-setup");
    codeCard = requireElement("online-code-card");
    roomCodeInput = requireElement("online-room-code");
    codeValue = requireElement("online-code-value");
    copyCodeButton = requireElement("online-copy-code");
    statusEl = requireElement("online-status");
    hintEl = requireElement("online-hint");
    pingEl = requireElement("online-ping");
    loader = requireElement("online-loader");
    ring = requireElement("online-ring");
    ringLabel = requireElement("online-ring-label");
    rosterEl = requireElement("online-roster");
    searchBox = requireElement("online-search");
    session = null;
    client = null;
    mock = isMockMode();
    mode = "random";
    activeCode = "";
    codeHost = false;
    raf = 0;
    lastFrame = 0;
    startAt = 0;
    pending = null;
    ringValue = 0;
    savedName = storedName();
    ownerAccess = false;
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.nameInput.value = this.savedName;
        void this.initOwner();
        this.nameInput.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter") {
            if (this.profileSaved)
                this.startSearch();
            else
                this.saveProfile();
        } });
        this.nameInput.addEventListener("keyup", (event) => event.stopPropagation());
        this.nameInput.addEventListener("input", () => { setText(this.nameSaveButton, "Сохранить"); setHidden(this.ownerBadge, true); this.refreshButtons(); });
        this.nameSaveButton.addEventListener("click", () => { this.callbacks.onClick(); this.saveProfile(); });
        this.roomCodeInput.addEventListener("input", () => { this.roomCodeInput.value = cleanCode(this.roomCodeInput.value); });
        this.roomCodeInput.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Enter")
            void this.joinCodeRoom(); });
        this.randomModeButton.addEventListener("click", () => this.switchMode("random"));
        this.codeModeButton.addEventListener("click", () => this.switchMode("code"));
        this.createRoomButton.addEventListener("click", () => void this.createCodeRoom());
        this.joinRoomButton.addEventListener("click", () => void this.joinCodeRoom());
        this.copyCodeButton.addEventListener("click", () => void this.copyCode());
        this.roomStartButton.addEventListener("click", () => { this.callbacks.onClick(); if (!this.session?.startCodeMatch())
            this.setStatus("Нужен ещё игрок", "Друг должен войти по коду комнаты."); });
        this.startButton.addEventListener("click", () => { this.callbacks.onClick(); this.startSearch(); });
        this.cancelButton.addEventListener("click", () => {
            this.callbacks.onClick();
            if (this.mode === "code") {
                this.leaveSession();
                this.showCodeSetup();
                this.setStatus("Комната закрыта", "Можно создать новую или войти по коду.");
            }
            else {
                this.session?.cancelSearch();
                this.setStatus("Поиск отменён", "Можно попробовать снова.");
            }
            this.refreshButtons();
        });
        this.soloButton.addEventListener("click", () => { this.callbacks.onClick(); this.session?.cancelSearch(); this.callbacks.onSolo(); });
        requireElement("online-back").addEventListener("click", () => { this.callbacks.onClick(); this.leaveSession(); this.callbacks.onBack(); });
    }
    get isSearching() { return this.session?.phase === "searching"; }
    get profileSaved() { return this.savedName.length >= 2 && cleanUserName(this.nameInput.value) === this.savedName; }
    get ownerActive() { return this.ownerAccess && isOwnerName(this.savedName); }
    open() { setHidden(this.soloButton, true); this.switchMode("random", false); this.startLoop(); }
    close() { this.stopLoop(); }
    reset() { this.leaveSession(); this.pending = null; this.startAt = 0; this.loader.dataset.mode = "idle"; this.rosterEl.replaceChildren(); this.showCodeSetup(); this.setStatus("Готовы к следующей игре", "Выберите случайную игру или комнату по коду."); this.refreshButtons(); }
    switchMode(mode, click = true) {
        if (click)
            this.callbacks.onClick();
        if (this.mode !== mode)
            this.leaveSession();
        this.mode = mode;
        this.randomModeButton.classList.toggle("online__mode--active", mode === "random");
        this.codeModeButton.classList.toggle("online__mode--active", mode === "code");
        this.randomModeButton.setAttribute("aria-selected", String(mode === "random"));
        this.codeModeButton.setAttribute("aria-selected", String(mode === "code"));
        setHidden(this.codeBox, mode !== "code");
        setHidden(this.startButton, mode !== "random");
        setHidden(this.roomStartButton, true);
        setHidden(this.cancelButton, true);
        setHidden(this.soloButton, true);
        setHidden(this.searchBox, true);
        this.loader.dataset.mode = "idle";
        this.rosterEl.replaceChildren();
        if (mode === "random") {
            this.setStatus("Случайная игра", "Введите имя и нажмите «Начать игру онлайн».");
        }
        else {
            this.showCodeSetup();
            this.setStatus("Комната по коду", "Создайте комнату или введите код друга.");
        }
        if (!this.profileSaved)
            this.setStatus("Регистрация", "Введите имя и нажмите «Сохранить». Это всё — пароль не нужен.");
        this.refreshButtons();
    }
    makeClient() { return this.mock ? new LoopbackClient(35) : new RealtimeClient(); }
    makeSession(client) {
        return new OnlineSession(client, this.savedName || "Игрок", {
            onPhase: (phase, detail) => { if (phase === "connecting")
                this.loader.dataset.mode = "connect"; if (detail)
                this.setStatus(detail, ""); this.refreshButtons(); },
            onRoster: (members) => this.renderRoster(members),
            onCountdown: (left, found) => this.onCountdown(left, found),
            onAlone: () => { if (this.mode === "random") {
                setHidden(this.soloButton, false);
                this.setStatus("Пока никого нет…", "Продолжаем искать. Можно начать одному или позвать друга.");
            } },
            onMatch: (info) => this.onMatchFound(info),
        }, this.ownerActive);
    }
    async ensureRandomSession() {
        if (this.mode !== "random")
            return;
        if (!this.session) {
            this.client = this.makeClient();
            this.session = this.makeSession(this.client);
        }
        if (this.session.phase !== "idle") {
            this.refreshButtons();
            return;
        }
        this.loader.dataset.mode = "connect";
        if (!(await this.session.enter())) {
            this.showConnectionError();
            return;
        }
        this.loader.dataset.mode = "idle";
        this.setStatus("Сеть на связи", "Введите имя и начните случайный поиск.");
        this.refreshButtons();
    }
    async createCodeRoom() { if (this.validName())
        await this.enterCodeRoom(roomCode(), true); }
    async joinCodeRoom() {
        if (!this.validName())
            return;
        const code = cleanCode(this.roomCodeInput.value);
        if (code.length !== 6) {
            this.setStatus("Неверный код", "Введите все 6 символов кода комнаты.");
            this.roomCodeInput.focus();
            return;
        }
        await this.enterCodeRoom(code, false);
    }
    async enterCodeRoom(code, asHost) {
        this.callbacks.onClick();
        this.leaveSession();
        this.activeCode = code;
        this.codeHost = asHost;
        this.client = this.makeClient();
        this.session = this.makeSession(this.client);
        this.loader.dataset.mode = "connect";
        this.showCodeCard(code);
        this.setStatus(asHost ? "Создаём комнату…" : "Входим в комнату…", `Код ${code}`);
        if (!(await this.session.enterCodeRoom(code, asHost))) {
            this.showConnectionError();
            this.showCodeSetup();
            return;
        }
        this.loader.dataset.mode = "search";
        setHidden(this.searchBox, false);
        setHidden(this.cancelButton, false);
        setHidden(this.roomStartButton, !asHost);
        this.setStatus(asHost ? `Комната ${code} создана` : `Вы в комнате ${code}`, asHost ? "Отправьте код друзьям. Когда они войдут, запустите игру." : "Ждём, когда создатель комнаты запустит игру.");
        this.refreshButtons();
    }
    startSearch() {
        if (this.mode !== "random" || !this.validName())
            return;
        if (!this.session || this.session.phase === "idle") {
            void this.ensureRandomSession().then(() => { if (this.session?.phase === "lobby")
                this.startSearch(); });
            return;
        }
        if (this.session.phase === "connecting") {
            this.setStatus("Ещё подключаемся…", "Секундочку.");
            return;
        }
        this.session.setName(this.nameInput.value.trim());
        this.session.startSearch();
        this.loader.dataset.mode = "search";
        setHidden(this.searchBox, false);
        setHidden(this.soloButton, true);
        this.setStatus("Собираем игроков…", `Максимум ${MAX_PLAYERS}. Начнём раньше, если комната заполнится.`);
        this.refreshButtons();
    }
    validName() {
        if (this.profileSaved)
            return true;
        this.setStatus("Сначала сохраните имя", "Введите имя и нажмите кнопку «Сохранить».");
        this.nameInput.focus();
        return false;
    }
    saveProfile() {
        const name = cleanUserName(this.nameInput.value);
        if (name.length < 2) {
            this.setStatus("Нужно имя", "Минимум 2 символа.");
            this.nameInput.focus();
            return false;
        }
        if (isOwnerName(name) && !this.ownerAccess) {
            this.setStatus("Имя goh занято", "Это имя навсегда закреплено за создателем игры.");
            this.nameInput.select();
            return false;
        }
        this.savedName = name;
        this.nameInput.value = name;
        rememberName(name);
        this.session?.setName(name);
        setText(this.nameSaveButton, "Сохранено");
        setHidden(this.ownerBadge, !this.ownerActive);
        this.setStatus(this.ownerActive ? "Профиль создателя сохранён" : "Имя сохранено", "Теперь можно заходить в онлайн.");
        this.refreshButtons();
        return true;
    }
    async initOwner() {
        let token = storedOwnerToken();
        const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
        const candidate = hashParams.get("owner") ?? "";
        try {
            if (candidate && await sha256(candidate) === OWNER_SETUP_HASH) {
                token = candidate;
                rememberOwnerToken(candidate);
                history.replaceState(null, "", `${location.pathname}${location.search}`);
            }
            this.ownerAccess = Boolean(token) && await sha256(token) === OWNER_SETUP_HASH;
        }
        catch {
            this.ownerAccess = false;
        }
        setHidden(this.ownerBadge, !(this.ownerAccess && isOwnerName(this.savedName)));
        this.refreshButtons();
    }
    showConnectionError() { this.loader.dataset.mode = "error"; this.setStatus("Сервер не отвечает", `${this.client?.lastError || "Не вышло подключиться"}. Попробуйте ещё раз.`); this.refreshButtons(); }
    onCountdown(left, found) {
        if (this.mode === "code") {
            this.ringValue = Math.min(1, found / MAX_PLAYERS);
            setText(this.ringLabel, `${found}`);
            this.setStatus(`Комната ${this.activeCode} · игроков: ${found}`, this.codeHost ? (found >= MIN_PLAYERS ? "Можно запускать игру." : "Отправьте код другу и дождитесь подключения.") : "Ждём запуска создателем комнаты.");
            this.refreshButtons();
            return;
        }
        this.ringValue = 1 - left / SEARCH_SECONDS;
        setText(this.ringLabel, `${left}`);
        const word = found === 1 ? "игрок" : found < 5 ? "игрока" : "игроков";
        this.setStatus("Собираем игроков…", `В очереди ${found} ${word} из ${MAX_PLAYERS}`);
    }
    onMatchFound(info) {
        this.pending = info;
        this.loader.dataset.mode = "found";
        const lag = Math.min(400, Math.round((this.session?.ping ?? 0) / 2));
        this.startAt = performance.now() + Math.max(900, info.startIn - lag);
        this.setStatus("Матч найден!", `Игроков: ${info.players.length}. Заходим в школу…`);
        this.renderMatchRoster(info);
        setHidden(this.soloButton, true);
        setHidden(this.roomStartButton, true);
        this.refreshButtons();
    }
    renderRoster(members) {
        if (this.pending)
            return;
        const searching = members.filter((member) => member.searching && !member.playing);
        this.rosterEl.replaceChildren();
        searching.slice(0, MAX_PLAYERS).forEach((member, index) => this.rosterEl.append(this.rosterRow(member.name, index, member.id === this.session?.id, member.owner)));
        for (let i = searching.length; i < MAX_PLAYERS; i += 1) {
            const empty = document.createElement("div");
            empty.className = "online-slot online-slot--empty";
            empty.textContent = "свободно";
            this.rosterEl.append(empty);
        }
        this.refreshButtons();
    }
    renderMatchRoster(info) { this.rosterEl.replaceChildren(); for (const player of info.players)
        this.rosterEl.append(this.rosterRow(player.name, player.index, player.id === this.session?.id, player.owner)); }
    rosterRow(name, index, self, owner) { const row = document.createElement("div"); row.className = `${self ? "online-slot online-slot--me" : "online-slot"}${owner ? " online-slot--owner" : ""}`; const dot = document.createElement("i"); dot.style.background = skinFor(index).tag; const label = document.createElement("span"); label.textContent = self ? `${name} (вы)` : name; row.append(dot); if (owner) {
        const mark = document.createElement("b");
        mark.className = "creator-emblem creator-emblem--small";
        mark.title = "Официальный создатель игры";
        row.append(mark);
    } row.append(label); return row; }
    showCodeSetup() { this.activeCode = ""; this.codeHost = false; setHidden(this.codeSetup, false); setHidden(this.codeCard, true); setHidden(this.roomStartButton, true); setHidden(this.cancelButton, true); setHidden(this.searchBox, true); }
    showCodeCard(code) { setText(this.codeValue, code); setHidden(this.codeSetup, true); setHidden(this.codeCard, false); }
    async copyCode() { if (!this.activeCode)
        return; try {
        await navigator.clipboard.writeText(this.activeCode);
        setText(this.copyCodeButton, "Скопировано");
        setTimeout(() => setText(this.copyCodeButton, "Копировать"), 1400);
    }
    catch {
        this.setStatus(`Код комнаты: ${this.activeCode}`, "Выделите код и отправьте его друзьям.");
    } }
    setStatus(title, hint) { setText(this.statusEl, title); setText(this.hintEl, hint); }
    refreshButtons() { const phase = this.session?.phase ?? "idle"; const searching = phase === "searching"; const busy = phase === "connecting" || phase === "found" || phase === "match"; const noProfile = !this.profileSaved; this.startButton.disabled = noProfile || this.mode !== "random" || searching || busy; this.createRoomButton.disabled = noProfile || busy; this.joinRoomButton.disabled = noProfile || busy; this.roomStartButton.disabled = !this.codeHost || (this.session?.searchers.length ?? 0) < MIN_PLAYERS || phase !== "searching"; if (this.mode === "random")
        setHidden(this.cancelButton, !searching); }
    startLoop() { if (this.raf)
        return; this.lastFrame = performance.now(); const step = (now) => { this.raf = requestAnimationFrame(step); const dt = Math.min(0.25, (now - this.lastFrame) / 1000); this.lastFrame = now; this.frame(dt, now); }; this.raf = requestAnimationFrame(step); }
    stopLoop() { if (!this.raf)
        return; cancelAnimationFrame(this.raf); this.raf = 0; }
    frame(dt, now) {
        const session = this.session;
        if (!session)
            return;
        session.update(dt);
        const ping = session.ping;
        const quality = ping <= 0 ? "wait" : ping < 180 ? "good" : ping < 500 ? "ok" : "bad";
        setText(this.pingEl, ping > 0 ? `${ping} мс` : "—");
        this.pingEl.dataset.q = quality;
        if (session.phase === "searching")
            this.ring.style.setProperty("--fill", `${Math.round(this.ringValue * 360)}deg`);
        else if (this.pending) {
            const left = Math.max(0, this.startAt - now);
            setText(this.ringLabel, `${Math.ceil(left / 1000)}`);
            this.ring.style.setProperty("--fill", "360deg");
            if (left <= 0) {
                const info = this.pending;
                this.pending = null;
                this.stopLoop();
                this.callbacks.onMatch(session, info);
            }
        }
    }
    leaveSession() { this.session?.leave(); this.session = null; this.client = null; this.pending = null; }
    dispose() { this.stopLoop(); this.leaveSession(); }
}
//# sourceMappingURL=online.js.map