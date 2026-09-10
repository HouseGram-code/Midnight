/** Маленькие хелперы для DOM без внешних библиотек. */

export function requireElement(id: string): HTMLElement {
	const element = document.getElementById(id)
	if (!element) throw new Error(`Не найден элемент #${id}`)
	return element
}

export function requireCanvas(id: string): HTMLCanvasElement {
	const element = requireElement(id)
	if (!(element instanceof HTMLCanvasElement)) {
		throw new Error(`Элемент #${id} не canvas`)
	}
	return element
}

/** Меняет текст только при реальном изменении — меньше перерисовок. */
export function setText(element: HTMLElement, text: string): void {
	if (element.textContent !== text) element.textContent = text
}

export function setHidden(element: HTMLElement, hidden: boolean): void {
	if (element.hidden !== hidden) element.hidden = hidden
}
