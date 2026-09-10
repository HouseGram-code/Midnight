/**
 * Игрок: цилиндр с камерой на уровне глаз.
 *
 * Движение решается поосево (сначала X, потом Z, потом Y) — это даёт
 * скольжение вдоль стен вместо застревания в углах и позволяет автоматически
 * зашагивать на ступеньки до stepHeight.
 */
import { CONFIG } from "../config.js";
import { clamp } from "../core/math.js";
export class PlayerController {
    collision;
    /** Позиция СТОП, не глаз. */
    x = 0;
    y = 0;
    z = 0;
    yaw = 0;
    pitch = 0;
    velocityX = 0;
    velocityY = 0;
    velocityZ = 0;
    onGround = true;
    crouching = false;
    sprinting = false;
    height = CONFIG.player.height;
    bobPhase = 0;
    bobOffset = 0;
    constructor(collision, spawn) {
        this.collision = collision;
        this.teleport(spawn);
    }
    teleport(spawn) {
        this.x = spawn.x;
        this.z = spawn.z;
        this.y = 0;
        this.yaw = spawn.yaw;
        this.pitch = 0;
        this.velocityX = 0;
        this.velocityY = 0;
        this.velocityZ = 0;
        this.crouching = false;
        this.onGround = true;
        this.bobOffset = 0;
    }
    get eyeY() {
        const base = this.crouching ? CONFIG.player.crouchEyeHeight : CONFIG.player.eyeHeight;
        return this.y + base + this.bobOffset;
    }
    get speed() {
        return Math.hypot(this.velocityX, this.velocityZ);
    }
    /** Поворот камеры. dx/dy уже умножены на чувствительность. */
    applyLook(dx, dy) {
        this.yaw -= dx;
        if (this.yaw > Math.PI)
            this.yaw -= Math.PI * 2;
        if (this.yaw < -Math.PI)
            this.yaw += Math.PI * 2;
        this.pitch = clamp(this.pitch - dy, -CONFIG.camera.maxPitch, CONFIG.camera.maxPitch);
    }
    update(dt, input) {
        const player = CONFIG.player;
        // Приседание: встаём только если сверху есть место.
        const wantsCrouch = input.isDown("crouch");
        if (this.crouching && !wantsCrouch) {
            if (!this.collision.overlaps(this.x, this.y, this.z, player.radius, player.height)) {
                this.crouching = false;
            }
        }
        else {
            this.crouching = wantsCrouch;
        }
        this.height = this.crouching ? player.crouchHeight : player.height;
        this.sprinting = input.isDown("sprint") && !this.crouching && this.onGround;
        const targetSpeed = this.crouching
            ? player.crouchSpeed
            : this.sprinting
                ? player.sprintSpeed
                : player.walkSpeed;
        const forward = input.moveForward;
        const strafe = input.moveRight;
        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        // Взгляд вперёд = (-sin, -cos), вправо = (cos, -sin) — как в viewFromYawPitch.
        let wishX = -sinYaw * forward + cosYaw * strafe;
        let wishZ = -cosYaw * forward - sinYaw * strafe;
        const wishLength = Math.hypot(wishX, wishZ);
        if (wishLength > 1e-4) {
            wishX = (wishX / wishLength) * targetSpeed;
            wishZ = (wishZ / wishLength) * targetSpeed;
        }
        else {
            wishX = 0;
            wishZ = 0;
        }
        const accel = (this.onGround ? player.groundAccel : player.airAccel) * dt;
        const blend = accel < 1 ? accel : 1;
        this.velocityX += (wishX - this.velocityX) * blend;
        this.velocityZ += (wishZ - this.velocityZ) * blend;
        if (this.onGround && input.isDown("jump") && !this.crouching) {
            this.velocityY = player.jumpSpeed;
            this.onGround = false;
        }
        this.velocityY -= player.gravity * dt;
        if (this.velocityY < -55)
            this.velocityY = -55;
        this.moveHorizontal(this.velocityX * dt, 0);
        this.moveHorizontal(0, this.velocityZ * dt);
        this.moveVertical(this.velocityY * dt);
        this.updateHeadBob(dt);
    }
    moveHorizontal(dx, dz) {
        if (dx === 0 && dz === 0)
            return;
        const radius = CONFIG.player.radius;
        const nextX = this.x + dx;
        const nextZ = this.z + dz;
        if (!this.collision.overlaps(nextX, this.y, nextZ, radius, this.height)) {
            this.x = nextX;
            this.z = nextZ;
            return;
        }
        // Страховка: если игрок уже внутри геометрии, разрешаем шаг наружу,
        // иначе любое направление будет занято и он останется замурованным.
        if (this.collision.overlaps(this.x, this.y, this.z, radius, this.height)) {
            this.x = nextX;
            this.z = nextZ;
            return;
        }
        // Пробуем зашагнуть на ступеньку.
        if (this.onGround) {
            const stepY = this.collision.groundHeight(nextX, nextZ, this.y, radius, CONFIG.player.stepHeight);
            if (stepY > this.y + 0.015 &&
                !this.collision.overlaps(nextX, stepY, nextZ, radius, this.height)) {
                this.x = nextX;
                this.z = nextZ;
                this.y = stepY;
                return;
            }
        }
        if (dx !== 0)
            this.velocityX = 0;
        if (dz !== 0)
            this.velocityZ = 0;
    }
    moveVertical(dy) {
        const radius = CONFIG.player.radius;
        if (dy > 0) {
            const nextY = this.y + dy;
            if (this.collision.overlaps(this.x, nextY, this.z, radius, this.height)) {
                this.velocityY = 0;
            }
            else {
                this.y = nextY;
                this.onGround = false;
            }
            return;
        }
        const support = this.collision.groundHeight(this.x, this.z, this.y + 0.05, radius, 0);
        const target = this.y + dy;
        if (target <= support) {
            this.y = support;
            this.velocityY = 0;
            this.onGround = true;
        }
        else {
            this.y = target;
            this.onGround = false;
        }
    }
    updateHeadBob(dt) {
        const player = CONFIG.player;
        const speed = this.speed;
        if (this.onGround && speed > 0.35) {
            const ratio = Math.min(1.4, speed / player.walkSpeed);
            this.bobPhase += dt * player.headBobSpeed * ratio;
            if (this.bobPhase > Math.PI * 2)
                this.bobPhase -= Math.PI * 2;
            const target = Math.sin(this.bobPhase) * player.headBobAmount * ratio;
            this.bobOffset += (target - this.bobOffset) * Math.min(1, dt * 22);
        }
        else {
            this.bobOffset += (0 - this.bobOffset) * Math.min(1, dt * 10);
        }
    }
}
//# sourceMappingURL=controller.js.map