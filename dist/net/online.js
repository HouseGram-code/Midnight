/**
 * Связка сети и игры: что шлём, что принимаем, как сглаживаем.
 *
 * Модель простая и честная для беты:
 *  • каждый игрок — хозяин своего тела и шлёт свою позу 14 раз в секунду;
 *  • учительница живёт только у хоста, остальные видят её по сети;
 *  • предметы, баррикада и свет — общие на всю команду.
 */
import { buildRemotePlayer, skinFor } from "./remote.js";
import { STATE_HZ, TEACHER_HZ } from "./session.js";
const STATE_INTERVAL = 1 / STATE_HZ;
const TEACHER_INTERVAL = 1 / TEACHER_HZ;
function shortestAngle(from, to) {
    let delta = to - from;
    while (delta > Math.PI)
        delta -= Math.PI * 2;
    while (delta < -Math.PI)
        delta += Math.PI * 2;
    return delta;
}
export class OnlineGame {
    session;
    match;
    hooks;
    players = new Map();
    localIndex;
    localSkin;
    isHost;
    /** Последняя поза учительницы с сети — цель для сглаживания. */
    teacherNet = null;
    /** Сглаженная поза: её рисуют все, кто учительницу не считает сам. */
    teacherView = null;
    live = true;
    stateTimer = 0;
    teacherTimer = 0;
    teacherStale = 0;
    localActive = false;
    wasAuthority = false;
    names = new Map();
    constructor(session, match, hooks) {
        this.session = session;
        this.match = match;
        this.hooks = hooks;
        const me = match.players.find((player) => player.id === session.id);
        this.localIndex = me ? me.index : 0;
        this.localSkin = skinFor(this.localIndex);
        this.isHost = match.host === session.id;
        for (const player of match.players) {
            this.names.set(player.id, player.name);
            if (player.id === session.id)
                continue;
            this.players.set(player.id, {
                id: player.id,
                name: player.name,
                index: player.index,
                skin: skinFor(player.index),
                x: 17.5,
                y: 0,
                z: 6,
                yaw: 0,
                speed: 0,
                targetX: 17.5,
                targetY: 0,
                targetZ: 6,
                targetYaw: 0,
                crouching: false,
                hidden: false,
                sitting: true,
                flashlight: false,
                lives: 5,
                items: 0,
                escaped: false,
                down: false,
                active: false,
                phase: player.index * 1.3,
                last: 0,
            });
        }
        this.bind();
    }
    get playerCount() {
        let alive = 1;
        for (const player of this.players.values())
            if (!player.down)
                alive += 1;
        return alive;
    }
    get ping() {
        return this.session.ping;
    }
    /**
     * Кто считает учительницу. Раньше это был только хост, и стоило ему
     * застрять в кат-сцене, погибнуть или выйти — учительница замирала у всех.
     * Теперь ведёт тот из играющих, у кого меньше номер: эстафета живая.
     */
    get authority() {
        if (!this.live || !this.localActive)
            return false;
        for (const player of this.players.values()) {
            if (!player.active)
                continue;
            if (player.index < this.localIndex)
                return false;
        }
        return true;
    }
    /** true ровно в тот кадр, когда мы взяли учительницу на себя. */
    takeAuthority() {
        const now = this.authority;
        const changed = now && !this.wasAuthority;
        this.wasAuthority = now;
        return changed;
    }
    nameOf(id) {
        return this.names.get(id) ?? "Игрок";
    }
    bind() {
        const room = this.session.room;
        if (!room)
            return;
        room.on("s", (payload) => this.applyState(payload));
        room.on("t", (payload) => this.applyTeacherPacket(payload));
        room.on("i", (payload) => {
            const id = String(payload.i ?? "");
            if (id === this.session.id)
                return;
            const kind = String(payload.k ?? "");
            if (kind)
                this.hooks.onItem(kind, this.nameOf(id));
        });
        room.on("g", (payload) => {
            const id = String(payload.i ?? "");
            if (id === this.session.id)
                return;
            const stage = Number(payload.g ?? 0);
            this.hooks.onStage(stage, this.nameOf(id));
        });
        room.on("h", (payload) => {
            if (String(payload.i ?? "") !== this.session.id)
                return;
            this.hooks.onHit();
        });
        room.on("n", () => this.hooks.onLightsOut());
        room.on("e", (payload) => {
            const id = String(payload.i ?? "");
            const player = this.players.get(id);
            if (player)
                player.escaped = true;
            if (id !== this.session.id)
                this.hooks.onToast(`${this.nameOf(id)} выбрался из школы!`);
        });
        room.on("d", (payload) => {
            const id = String(payload.i ?? "");
            const player = this.players.get(id);
            if (player)
                player.down = true;
            if (id !== this.session.id)
                this.hooks.onToast(`${this.nameOf(id)} попался…`);
        });
        room.on("bye", (payload) => {
            const id = String(payload.i ?? "");
            if (!this.players.has(id))
                return;
            this.players.delete(id);
            this.hooks.onToast(`${this.nameOf(id)} вышел из игры`);
        });
        room.on("c", (payload) => {
            const id = String(payload.i ?? "");
            const text = String(payload.m ?? "");
            if (!text)
                return;
            const system = Boolean(payload.s);
            const player = this.players.get(id);
            const color = system
                ? "#9fb0c8"
                : player
                    ? player.skin.tag
                    : id === this.session.id
                        ? this.localSkin.tag
                        : "#cfd8e6";
            this.hooks.onChat(system ? "" : this.nameOf(id), text, color, system);
        });
    }
    applyState(payload) {
        const id = String(payload.i ?? "");
        if (!id || id === this.session.id)
            return;
        let player = this.players.get(id);
        if (!player) {
            const index = Number(payload.p ?? this.players.size + 1);
            player = {
                id,
                name: this.nameOf(id),
                index,
                skin: skinFor(index),
                x: Number(payload.x ?? 0),
                y: Number(payload.y ?? 0),
                z: Number(payload.z ?? 0),
                yaw: Number(payload.a ?? 0),
                speed: 0,
                targetX: Number(payload.x ?? 0),
                targetY: Number(payload.y ?? 0),
                targetZ: Number(payload.z ?? 0),
                targetYaw: Number(payload.a ?? 0),
                crouching: false,
                hidden: false,
                sitting: false,
                flashlight: false,
                lives: 5,
                items: 0,
                escaped: false,
                down: false,
                active: false,
                phase: 0,
                last: 0,
            };
            this.players.set(id, player);
        }
        player.targetX = Number(payload.x ?? player.targetX);
        player.targetY = Number(payload.y ?? player.targetY);
        player.targetZ = Number(payload.z ?? player.targetZ);
        player.targetYaw = Number(payload.a ?? player.targetYaw);
        player.speed = Number(payload.v ?? 0);
        const flags = Number(payload.f ?? 0);
        player.crouching = (flags & 1) !== 0;
        player.hidden = (flags & 2) !== 0;
        player.sitting = (flags & 4) !== 0;
        player.flashlight = (flags & 8) !== 0;
        player.escaped = (flags & 16) !== 0;
        player.down = (flags & 32) !== 0;
        player.active = (flags & 64) !== 0;
        player.lives = Number(payload.l ?? player.lives);
        player.items = Number(payload.k ?? player.items);
        player.last = Date.now();
    }
    applyTeacherPacket(payload) {
        // Свою учительницу чужими пакетами не перебиваем.
        if (this.authority)
            return;
        const next = {
            x: Number(payload.x ?? 38),
            z: Number(payload.z ?? 15),
            yaw: Number(payload.a ?? 0),
            speed: Number(payload.v ?? 0),
            visible: Boolean(payload.o ?? 1),
            alert: Number(payload.r ?? 0),
        };
        this.teacherNet = next;
        if (!this.teacherView)
            this.teacherView = { ...next };
        this.teacherStale = 0;
    }
    /** Отправка своего состояния и сглаживание чужих. */
    update(dt, local) {
        this.localActive = local.active;
        this.updateTeacherView(dt);
        this.stateTimer += dt;
        if (this.stateTimer >= STATE_INTERVAL) {
            this.stateTimer = 0;
            const flags = (local.crouching ? 1 : 0) |
                (local.hidden ? 2 : 0) |
                (local.sitting ? 4 : 0) |
                (local.flashlight ? 8 : 0) |
                (local.escaped ? 16 : 0) |
                (local.down ? 32 : 0) |
                (local.active ? 64 : 0);
            this.session.room?.send("s", {
                i: this.session.id,
                p: this.localIndex,
                x: Math.round(local.x * 100) / 100,
                y: Math.round(local.y * 100) / 100,
                z: Math.round(local.z * 100) / 100,
                a: Math.round(local.yaw * 100) / 100,
                v: Math.round(local.speed * 10) / 10,
                f: flags,
                l: local.lives,
                k: local.items,
            });
        }
        const now = Date.now();
        for (const player of this.players.values()) {
            const blend = Math.min(1, dt * 12);
            player.x += (player.targetX - player.x) * blend;
            player.y += (player.targetY - player.y) * blend;
            player.z += (player.targetZ - player.z) * blend;
            player.yaw += shortestAngle(player.yaw, player.targetYaw) * Math.min(1, dt * 10);
            player.phase += dt * (2.6 + player.speed * 1.7);
            // Пакетов нет больше секунды — считаем, что игрок стоит.
            if (player.last > 0 && now - player.last > 1000)
                player.speed = 0;
        }
    }
    /** Хост рассылает учительницу. */
    pushTeacher(dt, snapshot) {
        if (!this.authority)
            return;
        // Держим свою копию: если эстафету перехватит другой игрок,
        // у нас останется последняя честная поза.
        this.teacherNet = snapshot;
        this.teacherView = { ...snapshot };
        this.teacherStale = 0;
        this.teacherTimer += dt;
        if (this.teacherTimer < TEACHER_INTERVAL)
            return;
        this.teacherTimer = 0;
        this.session.room?.send("t", {
            x: Math.round(snapshot.x * 100) / 100,
            z: Math.round(snapshot.z * 100) / 100,
            a: Math.round(snapshot.yaw * 100) / 100,
            v: Math.round(snapshot.speed * 10) / 10,
            o: snapshot.visible ? 1 : 0,
            r: Math.round(snapshot.alert * 100) / 100,
        });
    }
    /**
     * Сглаживание учительницы у тех, кто её не считает: пакеты идут 14 раз в
     * секунду, между ними тело едет само — иначе она дёргалась и «стояла».
     */
    updateTeacherView(dt) {
        const target = this.teacherNet;
        if (!target)
            return;
        if (!this.teacherView) {
            this.teacherView = { ...target };
            return;
        }
        const view = this.teacherView;
        this.teacherStale += dt;
        const blend = Math.min(1, dt * 11);
        view.x += (target.x - view.x) * blend;
        view.z += (target.z - view.z) * blend;
        view.yaw += shortestAngle(view.yaw, target.yaw) * Math.min(1, dt * 9);
        view.visible = target.visible;
        view.alert = target.alert;
        // Пакетов давно нет — гасим шаг, чтобы ноги не месили воздух.
        view.speed = this.teacherStale > 0.9 ? 0 : target.speed;
    }
    sendItem(kind) {
        this.session.room?.send("i", { i: this.session.id, k: kind });
    }
    sendStage(stage) {
        this.session.room?.send("g", { i: this.session.id, g: stage });
    }
    sendHit(target) {
        this.session.room?.send("h", { i: target });
    }
    sendLightsOut() {
        this.session.room?.send("n", { i: this.session.id });
    }
    sendEscape() {
        this.session.room?.send("e", { i: this.session.id });
    }
    sendDown() {
        this.session.room?.send("d", { i: this.session.id });
    }
    sendChat(text) {
        this.session.sendChat(text);
    }
    /** Геометрия всех чужих игроков в один буфер. */
    buildMesh(mesh) {
        for (const player of this.players.values()) {
            // В шкафчике и после побега не рисуем вовсе.
            if (player.hidden || player.escaped || player.down)
                continue;
            buildRemotePlayer(mesh, {
                x: player.x,
                y: player.y,
                z: player.z,
                yaw: player.yaw,
                speed: player.speed,
                phase: player.phase,
                crouching: player.crouching,
                sitting: player.sitting,
                flashlight: player.flashlight,
                skin: player.skin,
            });
        }
    }
    leave() {
        this.live = false;
        this.session.leaveMatch();
    }
}
//# sourceMappingURL=online.js.map