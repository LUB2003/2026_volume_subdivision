// 항목 수(count)에 맞춰 1D 작업을 dispatch (한 차원 65535 workgroup 한계를 넘으면 2D로 분할)
// 셰이더에서는 num_workgroups 로 인덱스를 복원한다.
const WG_SIZE = 64;
const MAX_DIM = 65535;

function dispatch1D(pass, count) {
    const groups = Math.max(1, Math.ceil(count / WG_SIZE));
    pass.dispatchWorkgroups(
        Math.min(groups, MAX_DIM),
        Math.ceil(groups / MAX_DIM),
        1
    );
}


// average를 위한 face 중점 계산 쉐이더
// pass.end() 는 호출하는 쪽(main.js)에서 한다.
export function maxLevelFaceCentery(device, pass, vertexBuffer, MaxFaceBuffer, FaceCenteryBuffer) {
    const module = device.createShaderModule({
        label: "face centery",
        code: `
            @group(0) @binding(0) var<storage, read> faces : array<u32>;
            @group(0) @binding(1) var<storage, read_write> faceCentery : array<vec4f>;
            @group(0) @binding(2) var<storage, read_write> vertices : array<vec4f>;

            @compute @workgroup_size(64)
            fn cs(
                @builtin(global_invocation_id) gid : vec3<u32>,
                @builtin(num_workgroups) nwg : vec3<u32>
            ) {
                let id = gid.y * (nwg.x * 64u) + gid.x;
                if (id >= arrayLength(&faceCentery)) { return; }

                let v0 = faces[id * 4u];
                let v1 = faces[id * 4u + 1u];
                let v2 = faces[id * 4u + 2u];
                let v3 = faces[id * 4u + 3u];

                let mid = (vertices[v0] + vertices[v1] + vertices[v2] + vertices[v3]) * 0.25;

                faceCentery[id] = vec4f(mid.xyz, 1.0);
            }`
    });

    const pipeline = device.createComputePipeline({
        label: 'face centery pipeline',
        layout: 'auto',
        compute: { module },
    });

    const bindGroup = device.createBindGroup({
        label: 'face centery BindGroup',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: MaxFaceBuffer } },
            { binding: 1, resource: { buffer: FaceCenteryBuffer } },
            { binding: 2, resource: { buffer: vertexBuffer } },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    dispatch1D(pass, FaceCenteryBuffer.size / 16);   // face 개수
}


// boundary average
export function boundaryAverage(device, pass,
    BoundaryAverageData_idxData,
    BoundaryAverageData_start,
    BoundaryAverageData_count,
    BoundaryAverageData_faceIdx,
    maxLevelFaceCentery,
    vertexBuffer) {

    const module = device.createShaderModule({
        label: "boundary average",
        code: `
            @group(0) @binding(0) var<storage, read> idxData : array<u32>;
            @group(0) @binding(1) var<storage, read> startData : array<u32>;
            @group(0) @binding(2) var<storage, read> countData : array<u32>;
            @group(0) @binding(3) var<storage, read> faceIdxData : array<u32>;
            @group(0) @binding(4) var<storage, read> faceCentery : array<vec4f>;
            @group(0) @binding(5) var<storage, read_write> vertices : array<vec4f>;

            @compute @workgroup_size(64)
            fn cs(
                @builtin(global_invocation_id) gid : vec3<u32>,
                @builtin(num_workgroups) nwg : vec3<u32>
            ) {
                let id = gid.y * (nwg.x * 64u) + gid.x;

                // 기준: boundary 정점 개수 (vertices 전체 크기가 아님)
                if (id >= arrayLength(&idxData)) { return; }

                let start = startData[id];
                let count = countData[id];

                // 인접 face가 없으면 건드리지 않음 (0 나누기 방지)
                if (count == 0u) { return; }

                var sum = vec4f(0.0);
                for (var i: u32 = start; i < start + count; i = i + 1u) {
                    sum = sum + faceCentery[faceIdxData[i]];
                }
                sum = sum / f32(count);

                vertices[idxData[id]] = vec4f(sum.xyz, 1.0);
            }
        `
    });

    const pipeline = device.createComputePipeline({
        label: 'boundaryAveragePipeline',
        layout: 'auto',
        compute: { module },
    });

    const bindGroup = device.createBindGroup({
        label: 'boundaryAverageBindGroup',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: BoundaryAverageData_idxData } },
            { binding: 1, resource: { buffer: BoundaryAverageData_start } },
            { binding: 2, resource: { buffer: BoundaryAverageData_count } },
            { binding: 3, resource: { buffer: BoundaryAverageData_faceIdx } },
            { binding: 4, resource: { buffer: maxLevelFaceCentery } },
            { binding: 5, resource: { buffer: vertexBuffer } },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    dispatch1D(pass, BoundaryAverageData_idxData.size / 4);   // boundary 정점 개수
}


// average를 위한 cell 중점 계산 쉐이더
export function maxLevelCellCentery(device, pass, vertexBuffer, MaxCellBuffer, CellCenteryBuffer) {
    const module = device.createShaderModule({
        label: "cell centery",
        code: `
            @group(0) @binding(0) var<storage, read> cells : array<u32>;
            @group(0) @binding(1) var<storage, read_write> cellCentery : array<vec4f>;
            @group(0) @binding(2) var<storage, read_write> vertices : array<vec4f>;

            @compute @workgroup_size(64)
            fn cs(
                @builtin(global_invocation_id) gid : vec3<u32>,
                @builtin(num_workgroups) nwg : vec3<u32>
            ) {
                let id = gid.y * (nwg.x * 64u) + gid.x;
                if (id >= arrayLength(&cellCentery)) { return; }

                var sum = vec4f(0.0);
                for (var k: u32 = 0u; k < 8u; k = k + 1u) {
                    sum = sum + vertices[cells[id * 8u + k]];
                }
                let mid = sum * 0.125;

                cellCentery[id] = vec4f(mid.xyz, 1.0);
            }`
    });

    const pipeline = device.createComputePipeline({
        label: 'cell centery pipeline',
        layout: 'auto',
        compute: { module },
    });

    const bindGroup = device.createBindGroup({
        label: 'cell centery BindGroup',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: MaxCellBuffer } },
            { binding: 1, resource: { buffer: CellCenteryBuffer } },
            { binding: 2, resource: { buffer: vertexBuffer } },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    dispatch1D(pass, CellCenteryBuffer.size / 16);   // cell 개수 (셀당 vec4 하나)
}


// vertex average
export function vertexAverage(device, pass,
    AverageData_idxData,
    AverageData_start,
    AverageData_count,
    AverageData_cellIdx,
    maxLevelCellCentery,
    vertexBuffer) {

    const module = device.createShaderModule({
        label: "vertex average",
        code: `
            @group(0) @binding(0) var<storage, read> idxData : array<u32>;
            @group(0) @binding(1) var<storage, read> startData : array<u32>;
            @group(0) @binding(2) var<storage, read> countData : array<u32>;
            @group(0) @binding(3) var<storage, read> cellIdxData : array<u32>;
            @group(0) @binding(4) var<storage, read> cellCentery : array<vec4f>;
            @group(0) @binding(5) var<storage, read_write> vertices : array<vec4f>;

            @compute @workgroup_size(64)
            fn cs(
                @builtin(global_invocation_id) gid : vec3<u32>,
                @builtin(num_workgroups) nwg : vec3<u32>
            ) {
                let id = gid.y * (nwg.x * 64u) + gid.x;

                // 기준: internal 정점 개수 (vertices 전체 크기가 아님)
                if (id >= arrayLength(&idxData)) { return; }

                let start = startData[id];
                let count = countData[id];

                if (count == 0u) { return; }

                var sum = vec4f(0.0);
                for (var i: u32 = start; i < start + count; i = i + 1u) {
                    sum = sum + cellCentery[cellIdxData[i]];
                }
                sum = sum / f32(count);

                vertices[idxData[id]] = vec4f(sum.xyz, 1.0);
            }
        `
    });

    const pipeline = device.createComputePipeline({
        label: 'vertexAveragePipeline',
        layout: 'auto',
        compute: { module },
    });

    const bindGroup = device.createBindGroup({
        label: 'vertexAverageBindGroup',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: AverageData_idxData } },
            { binding: 1, resource: { buffer: AverageData_start } },
            { binding: 2, resource: { buffer: AverageData_count } },
            { binding: 3, resource: { buffer: AverageData_cellIdx } },
            { binding: 4, resource: { buffer: maxLevelCellCentery } },
            { binding: 5, resource: { buffer: vertexBuffer } },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    dispatch1D(pass, AverageData_idxData.size / 4);   // internal 정점 개수
}