#version 300 es
precision highp float;

in vec2 SCREEN_POS;

uniform sampler2D IN_COLOR;

out vec4 color;

void main(void) {
    // vec4 fg = vec4(SCREEN_POS, 0.0, 1.0);
    vec4 fg = texture(IN_COLOR, SCREEN_POS);
    color = fg;
}
