/**
 * ПЛАН ЭТАЖА — единственный источник правды о геометрии школы.
 *
 * Здание 72 × 44 м, начало координат — северо-западный угол, Y вверх.
 *
 *      z=0  ┐─СУ─┬─ЛЕСТ─┬─101─┬─102─┬─103─┬─104─┬─105─┬СКЛАД┐
 *     z=12  ├───────────────К О Р И Д О Р───────────────────┤
 *     z=18  ├──СПОРТЗАЛ──┬───ВЕСТИБЮЛЬ───┬─СТОЛОВАЯ──┤ z=31
 *           │              │   (главный вход) ├─БИБЛИОТЕКА─┤
 *     z=44  └──────────────┴──────────────────┴─────────────┘
 *          x=0            x=26                 x=50        x=72
 *
 * Добавить комнату, дверь или окно = добавить строчку в ROOMS или WALLS.
 * Геометрия, физика, свет и миникарта соберутся из этих данных сами.
 */
import { PALETTE } from "./palette.js";
export const BUILDING = {
    width: 72,
    depth: 44,
    exteriorThickness: 0.5,
    interiorThickness: 0.25,
    standardHeight: 3.2,
    hallHeight: 5,
    gymHeight: 6.6,
};
const EXT = BUILDING.exteriorThickness;
const INT = BUILDING.interiorThickness;
const H = BUILDING.standardHeight;
const HALL_H = BUILDING.hallHeight;
const GYM_H = BUILDING.gymHeight;
// ─────────────────── ПОМЕЩЕНИЯ ──────────────────
/** Северные кабинеты: одинаковые 11 × 12 м, отличаются только номером. */
function classroom(id, subject, x0) {
    return {
        id,
        name: `Кабинет ${id} · ${subject}`,
        kind: "classroom",
        x0,
        z0: 0,
        x1: x0 + 11,
        z1: 12,
        height: H,
        floorColor: PALETTE.floorLino,
        lamps: [2, 3],
    };
}
export const ROOMS = [
    {
        id: "wc",
        name: "Санузел",
        kind: "restroom",
        x0: 0,
        z0: 0,
        x1: 5.5,
        z1: 12,
        height: H,
        floorColor: PALETTE.floorTile,
        lamps: [1, 3],
    },
    {
        id: "stairs",
        name: "Лестничная клетка",
        kind: "stairwell",
        x0: 5.5,
        z0: 0,
        x1: 11,
        z1: 12,
        height: H,
        floorColor: PALETTE.floorTile,
        lamps: [1, 3],
    },
    classroom("101", "математика", 11),
    classroom("102", "русский язык", 22),
    classroom("103", "история", 33),
    classroom("104", "география", 44),
    classroom("105", "информатика", 55),
    {
        id: "storage",
        name: "Хозяйственная",
        kind: "storage",
        x0: 66,
        z0: 0,
        x1: 72,
        z1: 12,
        height: H,
        floorColor: PALETTE.floorLinoAlt,
        lamps: [1, 2],
    },
    {
        id: "corridor",
        name: "Коридор первого этажа",
        kind: "corridor",
        x0: 0,
        z0: 12,
        x1: 72,
        z1: 18,
        height: H,
        floorColor: PALETTE.floorLinoAlt,
        // Лампы коридора расставляются отдельно, по сегментам.
        lamps: [0, 0],
    },
    {
        id: "gym",
        name: "Спортивный зал",
        kind: "gym",
        x0: 0,
        z0: 18,
        x1: 26,
        z1: 44,
        height: GYM_H,
        floorColor: PALETTE.floorGym,
        lamps: [3, 3],
    },
    {
        id: "hall",
        name: "Вестибюль",
        kind: "hall",
        x0: 26,
        z0: 18,
        x1: 50,
        z1: 44,
        height: HALL_H,
        floorColor: PALETTE.floorHall,
        lamps: [3, 3],
    },
    {
        id: "cafeteria",
        name: "Столовая",
        kind: "cafeteria",
        x0: 50,
        z0: 18,
        x1: 72,
        z1: 31,
        height: H,
        floorColor: PALETTE.floorTile,
        lamps: [3, 2],
    },
    {
        id: "library",
        name: "Библиотека",
        kind: "library",
        x0: 50,
        z0: 31,
        x1: 72,
        z1: 44,
        height: H,
        floorColor: PALETTE.floorParquet,
        lamps: [3, 2],
    },
];
// ─────────────────── ПРОЁМЫ ──────────────────
/** Три окна кабинета на северной стене, ровно над радиаторами. */
function classroomWindows(x0) {
    return [x0 + 2.1, x0 + 5.5, x0 + 8.9].map((at) => ({
        at,
        width: 2.2,
        sill: 0.95,
        height: 1.75,
    }));
}
/** Высокие окна спортзала — выше трибун и щитов. */
function gymWindows(positions) {
    return positions.map((at) => ({ at, width: 2.4, sill: 2.6, height: 2.4 }));
}
/** Обычное окно жилой части школы. */
function windows(positions, width = 2, sill = 0.95, height = 1.75) {
    return positions.map((at) => ({ at, width, sill, height }));
}
/** Двери кабинетов всегда ближе к доске, чтобы не упираться в шкафы. */
function classroomDoor(x0) {
    return { at: x0 + 2.2, width: 1.1, height: 2.15, kind: "door" };
}
export const WALLS = [
    // ───── внешние стены ─────
    {
        // север: санузел, лестница, пять кабинетов, склад
        axis: "x",
        at: 0,
        from: -EXT / 2,
        to: BUILDING.width + EXT / 2,
        thickness: EXT,
        height: H,
        color: PALETTE.wallCream,
        wainscot: true,
        windows: [
            ...windows([2.75], 1.2, 1.7, 0.8),
            ...windows([8.25], 1.8, 1.1, 1.9),
            ...classroomWindows(11),
            ...classroomWindows(22),
            ...classroomWindows(33),
            ...classroomWindows(44),
            ...classroomWindows(55),
            ...windows([69], 1.2, 1.7, 0.8),
        ],
    },
    {
        // юг: спортзал
        axis: "x",
        at: 44,
        from: -EXT / 2,
        to: 26,
        thickness: EXT,
        height: GYM_H,
        color: PALETTE.wallMint,
        windows: gymWindows([4, 9.5, 16.5, 22]),
    },
    {
        // юг: главный вход в вестибюль
        axis: "x",
        at: 44,
        from: 26,
        to: 50,
        thickness: EXT,
        height: HALL_H,
        color: PALETTE.wallSand,
        doors: [{ at: 38, width: 3.4, height: 2.9, kind: "glass" }],
        windows: windows([29.5, 33, 43, 46.5], 2.2, 1, 2.6),
    },
    {
        // юг: библиотека
        axis: "x",
        at: 44,
        from: 50,
        to: BUILDING.width + EXT / 2,
        thickness: EXT,
        height: H,
        color: PALETTE.wallBlue,
        wainscot: true,
        windows: windows([54, 58.5, 63, 67.5]),
    },
    {
        // запад: санузел и торец коридора
        axis: "z",
        at: 0,
        from: EXT / 2,
        to: 18,
        thickness: EXT,
        height: H,
        color: PALETTE.wallCream,
        wainscot: true,
        windows: [...windows([3, 6, 9], 1, 1.7, 0.8), ...windows([15], 2.2, 0.95, 1.75)],
    },
    {
        // запад: спортзал
        axis: "z",
        at: 0,
        from: 18,
        to: BUILDING.depth - EXT / 2,
        thickness: EXT,
        height: GYM_H,
        color: PALETTE.wallMint,
        windows: gymWindows([22, 27, 32, 37, 41.5]),
    },
    {
        // восток: склад и торец коридора
        axis: "z",
        at: 72,
        from: EXT / 2,
        to: 18,
        thickness: EXT,
        height: H,
        color: PALETTE.wallCream,
        wainscot: true,
        windows: [...windows([6], 1.2, 1.7, 0.8), ...windows([15], 2.2, 0.95, 1.75)],
    },
    {
        // восток: столовая и библиотека
        axis: "z",
        at: 72,
        from: 18,
        to: BUILDING.depth - EXT / 2,
        thickness: EXT,
        height: H,
        color: PALETTE.wallSand,
        wainscot: true,
        windows: windows([21, 25, 29, 34, 38, 42]),
    },
    // ───── стены коридора ─────
    {
        // северная стена коридора: все двери кабинетов
        axis: "x",
        at: 12,
        from: EXT / 2,
        to: BUILDING.width - EXT / 2,
        thickness: INT,
        height: H,
        color: PALETTE.wallCream,
        wainscot: true,
        doors: [
            { at: 3.4, width: 1, height: 2.15, kind: "door" },
            { at: 8.25, width: 1.2, height: 2.15, kind: "door" },
            classroomDoor(11),
            classroomDoor(22),
            classroomDoor(33),
            classroomDoor(44),
            classroomDoor(55),
            { at: 69, width: 1, height: 2.15, kind: "door" },
        ],
    },
    {
        // южная стена коридора у спортзала (высокая, закрывает зал сверху)
        axis: "x",
        at: 18,
        from: EXT / 2,
        to: 26,
        thickness: INT,
        height: GYM_H,
        color: PALETTE.wallMint,
        doors: [{ at: 22.5, width: 2, height: 2.5, kind: "double" }],
    },
    {
        // южная стена коридора у вестибюля: широкая арка
        axis: "x",
        at: 18,
        from: 26,
        to: 50,
        thickness: INT,
        height: HALL_H,
        color: PALETTE.wallSand,
        doors: [{ at: 38, width: 6, height: 3, kind: "arch" }],
    },
    {
        // южная стена коридора у столовой
        axis: "x",
        at: 18,
        from: 50,
        to: BUILDING.width - EXT / 2,
        thickness: INT,
        height: H,
        color: PALETTE.wallSand,
        wainscot: true,
        doors: [{ at: 61, width: 1.8, height: 2.3, kind: "double" }],
    },
    // ───── внутренние перегородки северного крыла ─────
    ...[5.5, 11, 22, 33, 44, 55, 66].map((at) => ({
        axis: "z",
        at,
        from: EXT / 2,
        to: 12,
        thickness: INT,
        height: H,
        color: PALETTE.wallCream,
        wainscot: true,
    })),
    // ───── южное крыло ─────
    {
        // спортзал | вестибюль
        axis: "z",
        at: 26,
        from: 18,
        to: BUILDING.depth - EXT / 2,
        thickness: INT,
        height: GYM_H,
        color: PALETTE.wallMint,
        doors: [{ at: 24, width: 1.6, height: 2.4, kind: "double" }],
    },
    {
        // вестибюль | столовая и библиотека
        axis: "z",
        at: 50,
        from: 18,
        to: BUILDING.depth - EXT / 2,
        thickness: INT,
        height: HALL_H,
        color: PALETTE.wallSand,
        doors: [
            { at: 24, width: 1.6, height: 2.3, kind: "door" },
            { at: 38.5, width: 1.4, height: 2.3, kind: "door" },
        ],
    },
    {
        // столовая | библиотека
        axis: "x",
        at: 31,
        from: 50,
        to: BUILDING.width - EXT / 2,
        thickness: INT,
        height: H,
        color: PALETTE.wallBlue,
        wainscot: true,
        doors: [{ at: 61, width: 2.2, height: 2.4, kind: "arch" }],
    },
];
const DEFAULT_SPAWN = {
    id: "entrance",
    label: "Главный вход",
    x: 38,
    z: 40.5,
    yaw: 0,
};
/** Клавиши 1…9 в игре соответствуют этому списку по порядку. */
export const SPAWNS = [
    DEFAULT_SPAWN,
    { id: "hall", label: "Вестибюль", x: 38, z: 31, yaw: 0 },
    { id: "corridor", label: "Коридор", x: 36, z: 15, yaw: -Math.PI / 2 },
    { id: "class101", label: "Кабинет 101", x: 17.5, z: 6, yaw: Math.PI / 2 },
    { id: "class105", label: "Кабинет 105", x: 61.5, z: 6, yaw: Math.PI / 2 },
    { id: "gym", label: "Спортзал", x: 13, z: 34, yaw: 0 },
    { id: "cafeteria", label: "Столовая", x: 62, z: 26, yaw: Math.PI / 2 },
    { id: "library", label: "Библиотека", x: 55.5, z: 43.1, yaw: 0 },
    { id: "stairs", label: "Лестница", x: 8.25, z: 9.6, yaw: 0 },
];
/** Какое помещение в точке (x, z). null — игрок на улице. */
export function findRoomAt(x, z) {
    for (const room of ROOMS) {
        if (x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1)
            return room;
    }
    return null;
}
/** Точка старта по идентификатору из URL; при любой ошибке — главный вход. */
export function findSpawn(id) {
    if (!id)
        return DEFAULT_SPAWN;
    return SPAWNS.find((point) => point.id === id) ?? DEFAULT_SPAWN;
}
//# sourceMappingURL=layout.js.map