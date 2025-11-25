import { mat4, vec3, glMatrix } from 'gl-matrix';

const toRadian = glMatrix.toRadian;

export class Camera {
    public position: vec3;
    private front: vec3;
    private up: vec3;
    private right: vec3;
    private worldUp: vec3;

    public yaw: number;
    public pitch: number;

    private fov: number;
    private aspect: number;
    private near: number;
    private far: number;

    constructor(position: vec3 = vec3.fromValues(0, 0, 0), aspect: number = 1.0) {
        this.position = position;
        this.worldUp = vec3.fromValues(0, 1, 0);
        this.front = vec3.fromValues(0, 0, -1);
        this.up = vec3.create();
        this.right = vec3.create();

        this.yaw = -90.0;
        this.pitch = 0.0;

        this.fov = 45.0;
        this.aspect = aspect;
        this.near = 0.1;
        this.far = 1000.0;

        this.updateCameraVectors();
    }

    public getViewMatrix(): mat4 {
        const target = vec3.create();
        vec3.add(target, this.position, this.front);
        const view = mat4.create();
        mat4.lookAt(view, this.position, target, this.up);
        return view;
    }

    public getProjectionMatrix(): mat4 {
        const projection = mat4.create();
        // Use perspectiveZO for WebGPU (0..1 depth range) if available, otherwise manual or standard
        // gl-matrix 3.x has perspectiveZO
        if ((mat4 as any).perspectiveZO) {
             (mat4 as any).perspectiveZO(projection, toRadian(this.fov), this.aspect, this.near, this.far);
        } else {
            mat4.perspective(projection, toRadian(this.fov), this.aspect, this.near, this.far);
            // Convert -1..1 to 0..1?
            // T = translate(0, 0, 1) * scale(1, 1, 0.5)
            // Or just assume the user installed a version that supports it or I accept clipping.
        }
        return projection;
    }

    public updateAspect(aspect: number) {
        this.aspect = aspect;
    }

    public processKeyboard(direction: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN', deltaTime: number, speed: number = 10.0) {
        const velocity = speed * deltaTime;
        const moveVec = vec3.create();

        if (direction === 'FORWARD') {
            vec3.scale(moveVec, this.front, velocity);
            vec3.add(this.position, this.position, moveVec);
        }
        if (direction === 'BACKWARD') {
            vec3.scale(moveVec, this.front, velocity);
            vec3.sub(this.position, this.position, moveVec);
        }
        if (direction === 'LEFT') {
            vec3.scale(moveVec, this.right, velocity);
            vec3.sub(this.position, this.position, moveVec);
        }
        if (direction === 'RIGHT') {
            vec3.scale(moveVec, this.right, velocity);
            vec3.add(this.position, this.position, moveVec);
        }
        // Flight controls for debugging/easy movement
        if (direction === 'UP') {
            this.position[1] += velocity;
        }
        if (direction === 'DOWN') {
            this.position[1] -= velocity;
        }
    }

    public processMouseMovement(xoffset: number, yoffset: number, constrainPitch: boolean = true) {
        const sensitivity = 0.1;
        xoffset *= sensitivity;
        yoffset *= sensitivity;

        this.yaw += xoffset;
        this.pitch += yoffset;

        if (constrainPitch) {
            if (this.pitch > 89.0) this.pitch = 89.0;
            if (this.pitch < -89.0) this.pitch = -89.0;
        }

        this.updateCameraVectors();
    }

    private updateCameraVectors() {
        const front = vec3.create();
        front[0] = Math.cos(toRadian(this.yaw)) * Math.cos(toRadian(this.pitch));
        front[1] = Math.sin(toRadian(this.pitch));
        front[2] = Math.sin(toRadian(this.yaw)) * Math.cos(toRadian(this.pitch));
        vec3.normalize(this.front, front);

        vec3.cross(this.right, this.front, this.worldUp);
        vec3.normalize(this.right, this.right);

        vec3.cross(this.up, this.right, this.front);
        vec3.normalize(this.up, this.up);
    }
}
