/**
 * Музыка главного меню.
 *
 * Трек длинный (больше трёх минут), поэтому его не декодируем в AudioBuffer —
 * это были бы десятки мегабайт памяти. Обычный тег <audio> стримит файл сам.
 * Внутри игры музыка не звучит: только в меню и на его экранах.
 *
 * Браузеры не дают автозапуск до первого жеста пользователя. Если play()
 * отклонили, ждём первый клик или нажатие клавиши и запускаем снова.
 */
const TRACK = "assets/audio/menu_music.mp3";
const FADE_STEP = 0.05;
const FADE_MS = 55;
export class MenuMusic {
    element;
    target = 0.45;
    wanted = false;
    fadeTimer = null;
    armed = false;
    constructor() {
        this.element = new Audio(TRACK);
        this.element.loop = true;
        this.element.preload = "auto";
        this.element.volume = 0;
    }
    /** Громкость берём из настроек игры. */
    setVolume(value) {
        this.target = Math.max(0, Math.min(1, value));
        if (this.wanted && this.fadeTimer === null)
            this.element.volume = this.target;
    }
    play() {
        if (this.wanted && !this.element.paused) {
            this.fadeTo(this.target);
            return;
        }
        this.wanted = true;
        void this.element
            .play()
            .then(() => this.fadeTo(this.target))
            .catch(() => this.waitForGesture());
    }
    stop() {
        this.wanted = false;
        this.fadeTo(0, () => {
            this.element.pause();
            this.element.currentTime = 0;
        });
    }
    fadeTo(volume, done) {
        this.clearFade();
        const goal = Math.max(0, Math.min(1, volume));
        this.fadeTimer = window.setInterval(() => {
            const current = this.element.volume;
            const next = current < goal ? Math.min(goal, current + FADE_STEP) : Math.max(goal, current - FADE_STEP);
            this.element.volume = next;
            if (Math.abs(next - goal) < 0.005) {
                this.element.volume = goal;
                this.clearFade();
                done?.();
            }
        }, FADE_MS);
    }
    clearFade() {
        if (this.fadeTimer !== null) {
            window.clearInterval(this.fadeTimer);
            this.fadeTimer = null;
        }
    }
    /** Автозапуск заблокирован — стартуем после первого жеста. */
    waitForGesture() {
        if (this.armed)
            return;
        this.armed = true;
        const start = () => {
            window.removeEventListener("pointerdown", start);
            window.removeEventListener("keydown", start);
            this.armed = false;
            if (this.wanted) {
                this.wanted = false;
                this.play();
            }
        };
        window.addEventListener("pointerdown", start);
        window.addEventListener("keydown", start);
    }
}
//# sourceMappingURL=music.js.map