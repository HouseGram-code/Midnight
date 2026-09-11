/**
 * УПРАВЛЕНИЕ С ТЕЛЕФОНА (Android и iPhone).
 *
 * Модуль ничего не знает про игру: он превращает касания в те же самые
 * события, что и клавиатура (WASD через аналоговые оси, E, F, Shift, C,
 * пробел, T, Esc, цифры пояса). Поэтому игровая логика осталась нетронутой.
 *
 * Раскладка:
 *   • левый низ  — стик движения, полный наклон вперёд = бег;
 *   • правая часть экрана — обзор пальцем;
 *   • правый низ — крупные кнопки действий;
 *   • правый верх — пауза, карта, чат, полный экран;
 *   • низ по центру — пояс предметов 1…6.
 */
/** Телефон или планшет. Мышь такую проверку не проходит. */
export function isTouchDevice() {
    if (typeof window === "undefined")
        return false;
    const forced = new URLSearchParams(window.location.search).get("touch");
    if (forced === "1")
        return true;
    if (forced === "0")
        return false;
    const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;
    const points = navigator.maxTouchPoints ?? 0;
    return coarse && points > 0;
}
/** Радиус стика в пикселях. */
const STICK_RADIUS = 60;
/** Мёртвая зона: палец дрожит, персонаж — нет. */
const DEAD_ZONE = 0.14;
/** Множитель чувствительности обзора относительно мышиной. */
const LOOK_SCALE = 1.9;
/** По вертикали палец должен быть спокойнее — иначе камера прыгает. */
const LOOK_PITCH_SCALE = 0.82;
/** Сглаживание обзора: 0 — резко, 1 — очень мягко. */
const LOOK_SMOOTH = 0.55;
/** Короткая вибрация под пальцем: так кнопки ощущаются живыми. */
function buzz(ms) {
    try {
        navigator.vibrate?.(ms);
    }
    catch {
        // Вибрация — необязательная роскошь.
    }
}
export class TouchControls {
    input;
    callbacks;
    enabled;
    root = null;
    knob = null;
    stickBase = null;
    chatBtn = null;
    stickId = -1;
    lookId = -1;
    lastLookX = 0;
    lastLookY = 0;
    stickCenterX = 0;
    stickCenterY = 0;
    zone = null;
    /** Накопленный за кадр обзор — отдаём его плавно в frame(). */
    lookVelX = 0;
    lookVelY = 0;
    sprintAuto = false;
    sprintManual = false;
    sprintOn = false;
    held = new Set();
    constructor(input, callbacks) {
        this.input = input;
        this.callbacks = callbacks;
        this.enabled = isTouchDevice();
        if (!this.enabled)
            return;
        document.body.dataset.touch = "1";
        this.build();
    }
    /** Показывать управление только во время игры. */
    setVisible(visible) {
        const root = this.root;
        if (!root)
            return;
        if (root.hidden !== visible) {
            // hidden уже в нужном состоянии
        }
        if (root.hidden === !visible)
            return;
        root.hidden = !visible;
        if (!visible)
            this.releaseAll();
    }
    /** Кнопка чата нужна только в онлайне. */
    setOnline(online) {
        if (this.chatBtn)
            this.chatBtn.hidden = !online;
    }
    // ------------------------------------------------------------------ вёрстка
    build() {
        const root = document.createElement("div");
        root.className = "touch";
        root.hidden = true;
        const look = document.createElement("div");
        look.className = "touch__look";
        root.append(look);
        // Зона движения: вся левая половина низа экрана. Стик появляется
        // ровно там, где коснулись — не нужно целиться в кружок.
        const zone = document.createElement("div");
        zone.className = "touch__zone";
        root.append(zone);
        const stick = document.createElement("div");
        stick.className = "touch__stick";
        const knob = document.createElement("i");
        knob.className = "touch__knob";
        stick.append(knob);
        root.append(stick);
        const actions = document.createElement("div");
        actions.className = "touch__actions";
        root.append(actions);
        const top = document.createElement("div");
        top.className = "touch__top";
        root.append(top);
        const belt = document.createElement("div");
        belt.className = "touch__belt";
        root.append(belt);
        document.body.append(root);
        this.root = root;
        this.stickBase = stick;
        this.knob = knob;
        this.zone = zone;
        this.parkStick();
        // Правый низ: то, чем играют постоянно.
        this.addButton(actions, {
            label: "Взять",
            hint: "держать",
            code: "KeyE",
            className: "touch__btn touch__btn--main",
        });
        this.addButton(actions, { label: "🔦", hint: "фонарь", code: "KeyF", tap: true });
        const sprint = this.addButton(actions, { label: "🏃", hint: "бег" });
        sprint.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            this.sprintManual = !this.sprintManual;
            sprint.dataset.on = this.sprintManual ? "1" : "";
            this.applySprint();
        });
        this.addButton(actions, { label: "🧎", hint: "сесть", code: "KeyC", toggle: true });
        this.addButton(actions, { label: "⤴", hint: "прыжок", code: "Space", tap: true });
        // Правый верх: служебное.
        this.addButton(top, { label: "⏸", code: "Escape", tap: true, className: "touch__btn touch__btn--small" });
        this.addButton(top, { label: "🗺", code: "KeyM", tap: true, className: "touch__btn touch__btn--small" });
        this.chatBtn = this.addButton(top, {
            label: "💬",
            code: "KeyT",
            tap: true,
            className: "touch__btn touch__btn--small",
        });
        this.chatBtn.hidden = true;
        this.addButton(top, {
            label: "⛶",
            press: () => this.toggleFullscreen(),
            className: "touch__btn touch__btn--small",
        });
        // Пояс предметов.
        for (let i = 1; i <= 6; i += 1) {
            this.addButton(belt, {
                label: String(i),
                code: `Digit${i}`,
                tap: true,
                className: "touch__btn touch__btn--slot",
            });
        }
        zone.addEventListener("pointerdown", this.onStickDown);
        stick.addEventListener("pointerdown", this.onStickDown);
        look.addEventListener("pointerdown", this.onLookDown);
        window.addEventListener("pointermove", this.onPointerMove, { passive: false });
        window.addEventListener("pointerup", this.onPointerUp);
        window.addEventListener("pointercancel", this.onPointerUp);
        // Safari на iPhone зумит по двойному тапу и щипку — гасим оба жеста.
        document.addEventListener("gesturestart", (event) => event.preventDefault());
        document.addEventListener("dblclick", (event) => event.preventDefault());
    }
    addButton(parent, spec) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = spec.className ?? "touch__btn";
        const label = document.createElement("span");
        label.textContent = spec.label;
        button.append(label);
        if (spec.hint) {
            const hint = document.createElement("i");
            hint.textContent = spec.hint;
            button.append(hint);
        }
        parent.append(button);
        if (spec.press) {
            button.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                spec.press?.();
            });
            return button;
        }
        const code = spec.code;
        if (!code)
            return button;
        if (spec.toggle) {
            button.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                const on = !this.held.has(code);
                button.dataset.on = on ? "1" : "";
                this.key(on ? "keydown" : "keyup", code);
            });
            return button;
        }
        if (spec.tap) {
            button.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                button.dataset.on = "1";
                this.key("keydown", code);
                window.setTimeout(() => {
                    this.key("keyup", code);
                    button.dataset.on = "";
                }, 70);
            });
            return button;
        }
        // Кнопка удержания: держим клавишу, пока палец на экране.
        button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            button.dataset.on = "1";
            this.key("keydown", code);
        });
        const release = () => {
            if (!this.held.has(code))
                return;
            button.dataset.on = "";
            this.key("keyup", code);
        };
        button.addEventListener("pointerup", release);
        button.addEventListener("pointercancel", release);
        button.addEventListener("pointerleave", release);
        return button;
    }
    // ------------------------------------------------------------------ касания
    onStickDown = (event) => {
        if (this.stickId >= 0 || !this.stickBase)
            return;
        this.stickId = event.pointerId;
        // Центр стика — точка касания.
        this.stickCenterX = event.clientX;
        this.stickCenterY = event.clientY;
        this.stickBase.style.left = `${event.clientX}px`;
        this.stickBase.style.top = `${event.clientY}px`;
        this.stickBase.style.bottom = "auto";
        this.stickBase.dataset.on = "1";
        try {
            ;
            event.target.setPointerCapture?.(event.pointerId);
        }
        catch {
            // Захват пальца — только улучшение, без него тоже работает.
        }
        this.moveStick(event.clientX, event.clientY);
        event.preventDefault();
    };
    onLookDown = (event) => {
        if (this.lookId >= 0)
            return;
        this.lookId = event.pointerId;
        this.lastLookX = event.clientX;
        this.lastLookY = event.clientY;
        try {
            ;
            event.target.setPointerCapture?.(event.pointerId);
        }
        catch {
            // не критично
        }
        event.preventDefault();
    };
    onPointerMove = (event) => {
        if (event.pointerId === this.stickId) {
            this.moveStick(event.clientX, event.clientY);
            event.preventDefault();
            return;
        }
        if (event.pointerId !== this.lookId)
            return;
        // Браузер может склеить несколько движений в одно событие:
        // берём все точки, иначе обзор рвётся на низком FPS.
        const points = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
        const samples = points.length > 0 ? points : [event];
        let dx = 0;
        let dy = 0;
        for (const point of samples) {
            dx += point.clientX - this.lastLookX;
            dy += point.clientY - this.lastLookY;
            this.lastLookX = point.clientX;
            this.lastLookY = point.clientY;
        }
        if (this.callbacks.isTyping())
            return;
        const step = this.input.sensitivity * LOOK_SCALE;
        this.lookVelX += dx * step;
        this.lookVelY += dy * step * LOOK_PITCH_SCALE;
        event.preventDefault();
    };
    /**
     * Вызывается каждый кадр: отдаёт накопленный обзор порциями,
     * чтобы камера шла плавно даже при рваных событиях тачскрина.
     */
    frame() {
        if (!this.enabled)
            return;
        if (this.lookVelX === 0 && this.lookVelY === 0)
            return;
        const takeX = this.lookVelX * LOOK_SMOOTH;
        const takeY = this.lookVelY * LOOK_SMOOTH;
        this.lookVelX -= takeX;
        this.lookVelY -= takeY;
        if (Math.abs(this.lookVelX) < 0.01)
            this.lookVelX = 0;
        if (Math.abs(this.lookVelY) < 0.01)
            this.lookVelY = 0;
        this.input.addLook(takeX, takeY);
    }
    /** Вернуть стик в базовый угол между касаниями. */
    parkStick() {
        const stick = this.stickBase;
        if (!stick)
            return;
        stick.dataset.on = "";
        stick.style.left = "";
        stick.style.top = "";
        stick.style.bottom = "";
        if (this.knob)
            this.knob.style.transform = "translate(0px, 0px)";
    }
    onPointerUp = (event) => {
        if (event.pointerId === this.stickId) {
            this.stickId = -1;
            this.input.padX = 0;
            this.input.padY = 0;
            this.parkStick();
            if (this.sprintAuto) {
                this.sprintAuto = false;
                this.applySprint();
            }
            return;
        }
        if (event.pointerId === this.lookId)
            this.lookId = -1;
    };
    moveStick(clientX, clientY) {
        let dx = clientX - this.stickCenterX;
        let dy = clientY - this.stickCenterY;
        const length = Math.hypot(dx, dy);
        if (length > STICK_RADIUS) {
            dx = (dx / length) * STICK_RADIUS;
            dy = (dy / length) * STICK_RADIUS;
        }
        const nx = dx / STICK_RADIUS;
        const ny = dy / STICK_RADIUS;
        const power = Math.hypot(nx, ny);
        const scale = power < DEAD_ZONE ? 0 : Math.min(1, (power - DEAD_ZONE) / (1 - DEAD_ZONE));
        if (power > 1e-4 && scale > 0) {
            this.input.padX = (nx / power) * scale;
            this.input.padY = (-ny / power) * scale;
        }
        else {
            this.input.padX = 0;
            this.input.padY = 0;
        }
        if (this.knob)
            this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
        // Полный наклон вперёд — побежали.
        const wantSprint = scale > 0.88 && -ny > 0.42;
        if (wantSprint !== this.sprintAuto) {
            this.sprintAuto = wantSprint;
            this.applySprint();
            if (wantSprint)
                buzz(12);
        }
    }
    applySprint() {
        const want = this.sprintAuto || this.sprintManual;
        if (want === this.sprintOn)
            return;
        this.sprintOn = want;
        this.key(want ? "keydown" : "keyup", "ShiftLeft");
    }
    key(type, code) {
        if (type === "keydown")
            this.held.add(code);
        else
            this.held.delete(code);
        window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    }
    releaseAll() {
        this.input.padX = 0;
        this.input.padY = 0;
        this.stickId = -1;
        this.lookId = -1;
        this.sprintAuto = false;
        this.sprintManual = false;
        this.sprintOn = false;
        this.lookVelX = 0;
        this.lookVelY = 0;
        this.parkStick();
        for (const code of Array.from(this.held))
            this.key("keyup", code);
        this.held.clear();
        if (!this.root)
            return;
        for (const element of Array.from(this.root.querySelectorAll("[data-on]"))) {
            ;
            element.dataset.on = "";
        }
    }
    toggleFullscreen() {
        const element = document.documentElement;
        if (document.fullscreenElement) {
            void document.exitFullscreen?.();
            return;
        }
        if (element.requestFullscreen) {
            void element.requestFullscreen().catch(() => undefined);
        }
        else {
            element.webkitRequestFullscreen?.();
        }
        const orientation = screen.orientation;
        void orientation?.lock?.("landscape").catch(() => undefined);
    }
}
//# sourceMappingURL=touch.js.map