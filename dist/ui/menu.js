/**
 * Главное меню и настройки.
 *
 * Настройки хранятся в localStorage, поэтому переживают перезагрузку.
 * Всё на обычных DOM-событиях — никаких фреймворков.
 */
import { requireElement, setHidden, setText } from "./dom.js";
import { DIFFICULTY_PRESETS, difficultyOf } from "../game/difficulty.js";
export const GAME_VERSION = "1.0.3-beta";
export const QUALITY_LEVELS = ["auto", "low", "medium", "high"];
const STORAGE_KEY = "school3d.settings.v1";
const DEFAULT_SETTINGS = {
    sensitivity: 1,
    volume: 0.8,
    brightness: 1,
    invertY: false,
    showFps: false,
    quality: "auto",
    difficulty: "normal",
};
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            sensitivity: clamp(Number(parsed.sensitivity ?? 1) || 1, 0.3, 2.5),
            volume: clamp(Number(parsed.volume ?? 0.8), 0, 1),
            brightness: clamp(Number(parsed.brightness ?? 1) || 1, 0.6, 1.6),
            invertY: Boolean(parsed.invertY),
            showFps: Boolean(parsed.showFps),
            quality: QUALITY_LEVELS.includes(parsed.quality)
                ? parsed.quality
                : "auto",
            difficulty: difficultyOf(parsed.difficulty),
        };
    }
    catch {
        return { ...DEFAULT_SETTINGS };
    }
}
export function saveSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    catch {
        // Приватный режим браузера — просто играем без сохранения.
    }
}
/** Android пробуем повернуть автоматически; iPhone показывает аккуратную подсказку. */
export function requestMobileLandscape() {
    if (!matchMedia("(pointer: coarse)").matches && innerWidth > 900)
        return;
    document.body.dataset.landscape = "1";
    const element = document.documentElement;
    try {
        if (!document.fullscreenElement) {
            if (element.requestFullscreen)
                void element.requestFullscreen().catch(() => undefined);
            else
                element.webkitRequestFullscreen?.();
        }
        const orientation = screen.orientation;
        void orientation?.lock?.("landscape").catch(() => undefined);
    }
    catch {
        // iOS Safari не разрешает программный lock — CSS попросит повернуть устройство.
    }
}
export class Menu {
    callbacks;
    screen = requireElement("menu");
    panels = {
        root: requireElement("menu-root"),
        settings: requireElement("menu-settings"),
        controls: requireElement("menu-controls"),
        acts: requireElement("menu-acts"),
        about: requireElement("menu-about"),
        online: requireElement("menu-online"),
    };
    playButton = requireElement("menu-play");
    versionEl = requireElement("menu-version");
    sensitivityInput = requireElement("set-sensitivity");
    volumeInput = requireElement("set-volume");
    brightnessInput = requireElement("set-brightness");
    invertInput = requireElement("set-invert");
    fpsInput = requireElement("set-fps");
    qualityInput = requireElement("set-quality");
    difficultyInput = requireElement("set-difficulty");
    difficultyNote = requireElement("set-difficulty-note");
    sensitivityValue = requireElement("set-sensitivity-value");
    volumeValue = requireElement("set-volume-value");
    brightnessValue = requireElement("set-brightness-value");
    settings;
    panel = "root";
    visible = true;
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.settings = loadSettings();
        setText(this.versionEl, `версия ${GAME_VERSION}`);
        // Кнопка «Играть» ведёт на выбор акта, а не сразу в игру.
        this.playButton.addEventListener("click", () => this.showPanel("acts"));
        const actsNote = requireElement("acts-note");
        requireElement("act-1").addEventListener("click", () => {
            requestMobileLandscape();
            this.callbacks.onPlay(1);
        });
        requireElement("act-2").addEventListener("click", () => {
            setText(actsNote, "Акт II: взрыв школы. Второй этаж, динамит и 5 минут.");
            requestMobileLandscape();
            this.callbacks.onPlay(2);
        });
        this.bindPanel("menu-open-settings", "settings");
        this.bindPanel("menu-open-controls", "controls");
        this.bindPanel("menu-open-about", "about");
        requireElement("menu-open-online").addEventListener("click", () => {
            // В панели онлайна надо вводить имя и код комнаты, поэтому экран
            // не переворачиваем — альбомный режим включится уже при старте матча.
            this.showPanel("online");
            this.callbacks.onOnline();
        });
        for (const id of ["settings-back", "controls-back", "about-back", "acts-back"]) {
            requireElement(id).addEventListener("click", () => this.showPanel("root"));
        }
        this.sensitivityInput.value = String(Math.round(this.settings.sensitivity * 100));
        this.volumeInput.value = String(Math.round(this.settings.volume * 100));
        this.brightnessInput.value = String(Math.round(this.settings.brightness * 100));
        this.invertInput.checked = this.settings.invertY;
        this.fpsInput.checked = this.settings.showFps;
        this.qualityInput.value = this.settings.quality;
        this.difficultyInput.value = this.settings.difficulty;
        this.refreshLabels();
        const onInput = () => {
            this.settings = {
                sensitivity: clamp(Number(this.sensitivityInput.value) / 100, 0.3, 2.5),
                volume: clamp(Number(this.volumeInput.value) / 100, 0, 1),
                brightness: clamp(Number(this.brightnessInput.value) / 100, 0.6, 1.6),
                invertY: this.invertInput.checked,
                showFps: this.fpsInput.checked,
                quality: QUALITY_LEVELS.includes(this.qualityInput.value)
                    ? this.qualityInput.value
                    : "auto",
                difficulty: difficultyOf(this.difficultyInput.value),
            };
            this.refreshLabels();
            saveSettings(this.settings);
            this.callbacks.onSettingsChange(this.settings);
        };
        for (const input of [
            this.sensitivityInput,
            this.volumeInput,
            this.brightnessInput,
            this.invertInput,
            this.fpsInput,
            this.qualityInput,
            this.difficultyInput,
        ]) {
            input.addEventListener("input", onInput);
            input.addEventListener("change", onInput);
        }
        requireElement("settings-reset").addEventListener("click", () => {
            this.settings = { ...DEFAULT_SETTINGS };
            this.sensitivityInput.value = "100";
            this.volumeInput.value = "80";
            this.brightnessInput.value = "100";
            this.invertInput.checked = false;
            this.fpsInput.checked = DEFAULT_SETTINGS.showFps;
            this.qualityInput.value = DEFAULT_SETTINGS.quality;
            this.difficultyInput.value = DEFAULT_SETTINGS.difficulty;
            this.refreshLabels();
            saveSettings(this.settings);
            this.callbacks.onSettingsChange(this.settings);
        });
    }
    bindPanel(buttonId, panel) {
        requireElement(buttonId).addEventListener("click", () => this.showPanel(panel));
    }
    refreshLabels() {
        setText(this.sensitivityValue, `${Math.round(this.settings.sensitivity * 100)}%`);
        setText(this.volumeValue, `${Math.round(this.settings.volume * 100)}%`);
        setText(this.brightnessValue, `${Math.round(this.settings.brightness * 100)}%`);
        // Под списком сложности сразу пишем, что именно меняется.
        const preset = DIFFICULTY_PRESETS[this.settings.difficulty];
        setText(this.difficultyNote, `${preset.note} Жизней: ${preset.lives}.`);
    }
    showPanel(panel) {
        if (this.panel === "online" && panel !== "online")
            this.callbacks.onOnlineClose();
        this.panel = panel;
        for (const [name, element] of Object.entries(this.panels)) {
            setHidden(element, name !== panel);
        }
    }
    get isVisible() {
        return this.visible;
    }
    get currentPanel() {
        return this.panel;
    }
    show() {
        this.visible = true;
        this.showPanel("root");
        setHidden(this.screen, false);
    }
    hide() {
        this.visible = false;
        setHidden(this.screen, true);
    }
    /** Esc в меню: из подраздела — назад, из корня — ничего. */
    handleEscape() {
        if (this.panel !== "root") {
            this.showPanel("root");
            return true;
        }
        return false;
    }
    setPlayLabel(text) {
        setText(this.playButton, text);
    }
}
//# sourceMappingURL=menu.js.map