import {WINDFISH_SPRITE} from "@/client/components/loading/windfishSprite";
import {loadImage} from "@/client/lib/imageCache";
import {
	createFullscreenQuad,
	createNearestTexture,
	createProgram,
	QUAD_VERTICES,
	uniformLocation,
	type FullscreenQuad,
} from "@/client/lib/webgl";
import {useEffect, useRef, useState} from "react";

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

type WindfishLoaderProps = {
	size?: number;
	className?: string;
};

// animated windfish sprite driven by a column-warp shader, usable as a
// loading indicator. the sprite is baked into the bundle so it renders
// without a network request. this is the app's cold-start screen, so a browser
// that can't run the shader falls back to the plain sprite rather than failing:
// there is no error boundary above here, and a thrown effect would take the
// whole tree down over an animation.
export function WindfishLoader({size = 96, className}: WindfishLoaderProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [warped, setWarped] = useState(true);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const stop = startWave(canvas);
		if (stop) return stop;
		setWarped(false);
	}, []);

	if (!warped)
		return (
			<img
				src={WINDFISH_SPRITE}
				width={size}
				height={size}
				className={className}
				style={{imageRendering: "pixelated"}}
				alt="Loading"
			/>
		);
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

type WavePipeline = {
	readonly program: WebGLProgram;
	readonly quad: FullscreenQuad;
	readonly texture: WebGLTexture;
	readonly time: WebGLUniformLocation;
	readonly intensity: WebGLUniformLocation;
	readonly speed: WebGLUniformLocation;
	readonly sampler: WebGLUniformLocation;
};

// the gl objects one wave pass needs, or null if any of them wouldn't build.
// everything in lib/webgl throws on failure, which is the honest answer there;
// deciding that a failure only costs the animation is this caller's call.
function buildPipeline(gl: WebGL2RenderingContext): WavePipeline | null {
	try {
		const program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
		return {
			program,
			quad: createFullscreenQuad(gl, program, "a_pos"),
			texture: createNearestTexture(gl),
			time: uniformLocation(gl, program, "u_time"),
			intensity: uniformLocation(gl, program, "u_intensity"),
			speed: uniformLocation(gl, program, "u_speed"),
			sampler: uniformLocation(gl, program, "u_tex"),
		};
	} catch {
		return null;
	}
}

// starts the wave animation on `canvas` and returns its teardown, or null when
// this browser can't run it — the caller's cue to show the static sprite.
function startWave(canvas: HTMLCanvasElement): (() => void) | null {
	const gl = canvas.getContext("webgl2", {premultipliedAlpha: false, alpha: true});
	if (!gl) return null;
	const pipeline = buildPipeline(gl);
	if (!pipeline) return null;
	const {program, quad, texture, time, intensity, speed, sampler} = pipeline;
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
		gl.bindTexture(gl.TEXTURE_2D, texture);
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
			gl.bindVertexArray(quad.vao);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.uniform1i(sampler, 0);
			gl.uniform1f(time, (performance.now() - start) / 1000);
			gl.uniform1f(intensity, WAVE_INTENSITY);
			gl.uniform1f(speed, WAVE_SPEED);
			gl.drawArrays(gl.TRIANGLES, 0, QUAD_VERTICES);
		}
		rafId = requestAnimationFrame(tick);
	};
	rafId = requestAnimationFrame(tick);
	return () => {
		cancelled = true;
		cancelAnimationFrame(rafId);
		gl.deleteProgram(program);
		gl.deleteBuffer(quad.buffer);
		gl.deleteVertexArray(quad.vao);
		gl.deleteTexture(texture);
	};
}
