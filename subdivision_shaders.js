export function subdiv_edge(device, pass, lv0_vertex_buffer, edge_buffer, level_buffer){
    const module = device.createShaderModule({
        lable : "edge subdivision",
        code : `
            struct LevelInfo {
                vertexCount : u32,
                edgeCount : u32,
                faceCount : u32,
                cellCount : u32,
            };
        
            @group(0) @binding(0) var<storage, read> levelInfo : LevelInfo;
            @group(0) @binding(1) var<storage, read> edges : array<u32>;
            @group(0) @binding(2) var<storage, read_write> vertices : array<vec4f>;
            
            @compute @workgroup_size(64)
            fn cs(@builtin(global_invocation_id) id : vec3<u32>) {
        
            let edgeId = id.x;
        
        
            if (edgeId >= levelInfo.edgeCount) {
                return;
            }
        
            let v0 = edges[edgeId * 2];
            let v1 = edges[edgeId * 2 + 1];
        
            let p0 = vertices[v0];
            let p1 = vertices[v1];
        
            let mid = ((p0 + p1) * 0.5);
        
            let base = levelInfo.vertexCount;
        
            vertices[base + edgeId] = vec4f(mid.xyz, 1.0);
            }`
    })

    const edgeSubdivisionPipeline = device.createComputePipeline({
        label : 'edgeSubdivPipeline',
        layout : 'auto',
        compute : { module : module },
    });

    const edgeSubdivisionBindGroup = device.createBindGroup({
        label : 'edgeSubdivBindGroup',
        layout : edgeSubdivisionPipeline.getBindGroupLayout(0),
        entries : [
            {binding : 0, resource : level_buffer},
            {binding : 1, resource : edge_buffer},
            {binding : 2, resource : lv0_vertex_buffer},
        ],
    })
    pass.setPipeline(edgeSubdivisionPipeline);
    pass.setBindGroup(0, edgeSubdivisionBindGroup);
    pass.dispatchWorkgroups(64)
    pass.end();

}


export function subdiv_face(device, pass, lv0_vertex_buffer, face_buffer, level_buffer){
    const module = device.createShaderModule({
        lable : "face subdivision",
        code : `
            struct LevelInfo {
                vertexCount : u32,
                edgeCount : u32,
                faceCount : u32,
                cellCount : u32,
            };
        
            @group(0) @binding(0) var<storage, read> levelInfo : LevelInfo;
            @group(0) @binding(1) var<storage, read> faces : array<u32>;
            @group(0) @binding(2) var<storage, read_write> vertices : array<vec4f>;
            
            @compute @workgroup_size(64)
            fn cs(@builtin(global_invocation_id) global_id : vec3<u32>) {
        
            let faceId = global_id.x;

            if (faceId >= levelInfo.faceCount) {
                return;
            }
        
        
            let v0 = faces[faceId * 4];
            let v1 = faces[faceId * 4 + 1];
            let v2 = faces[faceId * 4 + 2];
            let v3 = faces[faceId * 4 + 3];
        
            let p0 = vertices[v0];
            let p1 = vertices[v1];
            let p2 = vertices[v2];
            let p3 = vertices[v3];
        
            let mid = ((p0 + p1 + p2 + p3) * 0.25);
        
            let base = levelInfo.vertexCount+levelInfo.edgeCount;
        
            vertices[base + faceId] = vec4f(mid.xyz, 1.0);
            }`
    })

    const faceSubdivisionPipeline = device.createComputePipeline({
        label : 'faceSubdivPipeline',
        layout : 'auto',
        compute : { module : module },
    });

    const faceSubdivisionBindGroup = device.createBindGroup({
        label : 'faceSubdivBindGroup',
        layout : faceSubdivisionPipeline.getBindGroupLayout(0),
        entries : [
            {binding : 0, resource : level_buffer},
            {binding : 1, resource : face_buffer},
            {binding : 2, resource : lv0_vertex_buffer},
        ],
    })

    pass.setPipeline(faceSubdivisionPipeline);
    pass.setBindGroup(0, faceSubdivisionBindGroup);
    pass.dispatchWorkgroups(64)
    pass.end();

}

export function subdiv_cell(device, pass, lv0_vertex_buffer, cell_buffer, level_buffer){
    const module = device.createShaderModule({
        lable : "cell subdivision",
        code : `
            struct LevelInfo {
                vertexCount : u32,
                edgeCount : u32,
                faceCount : u32,
                cellCount : u32,
            };
        
            @group(0) @binding(0) var<storage, read> levelInfo : LevelInfo;
            @group(0) @binding(1) var<storage, read> cells : array<u32>;
            @group(0) @binding(2) var<storage, read_write> vertices : array<vec4f>;
            
            @compute @workgroup_size(64)
            fn cs(@builtin(global_invocation_id) global_id : vec3<u32>) {
        
            let cellId = global_id.x;
        
        
            let v0 = cells[cellId * 8];
            let v1 = cells[cellId * 8 + 1];
            let v2 = cells[cellId * 8 + 2];
            let v3 = cells[cellId * 8 + 3];
            let v4 = cells[cellId * 8 + 4];
            let v5 = cells[cellId * 8 + 5];
            let v6 = cells[cellId * 8 + 6];
            let v7 = cells[cellId * 8 + 7];
        
            let p0 = vertices[v0];
            let p1 = vertices[v1];
            let p2 = vertices[v2];
            let p3 = vertices[v3];
            let p4 = vertices[v4];
            let p5 = vertices[v5];
            let p6 = vertices[v6];
            let p7 = vertices[v7];
        
            let mid = ((p0 + p1 + p2 + p3 + p4 + p5 + p6 + p7) * 0.125);
        
            let base = levelInfo.vertexCount+levelInfo.edgeCount+levelInfo.faceCount;
        
            vertices[base + cellId] = vec4f(mid.xyz, 1.0);
            }`
    })

    const cellSubdivisionPipeline = device.createComputePipeline({
        label : 'cellSubdivPipeline',
        layout : 'auto',
        compute : { module : module },
    });

    const cellSubdivisionBindGroup = device.createBindGroup({
        label : 'cellSubdivBindGroup',
        layout : cellSubdivisionPipeline.getBindGroupLayout(0),
        entries : [
            {binding : 0, resource : level_buffer},
            {binding : 1, resource : cell_buffer},
            {binding : 2, resource : lv0_vertex_buffer},
        ],
    })

    pass.setPipeline(cellSubdivisionPipeline);
    pass.setBindGroup(0, cellSubdivisionBindGroup);
    pass.dispatchWorkgroups(64)
    pass.end();
}

