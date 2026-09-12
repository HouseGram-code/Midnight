/**
 * Вид чужих игроков: блочный школьник с рюкзаком и проекция ников на экран.
 *
 * Модель собрана из коробок тем же MeshBuilder, что и вся школа,
 * поэтому свет и туман работают на ней без единой строчки в шейдере.
 */
import { shade } from "../core/mesh.js";
import { buildItemModel } from "../game/items.js";
import { RYZIK_SHIRT_PIXELS } from "./ryzikTexture.js";
/** Код ездит по сети: 0 — обычный, 1 — ryzik3489. Новые варианты добавлять только в конец. */
export function skinCode(id) {
    return id === "ryzik3489" ? 1 : 0;
}
export function skinIdFromCode(code) {
    return Number(code) === 1 ? "ryzik3489" : "classic";
}
export function selectedSkinId() {
    try {
        return typeof localStorage !== "undefined" && localStorage.getItem("school3d.skin.v1") === "ryzik3489"
            ? "ryzik3489"
            : "classic";
    }
    catch {
        return "classic";
    }
}
/** Пять разных школьников — чтобы в темноте было понятно, кто есть кто. */
export const PLAYER_SKINS = [
    {
        shirt: [0.33, 0.55, 0.86],
        pants: [0.19, 0.22, 0.3],
        hair: [0.19, 0.13, 0.09],
        skin: [0.86, 0.71, 0.6],
        tag: "#7fb4ff",
    },
    {
        shirt: [0.87, 0.42, 0.34],
        pants: [0.24, 0.2, 0.24],
        hair: [0.42, 0.24, 0.11],
        skin: [0.9, 0.76, 0.64],
        tag: "#ff9b86",
    },
    {
        shirt: [0.42, 0.74, 0.46],
        pants: [0.2, 0.24, 0.22],
        hair: [0.12, 0.1, 0.09],
        skin: [0.78, 0.6, 0.47],
        tag: "#8fe0a0",
    },
    {
        shirt: [0.79, 0.68, 0.3],
        pants: [0.26, 0.22, 0.18],
        hair: [0.55, 0.42, 0.16],
        skin: [0.92, 0.78, 0.66],
        tag: "#f2d477",
    },
    {
        shirt: [0.68, 0.45, 0.82],
        pants: [0.22, 0.2, 0.28],
        hair: [0.1, 0.09, 0.12],
        skin: [0.83, 0.67, 0.55],
        tag: "#d5a4ff",
    },
];
export function skinFor(index) {
    return PLAYER_SKINS[((index % PLAYER_SKINS.length) + PLAYER_SKINS.length) % PLAYER_SKINS.length];
}
/** Выбранный магазинный скин; обычный сохраняет цвет игрока по номеру. */
export function onlineSkinFor(code, index) {
    if (skinIdFromCode(code) !== "ryzik3489")
        return skinFor(index);
    return {
        id: "ryzik3489",
        shirt: [0.055, 0.06, 0.075],
        pants: [0.07, 0.09, 0.13],
        hair: [0.045, 0.035, 0.03],
        skin: [0.76, 0.58, 0.48],
        tag: "#f3a05e",
    };
}
/** Фото-принт на передней стороне футболки: маленькая цветная мозаика видна в 3D без текстурного шейдера. */
function buildShirtPrint(mesh, hipY, chestTop) {
    const rows = RYZIK_SHIRT_PIXELS.length;
    const columns = RYZIK_SHIRT_PIXELS[0]?.length ?? 0;
    if (rows === 0 || columns === 0)
        return;
    const x0 = -0.185;
    const x1 = 0.185;
    const y0 = hipY + 0.035;
    const y1 = chestTop - 0.035;
    const tileW = (x1 - x0) / columns;
    const tileH = (y1 - y0) / rows;
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const left = x0 + column * tileW;
            const right = left + tileW + 0.001;
            const top = y1 - row * tileH;
            const bottom = top - tileH - 0.001;
            mesh.box(left, bottom, -0.128, right, top, -0.121, RYZIK_SHIRT_PIXELS[row][column]);
        }
    }
}
function rotate(mesh, start, cx, cz, angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    // В игре yaw = 0 — это взгляд вдоль -Z, а поворот идёт как у учительницы:
    // x' = x*cos + z*sin, z' = -x*sin + z*cos. Раньше знаки были зеркальными,
    // и фигурка разворачивалась в другую сторону, чем смотрел сам игрок.
    for (let i = start; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i] - cx;
        const z = mesh.positions[i + 2] - cz;
        mesh.positions[i] = cx + x * cos + z * sin;
        mesh.positions[i + 2] = cz - x * sin + z * cos;
        const nx = mesh.normals[i];
        const nz = mesh.normals[i + 2];
        mesh.normals[i] = nx * cos + nz * sin;
        mesh.normals[i + 2] = -nx * sin + nz * cos;
    }
}
/**
 * Строит фигурку игрока. Сначала собираем её «лицом на север»
 * вокруг начала координат, потом разом поворачиваем и сдвигаем.
 */
export function buildRemotePlayer(mesh, pose) {
    const start = mesh.positions.length;
    const skin = pose.skin;
    const sit = pose.sitting;
    const crouch = pose.crouching && !sit;
    const scale = sit ? 0.86 : crouch ? 0.72 : 1;
    const base = sit ? 0.44 : 0;
    const walking = !sit && pose.speed > 0.35;
    const swing = walking ? Math.sin(pose.phase) * Math.min(1, pose.speed / 3.4) * 0.42 : 0;
    const bob = walking ? Math.abs(Math.sin(pose.phase)) * 0.035 : 0;
    const hipY = base + 0.84 * scale + bob;
    const chestTop = hipY + 0.52 * scale;
    const headLow = chestTop + 0.06;
    const headHigh = headLow + 0.26;
    // Ноги
    const legTop = hipY;
    const legBottom = base + (sit ? 0.42 : 0);
    if (sit) {
        // Сидячая поза: бёдра вперёд, голени вниз.
        mesh.box(-0.17, hipY - 0.16, -0.42, -0.02, hipY, 0.02, skin.pants);
        mesh.box(0.02, hipY - 0.16, -0.42, 0.17, hipY, 0.02, skin.pants);
        mesh.box(-0.16, 0.04, -0.42, -0.03, hipY - 0.16, -0.28, shade(skin.pants, 0.9));
        mesh.box(0.03, 0.04, -0.42, 0.16, hipY - 0.16, -0.28, shade(skin.pants, 0.9));
        mesh.box(-0.17, 0, -0.44, -0.02, 0.05, -0.24, [0.14, 0.13, 0.14]);
        mesh.box(0.02, 0, -0.44, 0.17, 0.05, -0.24, [0.14, 0.13, 0.14]);
    }
    else {
        const leftZ = swing * 0.34;
        const rightZ = -swing * 0.34;
        mesh.box(-0.17, legBottom + 0.05, -0.09 + leftZ, -0.02, legTop, 0.08 + leftZ, skin.pants);
        mesh.box(0.02, legBottom + 0.05, -0.09 + rightZ, 0.17, legTop, 0.08 + rightZ, skin.pants);
        mesh.box(-0.18, legBottom, -0.13 + leftZ, -0.01, legBottom + 0.06, 0.08 + leftZ, [0.14, 0.13, 0.14]);
        mesh.box(0.01, legBottom, -0.13 + rightZ, 0.18, legBottom + 0.06, 0.08 + rightZ, [0.14, 0.13, 0.14]);
    }
    // Корпус и руки
    mesh.box(-0.21, hipY, -0.12, 0.21, chestTop, 0.12, skin.shirt);
    mesh.box(-0.21, chestTop - 0.1, -0.12, 0.21, chestTop, 0.12, shade(skin.shirt, 1.08));
    if (skin.id === "ryzik3489")
        buildShirtPrint(mesh, hipY, chestTop);
    // Рюкзак — чтобы со спины игрок читался сразу.
    mesh.box(-0.16, hipY + 0.08, 0.12, 0.16, chestTop - 0.06, 0.24, shade(skin.pants, 1.25));
    const armSwing = swing * 0.3;
    const armTop = chestTop - 0.02;
    const armLow = hipY + 0.06;
    // В руке либо фонарь, либо найденный предмет — и то, и другое рисуем реальной моделью.
    const held = sit ? null : (pose.held ?? (pose.flashlight ? "flashlight" : null));
    if (held) {
        // Рука с предметом: плечо вниз, предплечье вперёд, в кулаке модель предмета.
        const shoulderY = armTop - 0.02;
        const elbowY = armLow + 0.14;
        const handY = elbowY + 0.07;
        mesh.box(0.2, elbowY, -0.11, 0.31, shoulderY, 0.09, skin.shirt);
        mesh.box(0.21, elbowY, -0.34, 0.3, elbowY + 0.12, -0.09, skin.shirt);
        mesh.box(0.215, elbowY, -0.43, 0.295, elbowY + 0.11, -0.32, skin.skin);
        // Модель строим в локальных координатах — общий rotate() ниже повернёт её вместе с телом.
        buildItemModel(mesh, held, { x: 0.255, y: handY, z: -0.5, yaw: 0 }, 0.95 * scale, held === "flashlight" && pose.flashlight);
        if (held === "flashlight" && pose.flashlight) {
            mesh.box(0.235, handY - 0.03, -0.66, 0.275, handY + 0.03, -0.62, [0.95, 0.9, 0.55], {
                emissive: true,
            });
        }
    }
    else {
        mesh.box(0.2, armLow, -0.1 - armSwing, 0.31, armTop, 0.1 - armSwing, skin.shirt);
        mesh.box(0.21, armLow - 0.12, -0.09 - armSwing, 0.3, armLow, 0.09 - armSwing, skin.skin);
    }
    mesh.box(-0.31, armLow, -0.1 + armSwing, -0.2, armTop, 0.1 + armSwing, skin.shirt);
    mesh.box(-0.3, armLow - 0.12, -0.09 + armSwing, -0.21, armLow, 0.09 + armSwing, skin.skin);
    // Голова
    mesh.box(-0.07, headLow - 0.06, -0.06, 0.07, headLow, 0.06, skin.skin);
    mesh.box(-0.14, headLow, -0.13, 0.14, headHigh, 0.13, skin.skin);
    mesh.box(-0.145, headHigh - 0.09, -0.135, 0.145, headHigh + 0.02, 0.135, skin.hair);
    // Глаза смотрят в −Z, чтобы поворот совпадал с учительницей.
    mesh.box(-0.09, headLow + 0.13, -0.14, -0.03, headLow + 0.18, -0.128, [0.1, 0.1, 0.12]);
    mesh.box(0.03, headLow + 0.13, -0.14, 0.09, headLow + 0.18, -0.128, [0.1, 0.1, 0.12]);
    rotate(mesh, start, 0, 0, pose.yaw);
    for (let i = start; i < mesh.positions.length; i += 3) {
        mesh.positions[i] += pose.x;
        mesh.positions[i + 1] += pose.y;
        mesh.positions[i + 2] += pose.z;
    }
    for (let i = start; i < mesh.positions.length; i += 3) {
        mesh.minX = Math.min(mesh.minX, mesh.positions[i]);
        mesh.maxX = Math.max(mesh.maxX, mesh.positions[i]);
        mesh.minY = Math.min(mesh.minY, mesh.positions[i + 1]);
        mesh.maxY = Math.max(mesh.maxY, mesh.positions[i + 1]);
        mesh.minZ = Math.min(mesh.minZ, mesh.positions[i + 2]);
        mesh.maxZ = Math.max(mesh.maxZ, mesh.positions[i + 2]);
    }
}
/**
 * Проекция точки мира в пиксели экрана — для ников над головой.
 * Матрицу не трогаем: такая же формула, как в шейдере камеры.
 */
export function projectToScreen(camera, point, width, height) {
    const dx = point.x - camera.x;
    const dy = point.y - camera.y;
    const dz = point.z - camera.z;
    const distance = Math.hypot(dx, dy, dz);
    const cy = Math.cos(camera.yaw);
    const sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch);
    const sp = Math.sin(camera.pitch);
    // Взгляд без наклона: вперёд = −Z при yaw = 0.
    // Базис ровно такой же, как у видовой матрицы рендера (viewFromYawPitch):
    // right = (cos yaw, 0, -sin yaw), up и forward — с учётом наклона.
    // Раньше знаки yaw и pitch были зеркальными — именно от этого ники и летали.
    const rx = dx * cy - dz * sy;
    const ry = dx * (sy * sp) + dy * cp + dz * (cy * sp);
    const forward = dx * (-sy * cp) + dy * sp + dz * (-cy * cp);
    if (forward <= 0.15)
        return { x: 0, y: 0, visible: false, distance };
    const aspect = width / Math.max(1, height);
    const focal = 1 / Math.tan(((camera.fov * Math.PI) / 180) * 0.5);
    const ndcX = (rx * focal) / (aspect * forward);
    const ndcY = (ry * focal) / forward;
    const screenX = (ndcX * 0.5 + 0.5) * width;
    const screenY = (0.5 - ndcY * 0.5) * height;
    const visible = ndcX > -1.02 && ndcX < 1.02 && ndcY > -1.05 && ndcY < 1.05;
    return { x: screenX, y: screenY, visible, distance };
}
//# sourceMappingURL=remote.js.map