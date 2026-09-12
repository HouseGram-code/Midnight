/**
 * Квестовые предметы, фонарь, баррикада на выходе и створки двери.
 *
 * Всё строится из тех же блоков, что и школа, но каждый кадр заново:
 * предметы покачиваются и вращаются, баррикада разбирается по доскам,
 * двери открываются на шарнирах. Всё вместе — меньше тысячи треугольников.
 */
import { PALETTE } from "../world/palette.js";
/** Пять предметов разбросаны по разным крыльям школы. */
export const QUEST_ITEMS = [
    {
        id: "key",
        label: "Ключ",
        hint: "Хозяйственная — восточный торец коридора",
        use: "навесной замок",
        x: 69,
        y: 1.05,
        z: 7.6,
    },
    {
        id: "crowbar",
        label: "Лом",
        hint: "Спортзал — у трибун",
        use: "забитые доски",
        x: 4.6,
        y: 0.95,
        z: 30,
    },
    {
        id: "cutters",
        label: "Кусачки",
        hint: "Столовая — линия раздачи",
        use: "цепь",
        x: 56.6,
        y: 1.35,
        z: 19.6,
    },
    {
        id: "handle",
        label: "Ручка",
        hint: "Библиотека — читальный стол",
        use: "снятая ручка двери",
        x: 53.5,
        y: 1.15,
        z: 38,
    },
    {
        id: "fuse",
        label: "Предохранитель",
        hint: "Санузел — западный торец коридора",
        use: "электрозамок",
        x: 2.7,
        y: 1.15,
        z: 8.4,
    },
];
/** Фонарь лежит на нашей же парте в кабинете 101. */
export const FLASHLIGHT_ITEM = {
    id: "flashlight",
    label: "Фонарь",
    hint: "Кабинет 101 — на нашей парте",
    use: "свет в темноте",
    x: 16.5,
    y: 1,
    z: 6.5,
};
/** Куда вставлять предметы: главный выход в вестибюле. */
export const EXIT_DOOR = {
    x: 38,
    z: 43.75,
    /** Где стоит игрок, когда разбирает баррикаду. */
    standZ: 42.2,
    width: 3.4,
    height: 2.9,
};
/**
 * Размеры шкафа-укрытия. Корпус глубокий, внутри реальная пустота,
 * а на уровне глаз — смотровая щель между створками: поэтому камера больше
 * не режет геометрию и предмет в руке не торчит наружу.
 */
export const HIDE_LOCKER = {
    depth: 0.78,
    height: 2.02,
    halfWidth: 0.46,
    panel: 0.075,
    /** Границы смотровой щели по высоте. */
    slitLow: 1.2,
    slitHigh: 1.64,
    /** Высота глаз внутри. */
    eyeHeight: 1.4,
};
/** Северная стена коридора — z = 12.125, южная — z = 17.875. */
export const HIDE_SPOTS = [
    { id: "h1", wall: "north", x: 15.6, z: 13.5, insideX: 15.6, insideZ: 12.5, yaw: Math.PI },
    { id: "h2", wall: "north", x: 21.6, z: 13.5, insideX: 21.6, insideZ: 12.5, yaw: Math.PI },
    { id: "h3", wall: "north", x: 30.5, z: 13.5, insideX: 30.5, insideZ: 12.5, yaw: Math.PI },
    { id: "h4", wall: "north", x: 43.2, z: 13.5, insideX: 43.2, insideZ: 12.5, yaw: Math.PI },
    { id: "h5", wall: "north", x: 54.4, z: 13.5, insideX: 54.4, insideZ: 12.5, yaw: Math.PI },
    { id: "h6", wall: "south", x: 5.5, z: 16.5, insideX: 5.5, insideZ: 17.5, yaw: 0 },
    { id: "h7", wall: "south", x: 17.4, z: 16.5, insideX: 17.4, insideZ: 17.5, yaw: 0 },
    { id: "h8", wall: "south", x: 45.5, z: 16.5, insideX: 45.5, insideZ: 17.5, yaw: 0 },
    { id: "h9", wall: "south", x: 57.5, z: 16.5, insideX: 57.5, insideZ: 17.5, yaw: 0 },
];
const GOLD = [0.82, 0.68, 0.24];
const STEEL = [0.68, 0.7, 0.74];
const STEEL_DARK = [0.36, 0.38, 0.42];
const RUBBER = [0.72, 0.22, 0.2];
const CERAMIC = [0.9, 0.88, 0.82];
const COPPER = [0.78, 0.5, 0.26];
const PLASTIC = [0.16, 0.17, 0.19];
const LENS = [1, 0.94, 0.72];
const BOARD = [0.55, 0.4, 0.25];
const BOARD_DARK = [0.44, 0.31, 0.19];
/** Ставит блок в локальных координатах предмета (ly — центр по высоте). */
function part(mesh, origin, lx, ly, lz, sx, sy, sz, color, emissive = false) {
    const cos = Math.cos(origin.yaw);
    const sin = Math.sin(origin.yaw);
    mesh.rotatedBox(origin.x + lx * cos + lz * sin, origin.y + ly - sy / 2, origin.z - lx * sin + lz * cos, sx, sy, sz, origin.yaw, color, emissive ? { emissive: true } : undefined);
}
/** Модель предмета в точке мира. Используется и для лежащего, и для в руке. */
export function buildItemModel(mesh, kind, origin, scale = 1, lightOn = false) {
    const s = scale;
    switch (kind) {
        case "key": {
            part(mesh, origin, 0, 0, 0, 0.022 * s, 0.022 * s, 0.17 * s, GOLD);
            part(mesh, origin, 0, 0, -0.1 * s, 0.075 * s, 0.02 * s, 0.06 * s, GOLD);
            part(mesh, origin, 0, 0, -0.1 * s, 0.03 * s, 0.03 * s, 0.025 * s, PLASTIC);
            part(mesh, origin, 0.03 * s, 0, 0.07 * s, 0.04 * s, 0.018 * s, 0.02 * s, GOLD);
            part(mesh, origin, 0.03 * s, 0, 0.03 * s, 0.04 * s, 0.018 * s, 0.02 * s, GOLD);
            break;
        }
        case "crowbar": {
            part(mesh, origin, 0, 0, 0, 0.032 * s, 0.032 * s, 0.52 * s, RUBBER);
            part(mesh, origin, 0, 0.03 * s, -0.28 * s, 0.03 * s, 0.09 * s, 0.05 * s, STEEL);
            part(mesh, origin, 0, 0.07 * s, -0.31 * s, 0.03 * s, 0.03 * s, 0.11 * s, STEEL);
            part(mesh, origin, 0, 0, 0.22 * s, 0.036 * s, 0.036 * s, 0.09 * s, PLASTIC);
            break;
        }
        case "cutters": {
            part(mesh, origin, -0.028 * s, 0, 0.08 * s, 0.026 * s, 0.026 * s, 0.19 * s, RUBBER);
            part(mesh, origin, 0.028 * s, 0, 0.08 * s, 0.026 * s, 0.026 * s, 0.19 * s, RUBBER);
            part(mesh, origin, 0, 0, -0.02 * s, 0.075 * s, 0.028 * s, 0.05 * s, STEEL_DARK);
            part(mesh, origin, -0.02 * s, 0, -0.08 * s, 0.028 * s, 0.022 * s, 0.11 * s, STEEL);
            part(mesh, origin, 0.02 * s, 0, -0.08 * s, 0.028 * s, 0.022 * s, 0.11 * s, STEEL);
            break;
        }
        case "handle": {
            part(mesh, origin, 0, 0, 0.04 * s, 0.075 * s, 0.16 * s, 0.022 * s, STEEL_DARK);
            part(mesh, origin, 0, 0.03 * s, -0.02 * s, 0.045 * s, 0.045 * s, 0.075 * s, STEEL);
            part(mesh, origin, 0.06 * s, 0.03 * s, -0.05 * s, 0.14 * s, 0.032 * s, 0.032 * s, STEEL);
            part(mesh, origin, 0, -0.05 * s, 0.02 * s, 0.03 * s, 0.03 * s, 0.03 * s, GOLD);
            break;
        }
        case "fuse": {
            part(mesh, origin, 0, 0, 0, 0.052 * s, 0.052 * s, 0.1 * s, CERAMIC);
            part(mesh, origin, 0, 0, -0.06 * s, 0.056 * s, 0.056 * s, 0.022 * s, COPPER);
            part(mesh, origin, 0, 0, 0.06 * s, 0.056 * s, 0.056 * s, 0.022 * s, COPPER);
            part(mesh, origin, 0, 0.028 * s, 0, 0.03 * s, 0.012 * s, 0.05 * s, [0.9, 0.35, 0.2]);
            break;
        }
        case "weapon": {
            // обрез: ствол, цевьё, укороченный ложе
            part(mesh, origin, 0, 0, -0.1 * s, 0.038 * s, 0.042 * s, 0.36 * s, STEEL_DARK);
            part(mesh, origin, 0, -0.012 * s, -0.12 * s, 0.05 * s, 0.03 * s, 0.16 * s, BOARD);
            part(mesh, origin, 0, -0.004 * s, 0.12 * s, 0.056 * s, 0.07 * s, 0.16 * s, BOARD_DARK);
            part(mesh, origin, 0, -0.05 * s, 0.05 * s, 0.03 * s, 0.06 * s, 0.05 * s, BOARD_DARK);
            part(mesh, origin, 0, -0.03 * s, 0.03 * s, 0.014 * s, 0.03 * s, 0.016 * s, STEEL);
            part(mesh, origin, 0, 0.028 * s, 0.02 * s, 0.02 * s, 0.016 * s, 0.05 * s, STEEL);
            break;
        }
        case "laptop": {
            // ноутбук: основание, экран под углом, светящаяся матрица
            part(mesh, origin, 0, 0, 0.02 * s, 0.3 * s, 0.026 * s, 0.22 * s, STEEL_DARK);
            part(mesh, origin, 0, 0.005 * s, 0.05 * s, 0.24 * s, 0.006 * s, 0.13 * s, [0.22, 0.24, 0.28]);
            part(mesh, origin, 0, 0.1 * s, -0.1 * s, 0.3 * s, 0.2 * s, 0.022 * s, STEEL);
            part(mesh, origin, 0, 0.1 * s, -0.088 * s, 0.26 * s, 0.16 * s, 0.008 * s, lightOn ? [0.45, 0.85, 1] : [0.1, 0.13, 0.16], lightOn);
            break;
        }
        case "flashlight":
        default: {
            part(mesh, origin, 0, 0, 0.02 * s, 0.062 * s, 0.062 * s, 0.2 * s, PLASTIC);
            part(mesh, origin, 0, 0, -0.1 * s, 0.08 * s, 0.08 * s, 0.05 * s, STEEL_DARK);
            part(mesh, origin, 0, 0, -0.125 * s, 0.062 * s, 0.062 * s, 0.012 * s, lightOn ? LENS : [0.6, 0.6, 0.56], lightOn);
            part(mesh, origin, 0, 0.036 * s, 0.05 * s, 0.022 * s, 0.014 * s, 0.04 * s, RUBBER);
            part(mesh, origin, 0, 0, 0.13 * s, 0.05 * s, 0.05 * s, 0.02 * s, STEEL_DARK);
            break;
        }
    }
}
/**
 * Лежащий предмет: плавно покачивается, крутится и светится снизу,
 * чтобы его можно было найти в темноте.
 */
export function buildItemPickup(mesh, def, time, highlighted) {
    const bob = Math.sin(time * 1.7 + def.x) * 0.05;
    const origin = { x: def.x, y: def.y + bob, z: def.z, yaw: time * 0.9 };
    buildItemModel(mesh, def.id, origin, 1.15, def.id === "flashlight");
    const glow = highlighted ? [1, 0.86, 0.4] : [0.5, 0.62, 0.8];
    mesh.rotatedBox(def.x, def.y - 0.22 + bob * 0.4, def.z, 0.3, 0.006, 0.3, time * 0.5, glow, {
        emissive: true,
    });
    mesh.rotatedBox(def.x, def.y - 0.19 + bob * 0.4, def.z, 0.12, 0.004, 0.12, -time * 0.7, glow, {
        emissive: true,
    });
}
/** Предмет в руке: чуть ниже и правее центра экрана. */
export function buildHeldItem(mesh, kind, camera, sway, lightOn = false) {
    const forwardX = -Math.sin(camera.yaw);
    const forwardZ = -Math.cos(camera.yaw);
    const rightX = Math.cos(camera.yaw);
    const rightZ = -Math.sin(camera.yaw);
    const distance = 0.52;
    const side = 0.24 + Math.sin(sway) * 0.012;
    const drop = -0.2 + Math.cos(sway * 1.6) * 0.012 + camera.pitch * 0.34;
    const origin = {
        x: camera.x + forwardX * distance + rightX * side,
        y: camera.y + drop,
        z: camera.z + forwardZ * distance + rightZ * side,
        yaw: camera.yaw + 0.42,
    };
    buildItemModel(mesh, kind, origin, 1, lightOn);
}
/**
 * Баррикада на главном выходе: доски, цепь, навесной замок, электрозамок.
 * progress 0 — всё на месте, 1 — выход свободен.
 */
export function buildBarricade(mesh, progress, time) {
    const x0 = EXIT_DOOR.x - EXIT_DOOR.width / 2;
    const x1 = EXIT_DOOR.x + EXIT_DOOR.width / 2;
    const z = 43.6;
    const planks = [
        { y: 2.3, angle: 0.05, removeAt: 0.12 },
        { y: 1.72, angle: -0.04, removeAt: 0.3 },
        { y: 1.12, angle: 0.03, removeAt: 0.52 },
        { y: 0.52, angle: -0.05, removeAt: 0.74 },
    ];
    for (const plank of planks) {
        if (progress > plank.removeAt)
            continue;
        const shake = progress > plank.removeAt - 0.12 ? Math.sin(time * 46) * 0.012 : 0;
        mesh.rotatedBox(EXIT_DOOR.x, plank.y + shake, z, EXIT_DOOR.width + 0.5, 0.22, 0.06, plank.angle, plank.y > 1.5 ? BOARD : BOARD_DARK);
        // шапки гвоздей
        for (const nx of [x0 + 0.25, x1 - 0.25]) {
            mesh.box(nx - 0.02, plank.y + 0.06, z - 0.075, nx + 0.02, plank.y + 0.1, z - 0.055, STEEL_DARK);
        }
    }
    // Вертикальные накладки снимаются последними.
    if (progress < 0.86) {
        for (const bx of [EXIT_DOOR.x - 1.2, EXIT_DOOR.x + 1.2]) {
            mesh.box(bx - 0.07, 0.2, z - 0.04, bx + 0.07, 2.55, z + 0.04, BOARD_DARK);
        }
    }
    // Цепь с замком посередине.
    if (progress < 0.62) {
        for (let i = 0; i < 11; i++) {
            const t = i / 10;
            const cx = x0 + 0.2 + t * (EXIT_DOOR.width - 0.4);
            const sag = Math.sin(t * Math.PI) * 0.16;
            mesh.rotatedBox(cx, 1.38 - sag, z - 0.12, 0.07, 0.05, 0.07, i * 0.6, STEEL, undefined);
        }
        mesh.box(EXIT_DOOR.x - 0.1, 1.05, z - 0.17, EXIT_DOOR.x + 0.1, 1.28, z - 0.07, STEEL_DARK);
        mesh.box(EXIT_DOOR.x - 0.05, 1.24, z - 0.15, EXIT_DOOR.x + 0.05, 1.36, z - 0.09, STEEL);
        mesh.box(EXIT_DOOR.x - 0.03, 1.12, z - 0.18, EXIT_DOOR.x + 0.03, 1.18, z - 0.16, GOLD);
    }
    // Электрозамок сбоку: красный диод гаснет, когда вставлен предохранитель.
    const locked = progress < 0.95;
    mesh.box(x1 + 0.12, 1.1, z - 0.06, x1 + 0.34, 1.55, z + 0.06, STEEL_DARK);
    mesh.box(x1 + 0.19, 1.42, z - 0.09, x1 + 0.27, 1.48, z - 0.06, locked ? [1, 0.2, 0.16] : [0.3, 1, 0.4], { emissive: true });
    mesh.box(x1 + 0.16, 1.16, z - 0.08, x1 + 0.3, 1.32, z - 0.06, PALETTE.metal);
}
/**
 * Створки главного входа. angle 0 — закрыто, ~1.4 — открыто внутрь.
 * Отсюда же берётся анимация двери в вступительной кат-сцене.
 */
export function buildExitDoors(mesh, angle) {
    const halfWidth = EXIT_DOOR.width / 2;
    const leafWidth = halfWidth - 0.05;
    const z = 43.95;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const leaf = (hingeX, direction) => {
        // Обе створки уходят внутрь (в −Z): раньше правая открывалась наружу.
        const centerX = hingeX + direction * (leafWidth / 2) * cos;
        const centerZ = z - (leafWidth / 2) * sin;
        const leafAngle = direction === 1 ? angle : -angle;
        mesh.rotatedBox(centerX, 0.02, centerZ, leafWidth, EXIT_DOOR.height, 0.07, leafAngle, PALETTE.doorLeaf);
        mesh.rotatedBox(centerX, 0.9, centerZ, leafWidth - 0.22, 1.6, 0.09, leafAngle, PALETTE.glass);
        const handleX = hingeX + direction * (leafWidth - 0.18) * cos;
        const handleZ = z - (leafWidth - 0.18) * sin;
        mesh.rotatedBox(handleX, 1.0, handleZ, 0.06, 0.28, 0.06, leafAngle, STEEL);
    };
    leaf(EXIT_DOOR.x - halfWidth + 0.05, 1);
    leaf(EXIT_DOOR.x + halfWidth - 0.05, -1);
}
/** Дверь кабинета 101 — её открывает учительница в кат-сцене. */
export function buildClassDoor(mesh, angle) {
    const hingeX = 13.2 - 0.55;
    const z = 12.125;
    const width = 1.1;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const centerX = hingeX + (width / 2) * cos;
    const centerZ = z - (width / 2) * sin;
    mesh.rotatedBox(centerX, 0.02, centerZ, width, 2.15, 0.06, angle, PALETTE.doorLeaf);
    mesh.rotatedBox(centerX, 1.25, centerZ, width - 0.34, 0.55, 0.08, angle, PALETTE.glass);
    const handleX = hingeX + (width - 0.14) * cos;
    const handleZ = z - (width - 0.14) * sin;
    mesh.rotatedBox(handleX, 1.02, handleZ, 0.05, 0.12, 0.16, angle, STEEL);
}
/**
 * Меловые штрихи на доске кабинета 101 (x0 = 11).
 *
 * Появляются по одному, пока учительница ведёт урок: без них было видно,
 * что она «пишет» по пустой доске.
 */
const CHALK_STROKES = [
    { z0: 5.15, z1: 6.35, y: 1.96 },
    { z0: 5.15, z1: 6.35, y: 1.89 },
    { z0: 5.05, z1: 5.55, y: 1.72 },
    { z0: 5.65, z1: 6.0, y: 1.72 },
    { z0: 6.1, z1: 6.55, y: 1.72 },
    { z0: 5.05, z1: 5.4, y: 1.52 },
    { z0: 5.5, z1: 6.05, y: 1.52 },
    { z0: 6.15, z1: 6.4, y: 1.52 },
    { z0: 5.05, z1: 5.75, y: 1.32 },
    { z0: 5.85, z1: 6.2, y: 1.32 },
    { z0: 5.1, z1: 5.5, y: 1.12 },
    { z0: 5.6, z1: 6.3, y: 1.12 },
];
const CHALK_COLOR = [0.9, 0.92, 0.88];
/** count — сколько штрихов уже написано (дробное значение округляется вниз). */
export function buildChalkMarks(mesh, count) {
    const total = Math.max(0, Math.min(CHALK_STROKES.length, Math.floor(count)));
    for (let i = 0; i < total; i++) {
        const stroke = CHALK_STROKES[i];
        if (!stroke)
            continue;
        mesh.box(11.2, stroke.y, stroke.z0, 11.225, stroke.y + 0.035, stroke.z1, CHALK_COLOR);
    }
}
//# sourceMappingURL=items.js.map