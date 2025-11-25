import { vec3, vec2 } from 'gl-matrix';

export interface Mesh {
    vertexData: Float32Array; // Interleaved: Pos(3), Normal(3), UV(2)
    vertexCount: number;
    indexData?: Uint16Array | Uint32Array;
    indexCount?: number;
}

export class Geometry {

    // Creates a flat plane (centered at 0,0,0) on the XZ plane
    public static createPlane(width: number, depth: number, subdivisions: number): Mesh {
        const vertexCount = (subdivisions + 1) * (subdivisions + 1);
        const vertices = new Float32Array(vertexCount * 8);
        const indices = [];

        for (let z = 0; z <= subdivisions; z++) {
            for (let x = 0; x <= subdivisions; x++) {
                const u = x / subdivisions;
                const v = z / subdivisions;

                const px = (u - 0.5) * width;
                const pz = (v - 0.5) * depth;
                const py = 0;

                const index = (z * (subdivisions + 1) + x) * 8;

                // Position
                vertices[index] = px;
                vertices[index + 1] = py;
                vertices[index + 2] = pz;

                // Normal (Up)
                vertices[index + 3] = 0;
                vertices[index + 4] = 1;
                vertices[index + 5] = 0;

                // UV
                vertices[index + 6] = u * 10; // Tiling factor
                vertices[index + 7] = v * 10;
            }
        }

        for (let z = 0; z < subdivisions; z++) {
            for (let x = 0; x < subdivisions; x++) {
                const i0 = z * (subdivisions + 1) + x;
                const i1 = i0 + 1;
                const i2 = (z + 1) * (subdivisions + 1) + x;
                const i3 = i2 + 1;

                indices.push(i0, i2, i1);
                indices.push(i1, i2, i3);
            }
        }

        return {
            vertexData: vertices,
            vertexCount: vertices.length / 8,
            indexData: new Uint32Array(indices),
            indexCount: indices.length
        };
    }

    // Creates a simple tree mesh
    public static createTree(): Mesh {
        const vertices: number[] = [];
        const indices: number[] = [];
        let vIndex = 0;

        const addVertex = (pos: vec3, normal: vec3, uv: vec2) => {
            vertices.push(pos[0], pos[1], pos[2]);
            vertices.push(normal[0], normal[1], normal[2]);
            vertices.push(uv[0], uv[1]);
            return vIndex++;
        };

        // 1. Trunk (Cylinder)
        const segments = 8;
        const height = 4.0;
        const radius = 0.3;

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            const x = Math.cos(theta) * radius;
            const z = Math.sin(theta) * radius;

            // Bottom
            addVertex(vec3.fromValues(x, 0, z), vec3.fromValues(x, 0, z), vec2.fromValues(i/segments, 0));
            // Top
            addVertex(vec3.fromValues(x * 0.5, height, z * 0.5), vec3.fromValues(x, 0, z), vec2.fromValues(i/segments, 1));
        }

        for (let i = 0; i < segments; i++) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2);
            indices.push(base + 1, base + 3, base + 2);
        }

        const trunkVertexCount = vIndex;

        // 2. Branches (Cross Quads at the top)
        // We add a few crossed planes for foliage
        const foliageCount = 6;
        const foliageSize = 3.0;
        const foliageStart = 2.0;

        for(let i=0; i<foliageCount; i++) {
            const y = foliageStart + Math.random() * (height - foliageStart + 1.0);
            const angle = Math.random() * Math.PI * 2;
            const w = foliageSize * (0.8 + Math.random() * 0.4);
            const h = foliageSize * (0.8 + Math.random() * 0.4);

            // Center of the quad
            const cx = 0;
            const cz = 0;

            // Rotate around Y
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Quad offsets
            const dx = w/2;

            // 4 corners
            const p1 = vec3.fromValues(cx - dx * cos, y - h/2, cz - dx * sin);
            const p2 = vec3.fromValues(cx + dx * cos, y - h/2, cz + dx * sin);
            const p3 = vec3.fromValues(cx + dx * cos, y + h/2, cz + dx * sin);
            const p4 = vec3.fromValues(cx - dx * cos, y + h/2, cz - dx * sin);

            // Normal (points up roughly, or perpendicular to quad)
            // For foliage, we often want normal pointing up or out. Let's make it follow the quad face.
            const norm = vec3.fromValues(-sin, 0, cos);

            // We need 4 vertices
            // Since we want to use a different texture for branches, we usually separate meshes or use a texture atlas.
            // For simplicity, let's assume the texture coordinates will shift or we use a texture array shader.
            // WAIT: The plan has 'tree.wgsl' using 'bark.png' and 'branch.png'.
            // I should probably separate Trunk and Leaves into two different Draw Calls (Meshes) to bind different textures.
            // OR I can pack UVs: UV.y > 1.0 implies leaves? No, that's hacky.
            // I'll return a composite mesh but I can't bind two textures easily unless I use an array or check UVs.
            // Better approach: 'createTree' returns { trunk: Mesh, leaves: Mesh }
        }

        return {
             vertexData: new Float32Array(vertices),
             vertexCount: vertices.length / 8,
             indexData: new Uint16Array(indices),
             indexCount: indices.length
        };
    }

    // Corrected approach: Separate meshes
    public static createTrunk(height: number = 4.0, radius: number = 0.3): Mesh {
        const vertices: number[] = [];
        const indices: number[] = [];
        let vIndex = 0;
        const segments = 8;

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            const x = Math.cos(theta);
            const z = Math.sin(theta);
            const normal = vec3.fromValues(x, 0, z); // simple normal

            // Bottom ring
            vertices.push(x * radius, 0, z * radius); // Pos
            vertices.push(x, 0, z); // Normal
            vertices.push(i / segments, 0); // UV

            // Top ring
            vertices.push(x * radius * 0.5, height, z * radius * 0.5); // Pos
            vertices.push(x, 0, z);
            vertices.push(i / segments, 1);
        }

        // Indices
        // Vertices are added in pairs (bottom, top) for each segment index
        // Wait, loop above adds 2 vertices per iteration? No, the loop logic was:
        /*
          for i in 0..segments:
             add Bottom (idx = 2*i)
             add Top    (idx = 2*i + 1)
        */
        // Let's rewrite loop to be clearer.

        for (let i = 0; i <= segments; i++) {
             const theta = (i / segments) * Math.PI * 2;
             const x = Math.cos(theta);
             const z = Math.sin(theta);

             // Bottom vertex
             vertices.push(x * radius, 0, z * radius, x, 0, z, i/segments, 0);
             // Top vertex
             vertices.push(x * radius * 0.6, height, z * radius * 0.6, x, 0, z, i/segments, 3.0); // Tiling vertical
        }

        for (let i = 0; i < segments; i++) {
            const b1 = i * 2;
            const t1 = i * 2 + 1;
            const b2 = (i + 1) * 2;
            const t2 = (i + 1) * 2 + 1;

            indices.push(b1, b2, t1);
            indices.push(t1, b2, t2);
        }

        return {
            vertexData: new Float32Array(vertices),
            vertexCount: vertices.length / 8,
            indexData: new Uint16Array(indices),
            indexCount: indices.length
        };
    }

    public static createFoliage(height: number = 4.0): Mesh {
         const vertices: number[] = [];
         const indices: number[] = [];
         let vIndex = 0;

         const addQuad = (x: number, y: number, z: number, w: number, h: number, rotY: number) => {
             const cos = Math.cos(rotY);
             const sin = Math.sin(rotY);
             const dx = w/2;
             const dy = h/2;

             // Normal for a billboard is tricky. Let's just point it up for uniform lighting, or use the plane normal.
             const nx = -sin;
             const nz = cos;

             // 0: BL, 1: BR, 2: TR, 3: TL
             // Relative positions rotated
             const p0 = [-dx*cos, -dy, -dx*sin];
             const p1 = [ dx*cos, -dy,  dx*sin];
             const p2 = [ dx*cos,  dy,  dx*sin];
             const p3 = [-dx*cos,  dy, -dx*sin];

             const start = vIndex;

             [p0, p1, p2, p3].forEach((p, i) => {
                 vertices.push(x + p[0], y + p[1], z + p[2]); // Pos
                 vertices.push(nx, 0, nz); // Normal
                 // UVs
                 if (i==0) vertices.push(0, 1);
                 if (i==1) vertices.push(1, 1);
                 if (i==2) vertices.push(1, 0);
                 if (i==3) vertices.push(0, 0);
                 vIndex++;
             });

             indices.push(start, start+1, start+2);
             indices.push(start, start+2, start+3);
         };

         // Create 3 layers of cross-quads
         for(let i=0; i<3; i++) {
             const y = height * 0.6 + i * (height * 0.15);
             const size = 3.0 - i * 0.5;
             addQuad(0, y, 0, size, size, 0);
             addQuad(0, y, 0, size, size, Math.PI / 2); // Cross
             addQuad(0, y, 0, size, size, Math.PI / 4); // Star
             addQuad(0, y, 0, size, size, -Math.PI / 4);
         }

         return {
            vertexData: new Float32Array(vertices),
            vertexCount: vertices.length / 8,
            indexData: new Uint16Array(indices),
            indexCount: indices.length
        };
    }
}
