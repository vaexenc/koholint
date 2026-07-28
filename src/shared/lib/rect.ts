// axis-aligned rectangle in a pixel space. shared by the simulation's collision
// boxes and the renderer's visible-world rect so culling and physics speak the
// same shape.
export type Aabb = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};
