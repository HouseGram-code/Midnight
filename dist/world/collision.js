/**
 * ФИЗИКА МИРА.
 *
 * Весь мир — это список осевых коробок (AABB). Их несколько тысяч, поэтому
 * перебирать все 120 раз в секунду нельзя. Решение — равномерная сетка по XZ:
 * каждая ячейка хранит индексы коробок, которые в неё попадают, и проверяются только
 * ячейки вокруг игрока (обычно 1–4 штуки).
 *
 * Сцена статичная: сначала всё добавляется через add(), потом один раз build().
 */
/** Размер ячейки в метрах. 4 м — компромисс между памятью и числом проверок. */
export const CELL_SIZE = 4;
/** Запас вокруг здания: внешние стены торчат за габариты на полтолщины. */
const MARGIN = 12;
export class CollisionWorld {
    boxes = [];
    originX = -MARGIN;
    originZ = -MARGIN;
    cellsX;
    cellsZ;
    cells = [];
    stamps = new Int32Array(0);
    stampId = 0;
    built = false;
    constructor(width, depth) {
        this.cellsX = Math.max(1, Math.ceil((width + MARGIN * 2) / CELL_SIZE));
        this.cellsZ = Math.max(1, Math.ceil((depth + MARGIN * 2) / CELL_SIZE));
    }
    /** Сколько всего коробок в мире (для статистики). */
    get count() {
        return this.boxes.length;
    }
    /** Добавить коробку. Координаты в любом порядке не принимаются: только min → max. */
    add(x0, y0, z0, x1, y1, z1) {
        if (this.built)
            throw new Error("CollisionWorld уже собран");
        // Вырожденные коробки не нужны: только замедляют поиск.
        if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4)
            return;
        this.boxes.push({ x0, y0, z0, x1, y1, z1 });
    }
    addBox(box) {
        this.add(box.x0, box.y0, box.z0, box.x1, box.y1, box.z1);
    }
    /** Разложить коробки по ячейкам. После этого мир только читается. */
    build() {
        if (this.built)
            return;
        const total = this.cellsX * this.cellsZ;
        this.cells = new Array(total);
        for (let i = 0; i < total; i++)
            this.cells[i] = [];
        for (let index = 0; index < this.boxes.length; index++) {
            const box = this.boxes[index];
            const ix0 = this.cellX(box.x0);
            const ix1 = this.cellX(box.x1);
            const iz0 = this.cellZ(box.z0);
            const iz1 = this.cellZ(box.z1);
            for (let iz = iz0; iz <= iz1; iz++) {
                const row = iz * this.cellsX;
                for (let ix = ix0; ix <= ix1; ix++)
                    this.cells[row + ix].push(index);
            }
        }
        this.stamps = new Int32Array(this.boxes.length);
        this.built = true;
    }
    /**
     * Пересекается ли цилиндр игрока (квадрат radius × radius) с геометрией.
     * feetY — уровень ступней. Нижние 6 см игнорируются, иначе игрок цепляется
     * за пороги и край ступенек, на которых стоит.
     */
    overlaps(x, feetY, z, radius, height) {
        if (!this.built)
            this.build();
        const minX = x - radius;
        const maxX = x + radius;
        const minZ = z - radius;
        const maxZ = z + radius;
        const minY = feetY + 0.06;
        const maxY = feetY + height;
        if (maxY <= minY)
            return false;
        const ix0 = this.cellX(minX);
        const ix1 = this.cellX(maxX);
        const iz0 = this.cellZ(minZ);
        const iz1 = this.cellZ(maxZ);
        const stamp = ++this.stampId;
        for (let iz = iz0; iz <= iz1; iz++) {
            const row = iz * this.cellsX;
            for (let ix = ix0; ix <= ix1; ix++) {
                const bucket = this.cells[row + ix];
                for (let i = 0; i < bucket.length; i++) {
                    const index = bucket[i];
                    if (this.stamps[index] === stamp)
                        continue;
                    this.stamps[index] = stamp;
                    const box = this.boxes[index];
                    if (box.x1 <= minX || box.x0 >= maxX)
                        continue;
                    if (box.z1 <= minZ || box.z0 >= maxZ)
                        continue;
                    if (box.y1 <= minY || box.y0 >= maxY)
                        continue;
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * Высота опоры под ногами: самый высокий верх коробки не выше feetY + tolerance.
     * 0 — пол школы, он есть везде и коробкой не описан.
     * tolerance = высота шага при ходьбе и 0 при проверке приземления.
     */
    groundHeight(x, z, feetY, radius, tolerance) {
        if (!this.built)
            this.build();
        const minX = x - radius;
        const maxX = x + radius;
        const minZ = z - radius;
        const maxZ = z + radius;
        const ceiling = feetY + tolerance + 1e-3;
        let best = 0;
        const ix0 = this.cellX(minX);
        const ix1 = this.cellX(maxX);
        const iz0 = this.cellZ(minZ);
        const iz1 = this.cellZ(maxZ);
        const stamp = ++this.stampId;
        for (let iz = iz0; iz <= iz1; iz++) {
            const row = iz * this.cellsX;
            for (let ix = ix0; ix <= ix1; ix++) {
                const bucket = this.cells[row + ix];
                for (let i = 0; i < bucket.length; i++) {
                    const index = bucket[i];
                    if (this.stamps[index] === stamp)
                        continue;
                    this.stamps[index] = stamp;
                    const box = this.boxes[index];
                    if (box.y1 > ceiling || box.y1 <= best)
                        continue;
                    if (box.x1 <= minX || box.x0 >= maxX)
                        continue;
                    if (box.z1 <= minZ || box.z0 >= maxZ)
                        continue;
                    best = box.y1;
                }
            }
        }
        return best;
    }
    /**
     * Есть ли стена между двумя точками. Простая выборка по отрезку:
     * для ников над головой этого хватает, а стоит она копейки.
     */
    blocked(x0, y0, z0, x1, y1, z1) {
        if (!this.built)
            this.build();
        const dx = x1 - x0;
        const dy = y1 - y0;
        const dz = z1 - z0;
        const length = Math.hypot(dx, dy, dz);
        if (length < 0.4)
            return false;
        const steps = Math.min(56, Math.max(2, Math.ceil(length / 0.45)));
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            if (this.pointInside(x0 + dx * t, y0 + dy * t, z0 + dz * t))
                return true;
        }
        return false;
    }
    /** Точка внутри геометрии — вспомогательная проверка для лучей. */
    pointInside(x, y, z) {
        const bucket = this.cells[this.cellZ(z) * this.cellsX + this.cellX(x)];
        if (!bucket)
            return false;
        for (let i = 0; i < bucket.length; i++) {
            const box = this.boxes[bucket[i]];
            if (x < box.x0 || x > box.x1)
                continue;
            if (y < box.y0 || y > box.y1)
                continue;
            if (z < box.z0 || z > box.z1)
                continue;
            return true;
        }
        return false;
    }
    cellX(value) {
        const index = Math.floor((value - this.originX) / CELL_SIZE);
        return index < 0 ? 0 : index >= this.cellsX ? this.cellsX - 1 : index;
    }
    cellZ(value) {
        const index = Math.floor((value - this.originZ) / CELL_SIZE);
        return index < 0 ? 0 : index >= this.cellsZ ? this.cellsZ - 1 : index;
    }
}
//# sourceMappingURL=collision.js.map