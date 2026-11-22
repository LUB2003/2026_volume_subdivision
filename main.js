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
import { createUI } from "./ui.js";


// ============================================================
// 설정
// ============================================================

const MAX_LEVEL = 3;                       // 최대 서브디비전 레벨
const FREE_COMPUTE_BUFFERS = true;         // 계산이 끝나면 계산 전용 버퍼를 해제해 메모리 절약

const DATA_PATH = {
    vtk: "./src/newA/big_A2.vtk",
    topology: "./src/newA/irregular_topology.json",
};

const RENDER_SHADER = /* wgsl */ `
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
    fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
        var out: VSOut;
        let p = pos[vertexIndex].xyz * 0.3;
        out.position = uniforms.mvp * vec4f(p, 1.0);
        return out;
    }

    @fragment
    fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
        return settings.faceColor;
    }

    @fragment
    fn fs_wire(in: VSOut) -> @location(0) vec4<f32> {
        return settings.wireColor;
    }
`;


// ============================================================
// 유틸
// ============================================================

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// 객체 안에 중첩된 GPUBuffer 를 모두 해제
function destroyBuffers(resource) {
    if (resource instanceof GPUBuffer) {
        resource.destroy();
    } else if (resource && typeof resource === "object") {
        Object.values(resource).forEach(destroyBuffers);
    }
}


// ============================================================
// WebGPU 초기화
// ============================================================

async function initGPU(canvas) {
    if (!navigator.gpu) {
        alert("WebGPU not supported");
        throw new Error("WebGPU not supported");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Failed to get GPU adapter");

    const device = await adapter.requestDevice();

    // 검증 에러를 콘솔에 출력
    device.addEventListener("uncapturederror", (e) => {
        console.error("WebGPU uncaptured error:", e.error.message);
    });

    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    return { device, context, format };
}


// ============================================================
// 레벨별 리소스
//   compute : 계산에만 쓰는 버퍼 (계산 후 해제 가능)
//   render  : 화면에 그릴 때 쓰는 index buffer
// ============================================================

async function createLevelResources(device, vertices, topology, level) {

    const [
        levelInfo, edge, face, cell,
        faceCenter, cellCenter,
        boundaryAvg, avg,
        faceIndex, edgeIndex,
    ] = await Promise.all([
        createLevelInfoBuffer(device, vertices, topology, level),
        createEdgeBuffer(device, topology, level),
        createFaceBuffer(device, topology, level),
        createCellBuffer(device, topology, level),
        createMaxFaceBuffer(device, topology, level),
        createMaxCellBuffer(device, topology, level),
        createBoundaryAverageBuffer(device, topology, level),
        createAverageBuffer(device, topology, level),
        createIndexBuffer(device, topology, level),
        createEdgeIndexBuffer(device, topology, level),
    ]);

    return {
        level,
        compute: {
            levelInfo, edge, face, cell,
            faceCenter,      // { MaxFaceBuffer, FaceCenteryBuffer }
            cellCenter,      // { MaxCellBuffer, CellCenteryBuffer }
            boundaryAvg,
            avg,
        },
        render: {
            indexBuffer: faceIndex.indexBuffer,
            indexCount: faceIndex.indexCount,
            edgeIndexBuffer: edgeIndex.indexBuffer,
            edgeIndexCount: edgeIndex.indexCount,
        },
    };
}


// ============================================================
// 서브디비전 실행
//   레벨마다: edge -> face -> cell -> face center -> cell center
//             -> boundary average -> vertex average -> (스냅샷 복사)
//
// 주의: subdivision_shaders.js / average_shaders.js 의 함수들은
//       pass.end() 를 호출하지 않아야 한다 (여기서 end() 한다).
// ============================================================

function runSubdivision(device, vertexBuffer, levels, snapshots, levelVertexCounts) {
    const encoder = device.createCommandEncoder();

    // compute pass 하나를 열고, 작업을 넣고, 닫는다
    const computePass = (work) => {
        const pass = encoder.beginComputePass();
        work(pass);
        pass.end();
    };

    for (const { level, compute: c } of levels) {

        computePass((p) => subdiv_edge(device, p, vertexBuffer, c.edge, c.levelInfo));
        computePass((p) => subdiv_face(device, p, vertexBuffer, c.face, c.levelInfo));
        computePass((p) => subdiv_cell(device, p, vertexBuffer, c.cell, c.levelInfo));

        computePass((p) => maxLevelFaceCentery(
            device, p, vertexBuffer,
            c.faceCenter.MaxFaceBuffer, c.faceCenter.FaceCenteryBuffer
        ));

        computePass((p) => maxLevelCellCentery(
            device, p, vertexBuffer,
            c.cellCenter.MaxCellBuffer, c.cellCenter.CellCenteryBuffer
        ));

        computePass((p) => boundaryAverage(
            device, p,
            c.boundaryAvg.BoundaryAverageData_idxData,
            c.boundaryAvg.BoundaryAverageData_start,
            c.boundaryAvg.BoundaryAverageData_count,
            c.boundaryAvg.BoundaryAverageData_faceIdx,
            c.faceCenter.FaceCenteryBuffer,
            vertexBuffer
        ));

        computePass((p) => vertexAverage(
            device, p,
            c.avg.AverageData_idxData,
            c.avg.AverageData_start,
            c.avg.AverageData_count,
            c.avg.AverageData_cellIdx,
            c.cellCenter.CellCenteryBuffer,
            vertexBuffer
        ));

        // 이 레벨의 결과를 스냅샷으로 저장 (마지막 레벨은 작업 버퍼를 그대로 사용)
        const i = level - 1;
        if (snapshots[i] !== vertexBuffer) {
            encoder.copyBufferToBuffer(vertexBuffer, 0, snapshots[i], 0, levelVertexCounts[i] * 16);
        }
    }

    device.queue.submit([encoder.finish()]);
}


// ============================================================
// 렌더링 파이프라인 / bind group
// ============================================================

function createRenderer(device, format, uniformBuffer, settingsBuffer, snapshots) {
    const shader = device.createShaderModule({ code: RENDER_SHADER });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX,   buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: GPUShaderStage.VERTEX,   buffer: { type: "uniform" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
    });

    const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    const makePipeline = (fragmentEntry, primitive) =>
        device.createRenderPipeline({
            layout,
            vertex: { module: shader, entryPoint: "vs_main" },
            fragment: { module: shader, entryPoint: fragmentEntry, targets: [{ format }] },
            primitive,
        });

    // 레벨마다 하나: 정점 버퍼만 다름
    const bindGroups = snapshots.map((buffer) =>
        device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer } },
                { binding: 1, resource: { buffer: uniformBuffer } },
                { binding: 2, resource: { buffer: settingsBuffer } },
            ],
        })
    );

    return {
        facePipeline: makePipeline("fs_main", { topology: "triangle-list", cullMode: "none" }),
        wirePipeline: makePipeline("fs_wire", { topology: "line-list" }),
        bindGroups,
    };
}


// ============================================================
// 메인
// ============================================================

async function init() {

    const canvas = document.getElementById("gpuCanvas");
    const { device, context, format } = await initGPU(canvas);

    // 데이터 로드
    const [vertices, topology] = await Promise.all([
        loadVTK(DATA_PATH.vtk),
        loadJSON(DATA_PATH.topology),
    ]);

    // 정점 버퍼 (모든 레벨이 공유하는 작업 버퍼, 최대 레벨 크기)
    // 주의: createVertexBuffer 의 usage 에 GPUBufferUsage.COPY_SRC 가 있어야 스냅샷 복사가 가능
    const levelNumbers = range(1, MAX_LEVEL);
    const levelVertexCounts = await Promise.all(
        levelNumbers.map((lv) => countVertex(topology, lv, vertices.length))
    );
    const V = levelVertexCounts[MAX_LEVEL - 1];

    const vertexBuffer = await createVertexBuffer(device, vertices, topology, MAX_LEVEL, V);

    // 레벨별 리소스
    const levels = await Promise.all(
        levelNumbers.map((lv) => createLevelResources(device, vertices, topology, lv))
    );

    // 레벨별 정점 스냅샷 (슬라이더 전환용). 마지막 레벨은 작업 버퍼를 그대로 사용
    const snapshots = levelNumbers.map((lv, i) =>
        lv === MAX_LEVEL
            ? vertexBuffer
            : device.createBuffer({
                size: levelVertexCounts[i] * 16,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            })
    );

    // UI (캔버스 크기, 색상 설정, 패널, FPS 전부 ui.js 에서 처리)
    const ui = createUI({
        device,
        canvas,
        maxLevel: MAX_LEVEL,
        levelStats: levels.map((L, i) => ({
            vertices: levelVertexCounts[i],
            triangles: Math.floor(L.render.indexCount / 3),
            edges: Math.floor(L.render.edgeIndexCount / 2),
        })),
    });

    // 렌더링 준비
    const uniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const renderer = createRenderer(device, format, uniformBuffer, ui.settings.buffer, snapshots);

    const camera = new OrbitCamera(canvas, device, uniformBuffer);
    ui.attachCamera(camera);

    // 서브디비전 실행
    runSubdivision(device, vertexBuffer, levels, snapshots, levelVertexCounts);

    // 계산이 끝나면 계산 전용 버퍼 해제 (렌더링에 쓰는 index buffer 와 정점 버퍼는 유지)
    if (FREE_COMPUTE_BUFFERS) {
        device.queue.onSubmittedWorkDone().then(() => {
            levels.forEach((L) => destroyBuffers(L.compute));
        });
    }

    // 렌더 루프
    function render() {
        const i = ui.state.displayLevel - 1;
        const { indexBuffer, indexCount, edgeIndexBuffer, edgeIndexCount } = levels[i].render;
        const bindGroup = renderer.bindGroups[i];
        const { showFaces, showWire, bgColor: [r, g, b] } = ui.settings.values;

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r, g, b, a: 1 },
                loadOp: "clear",
                storeOp: "store"
            }]
        });

        if (showFaces) {
            pass.setPipeline(renderer.facePipeline);
            pass.setBindGroup(0, bindGroup);
            pass.setIndexBuffer(indexBuffer, "uint32");
            pass.drawIndexed(indexCount);
        }

        if (showWire) {
            pass.setPipeline(renderer.wirePipeline);
            pass.setBindGroup(0, bindGroup);
            pass.setIndexBuffer(edgeIndexBuffer, "uint32");
            pass.drawIndexed(edgeIndexCount);
        }

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    function animate() {
        render();
        ui.tickFps();
        requestAnimationFrame(animate);
    }
    animate();
}

init().catch((err) => console.error("init failed:", err));