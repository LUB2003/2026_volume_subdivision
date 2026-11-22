import { loadJSON, loadVTK } from "./loadData.js";

import {
    countVertex,
    createLevelInfoBuffer,
    createVertexBuffer,
    createEdgeBuffer,
    createFaceBuffer,
    createCellBuffer,
    createIndexBuffer,
    createEdgeIndexBuffer,
} from "./subdivision_createBuffers.js";

import {
    subdiv_edge,
    subdiv_face,
    subdiv_cell
} from "./subdivision_shaders.js";

import {
    createBoundaryAverageBuffer,
    createMaxFaceBuffer,
    createAverageBuffer,
    createMaxCellBuffer
} from "./average_createBuffers.js";

import {
    maxLevelFaceCentery,
    maxLevelCellCentery,
    boundaryAverage,
    vertexAverage
} from "./average_shaders.js";

import { OrbitCamera } from "./camera.js";


// 최대 서브디비전 레벨 (vertexBuffer 크기도 이 레벨 기준)
const MAX_LEVEL = 3;


async function init() {

    if (!navigator.gpu) {
        alert("WebGPU not supported");
        return;
    }

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
        console.error("Failed to get GPU adapter");
        return;
    }

    const device = await adapter.requestDevice();

    // 검증 에러를 콘솔에 출력
    device.addEventListener("uncapturederror", (e) => {
        console.error("WebGPU uncaptured error:", e.error.message);
    });


    const canvas = document.getElementById("gpuCanvas");
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format,
        alphaMode: "opaque"
    });


    // Uniform buffer (MVP)
    const uniformBuffer = device.createBuffer({
        size: 64,
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });


    // ------------------------------------------------------------
    // UI 설정값 + 색상 uniform buffer (faceColor vec4 + wireColor vec4 = 32 bytes)
    // ------------------------------------------------------------
    const settingsBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const settings = {
        showFaces: true,
        showWire: true,
        faceColor: [1, 0.7, 0],
        wireColor: [0.2, 0.2, 0.2],
        bgColor: [0.5, 0.5, 0.5],
    };

    function hexToRgb(hex) {
        return [
            parseInt(hex.slice(1, 3), 16) / 255,
            parseInt(hex.slice(3, 5), 16) / 255,
            parseInt(hex.slice(5, 7), 16) / 255,
        ];
    }

    function writeSettings() {
        device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
            ...settings.faceColor, 1,
            ...settings.wireColor, 1,
        ]));
    }
    writeSettings();


    // Load VTK / topology
    const vertices = await loadVTK("./src/newA/big_A2.vtk");
    const irr_topology = await loadJSON("./src/newA/irregular_topology.json");


    // 모든 레벨이 공유하는 작업용 정점 버퍼 (최대 레벨 크기)
    // 주의: createVertexBuffer 안에서 usage 에 GPUBufferUsage.COPY_SRC 가 포함되어 있어야 함
    const V = await countVertex(irr_topology, MAX_LEVEL, vertices.length);

    const vertexBuffer = await createVertexBuffer(device, vertices, irr_topology, MAX_LEVEL, V);


    // ------------------------------------------------------------
    // 레벨별 리소스 (subdiv + center + average + 렌더링 index 전부 레벨 기준)
    // ------------------------------------------------------------
    async function createLevelResources(level) {

        const levelInfo = await createLevelInfoBuffer(device, vertices, irr_topology, level);
        const edge = await createEdgeBuffer(device, irr_topology, level);
        const face = await createFaceBuffer(device, irr_topology, level);
        const cell = await createCellBuffer(device, irr_topology, level);

        const { MaxFaceBuffer, FaceCenteryBuffer } = await createMaxFaceBuffer(device, irr_topology, level);
        const { MaxCellBuffer, CellCenteryBuffer } = await createMaxCellBuffer(device, irr_topology, level);

        const boundaryAvg = await createBoundaryAverageBuffer(device, irr_topology, level);
        const avg = await createAverageBuffer(device, irr_topology, level);

        // 렌더링용 index buffer (레벨별)
        const { indexBuffer, indexCount } = await createIndexBuffer(device, irr_topology, level);

        const { indexBuffer: edgeIndexBuffer, indexCount: edgeIndexCount } =
            await createEdgeIndexBuffer(device, irr_topology, level);

        return {
            level,
            levelInfo,
            edge,
            face,
            cell,
            MaxFaceBuffer,
            FaceCenteryBuffer,
            MaxCellBuffer,
            CellCenteryBuffer,
            boundaryAvg,
            avg,
            indexBuffer,
            indexCount,
            edgeIndexBuffer,
            edgeIndexCount
        };
    }

    // levels[0] = 레벨 1, levels[1] = 레벨 2, ...
    const levels = [];
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
        levels.push(await createLevelResources(lv));
    }


    // ------------------------------------------------------------
    // 레벨별 정점 스냅샷 (슬라이더로 레벨을 전환해서 보기 위함)
    // 레벨 k 계산이 끝난 직후의 정점 [0, count_k) 을 복사해 둔다.
    // 마지막 레벨은 작업 버퍼를 그대로 사용한다.
    // ------------------------------------------------------------
    const levelVertexCounts = [];
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
        levelVertexCounts.push(await countVertex(irr_topology, lv, vertices.length));
    }

    const levelVertexBuffers = levels.map((L, i) => {
        if (i === MAX_LEVEL - 1) return vertexBuffer;

        return device.createBuffer({
            size: levelVertexCounts[i] * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
    });


    // Render shader
    const shader = device.createShaderModule({
        code: `
            struct VSOut {
                @builtin(position) position: vec4<f32>,
            };

            struct Uniforms {
                mvp : mat4x4<f32>,
            };

            struct Settings {
                faceColor : vec4<f32>,
                wireColor : vec4<f32>,
            };


            @group(0) @binding(0) var<storage, read> pos : array<vec4<f32>>;
            @group(0) @binding(1) var<uniform> uniforms : Uniforms;
            @group(0) @binding(2) var<uniform> settings : Settings;


            @vertex
            fn vs_main(
                @builtin(vertex_index) vertexIndex: u32
            ) -> VSOut {
                var out: VSOut;
                let p = pos[vertexIndex].xyz * 0.3;
                out.position = uniforms.mvp * vec4f(p, 1.0);
                return out;
            }


            @fragment
            fn fs_main( in: VSOut ) -> @location(0) vec4<f32> {
                return settings.faceColor;
            }

            @fragment
            fn fs_wire( in: VSOut ) -> @location(0) vec4<f32> {
                return settings.wireColor;
            }
        `
    });


    // Render bind group layout
    const bindGroupLayout =
        device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "read-only-storage" },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" },
                },
            ],
        });


    // Pipeline layout
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });


    // Triangle pipeline
    const pipeline =
        device.createRenderPipeline({

            layout: pipelineLayout,

            vertex: {
                module: shader,
                entryPoint: "vs_main"
            },

            fragment: {
                module: shader,
                entryPoint: "fs_main",
                targets: [{ format }]
            },

            primitive: {
                topology: "triangle-list",
                cullMode: "none",
            },
        });


    // Wireframe pipeline
    const wirePipeline =
        device.createRenderPipeline({
            layout: pipelineLayout,

            vertex: {
                module: shader,
                entryPoint: "vs_main",
            },

            fragment: {
                module: shader,
                entryPoint: "fs_wire",
                targets: [{ format }]
            },

            primitive: {
                topology: "line-list",
            },
        });


    // Render bind group (레벨마다 하나: 정점 버퍼만 다름)
    const bindGroups = levelVertexBuffers.map((buf) =>
        device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: buf } },
                { binding: 1, resource: { buffer: uniformBuffer } },
                { binding: 2, resource: { buffer: settingsBuffer } },
            ]
        })
    );


    // ------------------------------------------------------------
    // 캔버스를 화면에 꽉 채우기
    // CSS 크기(clientWidth/Height) x devicePixelRatio 로 실제 해상도를 맞춘다.
    // ------------------------------------------------------------
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));

        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            return true;
        }
        return false;
    }

    resizeCanvas();


    // Camera (이동 / 회전 / 줌 지원)
    const camera = new OrbitCamera(canvas, device, uniformBuffer);

    // 창 크기가 바뀌면 해상도와 종횡비 갱신
    new ResizeObserver(() => {
        if (resizeCanvas()) camera.update();
    }).observe(canvas);


    // ------------------------------------------------------------
    // UI 이벤트 연결
    // ------------------------------------------------------------
    const $ = (id) => document.getElementById(id);

    // 현재 표시 중인 레벨
    let displayLevel = MAX_LEVEL;

    function updateStats() {
        const L = levels[displayLevel - 1];
        $("stat-v").textContent = levelVertexCounts[displayLevel - 1].toLocaleString();
        $("stat-t").textContent = Math.floor(L.indexCount / 3).toLocaleString();
        $("stat-e").textContent = Math.floor(L.edgeIndexCount / 2).toLocaleString();
        $("level-label").textContent = displayLevel;
    }

    const slider = $("level-slider");
    slider.min = 1;
    slider.max = MAX_LEVEL;
    slider.step = 1;
    slider.value = displayLevel;

    slider.addEventListener("input", (e) => {
        displayLevel = Number(e.target.value);
        updateStats();
    });

    updateStats();

    $("chk-faces").addEventListener("change", (e) => { settings.showFaces = e.target.checked; });
    $("chk-wire").addEventListener("change", (e) => { settings.showWire = e.target.checked; });

    $("col-face").addEventListener("input", (e) => {
        settings.faceColor = hexToRgb(e.target.value);
        writeSettings();
    });
    $("col-wire").addEventListener("input", (e) => {
        settings.wireColor = hexToRgb(e.target.value);
        writeSettings();
    });
    $("col-bg").addEventListener("input", (e) => {
        settings.bgColor = hexToRgb(e.target.value);
    });

    $("btn-reset").addEventListener("click", () => camera.reset());


    // ------------------------------------------------------------
    // 실행 순서 (레벨마다 한 세트)
    //   edge -> face -> cell -> face center -> cell center
    //   -> boundary average -> vertex average -> (스냅샷 복사)
    //
    // 주의: average_shaders.js 의 함수들은 pass.end() 를 하지 않아야 함
    //       (아래에서 호출하는 쪽이 end() 를 한다)
    // ------------------------------------------------------------
    function runSubdivision() {
        const encoder = device.createCommandEncoder();

        for (const L of levels) {

            // Edge subdivision
            let pass = encoder.beginComputePass();
            subdiv_edge(device, pass, vertexBuffer, L.edge, L.levelInfo);
            pass.end();

            // Face subdivision
            pass = encoder.beginComputePass();
            subdiv_face(device, pass, vertexBuffer, L.face, L.levelInfo);
            pass.end();

            // Cell subdivision
            pass = encoder.beginComputePass();
            subdiv_cell(device, pass, vertexBuffer, L.cell, L.levelInfo);
            pass.end();

            // Face center
            pass = encoder.beginComputePass();
            maxLevelFaceCentery(device, pass, vertexBuffer, L.MaxFaceBuffer, L.FaceCenteryBuffer);
            pass.end();

            // Cell center
            pass = encoder.beginComputePass();
            maxLevelCellCentery(device, pass, vertexBuffer, L.MaxCellBuffer, L.CellCenteryBuffer);
            pass.end();

            // Boundary vertex average
            pass = encoder.beginComputePass();
            boundaryAverage(
                device,
                pass,
                L.boundaryAvg.BoundaryAverageData_idxData,
                L.boundaryAvg.BoundaryAverageData_start,
                L.boundaryAvg.BoundaryAverageData_count,
                L.boundaryAvg.BoundaryAverageData_faceIdx,
                L.FaceCenteryBuffer,
                vertexBuffer
            );
            pass.end();

            // Vertex average
            pass = encoder.beginComputePass();
            vertexAverage(
                device,
                pass,
                L.avg.AverageData_idxData,
                L.avg.AverageData_start,
                L.avg.AverageData_count,
                L.avg.AverageData_cellIdx,
                L.CellCenteryBuffer,
                vertexBuffer
            );
            pass.end();

            // 이 레벨의 결과를 스냅샷으로 저장 (마지막 레벨은 작업 버퍼를 그대로 씀)
            const i = L.level - 1;
            if (i < MAX_LEVEL - 1) {
                encoder.copyBufferToBuffer(
                    vertexBuffer, 0,
                    levelVertexBuffers[i], 0,
                    levelVertexCounts[i] * 16
                );
            }
        }

        device.queue.submit([encoder.finish()]);
    }


    // Render (슬라이더로 선택한 레벨)
    function render() {

        const L = levels[displayLevel - 1];
        const bindGroup = bindGroups[displayLevel - 1];
        const [r, g, b] = settings.bgColor;

        const encoder = device.createCommandEncoder();

        const pass =
            encoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    clearValue: { r, g, b, a: 1 },
                    loadOp: "clear",
                    storeOp: "store"
                }]
            });


        // Triangle
        if (settings.showFaces) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.setIndexBuffer(L.indexBuffer, "uint32");
            pass.drawIndexed(L.indexCount);
        }


        // Wireframe
        if (settings.showWire) {
            pass.setPipeline(wirePipeline);
            pass.setBindGroup(0, bindGroup);
            pass.setIndexBuffer(L.edgeIndexBuffer, "uint32");
            pass.drawIndexed(L.edgeIndexCount);
        }

        pass.end();

        device.queue.submit([encoder.finish()]);
    }


    let frames = 0;
    let lastTime = performance.now();

    function animate() {
        render();

        // FPS 표시 (0.5초마다 갱신)
        frames++;
        const now = performance.now();
        if (now - lastTime >= 500) {
            $("stat-fps").textContent = Math.round(frames * 1000 / (now - lastTime));
            frames = 0;
            lastTime = now;
        }

        requestAnimationFrame(animate);
    }

    runSubdivision();
    animate();
}
init();