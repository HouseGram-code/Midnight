/**
 * Все числа, которые хочется крутить, собраны в одном месте.
 * Меняешь здесь — меняется во всей игре.
 */

export const CONFIG = {
	player: {
		radius: 0.34,
		height: 1.78,
		eyeHeight: 1.66,
		crouchHeight: 1.2,
		crouchEyeHeight: 1.05,
		walkSpeed: 3.4,
		sprintSpeed: 6.0,
		crouchSpeed: 1.6,
		groundAccel: 16,
		airAccel: 3,
		gravity: 22,
		jumpSpeed: 6.3,
		stepHeight: 0.42,
		headBobAmount: 0.022,
		headBobSpeed: 10.5,
	},
	camera: {
		fov: 74,
		near: 0.06,
		far: 300,
		sensitivity: 0.0021,
		maxPitch: 1.52,
	},
	render: {
		antialias: true,
		maxPixelRatio: 2,
		adaptiveResolution: true,
		minScale: 0.62,
		maxScale: 1,
		clearColor: [0.71, 0.76, 0.83],
	},
	light: {
		ambient: [0.33, 0.345, 0.38],
		sunDir: [0.36, 0.84, 0.41],
		fogColor: [0.71, 0.76, 0.83],
		fogDensity: 0.0072,
		maxBaked: 1.55,
	},
	physics: {
		fixedStep: 1 / 120,
		maxStepsPerFrame: 6,
		maxFrameDelta: 0.1,
	},
	/** Хоррор-режим: ночь, фонарь, жизни, взаимодействие. */
	horror: {
		/** Сколько жизней даётся на забег. */
		lives: 5,
		/** Множитель яркости днём и ночью. */
		dayLight: 1,
		nightLight: 0.115,
		/** Цвет тумана/фона днём и ночью. */
		dayFog: [0.71, 0.76, 0.83],
		nightFog: [0.035, 0.04, 0.055],
		/** Ночной туман гуще — коридор уходит в темноту. */
		nightFogDensity: 0.02,
		/** Фонарь: углы конуса (радианы), дальность и сила. */
		flashInner: 0.16,
		flashOuter: 0.42,
		flashRange: 19,
		flashPower: 1.5,
		/** Сколько держать E, чтобы взять предмет или снять доску. */
		holdSeconds: 2.5,
		/** Дистанция взаимодействия. */
		reach: 2.6,
		/** Неуязвимость после пробуждения, секунды. */
		respawnGrace: 3.5,
	},
	audio: {
		/** Громкость по умолчанию (меняется в настройках). */
		master: 0.8,
		ambience: 0.5,
		steps: 0.42,
		/** Скорость воспроизведения цикла шагов. */
		stepsWalkRate: 1,
		stepsSprintRate: 1.45,
		stepsCrouchRate: 0.65,
	},
} as const

export type Config = typeof CONFIG
