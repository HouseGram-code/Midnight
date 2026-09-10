/** Маленькие хелперы для DOM без внешних библиотек. */
export function requireElement(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error(`Не найден элемент #${id}`);
    return element;
}
export function requireCanvas(id) {
    const element = requireElement(id);
    if (!(element instanceof HTMLCanvasElement)) {
        throw new Error(`Элемент #${id} не canvas`);
    }
    return element;
}
/** Меняет текст только при реальном изменении — меньше перерисовок. */
export function setText(element, text) {
    if (element.textContent !== text)
        element.textContent = text;
}
export function setHidden(element, hidden) {
    if (element.hidden !== hidden)
        element.hidden = hidden;
}
//# sourceMappingURL=dom.js.map