// ============================================================
// HERO SHADER SLIDER — transition CROSSWARP (paniq, MIT)
// ============================================================
// Le shader utilise exactement la même interface que ton ancien :
// - uFrom / uTo       : les deux textures à mélanger
// - uProgress         : avancement 0.0 → 1.0
// - uFromScale/uToScale : gestion du "cover" (object-fit: cover)
//
// La transition vient de paniq (licence MIT) :
// https://github.com/gl-transitions/gl-transitions/blob/master/transitions/crosswarp.glsl

const canvas = document.getElementById('heroCanvas');
const gl = canvas.getContext('webgl');

if (!gl) {
  console.error("WebGL n'est pas supporté par ce navigateur.");
}

// ---- Vos images de slides, dans l'ordre ----
const slideSources = ['image1.jpg', 'image2.jpg', 'image3.jpg'];

let currentIndex = 0;
let nextIndex = 0;
let slides = [];
let animating = false;

// ------------------------------------------------------------
// 1) LES SHADERS
// ------------------------------------------------------------

// Vertex shader : rectangle plein écran (inchangé)
const vertexShaderSource = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// Fragment shader : CROSSWARP de paniq (adapté à ton interface)
// - la force du warp est réglable via la constante STRENGTH plus bas
// - on garde la gestion "cover" de ton ancien shader
const fragmentShaderSource = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform float uProgress;
  uniform vec2 uFromScale;
  uniform vec2 uToScale;
  uniform float uStrength;   // ← intensité du warp (0.1 = discret)

  vec2 coverUV(vec2 uv, vec2 scale) {
    return (uv - 0.5) * scale + 0.5;
  }

  vec4 getFromColor(vec2 p) {
    return texture2D(uFrom, coverUV(p, uFromScale));
  }
  vec4 getToColor(vec2 p) {
    return texture2D(uTo, coverUV(p, uToScale));
  }

  // --- code de paniq (MIT), adapté pour utiliser uStrength ---
  vec4 transition(vec2 p) {
    vec4 ca = getFromColor(p);
    vec4 cb = getToColor(p);

    vec2 oa = (((ca.rg + ca.b) * 0.5) * 2.0 - 1.0);
    vec2 ob = (((cb.rg + cb.b) * 0.5) * 2.0 - 1.0);
    vec2 oc = mix(oa, ob, 0.5) * uStrength;

    float w0 = uProgress;
    float w1 = 1.0 - w0;
    return mix(getFromColor(p + oc * w0), getToColor(p - oc * w1), uProgress);
  }

  void main() {
    gl_FragColor = transition(vUv);
  }
`;

// ------------------------------------------------------------
// 2) COMPILATION des shaders (inchangé)
// ------------------------------------------------------------
function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

// ------------------------------------------------------------
// 3) RECTANGLE PLEIN ÉCRAN (inchangé)
// ------------------------------------------------------------
const positions = new Float32Array([
  -1, -1,   1, -1,   -1, 1,
  -1,  1,   1, -1,    1, 1,
]);
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

const aPosition = gl.getAttribLocation(program, 'aPosition');
gl.enableVertexAttribArray(aPosition);
gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

// Uniforms
const uFrom = gl.getUniformLocation(program, 'uFrom');
const uTo = gl.getUniformLocation(program, 'uTo');
const uProgress = gl.getUniformLocation(program, 'uProgress');
const uFromScale = gl.getUniformLocation(program, 'uFromScale');
const uToScale = gl.getUniformLocation(program, 'uToScale');
const uStrength = gl.getUniformLocation(program, 'uStrength');   // ← nouveau

// ------------------------------------------------------------
// 4) CHARGEMENT DES IMAGES
// ------------------------------------------------------------
// 2 corrections par rapport à ton code d'origine :
//   - UNPACK_FLIP_Y_WEBGL → règle le problème des images à l'envers
//   - TEXTURE_MAG_FILTER → évite le flou moche quand l'image est zoomée
function loadTexture(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // ← AJOUT

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // ← AJOUT
      resolve({ texture, width: image.width, height: image.height });
    };
    image.onerror = () => console.error('Image introuvable :', src);
    image.src = src;
  });
}

// getCoverScale (inchangé)
function getCoverScale(imgW, imgH) {
  const canvasRatio = canvas.clientWidth / canvas.clientHeight;
  const imgRatio = imgW / imgH;
  return canvasRatio > imgRatio
    ? [1, imgRatio / canvasRatio]
    : [canvasRatio / imgRatio, 1];
}

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);

// ------------------------------------------------------------
// 5) RENDER
// ------------------------------------------------------------
// ⚙️ INTENSITÉ DU WARP — modifie cette valeur pour ajuster l'effet :
//   0.05 = très subtil
//   0.10 = équilibré (valeur par défaut du shader de paniq)
//   0.20 = fort
//   0.30 = très marqué
const WARP_STRENGTH = 0.1;

function render(progress) {
  const from = slides[currentIndex];
  const to = slides[nextIndex];

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, from.texture);
  gl.uniform1i(uFrom, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, to.texture);
  gl.uniform1i(uTo, 1);

  gl.uniform1f(uProgress, progress);
  gl.uniform1f(uStrength, WARP_STRENGTH);  // ← nouveau
  gl.uniform2fv(uFromScale, getCoverScale(from.width, from.height));
  gl.uniform2fv(uToScale, getCoverScale(to.width, to.height));

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ------------------------------------------------------------
// 6) TRANSITION animée (inchangé)
// ------------------------------------------------------------
function playTransition() {
  if (animating) return;
  animating = true;

  const duration = 1200;
  const start = performance.now();

  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    render(t);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      currentIndex = nextIndex;
      updateCaptions(currentIndex);
      animating = false;
    }
  }
  requestAnimationFrame(frame);
}

function goTo(direction) {
  if (animating) return;
  nextIndex = (currentIndex + direction + slides.length) % slides.length;
  playTransition();
}

// ------------------------------------------------------------
// 7) Légendes (inchangé)
// ------------------------------------------------------------
function updateCaptions(index) {
  document.querySelectorAll('.hero-caption').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.slide) === index);
  });
}

// ------------------------------------------------------------
// 8) DÉMARRAGE (inchangé)
// ------------------------------------------------------------
async function init() {
  resizeCanvas();
  slides = await Promise.all(slideSources.map(loadTexture));
  render(0);
  updateCaptions(currentIndex);
  setInterval(() => goTo(1), 4000);
}

document.getElementById('heroNext').addEventListener('click', () => goTo(1));
document.getElementById('heroPrev').addEventListener('click', () => goTo(-1));

init();