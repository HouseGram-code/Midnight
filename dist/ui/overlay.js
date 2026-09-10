/** Экраны поверх игры: загрузка, старт, пауза, ошибка. */
import { requireElement, setHidden, setText } from "./dom.js";
export class Overlay {
    loading = requireElement("loading");
    loadingText = requireElement("loading-text");
    start = requireElement("start");
    startButton = requireElement("start-play");
    pause = requireElement("pause");
    pauseButton = requireElement("pause-resume");
    error = requireElement("error");
    errorText = requireElement("error-text");
    setLoading(text) {
        if (text === null) {
            setHidden(this.loading, true);
            return;
        }
        setText(this.loadingText, text);
        setHidden(this.loading, false);
    }
    showStart() {
        setHidden(this.start, false);
    }
    hideStart() {
        setHidden(this.start, true);
    }
    showPause() {
        setHidden(this.pause, false);
    }
    hidePause() {
        setHidden(this.pause, true);
    }
    get pauseVisible() {
        return !this.pause.hidden;
    }
    showError(message) {
        setText(this.errorText, message);
        setHidden(this.error, false);
        setHidden(this.loading, true);
    }
    onStart(handler) {
        this.startButton.addEventListener("click", handler);
    }
    onResume(handler) {
        this.pauseButton.addEventListener("click", handler);
    }
}
//# sourceMappingURL=overlay.js.map