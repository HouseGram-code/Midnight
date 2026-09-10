/**
 * Управление с клавиатуры и мыши (только ПК на этом этапе).
 *
 * Использует Pointer Lock API: после клика мышь захватывается и камера
 * крутится как в любом шутере. Esc отпускает курсор.
 * Коды клавиш берутся из event.code — работает на любой раскладке (в т.ч. русской).
 */
const KEY_MAP = {
    KeyW: "forward",
    ArrowUp: "forward",
    KeyS: "back",
    ArrowDown: "back",
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right",
    Space: "jump",
    ShiftLeft: "sprint",
    ShiftRight: "sprint",
    KeyC: "crouch",
    ControlLeft: "crouch",
};
/** Предел смещения одного события мыши в пикселях: выбросы браузера обрезаем. */
const MAX_EVENT_PIXELS = 260;
/** Предел поворота за один кадр в радианах — страховка от рывка камеры. */
const MAX_FRAME_TURN = 0.65;
const clampSpike = (value) => {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(-MAX_EVENT_PIXELS, Math.min(MAX_EVENT_PIXELS, value));
};
const clampTurn = (value) => Math.max(-MAX_FRAME_TURN, Math.min(MAX_FRAME_TURN, value));
export class Input {
    pressed = new Set();
    onceHandlers = new Map();
    mouseDeltaX = 0;
    mouseDeltaY = 0;
    /** Аналоговый стик с телефона: -1…1 по каждой оси. */
    padX = 0;
    padY = 0;
    pointerLocked = false;
    sensitivity;
    /** Первое событие сразу после захвата курсора игнорируем. */
    skipNextMove = false;
    canvas;
    constructor(canvas, sensitivity) {
        this.canvas = canvas;
        this.sensitivity = sensitivity;
        window.addEventListener("keydown", this.handleKeyDown, { passive: false });
        window.addEventListener("keyup", this.handleKeyUp);
        window.addEventListener("blur", this.releaseAll);
        document.addEventListener("pointerlockchange", this.handlePointerLockChange);
        document.addEventListener("mousemove", this.handleMouseMove);
    }
    /** Подписка на одиночное нажатие клавиши (event.code). */
    onKey(code, handler) {
        const list = this.onceHandlers.get(code) ?? [];
        list.push(handler);
        this.onceHandlers.set(code, list);
    }
    isDown(action) {
        return this.pressed.has(action);
    }
    /** Ось вперёд/назад в диапазоне -1..1. */
    get moveForward() {
        const keys = (this.isDown("forward") ? 1 : 0) - (this.isDown("back") ? 1 : 0);
        return keys !== 0 ? keys : this.padY;
    }
    get moveRight() {
        const keys = (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0);
        return keys !== 0 ? keys : this.padX;
    }
    /** Поворот от пальца на экране — уже в радианах. */
    addLook(dx, dy) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy))
            return;
        this.mouseDeltaX += dx;
        this.mouseDeltaY += dy;
    }
    /**
     * Захват мыши. Никогда не бросает и не оставляет отклонённый промис:
     * браузер отказывает, если запрос пришёл не из жеста пользователя
     * (а кат-сцена идёт дольше минуты). Возвращает true, если мышь захвачена.
     */
    async requestPointerLock() {
        const attempt = async (options) => {
            try {
                const request = this.canvas.requestPointerLock;
                const maybePromise = request.call(this.canvas, options);
                if (maybePromise && typeof maybePromise.then === "function") {
                    await maybePromise.catch(() => undefined);
                }
            }
            catch {
                /* игнорируем: ниже вернём false */
            }
        };
        await attempt({ unadjustedMovement: true });
        if (document.pointerLockElement === this.canvas)
            return true;
        // Браузер без unadjustedMovement — пробуем обычный захват.
        await attempt();
        return document.pointerLockElement === this.canvas;
    }
    exitPointerLock() {
        if (document.pointerLockElement)
            document.exitPointerLock();
    }
    /**
     * Отдаёт накопленный поворот в радианах и обнуляет счётчик —
     * вызывать один раз за кадр.
     */
    consumeMouseDelta() {
        const x = clampTurn(this.mouseDeltaX);
        const y = clampTurn(this.mouseDeltaY);
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
        return { x, y };
    }
    /** Забыть накопленное смещение (после заставки, паузы, смены окна). */
    resetMouse() {
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
        this.skipNextMove = true;
    }
    handleKeyDown = (event) => {
        const action = KEY_MAP[event.code];
        if (action) {
            this.pressed.add(action);
            if (event.code === "Space")
                event.preventDefault();
        }
        if (!event.repeat) {
            const handlers = this.onceHandlers.get(event.code);
            if (handlers) {
                event.preventDefault();
                for (const handler of handlers)
                    handler();
            }
        }
    };
    handleKeyUp = (event) => {
        const action = KEY_MAP[event.code];
        if (action)
            this.pressed.delete(action);
    };
    releaseAll = () => {
        this.pressed.clear();
        this.padX = 0;
        this.padY = 0;
    };
    handlePointerLockChange = () => {
        this.pointerLocked = document.pointerLockElement === this.canvas;
        // И при захвате, и при отпускании курсора старое смещение больше не нужно.
        this.resetMouse();
        if (!this.pointerLocked)
            this.releaseAll();
    };
    handleMouseMove = (event) => {
        if (!this.pointerLocked)
            return;
        // Сразу после захвата браузер присылает разницу с прежней позицией курсора —
        // это сотни пикселей, из-за которых камера срывалась в разворот.
        if (this.skipNextMove) {
            this.skipNextMove = false;
            return;
        }
        // Смещение приходит в пикселях: переводим в радианы чувствительностью.
        this.mouseDeltaX += clampSpike(event.movementX) * this.sensitivity;
        this.mouseDeltaY += clampSpike(event.movementY) * this.sensitivity;
    };
}
//# sourceMappingURL=input.js.map