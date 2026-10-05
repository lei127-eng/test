// ============================================================
// HERO SHADER SLIDER — Transition Displacement Map (Codrops)
// ============================================================
// Effet : déformation liquide entre les images, contrôlée par
// une carte de déplacement (displacement map).
//
// Shader original (MIT) : Travis Fischer, adapté de Codrops
// https://tympanus.net/Development/DistortionHoverEffect

const canvas = document.getElementById('heroCanvas');
const gl = canvas.getContext('webgl');

if (!gl) {
  console.error("WebGL n'est pas supporté par ce navigateur.");
}

// ---- Tes images ----
const slideSources = ['image1.jpg', 'image2.jpg', 'image3.jpg'];

// ⚠️ LA CARTE DE DÉPLACEMENT — c'est elle qui définit la forme de la déformation
// Prends une image en niveaux de gris, de préférence 512x512 ou 1024x1024
const displacementSource = 'displacement.jpg';

let currentIndex = 0;
let nextIndex = 0;
let slides = [];
let dispTexture = null;
let animating = false;

// ------------------------------------------------------------
// 1) LES SHADERS
// ------------------------------------------------------------

const vertexShaderSource = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// Fragment shader : Displacement Map (Codrops)
const fragmentShaderSource = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform sampler2D uDisp;    // La carte de déplacement
  uniform float uProgress;
  uniform float uStrength;    // Intensité de la déformation
  uniform vec2 uFromScale;
  uniform vec2 uToScale;

  // Gestion du "cover" (équivalent object-fit: cover)
  vec2 coverUV(vec2 uv, vec2 scale) {
    return (uv - 0.5) * scale + 0.5;
  }

  vec4 getFromColor(vec2 p) {
    return texture2D(uFrom, coverUV(p, uFromScale));
  }
  vec4 getToColor(vec2 p) {
    return texture2D(uTo, coverUV(p, uToScale));
  }

  // --- Shader de Codrops (MIT) ---
  void main() {
    // Lecture de la carte de déplacement (canal rouge)
    float displacement = texture2D(uDisp, vUv).r * uStrength;

    // Décalage horizontal des UV pour chaque image
    vec2 uvFrom = vec2(vUv.x + uProgress * displacement, vUv.y);
    vec2 uvTo = vec2(vUv.x - (1.0 - uProgress) * displacement, vUv.y);

    // Mélange final
    gl_FragColor = mix(
      getFromColor(uvFrom),
      getToColor(uvTo),
      uProgress
    );
  }
`;

// ------------------------------------------------------------
// 2) COMPILATION des shaders
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
// 3) RECTANGLE PLEIN ÉCRAN
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
const uDisp = gl.getUniformLocation(program, 'uDisp');
const uProgress = gl.getUniformLocation(program, 'uProgress');
const uFromScale = gl.getUniformLocation(program, 'uFromScale');
const uToScale = gl.getUniformLocation(program, 'uToScale');
const uStrength = gl.getUniformLocation(program, 'uStrength');

// ------------------------------------------------------------
// 4) CHARGEMENT DES IMAGES
// ------------------------------------------------------------
function loadTexture(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      resolve({ texture, width: image.width, height: image.height });
    };
    image.onerror = () => console.error('Image introuvable :', src);
    image.src = src;
  });
}

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
// ⚙️ INTENSITÉ DE LA DÉFORMATION
//   0.1 = très subtil
//   0.5 = valeur par défaut de Codrops
//   1.0 = très marqué
//   2.0 = extrême (l'image se déchire presque)
const WARP_STRENGTH = 0.5;

function render(progress) {
  const from = slides[currentIndex];
  const to = slides[nextIndex];

  // Texture "from" sur l'unité 0
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, from.texture);
  gl.uniform1i(uFrom, 0);

  // Texture "to" sur l'unité 1
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, to.texture);
  gl.uniform1i(uTo, 1);

  // Carte de déplacement sur l'unité 2
  if (dispTexture) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dispTexture.texture);
    gl.uniform1i(uDisp, 2);
  }

  gl.uniform1f(uProgress, progress);
  gl.uniform1f(uStrength, WARP_STRENGTH);
  gl.uniform2fv(uFromScale, getCoverScale(from.width, from.height));
  gl.uniform2fv(uToScale, getCoverScale(to.width, to.height));

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ------------------------------------------------------------
// 6) TRANSITION animée
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
// 7) Légendes
// ------------------------------------------------------------
function updateCaptions(index) {
  document.querySelectorAll('.hero-caption').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.slide) === index);
  });
}

// ------------------------------------------------------------
// 8) DÉMARRAGE
// ------------------------------------------------------------
async function init() {
  resizeCanvas();

  // Chargement des slides + displacement map en parallèle
  const [loadedSlides, loadedDisp] = await Promise.all([
    Promise.all(slideSources.map(loadTexture)),
    loadTexture(displacementSource).catch(() => null)
  ]);

  slides = loadedSlides;
  dispTexture = loadedDisp;

  if (!dispTexture) {
    console.warn("Carte de déplacement introuvable — l'effet sera un simple fondu.");
  }

  render(0);
  updateCaptions(currentIndex);
  setInterval(() => goTo(1), 4000);
}

document.getElementById('heroNext').addEventListener('click', () => goTo(1));
document.getElementById('heroPrev').addEventListener('click', () => goTo(-1));

init();