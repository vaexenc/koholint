import {WINDFISH_SPRITE} from "@/components/windfishSprite";
import {useEffect, useRef} from "react";

const WAVE_INTENSITY = 0.015;
const WAVE_SPEED = 4.0;

const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
	v_uv = a_pos * 0.5 + 0.5;
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
out vec4 outColor;
void main() {
	vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
	float col = floor(uv.x * 64.0);
	float dy = sin(col * 0.1 + u_time * u_speed) * u_intensity;
	vec2 warped = vec2(uv.x, uv.y + dy);
	if (warped.y < 0.0 || warped.y > 1.0) {
		outColor = vec4(0.0);
		return;
	}
	outColor = texture(u_tex, warped);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("createShader failed");
	gl.shaderSource(shader, src);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`shader compile failed: ${log}`);
	}
	return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
	const program = gl.createProgram();
	if (!program) throw new Error("createProgram failed");
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`program link failed: ${log}`);
	}
	return program;
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`failed to load ${url}`));
		img.src = url;
	});
}

type WindfishLoaderProps = {
	size?: number;
	className?: string;
};

// animated windfish sprite driven by a column-warp shader, usable as a
// loading indicator. the sprite is baked into the bundle so it renders
// without a network request.
export function WindfishLoader({size = 96, className}: WindfishLoaderProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const gl = canvas.getContext("webgl2", {premultipliedAlpha: false, alpha: true});
		if (!gl) throw new Error("webgl2 not supported");
		const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
		const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
		const program = linkProgram(gl, vs, fs);
		const posLoc = gl.getAttribLocation(program, "a_pos");
		const timeLoc = gl.getUniformLocation(program, "u_time");
		const intensityLoc = gl.getUniformLocation(program, "u_intensity");
		const speedLoc = gl.getUniformLocation(program, "u_speed");
		const texLoc = gl.getUniformLocation(program, "u_tex");
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			gl.STATIC_DRAW
		);
		gl.enableVertexAttribArray(posLoc);
		gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			1,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			new Uint8Array([0, 0, 0, 0])
		);
		let cancelled = false;
		let rafId = 0;
		let ready = false;
		loadImage(WINDFISH_SPRITE).then((img) => {
			if (cancelled) return;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
			ready = true;
		});
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		const start = performance.now();
		const tick = () => {
			if (cancelled) return;
			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			if (ready) {
				gl.useProgram(program);
				gl.bindVertexArray(vao);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.uniform1i(texLoc, 0);
				gl.uniform1f(timeLoc, (performance.now() - start) / 1000);
				gl.uniform1f(intensityLoc, WAVE_INTENSITY);
				gl.uniform1f(speedLoc, WAVE_SPEED);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => {
			cancelled = true;
			cancelAnimationFrame(rafId);
			gl.deleteProgram(program);
			gl.deleteShader(vs);
			gl.deleteShader(fs);
			gl.deleteBuffer(buf);
			gl.deleteVertexArray(vao);
			gl.deleteTexture(tex);
		};
	}, []);
	return (
		<canvas
			ref={canvasRef}
			width={size}
			height={size}
			className={className}
			style={{imageRendering: "pixelated"}}
			role="status"
			aria-label="Loading"
		/>
	);
}
