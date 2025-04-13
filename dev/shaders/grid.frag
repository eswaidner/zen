#version 300 es
precision highp float;

uniform sampler2D IN_COLOR;

in vec2 SCREEN_POS;
in vec2 WORLD_POS;
in vec2 LOCAL_POS;

out vec4 OUT_COLOR;

float map(float value, float min1, float max1, float min2, float max2) {
    return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

float grid(float size, float thickness, vec2 pos) {
    vec2 grid = 1.0 - step(thickness, fract(pos * size));
    float mask = 1.0 - min(grid.x + grid.y, 1.0);
    return mask;
}

const float cellSize = 75.0;
const float worldSize = 512.0; // cells per side
const float halfWorldSize = worldSize * 0.5;

void main(void) {
    vec2 worldCoord = vec2(
            map(WORLD_POS.x, -halfWorldSize, halfWorldSize, 0.0, 1.0),
            map(WORLD_POS.y, -halfWorldSize, halfWorldSize, 0.0, 1.0)
        );

    float tileGrid = 1.0 - grid(1.0, 0.02, worldCoord.xy * worldSize);
    float chunkGrid = 1.0 - grid(1.0 / 16.0, 0.003, worldCoord.xy * worldSize);

    float grid = max(tileGrid, chunkGrid) * 0.125;
    vec4 fg = vec4(grid, grid, grid, 1.0);

    if (grid == 0.0) discard;

    // vec4 fg = vec4(SCREEN_POS, 0.0, 1.0);
    // vec4 fg = vec4(WORLD_POS, 0.0, 1.0);
    // vec4 fg = vec4(LOCAL_POS, 0.0, 1.0);
    // vec4 fg = vec4(0.0, 1.0, 0.0, 1.0);

    OUT_COLOR = fg;
}
