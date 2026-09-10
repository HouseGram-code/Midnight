/**
 * HUD: название помещения, координаты и техническая статистика.
 *
 * DOM обновляется не чаще 8 раз в секунду: каждый кадр трогать textContent
 * — лишняя нагрузка на главный поток.
 */
import { findRoomAt } from "../world/layout.js";
import { requireElement, setHidden, setText } from "./dom.js";
export class Hud {
    root = requireElement("hud");
    roomEl = requireElement("hud-room");
    positionEl = requireElement("hud-position");
    modeEl = requireElement("hud-mode");
    statsEl = requireElement("stats");
    helpEl = requireElement("help");
    fpsEl = requireElement("stat-fps");
    frameEl = requireElement("stat-frame");
    drawsEl = requireElement("stat-draws");
    trisEl = requireElement("stat-tris");
    scaleEl = requireElement("stat-scale");
    nextUpdate = 0;
    setVisible(visible) {
        setHidden(this.root, !visible);
    }
    toggleStats() {
        setHidden(this.statsEl, !this.statsEl.hidden);
    }
    toggleHelp() {
        setHidden(this.helpEl, !this.helpEl.hidden);
    }
    update(state, now) {
        if (now < this.nextUpdate)
            return;
        this.nextUpdate = now + 125;
        const room = findRoomAt(state.x, state.z);
        setText(this.roomEl, room ? room.name : "Улица");
        setText(this.positionEl, `X ${state.x.toFixed(1)} · Y ${state.y.toFixed(1)} · Z ${state.z.toFixed(1)}`);
        setText(this.modeEl, state.crouching ? "присед" : state.sprinting ? "бег" : "шаг");
        if (this.statsEl.hidden)
            return;
        setText(this.fpsEl, `${Math.round(state.fps)}`);
        setText(this.frameEl, `${state.frameMs.toFixed(1)} мс`);
        setText(this.drawsEl, `${state.drawCalls} / ${state.totalChunks}`);
        setText(this.trisEl, `${formatCount(state.triangles)} / ${formatCount(state.totalTriangles)}`);
        setText(this.scaleEl, `${Math.round(state.resolutionScale * 100)}%`);
    }
}
function formatCount(value) {
    if (value >= 1000)
        return `${(value / 1000).toFixed(1)}k`;
    return `${value}`;
}
//# sourceMappingURL=hud.js.map