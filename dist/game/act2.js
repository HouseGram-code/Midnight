/**
 * АКТ II — «Вернуться. Взрыв».
 *
 * Всё, что отличает второй акт от первого: точки предметов на втором этаже,
 * щит управления взрывчаткой, таймер на пять минут, капча и тексты миссий.
 *
 * Учительницы в акте II в школе нет — опасность одна: время.
 */
import { FLOOR2_Y } from "../world/floor2.js";
/** Сколько секунд даёт учительница после того, как заперла школу. */
export const ACT2_TIMER = 300;
/** Сколько идёт анимация взлома после капчи. */
export const ACT2_HACK_SECONDS = 60;
/** Щит управления взрывчаткой — серверная второго этажа. */
export const ACT2_PANEL = {
    x: 42.4,
    y: FLOOR2_Y + 1.5,
    z: 10.5,
    /** Куда встаёт игрок. */
    standZ: 9.5,
    /** На этой высоте стоит поставленный ноутбук. */
    laptopY: FLOOR2_Y + 0.88,
    laptopZ: 10.2,
    name: "Серверная · 2 этаж",
};
/** Где ждёт второй выход — служебная дверь в хозяйственной. */
export const ACT2_EXIT = {
    x: 69,
    y: 1.4,
    z: 1.2,
    standZ: 2.4,
    name: "Хозяйственная · служебный выход",
};
/** Оружие — спрятано в архиве за стеллажами. Искать тяжело — так и задумано. */
export const ACT2_WEAPON = {
    id: "weapon",
    label: "Обрез",
    hint: "Второй этаж — где-то среди старых папок",
    use: "единственная защита",
    x: 19.15,
    y: FLOOR2_Y + 0.42,
    z: 0.95,
};
/** Ноутбук — в учительской, на дальнем столе. */
export const ACT2_LAPTOP = {
    id: "laptop",
    label: "Ноутбук",
    hint: "Учительская — рабочий стол у окна",
    use: "взлом системы",
    x: 53.25,
    y: FLOOR2_Y + 0.92,
    z: 9.85,
};
/** Ключ от служебного выхода — в сейфе директора, сейф откроется после взлома. */
export const ACT2_KEY = {
    id: "key",
    label: "Ключ завхоза",
    hint: "Кабинет директора — сейф у стены",
    use: "служебный выход",
    x: 64.05,
    y: FLOOR2_Y + 0.68,
    z: 1.25,
};
export const ACT2_ITEMS = [ACT2_WEAPON, ACT2_LAPTOP, ACT2_KEY];
export const ACT2_STAGES = [
    "weapon",
    "laptop",
    "panel",
    "captcha",
    "hack",
    "key",
    "escape",
    "done",
];
export function stageCode(stage) {
    const index = ACT2_STAGES.indexOf(stage);
    return index < 0 ? 0 : index;
}
export function stageFromCode(code) {
    return ACT2_STAGES[Math.round(code)] ?? "weapon";
}
/** Текст задачи в HUD. */
export function objectiveFor(stage, hasLaptop) {
    switch (stage) {
        case "weapon":
            return "Найдите оружие на втором этаже";
        case "laptop":
            return "Найдите ноутбук — без него систему не взломать";
        case "panel":
            return hasLaptop
                ? "Поставьте ноутбук на щит в серверной"
                : "Возьмите ноутбук и идите в серверную";
        case "captcha":
            return "Пройдите проверку системы на ноутбуке";
        case "hack":
            return "Идёт взлом — дождитесь окончания";
        case "key":
            return "Найдите ключ в кабинете директора";
        case "escape":
            return "Служебный выход в хозяйственной — уходите!";
        default:
            return "Школа осталась позади";
    }
}
/** Предупреждения по таймеру: секунды → текст. */
export const ACT2_WARNINGS = [
    { at: 270, text: "Четыре с половиной минуты. Сначала ноутбук — без него никак." },
    { at: 240, text: "Четыре минуты до взрыва." },
    { at: 180, text: "Три минуты. Взлом идёт целую минуту — не тяните." },
    { at: 120, text: "Две минуты. Слышно, как тикает в стенах." },
    { at: 60, text: "Минута! Бегите!" },
    { at: 30, text: "Тридцать секунд…" },
    { at: 10, text: "Десять…" },
];
function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
    }
    return list;
}
function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}
/** Задача «продолжи последовательность». */
function sequenceTask() {
    const start = randomInt(2, 9);
    const step = randomInt(3, 9);
    const values = [start, start + step, start + step * 2, start + step * 3];
    const answer = String(start + step * 4);
    const wrong = new Set();
    while (wrong.size < 3) {
        const delta = randomInt(-step * 2, step * 2);
        const value = start + step * 4 + (delta === 0 ? step : delta);
        if (String(value) !== answer)
            wrong.add(String(value));
    }
    return {
        question: `${values.join(", ")}, ?`,
        answer,
        options: shuffle([answer, ...wrong]),
        hint: "Продолжите ряд",
    };
}
/** Задача «посчитать код канала». */
function mathTask() {
    const a = randomInt(12, 39);
    const b = randomInt(3, 12);
    const c = randomInt(2, 9);
    const value = a * b - c;
    const answer = String(value);
    const wrong = new Set();
    while (wrong.size < 3) {
        const noise = randomInt(-14, 14);
        if (noise === 0)
            continue;
        wrong.add(String(value + noise));
    }
    return {
        question: `${a} × ${b} − ${c} = ?`,
        answer,
        options: shuffle([answer, ...wrong]),
        hint: "Код канала детонатора",
    };
}
/** Задача «собери контрольную сумму»: сумма цифр серийника. */
function checksumTask() {
    const serial = String(randomInt(100000, 999999));
    let sum = 0;
    for (const digit of serial)
        sum += Number(digit);
    const answer = String(sum);
    const wrong = new Set();
    while (wrong.size < 3) {
        const noise = randomInt(-9, 9);
        if (noise === 0)
            continue;
        wrong.add(String(sum + noise));
    }
    return {
        question: `Серийный номер ${serial} — сумма цифр?`,
        answer,
        options: shuffle([answer, ...wrong]),
        hint: "Контрольная сумма",
    };
}
/** Задача «какой провод резать»: логика по правилам. */
function wireTask() {
    const colors = ["красный", "синий", "жёлтый", "зелёный"];
    const count = randomInt(2, 5);
    const even = count % 2 === 0;
    const answer = even ? "синий" : "жёлтый";
    return {
        question: `На схеме ${count} детонаторов. Правило: чётное число — синий канал, ` +
            "нечётное — жёлтый. Какой канал глушим?",
        answer,
        options: shuffle(colors.slice()),
        hint: "Выбор канала",
    };
}
/** Набор заданий капчи: три шага, каждый из разных типов. */
export function makeCaptcha() {
    const builders = shuffle([sequenceTask, mathTask, checksumTask, wireTask]);
    return builders.slice(0, 3).map((build) => build());
}
/** ММ:СС для таймера. */
export function formatTimer(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
}
//# sourceMappingURL=act2.js.map