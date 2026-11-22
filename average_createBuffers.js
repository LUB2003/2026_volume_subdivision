export async function loadJSON(url) {
    const res = await fetch(url);
    return await res.json();
}

function flatten(data) {
    // [[x,y], [x,y] ...] → [x,y,x,y,...]
    return new Uint32Array(data.flat());
}



//average : boundary
export async function createBoundaryAverageBuffer(device, irr_topology, max_level){

    const index = []; //인덱스
    const start = []; //시작점
    const faces_idx = []; //adjacent_boundary_faces
    const count = []; //face 인덱스의 개수

    const boundary_vertices_data = irr_topology.levels[max_level].boundary_vertices;

    
    let start_temp = 0;

    start.push(start_temp);

    for(const data of boundary_vertices_data){
        index.push(data.index);

        let faceIdxLen = data.adjacent_boundary_faces.length;
        count.push(faceIdxLen);

        start_temp = start_temp + faceIdxLen; 
        start.push(start_temp);

        for(const i of data.adjacent_boundary_faces){
            faces_idx.push(i);
        }

    }


    const idxData = new Uint32Array(index);
    const startData = new Uint32Array(start); //시작점
    const countData = new Uint32Array(count); //개수
    const adjacentData = new Uint32Array(faces_idx); //n번 vertex가 포함된 face의 번호


    const BoundaryAverageData_idxData = device.createBuffer({
        size:idxData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    const BoundaryAverageData_start = device.createBuffer({
        size:startData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    const BoundaryAverageData_count = device.createBuffer({
        size:countData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    })

    const BoundaryAverageData_faceIdx = device.createBuffer({
        size:adjacentData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    device.queue.writeBuffer(BoundaryAverageData_idxData,0,idxData);
    device.queue.writeBuffer(BoundaryAverageData_start,0,startData);
    device.queue.writeBuffer(BoundaryAverageData_count,0,countData)
    device.queue.writeBuffer(BoundaryAverageData_faceIdx,0,adjacentData);

    return{
        BoundaryAverageData_idxData,
        BoundaryAverageData_start,
        BoundaryAverageData_count,
        BoundaryAverageData_faceIdx
    }
}

//최종 level에서의 계산된 face에 대한 정보를 받아 중점 계산
//최종 결과에서의 face의 중점을 또 구해야 하기 때문에 필요하다
export async function createMaxFaceBuffer(device, irr_topology, max_level){
    const faces = flatten(irr_topology.levels[max_level].faces);
    const faceCount = irr_topology.levels[max_level].faces.length;

    const MaxFaceBuffer = device.createBuffer({
        size : faces.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    device.queue.writeBuffer(MaxFaceBuffer, 0, faces);

    const FaceCenteryBuffer = device.createBuffer({
        size : 16*faceCount,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    
    return { MaxFaceBuffer, FaceCenteryBuffer };
}


//average
export async function createAverageBuffer(device, irr_topology, max_level){

    const index = []; //인덱스
    const start = []; //시작점
    const cells_idx = []; //adjacent_boundary_cells
    const count = []; //cell 인덱스의 개수

    const vertices_data = irr_topology.levels[max_level].internal_vertices;

    
    let start_temp = 0;

    start.push(start_temp);

    for(const data of vertices_data){
        index.push(data.index);

        let cellIdxLen = data.adjacent_cells.length;
        count.push(cellIdxLen);

        start_temp = start_temp + cellIdxLen; 
        start.push(start_temp);

        for(const i of data.adjacent_cells){
            cells_idx.push(i);
        }

    }


    const idxData = new Uint32Array(index);
    const startData = new Uint32Array(start); //시작점
    const countData = new Uint32Array(count); //개수
    const adjacentData = new Uint32Array(cells_idx); //n번 vertex가 포함된 cell의 번호


    const AverageData_idxData = device.createBuffer({
        size:idxData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    const AverageData_start = device.createBuffer({
        size:startData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    const AverageData_count = device.createBuffer({
        size:countData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    })

    const AverageData_cellIdx = device.createBuffer({
        size:adjacentData.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    device.queue.writeBuffer(AverageData_idxData,0,idxData);
    device.queue.writeBuffer(AverageData_start,0,startData);
    device.queue.writeBuffer(AverageData_count,0,countData)
    device.queue.writeBuffer(AverageData_cellIdx,0,adjacentData);

    return{
        AverageData_idxData,
        AverageData_start,
        AverageData_count,
        AverageData_cellIdx
    }
}

//최종 level에서의 계산된 cell에 대한 정보를 받아 중점 계산
//최종 결과에서의 cell의 중점을 또 구해야 하기 때문에 필요하다
export async function createMaxCellBuffer(device, irr_topology, max_level){
    const cells = flatten(irr_topology.levels[max_level].cells);
    const cellCount = irr_topology.levels[max_level].cells.length;

    const MaxCellBuffer = device.createBuffer({
        size : cells.byteLength,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    device.queue.writeBuffer(MaxCellBuffer, 0, cells);

    const CellCenteryBuffer = device.createBuffer({
        size : 16*cellCount,
        usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    
    return { MaxCellBuffer, CellCenteryBuffer };
}