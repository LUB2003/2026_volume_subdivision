export async function loadJSON(url) {
    const res = await fetch(url);
    return await res.json();
}


export async function loadVTK(path) {
    const response = await fetch(path);
    const text = await response.text();

    return parseVTKPoints(text);
}

export function parseVTKPoints(vtkText) {

    const lines = vtkText.split(/\r?\n/);

    let points = [];

    let start = -1;
    let count = 0;


    for (let i = 0; i < lines.length; i++) {

        const line = lines[i].trim();

        if (line.startsWith("POINTS")) {

            const tokens = line.split(/\s+/);

            count = parseInt(tokens[1]);

            start = i + 1;
            break;
        }
    }


    if (start === -1) {
        throw new Error("POINTS not found");
    }


    let values = [];


    while (values.length < count * 3) {

        const nums = lines[start]
            .trim()
            .split(/\s+/)
            .map(Number);

        values.push(...nums);

        start++;
    }


    for (let i = 0; i < count; i++) {

        points.push([
            values[i * 3],
            values[i * 3 + 1],
            values[i * 3 + 2]
        ]);
    }


    return points;
}
