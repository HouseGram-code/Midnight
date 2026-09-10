/**
 * Библиотека предметов школы.
 *
 * Всё собрано из коробок — дешёво для GPU и легко править.
 * solid() добавляет и геометрию, и коллайдер; decor() — только геометрию.
 */
import { FACE, hashNoise, shade } from "../core/mesh.js";
import { BOOK_COLORS, PALETTE } from "./palette.js";
export function solid(ctx, x0, y0, z0, x1, y1, z1, color, skip = 0) {
    ctx.mesh.box(x0, y0, z0, x1, y1, z1, color, { skip });
    ctx.collision.add(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
}
export function decor(ctx, x0, y0, z0, x1, y1, z1, color, skip = 0) {
    ctx.mesh.box(x0, y0, z0, x1, y1, z1, color, { skip });
}
export function glow(ctx, x0, y0, z0, x1, y1, z1, color) {
    ctx.mesh.box(x0, y0, z0, x1, y1, z1, color, { emissive: true });
}
/** Коробка с поворотом вокруг Y + консервативный коллайдер. */
function rotatedSolid(ctx, cx, y0, cz, sx, sy, sz, angle, color, collide) {
    ctx.mesh.rotatedBox(cx, y0, cz, sx, sy, sz, angle, color);
    if (!collide)
        return;
    const c = Math.abs(Math.cos(angle));
    const s = Math.abs(Math.sin(angle));
    const hx = (sx / 2) * c + (sz / 2) * s;
    const hz = (sx / 2) * s + (sz / 2) * c;
    ctx.collision.add(cx - hx, y0, cz - hz, cx + hx, y0 + sy, cz + hz);
}
/** Плитка пола в два оттенка — дешёвый способ сделать пол живым. */
export function tiledFloor(mesh, x0, z0, x1, z1, tile, base, y = 0) {
    const alt = shade(base, 0.9);
    const columns = Math.max(1, Math.ceil((x1 - x0) / tile));
    const rows = Math.max(1, Math.ceil((z1 - z0) / tile));
    for (let r = 0; r < rows; r++) {
        const za = z0 + r * tile;
        const zb = Math.min(z1, za + tile);
        for (let c = 0; c < columns; c++) {
            const xa = x0 + c * tile;
            const xb = Math.min(x1, xa + tile);
            mesh.horizontalQuad(xa, za, xb, zb, y, (r + c) % 2 === 0 ? base : alt, true);
        }
    }
}
/** Полоса разметки на полу (спортзал). */
export function floorLine(mesh, x0, z0, x1, z1, width, color, y = 0.01) {
    const half = width / 2;
    if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) {
        mesh.horizontalQuad(Math.min(x0, x1), z0 - half, Math.max(x0, x1), z0 + half, y, color, true);
    }
    else {
        mesh.horizontalQuad(x0 - half, Math.min(z0, z1), x0 + half, Math.max(z0, z1), y, color, true);
    }
}
export function floorRect(mesh, x0, z0, x1, z1, width, color, y = 0.01) {
    floorLine(mesh, x0, z0, x1, z0, width, color, y);
    floorLine(mesh, x0, z1, x1, z1, width, color, y);
    floorLine(mesh, x0, z0, x0, z1, width, color, y);
    floorLine(mesh, x1, z0, x1, z1, width, color, y);
}
export function floorCircle(mesh, cx, cz, radius, width, color, y = 0.01, segments = 28) {
    const inner = radius - width / 2;
    const outer = radius + width / 2;
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        mesh.quad(cx + c0 * inner, y, cz + s0 * inner, cx + c0 * outer, y, cz + s0 * outer, cx + c1 * outer, y, cz + s1 * outer, cx + c1 * inner, y, cz + s1 * inner, color);
    }
}
/** Потолочный светильник-панель. */
export function ceilingLamp(ctx, x, z, y, long = 1.2) {
    decor(ctx, x - long / 2 - 0.06, y - 0.1, z - 0.28, x + long / 2 + 0.06, y, z + 0.28, PALETTE.metal);
    glow(ctx, x - long / 2, y - 0.12, z - 0.22, x + long / 2, y - 0.1, z + 0.22, PALETTE.lamp);
}
/** Школьная парта. angle = 0 — ученик смотрит в -Z. */
export function desk(ctx, x, z, angle) {
    const top = 0.75;
    rotatedSolid(ctx, x, top - 0.04, z, 1.28, 0.04, 0.58, angle, PALETTE.woodLight, false);
    rotatedSolid(ctx, x, 0, z, 1.28, top - 0.04, 0.05, angle, PALETTE.metalDark, false);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (const side of [-1, 1]) {
        const lx = side * 0.58;
        rotatedSolid(ctx, x + lx * c, 0, z - lx * s, 0.06, top - 0.04, 0.52, angle, PALETTE.metal, false);
    }
    const ac = Math.abs(Math.cos(angle));
    const as = Math.abs(Math.sin(angle));
    const hx = 0.7 * ac + 0.36 * as;
    const hz = 0.7 * as + 0.36 * ac;
    ctx.collision.add(x - hx, 0, z - hz, x + hx, top, z + hz);
}
/** Стул. Спинка со стороны +Z при angle = 0. */
export function chair(ctx, x, z, angle, color = PALETTE.plasticBlue) {
    rotatedSolid(ctx, x, 0.44, z, 0.44, 0.05, 0.44, angle, color, false);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const backX = x + 0.2 * s;
    const backZ = z + 0.2 * c;
    rotatedSolid(ctx, backX, 0.49, backZ, 0.44, 0.44, 0.05, angle, color, false);
    for (const sx of [-0.18, 0.18]) {
        for (const sz of [-0.18, 0.18]) {
            const lx = x + sx * c + sz * s;
            const lz = z - sx * s + sz * c;
            decor(ctx, lx - 0.02, 0, lz - 0.02, lx + 0.02, 0.44, lz + 0.02, PALETTE.metal);
        }
    }
    ctx.collision.add(x - 0.24, 0, z - 0.24, x + 0.24, 0.9, z + 0.24);
}
/** Учительский стол. */
export function teacherDesk(ctx, x, z, angle) {
    rotatedSolid(ctx, x, 0.72, z, 1.7, 0.06, 0.8, angle, PALETTE.woodMid, false);
    rotatedSolid(ctx, x, 0, z, 1.6, 0.72, 0.7, angle, PALETTE.woodDark, false);
    const c = Math.abs(Math.cos(angle));
    const s = Math.abs(Math.sin(angle));
    const hx = 0.85 * c + 0.4 * s;
    const hz = 0.85 * s + 0.4 * c;
    ctx.collision.add(x - hx, 0, z - hz, x + hx, 0.78, z + hz);
}
/**
 * Доска на стене.
 * side: "x0" — висит на западной стене и смотрит в +X, и т.д.
 */
export function wallBoard(ctx, side, at, from, to, y0, y1, color) {
    const depth = 0.07;
    const frame = shade(PALETTE.woodMid, 0.9);
    if (side === "x0" || side === "x1") {
        const dir = side === "x0" ? 1 : -1;
        const x0 = side === "x0" ? at : at - depth;
        const x1 = x0 + depth;
        decor(ctx, x0, y0 - 0.06, from - 0.06, x1, y1 + 0.06, to + 0.06, frame);
        decor(ctx, x0 + dir * 0.02, y0, from, x1 + dir * 0.02, y1, to, color);
    }
    else {
        const dir = side === "z0" ? 1 : -1;
        const z0 = side === "z0" ? at : at - depth;
        const z1 = z0 + depth;
        decor(ctx, from - 0.06, y0 - 0.06, z0, to + 0.06, y1 + 0.06, z1, frame);
        decor(ctx, from, y0, z0 + dir * 0.02, to, y1, z1 + dir * 0.02, color);
    }
}
/** Шкаф у стены. */
export function cabinet(ctx, x0, z0, x1, z1, height = 1.9) {
    solid(ctx, x0, 0, z0, x1, height, z1, PALETTE.woodMid);
    const alongX = x1 - x0 > z1 - z0;
    const count = Math.max(1, Math.round((alongX ? x1 - x0 : z1 - z0) / 0.6));
    for (let i = 0; i < count; i++) {
        const t0 = (alongX ? x0 : z0) + ((alongX ? x1 - x0 : z1 - z0) / count) * i + 0.04;
        const t1 = t0 + (alongX ? x1 - x0 : z1 - z0) / count - 0.08;
        if (alongX) {
            decor(ctx, t0, 0.08, z1, t1, height - 0.08, z1 + 0.03, shade(PALETTE.woodLight, 0.96));
        }
        else {
            decor(ctx, x1, 0.08, t0, x1 + 0.03, height - 0.08, t1, shade(PALETTE.woodLight, 0.96));
        }
    }
}
/**
 * Блок школьных шкафчиков вдоль стены коридора.
 * Каждая дверца — отдельная коробка с чередующимся оттенком и ручкой.
 */
export function lockerBank(ctx, axis, at, from, to, facing, base = PALETTE.lockerBlue) {
    const depth = 0.42;
    const height = 1.85;
    const unit = 0.4;
    const count = Math.floor((to - from) / unit);
    if (count < 1)
        return;
    const startOffset = (to - from - count * unit) / 2;
    const near = at;
    const far = at + facing * depth;
    if (axis === "x") {
        solid(ctx, from, 0, Math.min(near, far), to, height, Math.max(near, far), shade(base, 0.7));
        decor(ctx, from, height, Math.min(near, far), to, height + 0.06, Math.max(near, far), PALETTE.metalDark);
        for (let i = 0; i < count; i++) {
            const a = from + startOffset + i * unit + 0.02;
            const b = a + unit - 0.04;
            const tint = i % 2 === 0 ? 1 : 0.92;
            const doorZ = far + facing * 0.03;
            decor(ctx, a, 0.06, Math.min(far, doorZ), b, height - 0.06, Math.max(far, doorZ), shade(base, tint));
            const handleX = facing > 0 ? b - 0.07 : a + 0.07;
            decor(ctx, handleX - 0.025, 1.0, Math.min(doorZ, doorZ + facing * 0.03), handleX + 0.025, 1.16, Math.max(doorZ, doorZ + facing * 0.03), PALETTE.metal);
        }
    }
    else {
        solid(ctx, Math.min(near, far), 0, from, Math.max(near, far), height, to, shade(base, 0.7));
        decor(ctx, Math.min(near, far), height, from, Math.max(near, far), height + 0.06, to, PALETTE.metalDark);
        for (let i = 0; i < count; i++) {
            const a = from + startOffset + i * unit + 0.02;
            const b = a + unit - 0.04;
            const tint = i % 2 === 0 ? 1 : 0.92;
            const doorX = far + facing * 0.03;
            decor(ctx, Math.min(far, doorX), 0.06, a, Math.max(far, doorX), height - 0.06, b, shade(base, tint));
            const handleZ = facing > 0 ? b - 0.07 : a + 0.07;
            decor(ctx, Math.min(doorX, doorX + facing * 0.03), 1.0, handleZ - 0.025, Math.max(doorX, doorX + facing * 0.03), 1.16, handleZ + 0.025, PALETTE.metal);
        }
    }
}
/** Скамейка. */
export function bench(ctx, axis, at, from, to, offset) {
    if (axis === "x") {
        solid(ctx, from, 0.42, at - 0.22, to, 0.48, at + 0.22, PALETTE.woodLight);
        for (const t of [from + 0.25, to - 0.25]) {
            decor(ctx, t - 0.05, 0, at - 0.18, t + 0.05, 0.42, at + 0.18, PALETTE.metalDark);
        }
        const backA = at + offset * 0.2;
        const backB = at + offset * 0.24;
        decor(ctx, from, 0.5, Math.min(backA, backB), to, 0.95, Math.max(backA, backB), PALETTE.woodLight);
    }
    else {
        solid(ctx, at - 0.22, 0.42, from, at + 0.22, 0.48, to, PALETTE.woodLight);
        for (const t of [from + 0.25, to - 0.25]) {
            decor(ctx, at - 0.18, 0, t - 0.05, at + 0.18, 0.42, t + 0.05, PALETTE.metalDark);
        }
        const backA = at + offset * 0.2;
        const backB = at + offset * 0.24;
        decor(ctx, Math.min(backA, backB), 0.5, from, Math.max(backA, backB), 0.95, to, PALETTE.woodLight);
    }
}
/** Урна. */
export function bin(ctx, x, z) {
    solid(ctx, x - 0.18, 0, z - 0.18, x + 0.18, 0.62, z + 0.18, PALETTE.metalDark);
    decor(ctx, x - 0.2, 0.62, z - 0.2, x + 0.2, 0.68, z + 0.2, PALETTE.metal);
}
/** Фикус в кадке. */
export function plant(ctx, x, z, height = 1.5) {
    solid(ctx, x - 0.26, 0, z - 0.26, x + 0.26, 0.42, z + 0.26, PALETTE.plantPot);
    decor(ctx, x - 0.05, 0.42, z - 0.05, x + 0.05, height, z + 0.05, PALETTE.woodDark);
    const leaf = PALETTE.plantLeaf;
    for (let i = 0; i < 5; i++) {
        const n = hashNoise(x * 3.1 + z * 7.7 + i);
        const y = 0.7 + (height - 0.8) * (i / 5);
        const spread = 0.34 + n * 0.22;
        const angle = n * Math.PI * 2;
        const lx = x + Math.cos(angle) * spread * 0.5;
        const lz = z + Math.sin(angle) * spread * 0.5;
        ctx.mesh.rotatedBox(lx, y, lz, spread, 0.05, spread * 0.7, angle, shade(leaf, 0.85 + n * 0.3));
    }
}
/** Радиатор под окном. */
export function radiator(ctx, axis, at, from, to, facing) {
    const depth = 0.12;
    const color = shade(PALETTE.paper, 0.95);
    if (axis === "x") {
        const z0 = Math.min(at, at + facing * depth);
        const z1 = Math.max(at, at + facing * depth);
        solid(ctx, from, 0.18, z0, to, 0.78, z1, color);
        const count = Math.floor((to - from) / 0.12);
        for (let i = 0; i < count; i++) {
            const a = from + i * 0.12 + 0.03;
            decor(ctx, a, 0.2, z0 - 0.01, a + 0.06, 0.76, z1 + 0.01, shade(color, 0.9));
        }
    }
    else {
        const x0 = Math.min(at, at + facing * depth);
        const x1 = Math.max(at, at + facing * depth);
        solid(ctx, x0, 0.18, from, x1, 0.78, to, color);
        const count = Math.floor((to - from) / 0.12);
        for (let i = 0; i < count; i++) {
            const a = from + i * 0.12 + 0.03;
            decor(ctx, x0 - 0.01, 0.2, a, x1 + 0.01, 0.76, a + 0.06, shade(color, 0.9));
        }
    }
}
/** Информационный стенд с листочками. */
export function noticeBoard(ctx, side, at, from, to, seed = 1) {
    wallBoard(ctx, side, at, from, to, 1.05, 2.1, shade(PALETTE.woodDark, 1.3));
    const depth = 0.09;
    const papers = Math.max(2, Math.floor((to - from) / 0.5));
    for (let i = 0; i < papers; i++) {
        const n = hashNoise(seed * 13.7 + i * 5.3);
        const w = 0.22 + n * 0.1;
        const h = 0.3 + n * 0.12;
        const t = from + 0.14 + ((to - from - 0.3) * i) / papers;
        const y = 1.25 + n * 0.55;
        const tone = n > 0.72 ? PALETTE.plasticYellow : n > 0.45 ? PALETTE.paper : shade(PALETTE.glass, 1.1);
        if (side === "x0" || side === "x1") {
            const x = side === "x0" ? at + depth : at - depth - 0.01;
            decor(ctx, x, y, t, x + 0.01, y + h, t + w, tone);
        }
        else {
            const z = side === "z0" ? at + depth : at - depth - 0.01;
            decor(ctx, t, y, z, t + w, y + h, z + 0.01, tone);
        }
    }
}
/** Стенные часы. */
export function wallClock(ctx, side, at, along, y = 2.5) {
    const r = 0.24;
    const d = 0.07;
    if (side === "x0" || side === "x1") {
        const x = side === "x0" ? at : at - d;
        decor(ctx, x, y - r, along - r, x + d, y + r, along + r, PALETTE.metalDark);
        const face = side === "x0" ? x + d : x - 0.01;
        decor(ctx, face, y - r + 0.03, along - r + 0.03, face + 0.01, y + r - 0.03, along + r - 0.03, PALETTE.paper);
    }
    else {
        const z = side === "z0" ? at : at - d;
        decor(ctx, along - r, y - r, z, along + r, y + r, z + d, PALETTE.metalDark);
        const face = side === "z0" ? z + d : z - 0.01;
        decor(ctx, along - r + 0.03, y - r + 0.03, face, along + r - 0.03, y + r - 0.03, face + 0.01, PALETTE.paper);
    }
}
/** Стол столовой с двумя лавками (длинная ось — X). */
export function canteenTable(ctx, x, z, length = 2.6) {
    solid(ctx, x - length / 2, 0.7, z - 0.4, x + length / 2, 0.76, z + 0.4, PALETTE.woodLight);
    for (const t of [x - length / 2 + 0.3, x + length / 2 - 0.3]) {
        decor(ctx, t - 0.05, 0, z - 0.06, t + 0.05, 0.7, z + 0.06, PALETTE.metal);
        decor(ctx, t - 0.3, 0, z - 0.35, t + 0.3, 0.05, z + 0.35, PALETTE.metalDark);
    }
    for (const side of [-1, 1]) {
        const bz = z + side * 0.78;
        solid(ctx, x - length / 2 + 0.1, 0.42, bz - 0.16, x + length / 2 - 0.1, 0.47, bz + 0.16, PALETTE.woodMid);
        for (const t of [x - length / 2 + 0.35, x + length / 2 - 0.35]) {
            decor(ctx, t - 0.04, 0, bz - 0.12, t + 0.04, 0.42, bz + 0.12, PALETTE.metal);
        }
    }
}
/** Раздаточная линия. */
export function servingCounter(ctx, x0, z0, x1, z1) {
    solid(ctx, x0, 0, z0, x1, 0.92, z1, PALETTE.metal);
    decor(ctx, x0 - 0.06, 0.92, z0 - 0.06, x1 + 0.06, 0.98, z1 + 0.06, shade(PALETTE.metal, 1.12));
    decor(ctx, x0 + 0.1, 0.98, z0 + 0.08, x1 - 0.1, 1.02, z1 - 0.08, PALETTE.plasticGreen);
    const posts = Math.max(2, Math.round((x1 - x0) / 1.4));
    for (let i = 0; i <= posts; i++) {
        const x = x0 + ((x1 - x0) * i) / posts;
        decor(ctx, x - 0.03, 0.98, z1 - 0.1, x + 0.03, 1.75, z1 - 0.04, PALETTE.metalDark);
    }
    decor(ctx, x0, 1.68, z1 - 0.14, x1, 1.76, z1 - 0.02, shade(PALETTE.glass, 1.15));
}
/** Торговый автомат. */
export function vendingMachine(ctx, x, z, facing) {
    const w = 0.9;
    const d = 0.7;
    const h = 1.9;
    solid(ctx, x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, PALETTE.plasticRed);
    const inset = 0.04;
    if (facing === "z1") {
        glow(ctx, x - w / 2 + 0.1, 0.55, z + d / 2, x + w / 2 - 0.28, h - 0.18, z + d / 2 + inset, PALETTE.glassBright);
    }
    else if (facing === "z0") {
        glow(ctx, x - w / 2 + 0.28, 0.55, z - d / 2 - inset, x + w / 2 - 0.1, h - 0.18, z - d / 2, PALETTE.glassBright);
    }
    else if (facing === "x1") {
        glow(ctx, x + w / 2, 0.55, z - d / 2 + 0.1, x + w / 2 + inset, h - 0.18, z + d / 2 - 0.28, PALETTE.glassBright);
    }
    else {
        glow(ctx, x - w / 2 - inset, 0.55, z - d / 2 + 0.28, x - w / 2, h - 0.18, z + d / 2 - 0.1, PALETTE.glassBright);
    }
}
/** Стеллаж с книгами. Ось — направление длины. */
export function bookshelf(ctx, axis, at, from, to, depth = 0.5, height = 2.05, seed = 1) {
    const half = depth / 2;
    const x0 = axis === "x" ? from : at - half;
    const x1 = axis === "x" ? to : at + half;
    const z0 = axis === "x" ? at - half : from;
    const z1 = axis === "x" ? at + half : to;
    solid(ctx, x0, 0, z0, x1, height, z1, PALETTE.woodMid);
    const shelves = 5;
    for (let s = 1; s <= shelves; s++) {
        const y = (height / (shelves + 1)) * s;
        decor(ctx, x0 + 0.03, y, z0 + 0.03, x1 - 0.03, y + 0.03, z1 - 0.03, shade(PALETTE.woodLight, 0.9));
        const length = axis === "x" ? x1 - x0 : z1 - z0;
        const books = Math.floor(length / 0.13);
        for (let b = 0; b < books; b++) {
            const n = hashNoise(seed * 17.3 + s * 3.7 + b * 1.9);
            if (n < 0.14)
                continue;
            const color = BOOK_COLORS[Math.floor(n * BOOK_COLORS.length) % BOOK_COLORS.length];
            const bh = 0.2 + n * 0.1;
            const t0 = (axis === "x" ? x0 : z0) + 0.06 + b * 0.13;
            const t1 = t0 + 0.1;
            if (axis === "x") {
                for (const side of [-1, 1]) {
                    const zc = at + side * (half - 0.12);
                    decor(ctx, t0, y + 0.03, zc - 0.1, t1, y + 0.03 + bh, zc + 0.1, shade(color, 0.9 + n * 0.3));
                }
            }
            else {
                for (const side of [-1, 1]) {
                    const xc = at + side * (half - 0.12);
                    decor(ctx, xc - 0.1, y + 0.03, t0, xc + 0.1, y + 0.03 + bh, t1, shade(color, 0.9 + n * 0.3));
                }
            }
        }
    }
}
/** Круглый читательский стол (восьмиугольник из коробок). */
export function readingTable(ctx, x, z, radius = 0.85) {
    ctx.mesh.rotatedBox(x, 0.7, z, radius * 2, 0.06, radius * 1.4, 0, PALETTE.woodLight);
    ctx.mesh.rotatedBox(x, 0.7, z, radius * 1.4, 0.06, radius * 2, 0, PALETTE.woodLight);
    decor(ctx, x - 0.08, 0, z - 0.08, x + 0.08, 0.7, z + 0.08, PALETTE.metalDark);
    decor(ctx, x - 0.35, 0, z - 0.35, x + 0.35, 0.05, z + 0.35, PALETTE.metalDark);
    ctx.collision.add(x - radius, 0, z - radius, x + radius, 0.76, z + radius);
}
/** Баскетбольное кольцо со щитом. facing: направление в центр зала по Z. */
export function basketballHoop(ctx, x, z, facing) {
    const boardY = 2.75;
    const armZ = z + facing * 0.6;
    decor(ctx, x - 0.06, 3.05, Math.min(z, armZ), x + 0.06, 3.15, Math.max(z, armZ), PALETTE.metalDark);
    decor(ctx, x - 0.9, boardY, armZ - 0.03, x + 0.9, boardY + 1.05, armZ + 0.03, shade(PALETTE.glassBright, 0.98));
    decor(ctx, x - 0.3, boardY + 0.15, armZ + facing * 0.03, x + 0.3, boardY + 0.6, armZ + facing * 0.05, PALETTE.red);
    const rimZ = armZ + facing * 0.42;
    decor(ctx, x - 0.24, boardY + 0.12, Math.min(armZ, rimZ), x + 0.24, boardY + 0.16, Math.max(armZ, rimZ), PALETTE.plasticRed);
    for (let i = 0; i < 4; i++) {
        const y = boardY + 0.12 - 0.1 * (i + 1);
        const inset = 0.02 * i;
        decor(ctx, x - 0.22 + inset, y, Math.min(armZ, rimZ) + inset, x + 0.22 - inset, y + 0.02, Math.max(armZ, rimZ) - inset, PALETTE.paper);
    }
}
/** Трибуны спортзала (ступени вдоль стены X). */
export function bleachers(ctx, x0, z0, z1, steps = 4) {
    const stepDepth = 0.7;
    const stepHeight = 0.42;
    for (let i = 0; i < steps; i++) {
        const x = x0 + i * stepDepth;
        solid(ctx, x, 0, z0, x + stepDepth, stepHeight * (steps - i), z1, i % 2 === 0 ? PALETTE.woodMid : shade(PALETTE.woodMid, 0.92));
        decor(ctx, x, stepHeight * (steps - i), z0, x + stepDepth, stepHeight * (steps - i) + 0.04, z1, PALETTE.woodLight);
    }
}
/** Лестничный марш вдоль +Z с площадкой сверху. */
export function stairFlight(ctx, x0, x1, z0, steps, stepRun, stepRise) {
    for (let i = 0; i < steps; i++) {
        const z = z0 + i * stepRun;
        solid(ctx, x0, 0, z, x1, stepRise * (i + 1), z + stepRun, i % 2 === 0 ? PALETTE.floorTile : shade(PALETTE.floorTile, 0.94));
    }
    const topY = stepRise * steps;
    const topZ = z0 + steps * stepRun;
    // перила́ с двух сторон
    for (const x of [x0 + 0.06, x1 - 0.06]) {
        for (let i = 0; i < steps; i += 2) {
            const z = z0 + i * stepRun + stepRun / 2;
            decor(ctx, x - 0.03, stepRise * (i + 1), z - 0.03, x + 0.03, stepRise * (i + 1) + 0.95, z + 0.03, PALETTE.metal);
        }
    }
    return { topY, topZ };
}
/** Стойка дежурного / ресепшн. */
export function receptionDesk(ctx, x0, z0, x1, z1) {
    solid(ctx, x0, 0, z0, x1, 0.78, z1, PALETTE.woodMid);
    decor(ctx, x0 - 0.08, 0.78, z0 - 0.08, x1 + 0.08, 0.86, z1 + 0.08, PALETTE.woodLight);
    decor(ctx, x0 + 0.05, 0.86, z0 - 0.06, x1 - 0.05, 1.12, z0 + 0.02, shade(PALETTE.glass, 1.1));
}
/** Витрина с кубками. */
export function trophyCase(ctx, side, at, from, to, seed = 1) {
    const depth = 0.45;
    const x0 = side === "x0" ? at : at - depth;
    const x1 = x0 + depth;
    solid(ctx, x0, 0, from, x1, 2.2, to, PALETTE.woodDark);
    const faceX = side === "x0" ? x1 - 0.04 : x0 + 0.02;
    glow(ctx, faceX, 0.5, from + 0.06, faceX + 0.02, 2.1, to - 0.06, shade(PALETTE.glassBright, 0.92));
    for (let s = 0; s < 3; s++) {
        const y = 0.62 + s * 0.5;
        decor(ctx, x0 + 0.05, y, from + 0.05, x1 - 0.05, y + 0.03, to - 0.05, PALETTE.woodLight);
        const items = Math.floor((to - from) / 0.55);
        for (let i = 0; i < items; i++) {
            const n = hashNoise(seed * 9.1 + s * 4.3 + i * 2.7);
            if (n < 0.25)
                continue;
            const t = from + 0.25 + i * 0.55;
            const h = 0.16 + n * 0.16;
            const gold = n > 0.6 ? [0.86, 0.72, 0.3] : [0.72, 0.74, 0.78];
            decor(ctx, x0 + 0.14, y + 0.03, t - 0.06, x0 + 0.24, y + 0.03 + h, t + 0.06, gold);
            decor(ctx, x0 + 0.1, y + 0.03, t - 0.1, x0 + 0.28, y + 0.06, t + 0.1, PALETTE.woodDark);
        }
    }
}
/** Герб школы — простой геометрический знак на стене (без текста). */
export function schoolCrest(ctx, x, y, z, size = 1.6) {
    const d = 0.06;
    decor(ctx, x - size / 2, y - size / 2, z, x + size / 2, y + size / 2, z + d, PALETTE.plasticBlue);
    decor(ctx, x - size / 2 + 0.12, y - size / 2 + 0.12, z + d, x + size / 2 - 0.12, y + size / 2 - 0.12, z + d + 0.02, PALETTE.paper);
    ctx.mesh.rotatedBox(x, y - 0.28, z + d + 0.03, size * 0.42, size * 0.42, 0.02, Math.PI / 4, PALETTE.plasticBlue);
    decor(ctx, x - 0.06, y - 0.02, z + d + 0.05, x + 0.06, y + 0.5, z + d + 0.07, PALETTE.plasticYellow);
    decor(ctx, x - 0.3, y + 0.16, z + d + 0.05, x + 0.3, y + 0.28, z + d + 0.07, PALETTE.plasticYellow);
}
/** Тканевый баннер, свисающий с потолка. */
export function banner(ctx, x, z, top, height, color) {
    decor(ctx, x - 0.45, top - height, z - 0.01, x + 0.45, top, z + 0.01, color);
    decor(ctx, x - 0.5, top, z - 0.03, x + 0.5, top + 0.06, z + 0.03, PALETTE.metalDark);
    decor(ctx, x - 0.3, top - height - 0.16, z - 0.015, x + 0.3, top - height, z + 0.015, shade(color, 0.8));
}
/** Сантехника: раковины и зеркала вдоль стены X. */
export function sinkRow(ctx, x0, x1, z, facing) {
    const depth = 0.5;
    const z0 = Math.min(z, z + facing * depth);
    const z1 = Math.max(z, z + facing * depth);
    solid(ctx, x0, 0.72, z0, x1, 0.86, z1, PALETTE.floorTile);
    const count = Math.max(1, Math.floor((x1 - x0) / 0.75));
    for (let i = 0; i < count; i++) {
        const cx = x0 + (x1 - x0) * ((i + 0.5) / count);
        decor(ctx, cx - 0.2, 0.78, z0 + 0.06, cx + 0.2, 0.87, z1 - 0.06, shade(PALETTE.glassBright, 0.9));
        decor(ctx, cx - 0.03, 0.86, z + facing * 0.06, cx + 0.03, 1.06, z + facing * 0.1, PALETTE.metal);
        glow(ctx, cx - 0.28, 1.35, z + facing * 0.02, cx + 0.28, 2.0, z + facing * 0.05, shade(PALETTE.glassBright, 0.88));
    }
}
/** Кабинки санузла вдоль стены Z. */
export function toiletStalls(ctx, x, z0, z1, width, count) {
    const pitch = (z1 - z0) / count;
    for (let i = 0; i <= count; i++) {
        const z = z0 + i * pitch;
        solid(ctx, x, 0.15, z - 0.03, x + width, 2.05, z + 0.03, PALETTE.plasticGreen);
    }
    for (let i = 0; i < count; i++) {
        const zc = z0 + pitch * (i + 0.5);
        decor(ctx, x + width - 0.06, 0.15, zc - pitch / 2 + 0.06, x + width, 2.05, zc - 0.12, shade(PALETTE.plasticGreen, 1.12));
        decor(ctx, x + 0.12, 0, zc - 0.16, x + 0.5, 0.4, zc + 0.16, PALETTE.floorTile);
    }
}
/** Складские коробки вразнобой. */
export function crates(ctx, x0, z0, x1, z1, seed = 1) {
    let i = 0;
    for (let x = x0; x < x1 - 0.5; x += 0.75) {
        for (let z = z0; z < z1 - 0.5; z += 0.8) {
            const n = hashNoise(seed * 5.7 + i++);
            if (n < 0.3)
                continue;
            const h = 0.4 + n * 0.7;
            const tone = n > 0.66 ? PALETTE.woodMid : n > 0.45 ? shade(PALETTE.woodLight, 0.9) : PALETTE.paper;
            solid(ctx, x, 0, z, x + 0.6 + n * 0.1, h, z + 0.62, tone);
            if (n > 0.7)
                solid(ctx, x + 0.05, h, z + 0.05, x + 0.5, h + 0.35, z + 0.5, shade(tone, 0.9));
        }
    }
}
/** Дверное полотно, открытое вдоль стены (проход свободен). */
export function openDoorLeaf(ctx, axis, at, edge, direction, width, height, side) {
    const thickness = 0.05;
    const leaf = width - 0.06;
    if (axis === "x") {
        const z = at + side * 0.16;
        const x0 = direction > 0 ? edge : edge - leaf;
        decor(ctx, x0, 0.04, z - thickness, x0 + leaf, height, z + thickness, PALETTE.doorLeaf);
        const handleX = direction > 0 ? x0 + leaf - 0.12 : x0 + 0.12;
        decor(ctx, handleX - 0.05, 1.02, z - thickness - 0.03, handleX + 0.05, 1.1, z + thickness + 0.03, PALETTE.metal);
        ctx.collision.add(x0, 0, z - 0.1, x0 + leaf, height, z + 0.1);
    }
    else {
        const x = at + side * 0.16;
        const z0 = direction > 0 ? edge : edge - leaf;
        decor(ctx, x - thickness, 0.04, z0, x + thickness, height, z0 + leaf, PALETTE.doorLeaf);
        const handleZ = direction > 0 ? z0 + leaf - 0.12 : z0 + 0.12;
        decor(ctx, x - thickness - 0.03, 1.02, handleZ - 0.05, x + thickness + 0.03, 1.1, handleZ + 0.05, PALETTE.metal);
        ctx.collision.add(x - 0.1, 0, z0, x + 0.1, height, z0 + leaf);
    }
}
export const FACE_MASKS = FACE;
/**
 * Шкаф-укрытие: глубокий корпус с настоящей пустотой внутри и смотровой
 * щелью между створками. Камера игрока стоит в центре пустоты, поэтому
 * ничего не торчит и есть место для обзора.
 *
 * @param at координата стены по Z
 * @param x центр шкафа по X
 * @param facing +1 — фасад смотрит в +Z, −1 — в −Z
 */
export function hideLocker(ctx, at, x, facing, base = PALETTE.lockerTeal) {
    const depth = 0.78;
    const height = 2.02;
    const half = 0.46;
    const panel = 0.075;
    const slitLow = 1.2;
    const slitHigh = 1.64;
    const near = at;
    const far = at + facing * depth;
    const zA = Math.min(near, far);
    const zB = Math.max(near, far);
    const backA = Math.min(near, near + facing * panel);
    const backB = Math.max(near, near + facing * panel);
    const doorA = Math.min(far, far - facing * panel);
    const doorB = Math.max(far, far - facing * panel);
    const shell = shade(base, 0.62);
    const inner = shade(base, 0.38);
    // Корпус: задняя стенка, боковины, крыша и донце.
    solid(ctx, x - half, 0, backA, x + half, height, backB, shell);
    solid(ctx, x - half, 0, zA, x - half + panel, height, zB, shell);
    solid(ctx, x + half - panel, 0, zA, x + half, height, zB, shell);
    solid(ctx, x - half, height - 0.09, zA, x + half, height, zB, shade(base, 0.55));
    decor(ctx, x - half + panel, 0, backB, x + half - panel, 0.06, doorA, inner);
    // Полка над головой и крючок — внутри должно быть на что смотреть.
    decor(ctx, x - half + panel, 1.88, backB, x + half - panel, 1.94, doorA, inner);
    decor(ctx, x - 0.03, 1.72, backB + 0.02, x + 0.03, 1.88, backB + 0.07, PALETTE.metal);
    // Створки: снизу и сверху глухие, между ними щель на уровне глаз.
    const leaf = (y0, y1) => {
        solid(ctx, x - half + panel, y0, doorA, x - 0.014, y1, doorB, base);
        solid(ctx, x + 0.014, y0, doorA, x + half - panel, y1, doorB, shade(base, 0.93));
    };
    leaf(0.06, slitLow);
    leaf(slitHigh, height - 0.09);
    // Наружные детали: ручки и вентиляционные прорези.
    const outerA = Math.min(far, far + facing * 0.014);
    const outerB = Math.max(far, far + facing * 0.014);
    for (const hx of [x - 0.1, x + 0.1]) {
        decor(ctx, hx - 0.022, 0.92, outerA, hx + 0.022, 1.14, outerB, PALETTE.metal);
    }
    for (let i = 0; i < 3; i++) {
        const y = slitHigh + 0.14 + i * 0.11;
        decor(ctx, x - 0.28, y, outerA, x + 0.28, y + 0.03, outerB, shade(base, 0.5));
    }
    // Тёмные кромки щели, чтобы проём читался и снаружи, и изнутри.
    decor(ctx, x - half + panel, slitLow, doorA, x + half - panel, slitLow + 0.03, doorB, inner);
    decor(ctx, x - half + panel, slitHigh - 0.03, doorA, x + half - panel, slitHigh, doorB, inner);
}
//# sourceMappingURL=props.js.map