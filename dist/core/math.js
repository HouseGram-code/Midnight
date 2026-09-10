/**
 * Минимальная 3D-математика: матрицы 4x4 (column-major, как ждёт WebGL)
 * и извлечение плоскостей пирамиды видимости для отсечения.
 * Всё работает без выделения памяти в кадре — матрицы переиспользуются.
 */
export function vec3(x = 0, y = 0, z = 0) {
    return { x, y, z };
}
export function createMat4() {
    const m = new Float32Array(16);
    m[0] = 1;
    m[5] = 1;
    m[10] = 1;
    m[15] = 1;
    return m;
}
/** Матрица перспективной проекции. */
export function perspective(out, fovYRadians, aspect, near, far) {
    const f = 1 / Math.tan(fovYRadians / 2);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
}
/**
 * Видовая матрица из позиции камеры и углов поворота.
 * yaw = 0 смотрит вдоль -Z, положительный pitch смотрит вверх.
 */
export function viewFromYawPitch(out, eyeX, eyeY, eyeZ, yaw, pitch) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const fx = -sy * cp;
    const fy = sp;
    const fz = -cy * cp;
    const rx = cy;
    const ry = 0;
    const rz = -sy;
    const ux = sy * sp;
    const uy = cp;
    const uz = cy * sp;
    out[0] = rx;
    out[4] = ry;
    out[8] = rz;
    out[12] = -(rx * eyeX + ry * eyeY + rz * eyeZ);
    out[1] = ux;
    out[5] = uy;
    out[9] = uz;
    out[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ);
    out[2] = -fx;
    out[6] = -fy;
    out[10] = -fz;
    out[14] = fx * eyeX + fy * eyeY + fz * eyeZ;
    out[3] = 0;
    out[7] = 0;
    out[11] = 0;
    out[15] = 1;
    return out;
}
/** out = a * b */
export function multiply(out, a, b) {
    for (let col = 0; col < 4; col++) {
        const b0 = b[col * 4 + 0];
        const b1 = b[col * 4 + 1];
        const b2 = b[col * 4 + 2];
        const b3 = b[col * 4 + 3];
        out[col * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
}
export function createFrustum() {
    return new Float32Array(24);
}
export function extractFrustum(out, m) {
    const r0x = m[0];
    const r0y = m[4];
    const r0z = m[8];
    const r0w = m[12];
    const r1x = m[1];
    const r1y = m[5];
    const r1z = m[9];
    const r1w = m[13];
    const r2x = m[2];
    const r2y = m[6];
    const r2z = m[10];
    const r2w = m[14];
    const r3x = m[3];
    const r3y = m[7];
    const r3z = m[11];
    const r3w = m[15];
    setPlane(out, 0, r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w);
    setPlane(out, 1, r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w);
    setPlane(out, 2, r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w);
    setPlane(out, 3, r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w);
    setPlane(out, 4, r3x + r2x, r3y + r2y, r3z + r2z, r3w + r2w);
    setPlane(out, 5, r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w);
    return out;
}
function setPlane(out, index, x, y, z, w) {
    const len = Math.hypot(x, y, z) || 1;
    const i = index * 4;
    out[i] = x / len;
    out[i + 1] = y / len;
    out[i + 2] = z / len;
    out[i + 3] = w / len;
}
/** true, если AABB хотя бы частично внутри пирамиды видимости. */
export function frustumIntersectsAabb(f, minX, minY, minZ, maxX, maxY, maxZ) {
    for (let i = 0; i < 24; i += 4) {
        const a = f[i];
        const b = f[i + 1];
        const c = f[i + 2];
        const d = f[i + 3];
        const px = a > 0 ? maxX : minX;
        const py = b > 0 ? maxY : minY;
        const pz = c > 0 ? maxZ : minZ;
        if (a * px + b * py + c * pz + d < 0)
            return false;
    }
    return true;
}
export function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export const DEG = Math.PI / 180;
//# sourceMappingURL=math.js.map