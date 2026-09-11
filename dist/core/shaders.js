/**
 * Шейдеры (GLSL ES 3.00).
 *
 * Освещение дешёвое: свет от ламп и окон запечён в цвет вершины на этапе
 * сборки уровня. В рантайме остаются:
 *  — полусферический ambient и одно направленное «солнце»;
 *  — uLightMul: общий множитель яркости — когда гаснет свет, школа темнеет;
 *  — конус фонарика (один spot-свет, считается в три строки);
 *  — туман для глубины коридоров.
 * Поверхности с emissive (лампы, глаза учительницы, метки предметов)
 * не гаснут никогда.
 */
export const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aEmissive;

uniform mat4 uViewProjection;
uniform vec3 uEye;

out vec3 vColor;
out vec3 vNormal;
out vec3 vWorld;
out float vEmissive;
out float vDistance;

void main() {
	vColor = aColor;
	vNormal = aNormal;
	vWorld = aPosition;
	vEmissive = aEmissive;
	vDistance = length(aPosition - uEye);
	gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vColor;
in vec3 vNormal;
in vec3 vWorld;
in float vEmissive;
in float vDistance;

uniform vec3 uSunDirection;
uniform vec3 uFogColor;
uniform float uFogDensity;
/** Общая яркость сцены: 1 — день, ~0.12 — ночь. */
uniform float uLightMul;
/** Фонарь: позиция, направление и параметры конуса. */
uniform vec3 uFlashOrigin;
uniform vec3 uFlashDirection;
/** x = cos внешнего угла, y = cos внутреннего, z = дальность, w = сила. */
uniform vec4 uFlashCone;
/** Фонари чужих игроков в онлайне: до трёх ближайших. */
uniform int uExtraCount;
uniform vec3 uExtraOrigin[3];
uniform vec3 uExtraDirection[3];
uniform vec4 uExtraCone[3];

out vec4 fragColor;

/** Один spot-свет: та же формула, что и для своего фонаря. */
vec3 spotLight(vec3 baseColor, vec3 n, vec3 origin, vec3 dir, vec4 cone) {
	vec3 toFragment = vWorld - origin;
	float dist = length(toFragment);
	vec3 direction = toFragment / max(dist, 0.0001);
	float shape = smoothstep(cone.x, cone.y, dot(direction, dir));
	float reach = clamp(1.0 - dist / max(cone.z, 0.001), 0.0, 1.0);
	float lambert = max(dot(n, -direction), 0.12);
	return baseColor * shape * reach * reach * lambert * cone.w;
}

void main() {
	vec3 n = normalize(vNormal);
	float sky = 0.5 + 0.5 * n.y;
	float sun = max(dot(n, uSunDirection), 0.0);
	float shading = 0.58 + 0.26 * sky + 0.18 * sun;

	vec3 lit = mix(vColor * shading, vColor, vEmissive);
	lit *= mix(uLightMul, 1.0, vEmissive);

	if (uFlashCone.w > 0.001) {
		lit += spotLight(vColor, n, uFlashOrigin, uFlashDirection, uFlashCone);
	}

	// Фонари товарищей по комнате — видно, куда они светят.
	for (int i = 0; i < 3; i++) {
		if (i >= uExtraCount) break;
		lit += spotLight(vColor, n, uExtraOrigin[i], uExtraDirection[i], uExtraCone[i]);
	}

	float fogAmount = 1.0 - exp(-pow(vDistance * uFogDensity, 2.0));
	fogAmount *= mix(0.82, 0.25, vEmissive);
	vec3 color = mix(lit, uFogColor, clamp(fogAmount, 0.0, 1.0));

	// лёгкая гамма-коррекция, чтобы тени не были «грязными»
	fragColor = vec4(pow(clamp(color, 0.0, 1.0), vec3(0.92)), 1.0);
}
`;
//# sourceMappingURL=shaders.js.map