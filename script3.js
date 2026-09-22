// ============================================================
// HERO SHADER SLIDER — transition animée en WebGL pur
// ============================================================
// ATTENTION : ceci est un niveau nettement plus avancé que le
// reste du site (on sort du HTML/CSS classique). Pas besoin de
// tout comprendre au mot près — lisez les commentaires comme
// une carte, pas comme un examen. Aucune librairie externe
// n'est utilisée : WebGL est une API native du navigateur.

const canvas = document.getElementById('heroCanvas');
const gl = canvas.getContext('webgl');

if (!gl) {
  console.error("WebGL n'est pas supporté par ce navigateur.");
}

// ---- Vos images de slides, dans l'ordre ----
const slideSources = ['image1.jpg', 'image2.jpg', 'image3.jpg'];

let currentIndex = 0; // slide actuellement affichée
let nextIndex = 0;    // slide vers laquelle on transitionne
let slides = [];       // contiendra les textures chargées
let animating = false;

// ------------------------------------------------------------
// 1) LES SHADERS : deux petits programmes qui tournent sur le GPU
// ------------------------------------------------------------

// Le "vertex shader" positionne juste un rectangle plein écran.
// (2 triangles qui couvrent tout le canvas — c'est le minimum
// nécessaire pour pouvoir dessiner quoi que ce soit en WebGL)
const vertexShaderSource = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// Le "fragment shader" calcule la couleur de CHAQUE pixel.
// Effet "morph-x" : les deux images glissent horizontalement
// en sens opposés pendant la transition, puis se fondent.
const fragmentShaderSource = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform float uProgress;   // avance de 0.0 à 1.0 pendant la transition
  uniform vec2 uFromScale;   // pour que l'image ne soit jamais déformée
  uniform vec2 uToScale;

  // Recentre les coordonnées de texture pour un effet "cover"
  // (équivalent GLSL de object-fit: cover en CSS)
  vec2 coverUV(vec2 uv, vec2 scale) {
    return (uv - 0.5) * scale + 0.5;
  }

  void main() {
    // Intensité du morph : monte puis redescend pendant la transition
    // (0 au début, max au milieu, 0 à la fin) → mouvement fluide
    float intensity = sin(uProgress * 3.14159) * 0.15;

    // On décale l'image "from" vers la droite et "to" vers la gauche
    vec2 uvFrom = vUv + vec2( intensity, 0.0);
    vec2 uvTo   = vUv + vec2(-intensity, 0.0);

    // Application du "cover" pour éviter la déformation
    uvFrom = coverUV(uvFrom, uFromScale);
    uvTo   = coverUV(uvTo, uToScale);

    vec4 colFrom = texture2D(uFrom, uvFrom);
    vec4 colTo   = texture2D(uTo, uvTo);

    // Fondu adouci entre les deux
    float p = smoothstep(0.0, 1.0, uProgress);
    gl_FragColor = mix(colFrom, colTo, p);
  }
`;

// ------------------------------------------------------------
// 2) COMPILATION des shaders (routine technique WebGL)
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
// 3) LE RECTANGLE PLEIN ÉCRAN (2 triangles = 6 points)
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

// Emplacements des variables ("uniforms") qu'on va envoyer au shader
const uFrom = gl.getUniformLocation(program, 'uFrom');
const uTo = gl.getUniformLocation(program, 'uTo');
const uProgress = gl.getUniformLocation(program, 'uProgress');
const uFromScale = gl.getUniformLocation(program, 'uFromScale');
const uToScale = gl.getUniformLocation(program, 'uToScale');

// ------------------------------------------------------------
// 4) CHARGEMENT DES IMAGES comme textures WebGL
// ------------------------------------------------------------
function loadTexture(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      resolve({ texture, width: image.width, height: image.height });
    };
    image.onerror = () => console.error('Image introuvable :', src);
    image.src = src;
  });
}

// Calcule le "zoom" à appliquer à une image pour qu'elle remplisse
// le canvas sans être étirée (comme object-fit: cover)
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
// 5) DESSINER une image (progress = 0) ou la transition en cours
// ------------------------------------------------------------
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
  gl.uniform2fv(uFromScale, getCoverScale(from.width, from.height));
  gl.uniform2fv(uToScale, getCoverScale(to.width, to.height));

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ------------------------------------------------------------
// 6) LA TRANSITION animée (comme un setInterval, mais optimisé
//    pour l'affichage grâce à requestAnimationFrame)
// ------------------------------------------------------------
function playTransition() {
  if (animating) return;
  animating = true;

  const duration = 1200; // durée de la transition en millisecondes
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
// 7) Les légendes (texte au-dessus du canvas, gérées en HTML/CSS classique)
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
  slides = await Promise.all(slideSources.map(loadTexture));
  render(0); // affiche la première image, sans transition
  updateCaptions(currentIndex);
  setInterval(() => goTo(1), 4000); // autoplay : slide suivante toutes les 4s
}

document.getElementById('heroNext').addEventListener('click', () => goTo(1));
document.getElementById('heroPrev').addEventListener('click', () => goTo(-1));

init();
