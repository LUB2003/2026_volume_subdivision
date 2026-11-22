// 궤도(orbit) + 이동(pan) + 줌 카메라
//
// 조작
//   좌클릭 드래그            : 회전
//   우클릭 드래그 / 휠클릭 드래그 / Shift + 좌클릭 드래그 : 이동(pan)
//   마우스 휠                : 줌
//   더블클릭 또는 R 키       : 카메라 리셋
//
// uniformBuffer 에는 MVP(mat4x4<f32>, 64 bytes)를 쓴다.
// 캔버스 크기가 바뀌면 update() 를 다시 호출해야 종횡비가 갱신된다.

export class OrbitCamera {

    constructor(canvas, device, uniformBuffer, options = {}) {
        this.canvas = canvas;
        this.device = device;
        this.uniformBuffer = uniformBuffer;

        // 초기값 (리셋 시 돌아갈 값)
        this.initial = {
            yaw: options.yaw ?? 0.6,
            pitch: options.pitch ?? 0.4,
            distance: options.distance ?? 3.0,
            target: options.target ?? [0, 0, 0],
        };

        this.fov = options.fov ?? (45 * Math.PI / 180);
        this.near = options.near ?? 0.01;
        this.far = options.far ?? 1000;

        this.rotateSpeed = 0.005;
        this.zoomSpeed = 0.001;

        this.reset(false);

        this._bindEvents();
        this.update();
    }

    reset(doUpdate = true) {
        this.yaw = this.initial.yaw;
        this.pitch = this.initial.pitch;
        this.distance = this.initial.distance;
        this.target = [...this.initial.target];
        if (doUpdate) this.update();
    }

    // ------------------------------------------------------------
    // 입력 처리
    // ------------------------------------------------------------
    _bindEvents() {
        const canvas = this.canvas;

        let dragging = false;
        let mode = "orbit";
        let lastX = 0;
        let lastY = 0;

        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        canvas.addEventListener("pointerdown", (e) => {
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;

            // 우클릭(2), 휠클릭(1), Shift+좌클릭 => 이동
            mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? "pan" : "orbit";

            canvas.setPointerCapture(e.pointerId);
        });

        canvas.addEventListener("pointermove", (e) => {
            if (!dragging) return;

            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;

            if (mode === "pan") {
                this._pan(dx, dy);
            } else {
                this.yaw -= dx * this.rotateSpeed;
                this.pitch += dy * this.rotateSpeed;

                const limit = Math.PI / 2 - 0.01;
                this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
            }

            this.update();
        });

        const stop = (e) => {
            dragging = false;
            if (canvas.hasPointerCapture(e.pointerId)) {
                canvas.releasePointerCapture(e.pointerId);
            }
        };
        canvas.addEventListener("pointerup", stop);
        canvas.addEventListener("pointercancel", stop);

        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            this.distance *= Math.exp(e.deltaY * this.zoomSpeed);
            this.distance = Math.max(0.05, Math.min(500, this.distance));
            this.update();
        }, { passive: false });

        canvas.addEventListener("dblclick", () => this.reset());

        window.addEventListener("keydown", (e) => {
            if (e.key === "r" || e.key === "R") this.reset();
        });
    }

    // 화면 기준으로 이동: 화면에서 드래그한 만큼 장면이 따라오도록 target 을 옮긴다
    _pan(dx, dy) {
        const { right, up } = this._basis();

        // 화면 높이 1픽셀이 target 거리에서 차지하는 월드 길이
        const worldPerPixel =
            (2 * this.distance * Math.tan(this.fov / 2)) / this.canvas.height;

        for (let i = 0; i < 3; i++) {
            this.target[i] += (-dx * right[i] + dy * up[i]) * worldPerPixel;
        }
    }

    // ------------------------------------------------------------
    // 행렬 계산 (column-major, WebGPU 클립 z 범위 0..1)
    // ------------------------------------------------------------
    _eye() {
        const cp = Math.cos(this.pitch);
        return [
            this.target[0] + this.distance * cp * Math.sin(this.yaw),
            this.target[1] + this.distance * Math.sin(this.pitch),
            this.target[2] + this.distance * cp * Math.cos(this.yaw),
        ];
    }

    _basis() {
        const eye = this._eye();
        const f = normalize(sub(this.target, eye));
        const r = normalize(cross(f, [0, 1, 0]));
        const u = cross(r, f);
        return { eye, forward: f, right: r, up: u };
    }

    _viewMatrix() {
        const { eye, forward: f, right: r, up: u } = this._basis();

        return new Float32Array([
            r[0], u[0], -f[0], 0,
            r[1], u[1], -f[1], 0,
            r[2], u[2], -f[2], 0,
            -dot(r, eye), -dot(u, eye), dot(f, eye), 1,
        ]);
    }

    _projectionMatrix() {
        const aspect = this.canvas.width / Math.max(1, this.canvas.height);
        const f = 1 / Math.tan(this.fov / 2);
        const n = this.near;
        const fa = this.far;

        const m = new Float32Array(16);
        m[0] = f / aspect;
        m[5] = f;
        m[10] = fa / (n - fa);
        m[11] = -1;
        m[14] = (n * fa) / (n - fa);
        return m;
    }

    update() {
        const mvp = mul(this._projectionMatrix(), this._viewMatrix());
        this.device.queue.writeBuffer(this.uniformBuffer, 0, mvp);
    }
}


// ---------------- 간단한 벡터/행렬 유틸 ----------------
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}
function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

// out = a * b (column-major)
function mul(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) {
                s += a[k * 4 + r] * b[c * 4 + k];
            }
            out[c * 4 + r] = s;
        }
    }
    return out;
}