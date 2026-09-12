/**
 * АКТ II — «Вернуться. Взрыв».
 *
 * Всё, что отличает второй акт от первого: точки предметов на втором этаже,
 * щит управления взрывчаткой, таймер на пять минут, капча и тексты миссий.
 *
 * Учительницы в акте II в школе нет — опасность одна: время.
 */

import { FLOOR2_Y } from "../world/floor2.js"
import type { Difficulty } from "./difficulty.js"
import type { ItemDef } from "./items.js"

/** Сколько секунд даёт учительница после того, как заперла школу. */
export const ACT2_TIMER = 300
/** Сколько идёт анимация взлома после капчи. */
export const ACT2_HACK_SECONDS = 60

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
} as const

/** Где ждёт второй выход — служебная дверь в хозяйственной. */
export const ACT2_EXIT = {
	x: 69,
	y: 1.4,
	z: 1.2,
	standZ: 2.4,
	name: "Хозяйственная · служебный выход",
} as const

/** Оружие — спрятано в архиве за стеллажами. Искать тяжело — так и задумано. */
export const ACT2_WEAPON: ItemDef = {
	id: "weapon",
	label: "Обрез",
	hint: "Второй этаж — где-то среди старых папок",
	use: "единственная защита",
	x: 19.15,
	y: FLOOR2_Y + 0.42,
	z: 0.95,
}

/** Ноутбук — в учительской, на дальнем столе. */
export const ACT2_LAPTOP: ItemDef = {
	id: "laptop",
	label: "Ноутбук",
	hint: "Учительская — рабочий стол у окна",
	use: "взлом системы",
	x: 53.25,
	y: FLOOR2_Y + 0.92,
	z: 9.85,
}

/** Ключ от служебного выхода — в сейфе директора, сейф откроется после взлома. */
export const ACT2_KEY: ItemDef = {
	id: "key",
	label: "Ключ завхоза",
	hint: "Кабинет директора — сейф у стены",
	use: "служебный выход",
	x: 64.05,
	y: FLOOR2_Y + 0.68,
	z: 1.25,
}

export const ACT2_ITEMS: readonly ItemDef[] = [ACT2_WEAPON, ACT2_LAPTOP, ACT2_KEY]

/**
 * Шаги миссии. Идут строго по порядку и одинаково в одиночной игре и онлайне.
 * Номера ездят по сети, поэтому менять только в конец.
 */
export type Act2Stage =
	| "weapon"
	| "laptop"
	| "panel"
	| "captcha"
	| "hack"
	| "key"
	| "escape"
	| "done"

export const ACT2_STAGES: readonly Act2Stage[] = [
	"weapon",
	"laptop",
	"panel",
	"captcha",
	"hack",
	"key",
	"escape",
	"done",
]

export function stageCode(stage: Act2Stage): number {
	const index = ACT2_STAGES.indexOf(stage)
	return index < 0 ? 0 : index
}

export function stageFromCode(code: number): Act2Stage {
	return ACT2_STAGES[Math.round(code)] ?? "weapon"
}

/** Текст задачи в HUD. */
export function objectiveFor(stage: Act2Stage, hasLaptop: boolean): string {
	switch (stage) {
		case "weapon":
			return "Найдите оружие на втором этаже"
		case "laptop":
			return "Найдите ноутбук — без него систему не взломать"
		case "panel":
			return hasLaptop
				? "Поставьте ноутбук на щит в серверной"
				: "Возьмите ноутбук и идите в серверную"
		case "captcha":
			return "Пройдите проверку системы на ноутбуке"
		case "hack":
			return "Идёт взлом — дождитесь окончания"
		case "key":
			return "Найдите ключ в кабинете директора"
		case "escape":
			return "Служебный выход в хозяйственной — уходите!"
		default:
			return "Школа осталась позади"
	}
}

/** Предупреждения по таймеру: секунды → текст. */
export const ACT2_WARNINGS: ReadonlyArray<{ at: number; text: string }> = [
	{ at: 270, text: "Четыре с половиной минуты. Сначала ноутбук — без него никак." },
	{ at: 240, text: "Четыре минуты до взрыва." },
	{ at: 180, text: "Три минуты. Взлом идёт целую минуту — не тяните." },
	{ at: 120, text: "Две минуты. Слышно, как тикает в стенах." },
	{ at: 60, text: "Минута! Бегите!" },
	{ at: 30, text: "Тридцать секунд…" },
	{ at: 10, text: "Десять…" },
]

/** Одно задание капчи. */
export interface CaptchaTask {
	question: string
	answer: string
	/** Варианты ответа — всегда четыре. */
	options: string[]
	hint: string
}

function shuffle<T>(list: T[]): T[] {
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		const tmp = list[i]
		list[i] = list[j]
		list[j] = tmp
	}
	return list
}

function randomInt(min: number, max: number): number {
	return min + Math.floor(Math.random() * (max - min + 1))
}

/** Задача «продолжи последовательность». */
function sequenceTask(): CaptchaTask {
	const start = randomInt(2, 9)
	const step = randomInt(3, 9)
	const values = [start, start + step, start + step * 2, start + step * 3]
	const answer = String(start + step * 4)
	const wrong = new Set<string>()
	while (wrong.size < 3) {
		const delta = randomInt(-step * 2, step * 2)
		const value = start + step * 4 + (delta === 0 ? step : delta)
		if (String(value) !== answer) wrong.add(String(value))
	}
	return {
		question: `${values.join(", ")}, ?`,
		answer,
		options: shuffle([answer, ...wrong]),
		hint: "Продолжите ряд",
	}
}

/** Задача «посчитать код канала». */
function mathTask(): CaptchaTask {
	const a = randomInt(12, 39)
	const b = randomInt(3, 12)
	const c = randomInt(2, 9)
	const value = a * b - c
	const answer = String(value)
	const wrong = new Set<string>()
	while (wrong.size < 3) {
		const noise = randomInt(-14, 14)
		if (noise === 0) continue
		wrong.add(String(value + noise))
	}
	return {
		question: `${a} × ${b} − ${c} = ?`,
		answer,
		options: shuffle([answer, ...wrong]),
		hint: "Код канала детонатора",
	}
}

/** Простое сложение для лёгкого режима: ответ можно посчитать без калькулятора. */
function easyMathTask(): CaptchaTask {
	const a = randomInt(2, 9)
	const b = randomInt(2, 9)
	const value = a + b
	const answer = String(value)
	const wrong = new Set<string>()
	for (const delta of [-2, -1, 1, 2]) {
		if (value + delta > 0) wrong.add(String(value + delta))
		if (wrong.size === 3) break
	}
	return {
		question: `${a} + ${b} = ?`,
		answer,
		options: shuffle([answer, ...wrong]),
		hint: "Лёгкая проверка",
	}
}

/** Короткий очевидный ряд для лёгкого режима. */
function easySequenceTask(): CaptchaTask {
	const start = randomInt(1, 5)
	const step = randomInt(2, 4)
	const answer = String(start + step * 3)
	return {
		question: `${start}, ${start + step}, ${start + step * 2}, ?`,
		answer,
		options: shuffle([
			answer,
			String(start + step * 3 - 1),
			String(start + step * 3 + 1),
			String(start + step * 4),
		]),
		hint: `Прибавляйте ${step}`,
	}
}

/** Задача «собери контрольную сумму»: сумма цифр серийника. */
function checksumTask(): CaptchaTask {
	const serial = String(randomInt(100000, 999999))
	let sum = 0
	for (const digit of serial) sum += Number(digit)
	const answer = String(sum)
	const wrong = new Set<string>()
	while (wrong.size < 3) {
		const noise = randomInt(-9, 9)
		if (noise === 0) continue
		wrong.add(String(sum + noise))
	}
	return {
		question: `Серийный номер ${serial} — сумма цифр?`,
		answer,
		options: shuffle([answer, ...wrong]),
		hint: "Контрольная сумма",
	}
}

/** Задача «какой провод резать»: логика по правилам. */
function wireTask(): CaptchaTask {
	const colors = ["красный", "синий", "жёлтый", "зелёный"]
	const count = randomInt(2, 5)
	const even = count % 2 === 0
	const answer = even ? "синий" : "жёлтый"
	return {
		question:
			`На схеме ${count} детонаторов. Правило: чётное число — синий канал, ` +
			"нечётное — жёлтый. Какой канал глушим?",
		answer,
		options: shuffle(colors.slice()),
		hint: "Выбор канала",
	}
}

/** Набор заданий капчи зависит от выбранной сложности игры. */
export function makeCaptcha(difficulty: Difficulty = "normal"): CaptchaTask[] {
	if (difficulty === "ghost" || difficulty === "easy") {
		return [shuffle([easyMathTask, easySequenceTask])[0]()]
	}
	const builders = shuffle([sequenceTask, mathTask, checksumTask, wireTask])
	const count = difficulty === "hard" ? 4 : 3
	return builders.slice(0, count).map((build) => build())
}

/** ММ:СС для таймера. */
export function formatTimer(seconds: number): string {
	const total = Math.max(0, Math.ceil(seconds))
	const minutes = Math.floor(total / 60)
	const rest = total % 60
	return `${minutes}:${String(rest).padStart(2, "0")}`
}
