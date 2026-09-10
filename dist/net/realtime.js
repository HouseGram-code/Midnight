/**
 * Тонкий клиент Supabase Realtime (протокол Phoenix) + локальная сеть для отладки.
 *
 * Зачем свой клиент, а не supabase-js: игре нужны только broadcast и presence,
 * а лишние 40 КБ библиотеки и сборщик тут ни к чему. Всё общение — четыре типа
 * сообщений: phx_join, broadcast, presence, heartbeat.
 *
 * Пинг настоящий: это RTT ответа на heartbeat.
 *
 * Режим ?netmock=1 — игра без интернета через BroadcastChannel: вкладки
 * одного браузера видят друг друга. Разные профили браузера и разные
 * компьютеры так соединить нельзя — для них нужен режим без netmock.
 */
export const SUPABASE_URL = "https://itdmkqmluxrrbtnfaikh.supabase.co";
/** Публичный anon JWT. Секретные и service_role ключи сюда добавлять нельзя. */
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0ZG1rcW1sdXhycmJ0bmZhaWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjI5NjAsImV4cCI6MjEwNDU5ODk2MH0.CxkqvX6Q30qeQ3bTgSWpf_IiRyPG-fAuS862ISG8u5U";
/** Игра запущена с ?netmock=1 — сеть локальная, без интернета. */
export function isMockMode() {
    if (typeof location === "undefined")
        return false;
    return location.search.includes("netmock=1");
}
const JOIN_TIMEOUT = 9000;
// Phoenix рекомендует редкий keep-alive. Две секунды создавали лишнюю
// нагрузку и могли сами провоцировать reconnect-шторм при плохом интернете.
const HEARTBEAT_MS = 25000;
const MAX_MISSED = 2;
const MAX_BACKOFF = 6000;
export function randomId() {
    const bytes = new Uint8Array(8);
    const source = globalThis.crypto;
    if (source && typeof source.getRandomValues === "function") {
        source.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    let out = "";
    for (const byte of bytes)
        out += byte.toString(16).padStart(2, "0");
    return out;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function clonePayload(payload) {
    try {
        return JSON.parse(JSON.stringify(payload));
    }
    catch {
        return { ...payload };
    }
}
/** Из presence-записи Phoenix берём последнюю мету. */
function lastMeta(value) {
    if (!value || typeof value !== "object")
        return null;
    const metas = value.metas;
    if (!Array.isArray(metas) || metas.length === 0)
        return null;
    const meta = metas[metas.length - 1];
    return meta && typeof meta === "object" ? meta : null;
}
class Channel {
    name;
    client;
    topic;
    handlers = new Map();
    presenceHandlers = [];
    members = new Map();
    queue = [];
    meta = null;
    trackedJson = "";
    joined = false;
    left = false;
    joinRef = "";
    resolveReady = null;
    readyPromise = new Promise((resolve) => {
        this.resolveReady = resolve;
    });
    constructor(name, client) {
        this.name = name;
        this.client = client;
        this.topic = `realtime:${name}`;
    }
    on(event, handler) {
        const list = this.handlers.get(event);
        if (list)
            list.push(handler);
        else
            this.handlers.set(event, [handler]);
    }
    onPresence(handler) {
        this.presenceHandlers.push(handler);
    }
    ready() {
        if (this.joined)
            return Promise.resolve(true);
        if (this.left)
            return Promise.resolve(false);
        return this.readyPromise;
    }
    presence() {
        return this.members;
    }
    send(event, payload) {
        if (this.left)
            return;
        if (!this.joined) {
            // Пока канал не подтвердил вход, копим только важное (чат, матч).
            if (this.queue.length < 24)
                this.queue.push({ event, payload });
            return;
        }
        this.client.push({
            topic: this.topic,
            event: "broadcast",
            payload: { type: "broadcast", event, payload },
            ref: this.client.nextRef(),
            join_ref: this.joinRef,
        });
    }
    track(meta) {
        this.meta = meta;
        if (!this.joined || this.left)
            return;
        const nextJson = JSON.stringify(meta);
        // Supabase ограничивает частоту Presence track. Одинаковое состояние
        // повторно не отправляем — сервер и так хранит его до отключения.
        if (nextJson === this.trackedJson)
            return;
        this.trackedJson = nextJson;
        this.client.push({
            topic: this.topic,
            event: "presence",
            payload: { type: "presence", event: "track", payload: meta },
            ref: this.client.nextRef(),
            join_ref: this.joinRef,
        });
    }
    leave() {
        this.left = true;
        this.joined = false;
        this.resolveReady?.(false);
        this.resolveReady = null;
        if (this.client.status === "open") {
            this.client.push({
                topic: this.topic,
                event: "phx_leave",
                payload: {},
                ref: this.client.nextRef(),
                join_ref: this.joinRef,
            });
        }
        this.client.dropChannel(this.name);
    }
    /** Вход в канал: настройки broadcast + presence. */
    join() {
        if (this.left)
            return;
        this.joined = false;
        this.trackedJson = "";
        this.joinRef = this.client.nextRef();
        this.client.push({
            topic: this.topic,
            event: "phx_join",
            payload: {
                config: {
                    broadcast: { self: true, ack: false },
                    presence: { key: this.client.id, enabled: true },
                    private: false,
                },
                access_token: SUPABASE_KEY,
            },
            ref: this.joinRef,
            join_ref: this.joinRef,
        });
    }
    handle(message) {
        switch (message.event) {
            case "phx_reply": {
                // Ответы на track/broadcast не являются подтверждением входа.
                if (!this.joined && message.ref !== this.joinRef)
                    return;
                const status = message.payload.status;
                if (status !== "ok") {
                    const response = message.payload.response;
                    const reason = response && typeof response === "object"
                        ? String(response.reason ?? "")
                        : "";
                    if (reason)
                        this.client.noteError(`Сервер отказал во входе в канал: ${reason}`);
                    this.resolveReady?.(false);
                    this.resolveReady = null;
                    return;
                }
                if (this.joined)
                    return;
                this.joined = true;
                this.resolveReady?.(true);
                this.resolveReady = null;
                if (this.meta)
                    this.track(this.meta);
                const pending = this.queue.splice(0, this.queue.length);
                for (const item of pending)
                    this.send(item.event, item.payload);
                return;
            }
            case "presence_state": {
                this.members.clear();
                for (const [key, value] of Object.entries(message.payload)) {
                    const meta = lastMeta(value);
                    if (meta)
                        this.members.set(key, meta);
                }
                this.emitPresence();
                return;
            }
            case "presence_diff": {
                const leaves = message.payload.leaves;
                const joins = message.payload.joins;
                if (leaves && typeof leaves === "object") {
                    for (const key of Object.keys(leaves))
                        this.members.delete(key);
                }
                if (joins && typeof joins === "object") {
                    for (const [key, value] of Object.entries(joins)) {
                        const meta = lastMeta(value);
                        if (meta)
                            this.members.set(key, meta);
                    }
                }
                this.emitPresence();
                return;
            }
            case "broadcast": {
                const event = message.payload.event;
                const body = message.payload.payload;
                if (typeof event !== "string")
                    return;
                const handlers = this.handlers.get(event);
                if (!handlers)
                    return;
                const data = body && typeof body === "object" ? body : {};
                for (const handler of handlers)
                    handler(data);
                return;
            }
            case "phx_error":
            case "phx_close": {
                this.joined = false;
                return;
            }
            default:
                return;
        }
    }
    emitPresence() {
        for (const handler of this.presenceHandlers)
            handler();
    }
}
export class RealtimeClient {
    id = randomId();
    transport = "supabase";
    status = "idle";
    ping = 0;
    lastError = "";
    socket = null;
    channels = new Map();
    refCounter = 0;
    heartbeatTimer = null;
    heartbeatRef = "";
    heartbeatAt = 0;
    missed = 0;
    attempt = 0;
    closedByUser = false;
    connecting = null;
    get url() {
        const base = SUPABASE_URL.replace(/^http/, "ws").replace(/\/+$/, "");
        return `${base}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`;
    }
    noteError(text) {
        this.lastError = text;
    }
    connect() {
        if (this.status === "open")
            return Promise.resolve(true);
        if (this.connecting)
            return this.connecting;
        this.closedByUser = false;
        this.connecting = this.openSocket().finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }
    openSocket() {
        this.status = "connecting";
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            this.status = "closed";
            this.lastError = "Нет интернета — браузер говорит, что сети нет";
            return Promise.resolve(false);
        }
        if (typeof WebSocket === "undefined") {
            this.status = "closed";
            this.lastError = "Браузер не умеет WebSocket";
            return Promise.resolve(false);
        }
        return new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => {
                if (settled)
                    return;
                settled = true;
                resolve(ok);
            };
            let socket;
            try {
                socket = new WebSocket(this.url);
            }
            catch {
                this.status = "closed";
                this.lastError = "Браузер не дал открыть соединение";
                finish(false);
                return;
            }
            this.socket = socket;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                // Не вызываем close() у CONNECTING-сокета: Chrome пишет ложную
                // ошибку «closed before the connection is established».
                if (socket.readyState !== WebSocket.CONNECTING) {
                    try {
                        socket.close();
                    }
                    catch {
                        // уже закрыт
                    }
                }
                if (this.socket === socket)
                    this.socket = null;
                this.status = "closed";
                this.lastError = `Сервер не ответил за ${Math.round(JOIN_TIMEOUT / 1000)} с`;
                finish(false);
            }, JOIN_TIMEOUT);
            socket.onopen = () => {
                clearTimeout(timer);
                if (this.closedByUser || this.socket !== socket) {
                    try {
                        socket.close(1000, "cancelled");
                    }
                    catch {
                        // уже закрыт
                    }
                    finish(false);
                    return;
                }
                this.status = "open";
                this.attempt = 0;
                this.missed = 0;
                this.lastError = "";
                this.startHeartbeat();
                for (const channel of this.channels.values())
                    channel.join();
                finish(true);
            };
            socket.onmessage = (event) => {
                if (typeof event.data !== "string")
                    return;
                this.handleRaw(event.data);
            };
            socket.onerror = () => {
                if (this.status !== "open") {
                    clearTimeout(timer);
                    this.status = "closed";
                    this.lastError = "Не вышло дойти до сервера — проверьте интернет";
                    finish(false);
                }
            };
            socket.onclose = (event) => {
                clearTimeout(timer);
                this.stopHeartbeat();
                const wasOpen = this.status === "open";
                this.status = "closed";
                this.socket = null;
                const code = typeof event.code === "number" ? event.code : 0;
                if (!wasOpen && !this.lastError) {
                    this.lastError = `Сервер закрыл соединение (код ${code})`;
                }
                else if (wasOpen && !this.closedByUser) {
                    this.lastError = `Связь оборвалась (код ${code}) — переподключаемся`;
                }
                finish(false);
                if (wasOpen && !this.closedByUser)
                    this.scheduleReconnect();
            };
        });
    }
    scheduleReconnect() {
        if (this.closedByUser)
            return;
        this.attempt += 1;
        const wait = Math.min(600 * 2 ** (this.attempt - 1), MAX_BACKOFF);
        setTimeout(() => {
            if (this.closedByUser)
                return;
            void this.connect();
        }, wait);
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => this.beat(), HEARTBEAT_MS);
        this.beat();
    }
    stopHeartbeat() {
        if (this.heartbeatTimer === null)
            return;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }
    beat() {
        if (this.status !== "open" || !this.socket)
            return;
        if (this.heartbeatRef) {
            this.missed += 1;
            // Сервер молчит три удара подряд — рвём и переподключаемся.
            if (this.missed >= MAX_MISSED) {
                this.heartbeatRef = "";
                try {
                    this.socket.close();
                }
                catch {
                    // уже закрыт
                }
                return;
            }
        }
        const ref = this.nextRef();
        this.heartbeatRef = ref;
        this.heartbeatAt = Date.now();
        this.push({ topic: "phoenix", event: "heartbeat", payload: {}, ref });
    }
    handleRaw(raw) {
        let message;
        try {
            const parsed = JSON.parse(raw);
            message = {
                topic: typeof parsed.topic === "string" ? parsed.topic : "",
                event: typeof parsed.event === "string" ? parsed.event : "",
                payload: parsed.payload && typeof parsed.payload === "object"
                    ? parsed.payload
                    : {},
                ref: typeof parsed.ref === "string" ? parsed.ref : undefined,
                join_ref: typeof parsed.join_ref === "string" ? parsed.join_ref : undefined,
            };
        }
        catch {
            return;
        }
        if (message.topic === "phoenix") {
            if (message.ref && message.ref === this.heartbeatRef) {
                this.ping = Math.max(1, Math.round(Date.now() - this.heartbeatAt));
                this.heartbeatRef = "";
                this.missed = 0;
            }
            return;
        }
        for (const channel of this.channels.values()) {
            if (channel.topic === message.topic) {
                channel.handle(message);
                return;
            }
        }
    }
    nextRef() {
        this.refCounter += 1;
        return String(this.refCounter);
    }
    push(message) {
        if (!this.socket || this.status !== "open")
            return;
        try {
            this.socket.send(JSON.stringify(message));
        }
        catch {
            // Разрыв соединения обработает onclose.
        }
    }
    channel(name) {
        const existing = this.channels.get(name);
        if (existing)
            return existing;
        const channel = new Channel(name, this);
        this.channels.set(name, channel);
        if (this.status === "open")
            channel.join();
        return channel;
    }
    dropChannel(name) {
        this.channels.delete(name);
    }
    close() {
        this.closedByUser = true;
        this.stopHeartbeat();
        this.channels.clear();
        const socket = this.socket;
        this.socket = null;
        this.status = "closed";
        if (!socket)
            return;
        if (socket.readyState === WebSocket.CONNECTING)
            return;
        try {
            socket.close(1000, "client closed");
        }
        catch {
            // уже закрыт
        }
    }
}
// ------------------------------------------------------ локальная сеть (netmock)
const BUS_NAME = "school3d-netmock-v1";
/** Как часто повторяем своё presence, чтобы новая вкладка увидела нас. */
const MOCK_ANNOUNCE_MS = 900;
/** Сколько ждём молчаливого соседа, прежде чем считать, что он ушёл. */
const MOCK_PEER_TIMEOUT = 4500;
const MOCK_TICK_MS = 300;
function isBusMessage(value) {
    if (!value || typeof value !== "object")
        return false;
    const message = value;
    return typeof message.r === "string" && typeof message.f === "string" && typeof message.k === "string";
}
/**
 * Шина между вкладками одного браузера.
 * BroadcastChannel — основной путь, localStorage — запасной.
 */
function createLocalBus() {
    const handlers = [];
    const emit = (message) => {
        for (const handler of handlers)
            handler(message);
    };
    const onMessage = (handler) => {
        handlers.push(handler);
    };
    const BusCtor = globalThis.BroadcastChannel;
    if (BusCtor) {
        const bus = new BusCtor(BUS_NAME);
        bus.onmessage = (event) => {
            if (isBusMessage(event.data))
                emit(event.data);
        };
        return {
            kind: "broadcast",
            post: (message) => {
                try {
                    bus.postMessage(message);
                }
                catch {
                    // вкладка закрывается
                }
            },
            onMessage,
            close: () => {
                try {
                    bus.close();
                }
                catch {
                    // уже закрыт
                }
            },
        };
    }
    const storage = (() => {
        try {
            return typeof localStorage !== "undefined" ? localStorage : null;
        }
        catch {
            return null;
        }
    })();
    if (storage && typeof addEventListener === "function") {
        let seq = 0;
        const listener = (event) => {
            if (event.key !== BUS_NAME || !event.newValue)
                return;
            try {
                const parsed = JSON.parse(event.newValue);
                if (isBusMessage(parsed))
                    emit(parsed);
            }
            catch {
                // мусор в хранилище
            }
        };
        addEventListener("storage", listener);
        return {
            kind: "storage",
            post: (message) => {
                seq += 1;
                try {
                    storage.setItem(BUS_NAME, JSON.stringify({ ...message, seq, at: Date.now() }));
                }
                catch {
                    // приватный режим
                }
            },
            onMessage,
            close: () => removeEventListener("storage", listener),
        };
    }
    return { kind: "none", post: () => { }, onMessage, close: () => { } };
}
class LoopChannel {
    name;
    client;
    handlers = new Map();
    presenceHandlers = [];
    members = new Map();
    seen = new Map();
    meta = null;
    announced = 0;
    left = false;
    constructor(name, client) {
        this.name = name;
        this.client = client;
    }
    on(event, handler) {
        const list = this.handlers.get(event);
        if (list)
            list.push(handler);
        else
            this.handlers.set(event, [handler]);
    }
    onPresence(handler) {
        this.presenceHandlers.push(handler);
    }
    ready() {
        return Promise.resolve(!this.left);
    }
    presence() {
        return this.members;
    }
    send(event, payload) {
        if (this.left)
            return;
        const copy = clonePayload(payload);
        // Своё эхо — как у Supabase с broadcast.self = true.
        setTimeout(() => this.deliver(event, copy), this.client.latency);
        this.client.bus.post({ k: "b", r: this.name, f: this.client.id, e: event, p: copy });
    }
    track(meta) {
        if (this.left)
            return;
        this.meta = clonePayload(meta);
        this.members.set(this.client.id, this.meta);
        this.seen.set(this.client.id, Date.now());
        this.announce();
        this.notify();
    }
    leave() {
        if (this.left)
            return;
        this.left = true;
        this.client.bus.post({ k: "bye", r: this.name, f: this.client.id });
        this.members.clear();
        this.seen.clear();
        this.client.dropChannel(this.name);
    }
    /** Зашли в канал: спрашиваем, кто ещё тут. */
    join() {
        this.client.bus.post({ k: "who", r: this.name, f: this.client.id });
        if (this.meta)
            this.announce();
    }
    handleBus(message) {
        if (this.left || message.r !== this.name || message.f === this.client.id)
            return;
        switch (message.k) {
            case "b": {
                const event = message.e;
                if (!event)
                    return;
                const payload = message.p ?? {};
                setTimeout(() => this.deliver(event, payload), this.client.latency);
                return;
            }
            case "p": {
                this.members.set(message.f, message.m ?? {});
                this.seen.set(message.f, Date.now());
                this.notify();
                return;
            }
            case "who": {
                // Новичок спрашивает состав — отвечаем сразу.
                if (this.meta)
                    this.announce();
                return;
            }
            case "bye": {
                if (!this.members.delete(message.f))
                    return;
                this.seen.delete(message.f);
                this.notify();
                return;
            }
            default:
                return;
        }
    }
    /** Периодически: повторить себя и выкинуть молчащих. */
    tick(now) {
        if (this.left)
            return;
        if (this.meta && now - this.announced >= MOCK_ANNOUNCE_MS)
            this.announce();
        let changed = false;
        for (const [id, at] of [...this.seen]) {
            if (id === this.client.id)
                continue;
            if (now - at <= MOCK_PEER_TIMEOUT)
                continue;
            this.seen.delete(id);
            this.members.delete(id);
            changed = true;
        }
        if (changed)
            this.notify();
    }
    announce() {
        if (!this.meta)
            return;
        this.announced = Date.now();
        this.client.bus.post({ k: "p", r: this.name, f: this.client.id, m: this.meta });
    }
    deliver(event, payload) {
        if (this.left)
            return;
        const handlers = this.handlers.get(event);
        if (!handlers)
            return;
        for (const handler of handlers)
            handler(payload);
    }
    notify() {
        for (const handler of this.presenceHandlers)
            handler();
    }
}
/**
 * Локальная сеть без интернета: ?netmock=1 и автотесты.
 * Видит все вкладки одного браузера и профиля, но не другие профили/компьютеры.
 */
export class LoopbackClient {
    id = randomId();
    bus = createLocalBus();
    latency;
    status = "idle";
    ping;
    lastError = "";
    channels = new Map();
    timer = null;
    constructor(latency = 30) {
        this.latency = latency;
        this.ping = Math.max(1, Math.round(latency * 0.8));
        this.bus.onMessage((message) => {
            const channel = this.channels.get(message.r);
            if (channel)
                channel.handleBus(message);
        });
        if (this.bus.kind === "none") {
            this.lastError = "Браузер не дал связать вкладки — локальная сеть работает в одном окне";
        }
    }
    get transport() {
        return this.bus.kind;
    }
    async connect() {
        this.status = "connecting";
        await delay(this.latency);
        this.status = "open";
        if (this.timer === null) {
            this.timer = setInterval(() => {
                const now = Date.now();
                for (const channel of this.channels.values())
                    channel.tick(now);
            }, MOCK_TICK_MS);
        }
        return true;
    }
    channel(name) {
        const existing = this.channels.get(name);
        if (existing)
            return existing;
        const channel = new LoopChannel(name, this);
        this.channels.set(name, channel);
        channel.join();
        return channel;
    }
    dropChannel(name) {
        this.channels.delete(name);
    }
    close() {
        for (const channel of [...this.channels.values()])
            channel.leave();
        this.channels.clear();
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.status = "closed";
        this.bus.close();
    }
}
//# sourceMappingURL=realtime.js.map