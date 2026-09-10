/**
 * Палитра школы. Все цвета в линейном виде 0..1.
 * Меняешь здесь — меняется вся школа.
 */

import type { Color } from "../core/mesh.js"

export const PALETTE = {
	// Отделка
	wallCream: [0.86, 0.83, 0.75] as Color,
	wallMint: [0.76, 0.83, 0.78] as Color,
	wallBlue: [0.72, 0.79, 0.86] as Color,
	wallSand: [0.85, 0.78, 0.66] as Color,
	wainscot: [0.42, 0.46, 0.5] as Color,
	ceiling: [0.93, 0.93, 0.92] as Color,
	ceilingGrid: [0.82, 0.83, 0.84] as Color,

	// Полы
	floorLino: [0.55, 0.56, 0.58] as Color,
	floorLinoAlt: [0.48, 0.5, 0.53] as Color,
	floorParquet: [0.62, 0.44, 0.28] as Color,
	floorGym: [0.78, 0.58, 0.34] as Color,
	floorTile: [0.78, 0.79, 0.8] as Color,
	floorHall: [0.66, 0.63, 0.6] as Color,
	floorCarpet: [0.35, 0.4, 0.48] as Color,

	// Столярка и мебель
	woodLight: [0.78, 0.62, 0.42] as Color,
	woodMid: [0.6, 0.42, 0.26] as Color,
	woodDark: [0.38, 0.26, 0.17] as Color,
	metal: [0.6, 0.63, 0.66] as Color,
	metalDark: [0.34, 0.36, 0.39] as Color,
	plasticBlue: [0.24, 0.45, 0.72] as Color,
	plasticRed: [0.78, 0.3, 0.26] as Color,
	plasticGreen: [0.3, 0.58, 0.42] as Color,
	plasticYellow: [0.88, 0.72, 0.26] as Color,

	// Детали
	chalkboard: [0.16, 0.29, 0.24] as Color,
	whiteboard: [0.95, 0.96, 0.96] as Color,
	doorLeaf: [0.72, 0.56, 0.38] as Color,
	doorFrame: [0.9, 0.89, 0.86] as Color,
	glass: [0.68, 0.83, 0.9] as Color,
	glassBright: [0.95, 0.97, 1] as Color,
	lockerBlue: [0.22, 0.4, 0.6] as Color,
	lockerTeal: [0.2, 0.48, 0.5] as Color,
	lamp: [1, 0.98, 0.92] as Color,
	paper: [0.96, 0.95, 0.92] as Color,
	plantPot: [0.55, 0.33, 0.24] as Color,
	plantLeaf: [0.28, 0.5, 0.3] as Color,
	black: [0.1, 0.1, 0.11] as Color,
	red: [0.72, 0.24, 0.22] as Color,
	skyThroughWindow: [0.72, 0.85, 0.98] as Color,
} as const

/** Цвета корешков книг в библиотеке. */
export const BOOK_COLORS: readonly Color[] = [
	[0.66, 0.24, 0.22],
	[0.24, 0.36, 0.58],
	[0.28, 0.46, 0.32],
	[0.72, 0.58, 0.24],
	[0.46, 0.28, 0.48],
	[0.2, 0.44, 0.5],
	[0.76, 0.44, 0.24],
	[0.36, 0.38, 0.42],
]
