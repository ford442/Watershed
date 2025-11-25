export class InputHandler {
    public keys: { [key: string]: boolean } = {};
    public mouseDelta: { x: number, y: number } = { x: 0, y: 0 };
    public isPointerLocked: boolean = false;

    private element: HTMLElement;

    constructor(element: HTMLElement) {
        this.element = element;
        this.init();
    }

    private init() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        this.element.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                this.element.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === this.element;
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isPointerLocked) {
                this.mouseDelta.x += e.movementX;
                this.mouseDelta.y -= e.movementY; // Y is inverted in 3D usually
            }
        });
    }

    public getMouseDelta() {
        const delta = { ...this.mouseDelta };
        this.mouseDelta = { x: 0, y: 0 };
        return delta;
    }

    public isKeyDown(code: string): boolean {
        return !!this.keys[code];
    }
}
