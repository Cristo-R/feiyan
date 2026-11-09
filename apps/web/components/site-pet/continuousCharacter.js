import { petAssetUrl } from './petAssets';
import { loadPetAsset } from './petAssetLoader';

const QUAD = [[386, 498], [470, 548], [420, 855], [190, 822]];
const REST = [[386, 498], [450, 740], [420, 940], [190, 875]];
const WRIST = [448, 588];

export const REST_GESTURE = {
  head: 0, body: 0, x: 0, y: 0, hair: 0, squash: 0, relaxed: 0, smile: 0,
  left: [0, 0, 0], right: [0, 0, 0], pivot: [516, 650],
};

export async function loadAssets({ interactions = false } = {}) {
  const names = ['body', 'skirt', 'boots', 'seated', 'sleeve-left', 'sleeve-right', 'hand-left', 'hand-right', 'eyes-closed'];
  if (interactions) names.push('hand-relaxed-left', 'hand-relaxed-right', 'mouth-smile');
  const images = await Promise.all(names.map(async name => {
    const folder = name.startsWith('hand-relaxed') || name === 'mouth-smile' ? 'pet-preview/interactions/assets/' : 'pet-preview/gather/assets/';
    const image = await loadPetAsset(petAssetUrl(`${folder}${name}.webp`));
    return [name, image];
  }));
  return Object.fromEntries(images);
}

export function createCharacter(canvas, images) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) throw new Error('当前浏览器无法创建 WebGL 画布');
  const program = makeProgram(gl);
  gl.useProgram(program);
  const positions = gl.getAttribLocation(program, 'a_position');
  const restPositions = gl.getAttribLocation(program, 'a_rest');
  const reachWeights = gl.getAttribLocation(program, 'a_reachWeight');
  gl.enableVertexAttribArray(positions);
  gl.enableVertexAttribArray(restPositions);
  gl.enableVertexAttribArray(reachWeights);
  const uniforms = Object.fromEntries(['raise', 'sleeve', 'close', 'lift', 'seat', 'time', 'kind', 'side', 'wrist', 'restWrist', 'opacity', 'head', 'body', 'shift', 'hair', 'squash', 'reach', 'pivot'].map(name => [name, gl.getUniformLocation(program, `u_${name}`)]));
  const sourceWristUV = quadCoordinates(QUAD, WRIST);
  const restWrist = bilinear(REST, ...sourceWristUV);
  const [wu, wv] = quadCoordinates(QUAD, [426, 617]);
  const cuffWeight = wu * (1 - wv) + .6 * wu * wv + .25 * (1 - wu) * wv;
  const full = [[0, 0], [1024, 0], [1024, 1024], [0, 1024]];
  const layers = [
    ['boots', 5, 0, full, full],
    ['skirt', 3, 0, full, full],
    ['seated', 4, 0, full, full],
    ['body', 0, 0, full, full],
    ['sleeve-left', 1, -1, QUAD, REST],
    ['sleeve-right', 1, 1, mirror(QUAD), mirror(REST)],
    ['hand-left', 2, -1, full, full],
    ['hand-right', 2, 1, full, full],
    ['eyes-closed', 0, 0, full, full],
    ...(images['hand-relaxed-left'] ? [
      ['hand-relaxed-left', 2, -1, full, full],
      ['hand-relaxed-right', 2, 1, full, full],
      ['mouth-smile', 7, 0, full, full],
    ] : []),
  ].map(([name, kind, side, source, rest]) => {
    const vertices = [];
    const steps = kind === 2 ? 1 : 24;
    for (let y = 0; y < steps; y++) {
      for (let x = 0; x < steps; x++) {
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]]) {
          const u = (x + dx) / steps, v = (y + dy) / steps;
          const reachWeight = kind === 1 ? Math.min(1, (u * (1 - v) + .6 * u * v + .25 * (1 - u) * v) / cuffWeight) : 0;
          vertices.push(...bilinear(source, u, v), ...bilinear(rest, u, v), reachWeight);
        }
      }
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[name]);
    return { name, kind, side, buffer, texture, count: vertices.length / 5 };
  });
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  return {
    draw(state, time, gesture = REST_GESTURE) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uniforms.raise, state.raise);
      gl.uniform1f(uniforms.sleeve, state.sleeve);
      gl.uniform1f(uniforms.close, state.close);
      gl.uniform1f(uniforms.lift, state.lift);
      gl.uniform1f(uniforms.seat, state.seat);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.head, gesture.head);
      gl.uniform1f(uniforms.body, gesture.body);
      gl.uniform1f(uniforms.hair, gesture.hair);
      gl.uniform1f(uniforms.squash, gesture.squash);
      gl.uniform2f(uniforms.shift, gesture.x, gesture.y);
      gl.uniform2f(uniforms.pivot, ...gesture.pivot);
      for (const layer of layers) {
        gl.uniform1f(uniforms.kind, layer.kind);
        gl.uniform1f(uniforms.side, layer.side);
        const seatedReveal = smooth(.28, .78, state.seat);
        let opacity = layer.name === 'eyes-closed' ? state.close : layer.kind === 4 ? seatedReveal : layer.kind === 3 ? 1 - seatedReveal : layer.kind === 5 ? 1 - smooth(.15, .65, state.seat) : 1;
        if (layer.name === 'hand-left' || layer.name === 'hand-right') opacity *= 1 - gesture.relaxed;
        if (layer.name.startsWith('hand-relaxed')) opacity *= gesture.relaxed;
        if (layer.name === 'mouth-smile') opacity = gesture.smile;
        gl.uniform1f(uniforms.opacity, opacity);
        gl.uniform3f(uniforms.reach, ...(layer.side < 0 ? gesture.left : gesture.right));
        gl.uniform2f(uniforms.wrist, layer.side > 0 ? 1032 - WRIST[0] : WRIST[0], WRIST[1]);
        gl.uniform2f(uniforms.restWrist, layer.side > 0 ? 1032 - restWrist[0] : restWrist[0], restWrist[1]);
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
        gl.vertexAttribPointer(positions, 2, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(restPositions, 2, gl.FLOAT, false, 20, 8);
        gl.vertexAttribPointer(reachWeights, 1, gl.FLOAT, false, 20, 16);
        gl.bindTexture(gl.TEXTURE_2D, layer.texture);
        gl.drawArrays(gl.TRIANGLES, 0, layer.count);
      }
    },
    wristAt(raise, side) {
      const arc = Math.sin(Math.PI * raise);
      return [(side > 0 ? 1032 - mix(restWrist[0], WRIST[0], raise) : mix(restWrist[0], WRIST[0], raise)) + side * 64 * arc, mix(restWrist[1], WRIST[1], raise) - 20 * arc];
    },
  };
}

function makeProgram(gl) {
  const vertex = `
    attribute vec2 a_position, a_rest;
    attribute float a_reachWeight;
    varying vec2 v_uv;
    uniform float u_raise, u_sleeve, u_close, u_lift, u_seat, u_time, u_kind, u_side;
    uniform vec2 u_wrist, u_restWrist, u_shift, u_pivot;
    uniform vec3 u_reach;
    uniform float u_head, u_body, u_hair, u_squash;
    void main() {
      vec2 p = a_position;
      v_uv = a_position / 1024.0;
      if (u_kind == 1.0) {
        p = mix(a_rest, a_position, u_raise);
        p += (a_position-a_rest) * (u_sleeve-u_raise) * smoothstep(620.0,850.0,a_position.y);
        float cuff = smoothstep(520.0,565.0,a_position.y)*(1.0-smoothstep(630.0,820.0,a_position.y));
        p += vec2(u_side*64.0,-20.0)*sin(3.14159265*u_raise)*cuff;
      }
      if (u_kind == 1.0) {
        p += u_reach.xy * a_reachWeight;
      }
      if (u_kind == 2.0) {
        float angle = -u_side * 2.48 * (1.0 - u_raise) + u_reach.z;
        float c = cos(angle), s = sin(angle);
        vec2 d = p - u_wrist;
        p = mix(u_restWrist, u_wrist, u_raise) + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
        p += vec2(u_side*64.0,-20.0)*sin(3.14159265*u_raise) + u_reach.xy;
      }
      if (u_kind == 3.0) {
        float below = smoothstep(642.0, 900.0, p.y);
        p.x = 516.0 + (p.x-516.0)*(1.0+u_seat*.55*below);
        p.y -= u_seat*75.0*below;
      }
      if (u_kind == 4.0) {
        float below = smoothstep(642.0, 890.0, p.y);
        p.x = 516.0 + (p.x-516.0)*(1.0-(1.0-u_seat)*.46*below);
        p.y += (1.0-u_seat)*35.0*below;
      }
      if (u_kind == 5.0) {
        float side = p.x < 516.0 ? -1.0 : 1.0;
        p.x += side*u_seat*62.0;
        p.y -= u_seat*150.0;
      }
      if (u_kind == 0.0 || u_kind == 7.0) {
        float head = 1.0 - smoothstep(440.0, 540.0, p.y);
        float angle = u_head * head;
        vec2 d = p - vec2(516.0, 480.0);
        p = vec2(516.0, 480.0) + vec2(cos(angle)*d.x-sin(angle)*d.y, sin(angle)*d.x+cos(angle)*d.y);
        float strands = smoothstep(120.0, 225.0, abs(p.x-516.0))*smoothstep(470.0, 800.0, p.y);
        p.x += u_hair * strands * sin(p.y*.008 + u_time*3.0);
      }
      p.y -= u_squash * 17.0 * (1.0-smoothstep(500.0, 920.0, p.y));
      float upper = 1.0 - smoothstep(650.0, 950.0, p.y);
      p.y += u_close * 4.0 * (1.0 - smoothstep(450.0, 520.0, p.y));
      p.x += sin(u_time*1.8) * 1.1 * upper;
      p.y -= sin(u_time*1.8) * 1.4 * upper;
      p.y += u_seat * 40.0;
      p.y -= u_lift * (17.0 + sin(u_time*2.0)*2.0);
      vec2 d = p - u_pivot;
      p = u_pivot + vec2(cos(u_body)*d.x-sin(u_body)*d.y, sin(u_body)*d.x+cos(u_body)*d.y) + u_shift;
      vec2 world = vec2(-4.0, -24.0) + p;
      gl_Position = vec4(world.x/512.0-1.0, 1.0-world.y/512.0, 0.0, 1.0);
    }`;
  const fragment = `precision mediump float; varying vec2 v_uv; uniform sampler2D u_image; uniform float u_opacity;
    void main(){ gl_FragColor=texture2D(u_image,v_uv)*u_opacity; }`;
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

function bilinear(quad, u, v) {
  return [0, 1].map(axis => (1-u)*(1-v)*quad[0][axis]+u*(1-v)*quad[1][axis]+u*v*quad[2][axis]+(1-u)*v*quad[3][axis]);
}

function quadCoordinates(quad, point) {
  let u = .8, v = .2;
  for (let i = 0; i < 12; i++) {
    const p = bilinear(quad, u, v);
    const du = [0, 1].map(k => (1-v)*(quad[1][k]-quad[0][k])+v*(quad[2][k]-quad[3][k]));
    const dv = [0, 1].map(k => (1-u)*(quad[3][k]-quad[0][k])+u*(quad[2][k]-quad[1][k]));
    const dx = point[0]-p[0], dy = point[1]-p[1], det = du[0]*dv[1]-du[1]*dv[0];
    u += (dx*dv[1]-dy*dv[0])/det;
    v += (du[0]*dy-du[1]*dx)/det;
  }
  return [u, v];
}

function mirror(quad) { return quad.map(([x,y]) => [1032-x, y]); }
function mix(a,b,t) { return a+(b-a)*t; }

function smooth(a,b,x) { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); }
