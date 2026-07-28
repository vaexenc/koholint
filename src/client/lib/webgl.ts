// the webgl2 setup both of the app's shader effects need — the palette swap and
// the loader's wave warp. both draw one fullscreen quad through one texture, so
// the program build, the quad, the sampler state and the uniform lookups are the
// same every time; only the shaders differ. everything here throws on failure,
// which is the only honest answer for a gl object that couldn't be created —
// callers decide whether that means "fall back" or "give up".

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("gl: createShader failed");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`gl: shader compile failed: ${log}`);
	}
	return shader;
}

// compiles both stages, links them, and drops the shaders — a linked program
// keeps its own copy — so callers only ever hold a program to delete.
export function createProgram(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSource: string
): WebGLProgram {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
		throw new Error("gl: createProgram failed");
	}
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`gl: program link failed: ${log}`);
	}
	return program;
}

export type FullscreenQuad = {
	readonly vao: WebGLVertexArrayObject;
	readonly buffer: WebGLBuffer;
};

// the two triangles every fullscreen pass draws, bound to `attribute` and left
// bound on return. draw it with `gl.drawArrays(gl.TRIANGLES, 0, QUAD_VERTICES)`.
export const QUAD_VERTICES = 6;

export function createFullscreenQuad(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	attribute: string
): FullscreenQuad {
	const vao = gl.createVertexArray();
	const buffer = gl.createBuffer();
	if (!vao || !buffer) throw new Error("gl: quad allocation failed");
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
		gl.STATIC_DRAW
	);
	const location = gl.getAttribLocation(program, attribute);
	if (location < 0) throw new Error(`gl: missing attribute ${attribute}`);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
	return {vao, buffer};
}

// a texture sampled the way pixel art has to be: nearest, clamped, no wrap
// bleed. left bound on return.
export function createNearestTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) throw new Error("gl: createTexture failed");
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return texture;
}

// a uniform the shader is known to declare. a miss means the name is misspelled
// or the uniform was optimized out, which is a bug in the pair — not a state to
// render around.
export function uniformLocation(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string
): WebGLUniformLocation {
	const location = gl.getUniformLocation(program, name);
	if (!location) throw new Error(`gl: missing uniform ${name}`);
	return location;
}
