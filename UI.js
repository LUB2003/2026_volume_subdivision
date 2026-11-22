// UI 관련 코드를 모두 모은 파일
//   - 캔버스를 화면에 꽉 채우기 (해상도 / 리사이즈)
//   - 색상 설정 (uniform buffer 포함)
//   - 패널: 레벨 슬라이더, 표시 토글, 색상 선택기, 통계, 카메라 리셋
//   - FPS 표시
//
// main.js 에서는 createUI() 하나만 호출하면 된다.


// ============================================================
// 상수
// ============================================================

const MAX_DPR = 2;   // 캔버스 해상도 배율 상한 (성능 보호)

const DEFAULT_SETTINGS = {
    showFaces: true,
    showWire: true,
    faceColor: [1, 0.7, 0],
    wireColor: [0.2, 0.2, 0.2],
    bgColor: [0.5, 0.5, 0.5],
};


// ============================================================
// 유틸
// ============================================================

const $ = (id) => document.getElementById(id);

function hexToRgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function rgbToHex(rgb) {
    return "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}


// ============================================================
// 캔버스를 화면에 꽉 채우기
// CSS 크기(clientWidth/Height) x devicePixelRatio 로 실제 해상도를 맞춘다.
// 크기가 바뀌면 onResize() 를 호출한다.
// ============================================================

function setupCanvasResize(canvas, onResize) {
    const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));

        if (canvas.width === w && canvas.height === h) return false;

        canvas.width = w;
        canvas.height = h;
        return true;
    };

    resize();
    new ResizeObserver(() => { if (resize()) onResize(); }).observe(canvas);
}


// ============================================================
// 색상 설정 (uniform buffer: faceColor vec4 + wireColor vec4 = 32 bytes)
//   values : 현재 설정값 (렌더 루프가 읽음)
//   buffer : 셰이더가 읽는 uniform buffer
//   write  : values 의 색상을 buffer 에 업로드
// ============================================================

function createSettings(device) {
    const values = {
        ...DEFAULT_SETTINGS,
        faceColor: [...DEFAULT_SETTINGS.faceColor],
        wireColor: [...DEFAULT_SETTINGS.wireColor],
        bgColor: [...DEFAULT_SETTINGS.bgColor],
    };

    const buffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const write = () => {
        device.queue.writeBuffer(buffer, 0, new Float32Array([
            ...values.faceColor, 1,
            ...values.wireColor, 1,
        ]));
    };
    write();

    return { values, buffer, write };
}


// ============================================================
// 패널 UI 연결
// ============================================================

// 통계 표시
function bindStats(levelStats, state) {
    const update = () => {
        const s = levelStats[state.displayLevel - 1];
        $("stat-v").textContent = s.vertices.toLocaleString();
        $("stat-t").textContent = s.triangles.toLocaleString();
        $("stat-e").textContent = s.edges.toLocaleString();
        $("level-label").textContent = state.displayLevel;
    };
    update();
    return update;
}

// 레벨 슬라이더
function bindLevelSlider(state, maxLevel, onChange) {
    const slider = $("level-slider");
    slider.min = 1;
    slider.max = maxLevel;
    slider.step = 1;
    slider.value = state.displayLevel;

    slider.addEventListener("input", (e) => {
        state.displayLevel = Number(e.target.value);
        onChange();
    });
}

// 면 / 와이어프레임 표시 토글
function bindToggles(settings) {
    const toggles = [
        { id: "chk-faces", key: "showFaces" },
        { id: "chk-wire",  key: "showWire" },
    ];

    for (const { id, key } of toggles) {
        const input = $(id);
        input.checked = settings.values[key];
        input.addEventListener("change", (e) => { settings.values[key] = e.target.checked; });
    }
}

// 색상 선택기 (초기값을 settings 에 맞추고, 변경 시 반영)
function bindColors(settings) {
    const colors = [
        { id: "col-face", key: "faceColor", needsUpload: true },
        { id: "col-wire", key: "wireColor", needsUpload: true },
        { id: "col-bg",   key: "bgColor",   needsUpload: false },   // 배경색은 clearValue 로 쓰므로 업로드 불필요
    ];

    for (const { id, key, needsUpload } of colors) {
        const input = $(id);
        input.value = rgbToHex(settings.values[key]);
        input.addEventListener("input", (e) => {
            settings.values[key] = hexToRgb(e.target.value);
            if (needsUpload) settings.write();
        });
    }
}

// FPS 표시 (0.5초마다 갱신). 반환된 함수를 프레임마다 한 번씩 호출한다.
function createFpsCounter(element) {
    let frames = 0;
    let last = performance.now();

    return () => {
        frames++;
        const now = performance.now();
        if (now - last >= 500) {
            element.textContent = Math.round(frames * 1000 / (now - last));
            frames = 0;
            last = now;
        }
    };
}


// ============================================================
// UI 생성 (main.js 가 호출하는 유일한 진입점)
//
//   device     : GPUDevice (색상 uniform buffer 생성용)
//   canvas     : 렌더링 캔버스
//   levelStats : 레벨별 통계 [{ vertices, triangles, edges }, ...]
//   maxLevel   : 슬라이더 최대값
//
// 반환값
//   settings      : { values, buffer, write }  (렌더 루프와 셰이더가 사용)
//   state         : { displayLevel }           (슬라이더가 바꾸는 값)
//   tickFps()     : 프레임마다 호출
//   attachCamera  : 카메라 생성 후 호출 (리사이즈 시 갱신, 리셋 버튼 연결)
// ============================================================

export function createUI({ device, canvas, levelStats, maxLevel }) {

    const settings = createSettings(device);
    const state = { displayLevel: maxLevel };
    let camera = null;

    // 캔버스 (카메라가 생기기 전에 먼저 크기를 맞춰 둔다)
    setupCanvasResize(canvas, () => camera?.update());

    // 패널
    const updateStats = bindStats(levelStats, state);
    bindLevelSlider(state, maxLevel, updateStats);
    bindToggles(settings);
    bindColors(settings);

    // FPS
    const tickFps = createFpsCounter($("stat-fps"));

    return {
        settings,
        state,
        tickFps,
        attachCamera(cam) {
            camera = cam;
            $("btn-reset").addEventListener("click", () => cam.reset());
        },
    };
}