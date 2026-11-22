# irregular_topology.json 구조 설명

`irregular_topology.json`은 runtime viewer가 level별 subdivision 좌표를 계산하기 위해 읽는 topology/operator 파일이다. 이 파일에는 vertex 좌표가 없으며, 런타임은 `original.vtk`의 level 0 좌표와 이 파일의 topology를 결합해 좌표를 계산한다.

## 런타임 입력의 역할

| 파일 | 역할 |
|---|---|
| `original.vtk` | level 0 vertex 좌표와 level 0 cell connectivity를 제공한다. |
| `irregular_topology.json` | level별 topology, vertex update rule, regular/residual 분류를 제공한다. |
| `patch.json` | regular 영역의 tri-cubic B-spline patch surface를 샘플링하는 데 필요한 patch point index를 제공한다. |

## Root 구조

```json
{
  "schema": "runtime_irregular_topology_v3",
  "mesh_type": "hex",
  "max_level": 3,
  "boundary_mode": "surface",
  "levels": [],
  "regular_render": {}
}
```

| 항목 | 의미 |
|---|---|
| `schema` | runtime topology 포맷 식별자다. |
| `mesh_type` | cell row가 hexahedral cell 기준임을 나타낸다. 현재 값은 `hex`다. |
| `max_level` | 파일에 포함된 최대 subdivision level이다. |
| `boundary_mode` | boundary vertex의 좌표 update 방식이다. `surface` 또는 `ignore`다. |
| `levels` | level별 topology/operator record 배열이다. |
| `regular_render` | regular patch surface의 샘플링 설정이다. `kind`와 `max_patch_resolution`을 가진다. |

## Level record 구조

각 `levels[i]`는 해당 level의 topology와 vertex update group을 가진다. 항목 순서는 아래와 같이 고정한다.

```json
{
  "level": 1,
  "edges": [],
  "faces": [],
  "cells": [],
  "boundary_face_indices": [],
  "internal_vertices": [],
  "boundary_vertices": [],
  "cell_regular": []
}
```

### Topology

| 항목 | row 형식 | 의미 |
|---|---|---|
| `level` | integer | 현재 subdivision level 번호다. |
| `edges` | `[v0, v1]` | 이 level의 unique edge 목록이다. |
| `faces` | `[v0, v1, v2, v3]` | boundary와 interior를 모두 포함하는 unique quad face 목록이다. |
| `cells` | `[v0, v1, v2, v3, v4, v5, v6, v7]` | 이 level의 hexahedral cell 목록이다. |
| `boundary_face_indices` | `faces` index | `faces` 중 boundary face만 가리키는 index 목록이다. |

`faces[boundary_face_indices[i]]`로 i번째 boundary face의 구성 정점을 얻는다. `edges`, `faces`, `cells`는 현재 level의 display topology이면서 다음 level 정점 생성에 사용할 parent entity를 유도하는 입력이다.

### Subdivision entity 유도

새 정점 생성에 별도 source 배열이나 point-count 필드는 사용하지 않는다. `Lk+1.cells` 안에 동일한 connectivity로 남아 있는 `Lk.cells`는 subdivision되지 않고 carry된 cell이다. 반대로 `Lk+1.cells`에 남아 있지 않은 `Lk.cells`가 subdivision 대상이다.

런타임은 다음 순서로 parent entity를 유도한다.

1. `Lk.cells` 중 `Lk+1.cells`에 동일한 row가 없는 cell의 index를 선택한다.
2. 선택된 cell을 구성하는 `Lk.edges`와 `Lk.faces`의 index를 수집한다.
3. edge index와 face index를 오름차순으로 정렬하고, 선택 cell index는 원래 `cells` 순서를 유지한다.
4. 선택된 edge, face, cell의 구성 vertex 좌표 평균으로 Lk+1의 임시 정점을 만든다.

이 유도 결과의 개수는 곧 edge point, face point, cell point의 개수다. `Lk+1`의 새 정점 index는 이전 level point 수를 `start`라고 할 때 다음처럼 정해진다.

| 생성 종류 | output vertex index |
|---|---|
| 선택 edge의 local index `i` | `start + i` |
| 선택 face의 local index `i` | `start + selectedEdgeCount + i` |
| 선택 cell의 local index `i` | `start + selectedEdgeCount + selectedFaceCount + i` |

따라서 source 목록과 개수는 topology에서 재구성 가능하며 JSON에 중복 저장하지 않는다.

### internal_vertices

`internal_vertices`는 boundary가 아닌 모든 vertex의 update rule 배열이다.

```json
"internal_vertices": [
  {
    "index": 42,
    "adjacent_cells": [3, 8, 9, 14]
  }
]
```

| 항목 | 의미 |
|---|---|
| `index` | update할 현재 level vertex index다. |
| `adjacent_cells` | 해당 vertex의 좌표를 update할 때 평균할 현재 level `cells` index 목록이다. |

### boundary_vertices

`boundary_vertices`는 boundary 위의 모든 vertex의 update rule 배열이다.

```json
"boundary_vertices": [
  {
    "index": 7,
    "adjacent_boundary_faces": [0, 2, 5]
  }
]
```

| 항목 | 의미 |
|---|---|
| `index` | update할 현재 level boundary vertex index다. |
| `adjacent_boundary_faces` | 해당 vertex의 좌표를 update할 때 사용할 현재 level `faces`의 boundary face index 목록이다. |

`internal_vertices`와 `boundary_vertices`는 중복 없이 모든 current level vertex를 정확히 한 번씩 포함한다.

`boundary_mode == "surface"`이면 boundary vertex는 `adjacent_boundary_faces`의 face centroid 평균으로 update한다. `boundary_mode == "ignore"`이면 현재 level `cells`에서 해당 vertex를 포함하는 cell을 찾아 그 cell centroid 평균으로 update한다.

### cell_regular

`cell_regular`은 `cells`와 같은 길이를 가지며, 각 cell의 렌더링 경로를 지정한다.

```json
"cell_regular": [-1, -1, 2, 2]
```

| 값 | 의미 |
|---|---|
| `-1` | irregular/residual cell이다. runtime viewer가 topology 기반 residual mesh로 표시한다. |
| `0` 이상 | regular cell이다. 값은 cell이 regular chunk로 marking된 source level이다. `patch.json`의 B-spline patch surface로 표시한다. |

## 런타임 좌표 계산 순서

1. `original.vtk`에서 level 0 point 좌표와 cell connectivity를 읽는다.
2. VTK의 level 0 cell connectivity가 `levels[0].cells`와 일치하는지 확인한다.
3. target level까지 반복하며, 이전 level 좌표를 child point 배열의 기존 vertex 구간에 복사한다.
4. parent/child `cells` 비교로 subdivision 대상 cell과 그 edge/face를 유도한다.
5. 선택 edge, face, cell의 parent vertex 좌표 평균으로 child level 임시 정점을 만든다.
6. child level `cells`와 `faces`로 cell centroid 및 face centroid를 계산한다.
7. `internal_vertices`와 `boundary_vertices`의 index별 rule을 적용해 모든 child vertex 좌표를 update한다.
8. 계산된 좌표로 regular patch surface와 irregular/residual mesh를 렌더링한다.

모든 level 좌표는 위 절차로 브라우저에서 계산된다. `irregular_topology.json`에는 어떤 level의 vertex 좌표도 포함하지 않는다.
