export async function loadJSON(url) {
    const res = await fetch(url);
    return await res.json();
}

function flatten(data) {
    // [[x,y], [x,y] ...] → [x,y,x,y,...]
    return new Uint32Array(data.flat());
}

//vertex buffer 크기 구하는 용도
export async function countVertex(irr_topology, lv, vertexCount) {
    let V = vertexCount;

    for(let i=1 ; i<= lv ; i++){
        const level = irr_topology.levels[i - 1];
        V = V+ level.edges.length + level.faces.length + level.cells.length
    }
    return V;
}

//Uniform
//레벨별로 [기존 vertex 수 / edge point 수 / face point 수 / cell point 수] 넘김
export async function createLevelInfoBuffer(device, vertices, irr_topology, lv) {
    let V = vertices.length;
    
    for(let i=1 ; i< lv ; i++){
        const level = irr_topology.levels[i - 1];
        V =V+ level.edges.length + level.faces.length + level.cells.length
    }
    
    const max_level = irr_topology.levels[lv - 1];
    const E = max_level.edges.length;
    const F = max_level.faces.length;
    const C = max_level.cells.length;


    const levelInfo = new Uint32Array([V, E, F, C]);

    const levelInfoBuffer = device.createBuffer({
        size: levelInfo.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    console.log(levelInfo);
    device.queue.writeBuffer(levelInfoBuffer, 0, levelInfo);
    return levelInfoBuffer;
}
    


export async function createVertexBuffer(device, vertices, irr_topology, max_lv, V) {
    // =========================
    // 2. Vertex buffer (FIXED: vec4 align)
    // =========================
    const paddedVertices = new Float32Array(vertices.length * 4);

    for (let i = 0; i < vertices.length; i++) {
        paddedVertices[i * 4 + 0] = vertices[i][0];
        paddedVertices[i * 4 + 1] = vertices[i][1];
        paddedVertices[i * 4 + 2] = vertices[i][2];
        paddedVertices[i * 4 + 3] = 1.0;
    }

    const count = Number(V);
    
    console.log(typeof(count));
    const vertexBuffer = device.createBuffer({
        size: count * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    device.queue.writeBuffer(vertexBuffer, 0, paddedVertices);

    return vertexBuffer;
}


//edge point 계산을 위한 데이터를 담음
//irregular_topology.json 기반
export async function createEdgeBuffer(device, irr_topology, level){
    const edges = flatten(irr_topology.levels[level-1].edges);

    const edgeBuffer = device.createBuffer({
        size : edges.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    device.queue.writeBuffer(edgeBuffer, 0, edges);

    return edgeBuffer;
}


//face point 계산을 위한 데이터를 담음
//irregular_topology.json 기반
export async function createFaceBuffer(device, irr_topology, level){
    const faces = flatten(irr_topology.levels[level-1].faces);

    const faceBuffer = device.createBuffer({
        size : faces.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    device.queue.writeBuffer(faceBuffer, 0, faces);

    return faceBuffer;
}


//cell point 계산을 위한 데이터를 담음
//irregular_topology.json 기반
export async function createCellBuffer(device, irr_topology, level){
    const cells = flatten(irr_topology.levels[level-1].cells);

    const cellBuffer = device.createBuffer({
        size : cells.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    console.log(cells);
    device.queue.writeBuffer(cellBuffer, 0, cells);

    return cellBuffer;
}


//index buffer 생성
//irregular_topology.json의 max level의 face 데이터 사용
export async function createIndexBuffer(device, irr_topology, max_level){

    const indices = [];

    for(let i=1 ; i<=max_level ; i++){
        const faces = irr_topology.levels[i].faces;

        for(const face of faces){

            const v0 = face[0];
            const v1 = face[1];
            const v2 = face[2];
            const v3 = face[3];

            // triangle 1
            indices.push(v0,v1,v2);

            // triangle 2
            indices.push(v0,v2,v3);
        }
    }

    const indexData = new Uint32Array(indices);
    const indexBuffer = device.createBuffer({
        size: indexData.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});

    device.queue.writeBuffer(
        indexBuffer,
        0,
        indexData
    );

    return {
        indexBuffer,
        indexCount:indexData.length
    };
}

export async function createEdgeIndexBuffer(device, irr_topology, max_level){

    const indices = [];
    
    for(let i=0 ; i<=max_level ; i++){
        const edges = irr_topology.levels[i].edges;

        for(const edge of edges){
            indices.push(edge[0], edge[1]);
        }
    }

    const data = new Uint32Array(indices);
    console.log(data)

    const buffer = device.createBuffer({
        size:data.byteLength,
        usage:
            GPUBufferUsage.INDEX |
            GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(buffer,0,data);

    return {
        indexBuffer:buffer,
        indexCount:data.length
    };
}

