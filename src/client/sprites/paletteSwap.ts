import {
	createFullscreenQuad,
	createNearestTexture,
	createProgram,
	QUAD_VERTICES,
	uniformLocation,
} from "@/client/lib/webgl";
import {hexToRgb} from "@/shared/sprites/hexColor";
import type {SpritePalette, SpriteSheetColorMap} from "@/shared/sprites/types";

const PALETTE_KEYS = ["primary", "skin"] as const;
const MAX_MAP_ENTRIES = 16;

function buildColorMap(source: SpritePalette, target: SpritePalette): SpriteSheetColorMap {
	const map: SpriteSheetColorMap = new Map();
	for (const key of PALETTE_KEYS) {
		const src = source[key];
		const dst = target[key];
		if (!src || !dst) continue;
		const n = Math.min(src.length, dst.length);
		for (let i = 0; i < n; i++) map.set(src[i], dst[i]);
	}
	return map;
}

const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
	vUv = aPos * 0.5 + 0.5;
	gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform int uCount;
uniform vec3 uFrom[${MAX_MAP_ENTRIES}];
uniform vec3 uTo[${MAX_MAP_ENTRIES}];
in vec2 vUv;
out vec4 outColor;
void main() {
	vec4 c = texture(uTex, vUv);
	if (c.a == 0.0) { outColor = c; return; }
	vec3 src = floor(c.rgb * 255.0 + 0.5);
	for (int i = 0; i < ${MAX_MAP_ENTRIES}; i++) {
		if (i >= uCount) break;
		vec3 from = floor(uFrom[i] * 255.0 + 0.5);
		if (all(equal(src, from))) {
			outColor = vec4(uTo[i], c.a);
			return;
		}
	}
	outColor = c;
}`;

type GlState = {
	gl: WebGL2RenderingContext;
	canvas: HTMLCanvasElement;
	program: WebGLProgram;
	texture: WebGLTexture;
	locTex: WebGLUniformLocation;
	locCount: WebGLUniformLocation;
	locFrom: WebGLUniformLocation;
	locTo: WebGLUniformLocation;
};

let state: GlState | null | undefined;

// built once and kept for the page's lifetime. any failure along the way is
// remembered as `null`, which sends every later recolor down the plain-2d
// fallback in recolorImage rather than retrying a context that won't work.
function initGl(): GlState | null {
	if (state !== undefined) return state;
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl2", {premultipliedAlpha: false, antialias: false});
	if (!gl) return (state = null);
	try {
		const program = createProgram(gl, VERT_SRC, FRAG_SRC);
		createFullscreenQuad(gl, program, "aPos");
		state = {
			gl,
			canvas,
			program,
			texture: createNearestTexture(gl),
			locTex: uniformLocation(gl, program, "uTex"),
			locCount: uniformLocation(gl, program, "uCount"),
			locFrom: uniformLocation(gl, program, "uFrom"),
			locTo: uniformLocation(gl, program, "uTo"),
		};
	} catch {
		return (state = null);
	}
	return state;
}

// recolors `image` by mapping source -> target colors via a fragment shader.
// returns a fresh 2d canvas snapshot so callers can hold it independently of
// the shared webgl backbuffer. falls back to the original image on a 2d canvas
// when webgl2 is unavailable.
function recolorImage(image: HTMLImageElement, map: SpriteSheetColorMap): HTMLCanvasElement {
	const w = image.naturalWidth;
	const h = image.naturalHeight;
	const out = document.createElement("canvas");
	out.width = w;
	out.height = h;
	const out2d = out.getContext("2d");
	if (!out2d) return out;
	const gls = initGl();
	if (!gls) {
		out2d.drawImage(image, 0, 0);
		return out;
	}
	const {gl, canvas, program, texture, locTex, locCount, locFrom, locTo} = gls;
	canvas.width = w;
	canvas.height = h;
	gl.viewport(0, 0, w, h);
	gl.useProgram(program);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
	const entries = [...map].slice(0, MAX_MAP_ENTRIES);
	const fromArr = new Float32Array(MAX_MAP_ENTRIES * 3);
	const toArr = new Float32Array(MAX_MAP_ENTRIES * 3);
	for (let i = 0; i < entries.length; i++) {
		const [f, t] = entries[i];
		const fr = hexToRgb(f);
		const tr = hexToRgb(t);
		fromArr.set([fr[0] / 255, fr[1] / 255, fr[2] / 255], i * 3);
		toArr.set([tr[0] / 255, tr[1] / 255, tr[2] / 255], i * 3);
	}
	gl.uniform1i(locTex, 0);
	gl.uniform1i(locCount, entries.length);
	gl.uniform3fv(locFrom, fromArr);
	gl.uniform3fv(locTo, toArr);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	gl.drawArrays(gl.TRIANGLES, 0, QUAD_VERTICES);
	out2d.drawImage(canvas, 0, 0);
	return out;
}

// caches recolored sprites by (image, target palette) so repeated pairs — e.g.
// the same avatar shown across many chat rows — share one GPU recolor instead
// of each caller allocating its own canvas. keyed on object identity: `image`
// is shared from the image cache and `target` is a stable palette object, so
// equal appearances collide. a cached null records "no recolor needed" so that
// case is memoized too. source palette is fixed per image, so it need not key.
const recolorCache = new WeakMap<
	HTMLImageElement,
	WeakMap<SpritePalette, HTMLCanvasElement | null>
>();

export function recolorImageCached(
	image: HTMLImageElement,
	source: SpritePalette,
	target: SpritePalette
): HTMLCanvasElement | null {
	let byTarget = recolorCache.get(image);
	if (!byTarget) {
		byTarget = new WeakMap();
		recolorCache.set(image, byTarget);
	}
	const cached = byTarget.get(target);
	if (cached !== undefined) return cached;
	const colorMap = buildColorMap(source, target);
	const result = colorMap.size > 0 ? recolorImage(image, colorMap) : null;
	byTarget.set(target, result);
	return result;
}
