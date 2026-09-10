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
import { randomId } from "./realtime.js";
export const LOBBY_NAME = "school3d-lobby-v1";
export const CODE_ROOM_PREFIX = "school3d-code-v1-";
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;
export const SEARCH_SECONDS = 25;
/** Как часто шлём своё положение и учительницу. */
export const STATE_HZ = 8;
export const TEACHER_HZ = 6;
function cleanName(raw) {
    const text = raw.replace(/\s+/g, " ").trim().slice(0, 14);
    return text.length > 0 ? text : "Игрок";
}
export class OnlineSession {
    client;
    events;
    owner;
    id;
    name;
    phase = "idle";
    match = null;
    room = null;
    lobby = null;
    searchStart = 0;
    members = [];
    tick = 0;
    lastCountdown = -1;
    alonePinged = false;
    codeRoom = "";
    codeHost = false;
    constructor(client, name, events = {}, owner = false) {
        this.client = client;
        this.events = events;
        this.owner = owner;
        this.id = client.id;
        this.name = cleanName(name);
    }
    get ping() {
        return this.client.ping;
    }
    get roster() {
        return this.members;
    }
    get searchers() {
        return this.members
            .filter((member) => member.searching && !member.playing)
            .sort((a, b) => (a.since === b.since ? (a.id < b.id ? -1 : 1) : a.since - b.since));
    }
    get isHost() {
        return this.match ? this.match.host === this.id : false;
    }
    get isCodeRoom() {
        return this.codeRoom.length > 0;
    }
    get isCodeHost() {
        return this.isCodeRoom && this.codeHost;
    }
    setPhase(phase, detail) {
        if (this.phase === phase && !detail)
            return;
        this.phase = phase;
        this.events.onPhase?.(phase, detail);
    }
    /** Подключиться и зайти в лобби. */
    async enter(lobbyName = LOBBY_NAME) {
        this.setPhase("connecting");
        const ok = await this.client.connect();
        if (!ok) {
            this.setPhase("idle", this.client.lastError || "Не вышло подключиться к серверу");
            return false;
        }
        const lobby = this.client.channel(lobbyName);
        this.lobby = lobby;
        lobby.onPresence(() => this.readPresence());
        lobby.on("match", (payload) => this.handleMatch(payload));
        this.publish();
        const joined = await Promise.race([
            lobby.ready(),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!joined) {
            lobby.leave();
            this.lobby = null;
            this.setPhase("idle", this.client.lastError || "Сервер не подтвердил вход в онлайн-комнату");
            return false;
        }
        this.setPhase("lobby");
        return true;
    }
    async enterCodeRoom(code, asHost) {
        this.codeRoom = code;
        this.codeHost = asHost;
        const ok = await this.enter(`${CODE_ROOM_PREFIX}${code}`);
        if (ok)
            this.startSearch();
        return ok;
    }
    setName(raw) {
        this.name = cleanName(raw);
        this.publish();
    }
    publish() {
        this.lobby?.track({
            id: this.id,
            name: this.name,
            owner: this.owner,
            searching: this.phase === "searching" || this.phase === "found",
            playing: this.phase === "match",
            since: this.searchStart,
        });
    }
    readPresence() {
        const list = [];
        for (const meta of this.lobby?.presence().values() ?? []) {
            const id = typeof meta.id === "string" ? meta.id : "";
            if (!id)
                continue;
            list.push({
                id,
                name: typeof meta.name === "string" ? meta.name : "Игрок",
                owner: Boolean(meta.owner) && String(meta.name ?? "").trim().toLowerCase() === "goh",
                searching: Boolean(meta.searching),
                playing: Boolean(meta.playing),
                since: typeof meta.since === "number" ? meta.since : 0,
            });
        }
        this.members = list;
        this.events.onRoster?.(list);
    }
    /** Начать поиск игроков. */
    startSearch() {
        if (this.phase === "match")
            return;
        this.searchStart = Date.now();
        this.alonePinged = false;
        this.setPhase("searching");
        this.publish();
    }
    cancelSearch() {
        if (this.phase !== "searching" && this.phase !== "found")
            return;
        this.searchStart = 0;
        this.setPhase("lobby");
        this.publish();
    }
    /** Вызывается каждый кадр панели онлайна. */
    update(dt) {
        if (this.phase !== "searching")
            return;
        this.tick += dt;
        const elapsed = (Date.now() - this.searchStart) / 1000;
        const left = Math.max(0, Math.ceil(SEARCH_SECONDS - elapsed));
        const found = this.searchers.length;
        if (left !== this.lastCountdown) {
            this.lastCountdown = left;
            this.events.onCountdown?.(left, found);
        }
        if (this.tick < 0.4)
            return;
        this.tick = 0;
        if (this.isCodeRoom)
            return;
        this.evaluate(elapsed);
    }
    startCodeMatch() {
        if (!this.isCodeHost || this.phase !== "searching")
            return false;
        const group = this.searchers.slice(0, MAX_PLAYERS);
        if (group.length < MIN_PLAYERS)
            return false;
        const info = {
            room: `school3d-room-${this.codeRoom}-${randomId()}`,
            host: this.id,
            players: group.map((member, index) => ({ id: member.id, name: member.name, owner: member.owner, index })),
            startIn: 3200,
        };
        this.lobby?.send("match", info);
        return true;
    }
    evaluate(elapsed) {
        const searchers = this.searchers;
        const host = searchers[0];
        if (!host || host.id !== this.id)
            return;
        const group = searchers.slice(0, MAX_PLAYERS);
        const full = group.length >= MAX_PLAYERS;
        const ready = elapsed >= SEARCH_SECONDS && group.length >= MIN_PLAYERS;
        if (!full && !ready) {
            if (elapsed >= SEARCH_SECONDS && !this.alonePinged) {
                // Никого не нашли — говорим об этом и ждём дальше.
                this.alonePinged = true;
                this.searchStart = Date.now();
                this.events.onAlone?.();
            }
            return;
        }
        const info = {
            room: `school3d-room-${randomId()}`,
            host: this.id,
            players: group.map((member, index) => ({ id: member.id, name: member.name, owner: member.owner, index })),
            startIn: 3200,
        };
        this.lobby?.send("match", info);
    }
    handleMatch(payload) {
        if (this.phase === "match" || this.phase === "found")
            return;
        const room = typeof payload.room === "string" ? payload.room : "";
        const host = typeof payload.host === "string" ? payload.host : "";
        const rawPlayers = Array.isArray(payload.players) ? payload.players : [];
        const players = [];
        for (const item of rawPlayers) {
            const entry = item;
            if (typeof entry.id !== "string")
                continue;
            players.push({
                id: entry.id,
                name: typeof entry.name === "string" ? entry.name : "Игрок",
                owner: Boolean(entry.owner) && String(entry.name ?? "").trim().toLowerCase() === "goh",
                index: typeof entry.index === "number" ? entry.index : players.length,
            });
        }
        if (!room || !players.some((player) => player.id === this.id))
            return;
        const info = {
            room,
            host,
            players,
            startIn: typeof payload.startIn === "number" ? payload.startIn : 3200,
        };
        this.match = info;
        this.setPhase("found");
        this.joinRoom(info);
        this.events.onMatch?.(info);
    }
    joinRoom(info) {
        const channel = this.client.channel(info.room);
        this.room = channel;
        channel.track({ id: this.id, name: this.name, owner: this.owner });
        channel.on("c", (payload) => {
            const text = typeof payload.m === "string" ? payload.m : "";
            if (!text)
                return;
            this.events.onChat?.({
                name: typeof payload.n === "string" ? payload.n : "Игрок",
                text,
                system: Boolean(payload.s),
            });
        });
        this.setPhase("match");
        this.publish();
    }
    /** Сообщение в чат матча. */
    sendChat(text) {
        const message = text.replace(/\s+/g, " ").trim().slice(0, 90);
        if (!message)
            return;
        this.room?.send("c", { n: this.name, m: message, i: this.id });
    }
    sendSystem(text) {
        this.room?.send("c", { n: "", m: text, s: 1, i: this.id });
    }
    leaveMatch() {
        if (this.room) {
            this.room.send("bye", { i: this.id });
            this.room.leave();
            this.room = null;
        }
        this.match = null;
        this.searchStart = 0;
        this.setPhase(this.lobby ? "lobby" : "idle");
        this.publish();
    }
    leave() {
        this.leaveMatch();
        if (this.lobby) {
            this.lobby.leave();
            this.lobby = null;
        }
        this.codeRoom = "";
        this.codeHost = false;
        this.setPhase("idle");
        this.client.close();
    }
}
//# sourceMappingURL=session.js.map