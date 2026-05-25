import type {HexColor, SpritePalette, SpriteSheetColorMap} from "@/types";

const PALETTE_KEYS = ["primary", "skin"] as const;
const MAX_MAP_ENTRIES = 16;

function hexToRgb(hex: HexColor): [number, number, number] {
	const v = hex.slice(1);
	return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function buildColorMap(source: SpritePalette, target: SpritePalette): SpriteSheetColorMap {
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

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
	const sh = gl.createShader(type);
	if (!sh) throw new Error("createShader failed");
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh);
		gl.deleteShader(sh);
		throw new Error(`shader compile failed: ${log}`);
	}
	return sh;
}

function initGl(): GlState | null {
	if (state !== undefined) return state;
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl2", {premultipliedAlpha: false, antialias: false});
	if (!gl) return (state = null);
	const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
	const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
	const program = gl.createProgram();
	if (!program) return (state = null);
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return (state = null);
	const vao = gl.createVertexArray();
	const buf = gl.createBuffer();
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
		gl.STATIC_DRAW
	);
	const aPos = gl.getAttribLocation(program, "aPos");
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
	const texture = gl.createTexture();
	if (!texture) return (state = null);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	const get = (name: string): WebGLUniformLocation => {
		const loc = gl.getUniformLocation(program, name);
		if (!loc) throw new Error(`missing uniform ${name}`);
		return loc;
	};
	state = {
		gl,
		canvas,
		program,
		texture,
		locTex: get("uTex"),
		locCount: get("uCount"),
		locFrom: get("uFrom"),
		locTo: get("uTo"),
	};
	return state;
}

// recolors `image` by mapping source -> target colors via a fragment shader.
// returns a fresh 2d canvas snapshot so callers can hold it independently of
// the shared webgl backbuffer. falls back to the original image on a 2d canvas
// when webgl2 is unavailable.
export function recolorImage(image: HTMLImageElement, map: SpriteSheetColorMap): HTMLCanvasElement {
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
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	out2d.drawImage(canvas, 0, 0);
	return out;
}
