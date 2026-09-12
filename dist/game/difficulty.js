/** Сложность игры: один набор настроек для одиночки и для онлайна. */
export const DIFFICULTIES = ["ghost", "easy", "normal", "hard"];
export const DIFFICULTY_PRESETS = {
    ghost: {
        id: "ghost",
        label: "Призрак — её нет в школе",
        short: "Призрак",
        note: "Учительница ушла и никого не видит. Школа пустая: спокойно ищите предметы и выход.",
        lives: 5,
        speed: 0,
        sight: 0,
        notice: 99,
        hear: 0,
        absent: true,
    },
    easy: {
        id: "easy",
        label: "Легко",
        short: "Легко",
        note: "Она медленная, видит близко и реагирует не сразу.",
        lives: 7,
        speed: 0.82,
        sight: 0.62,
        notice: 2.2,
        hear: 0.6,
        absent: false,
    },
    normal: {
        id: "normal",
        label: "Нормальный",
        short: "Нормальный",
        note: "Как задумано: обычное поведение учительницы.",
        lives: 5,
        speed: 1,
        sight: 1,
        notice: 1,
        hear: 1,
        absent: false,
    },
    hard: {
        id: "hard",
        label: "Сложный",
        short: "Сложный",
        note: "Быстрее, слышит шаги дальше и замечает почти мгновенно.",
        lives: 3,
        speed: 1.14,
        sight: 1.25,
        notice: 0.45,
        hear: 1.35,
        absent: false,
    },
};
/** Любую строку приводим к известной сложности. */
export function difficultyOf(raw) {
    return typeof raw === "string" && DIFFICULTIES.includes(raw) ? raw : "normal";
}
/** Пресет по любому вводу. */
export function presetOf(raw) {
    return DIFFICULTY_PRESETS[difficultyOf(raw)];
}
//# sourceMappingURL=difficulty.js.map