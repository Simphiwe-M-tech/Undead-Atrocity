import * as THREE from 'three';

/**
 * ProceduralTextures - Canvas-generated textures used by the Rooftop level.
 *
 * The academic LAMP host for this build does not ship any bitmap asset
 * pipeline, so rather than depend on binary texture/cubemap files that may
 * be missing (breaking the scene with a black screen), every texture below
 * is synthesized once at load time with the 2D canvas API and uploaded as a
 * THREE.CanvasTexture / THREE.CubeTexture.
 *
 * If real photographic textures are later dropped into the project (see
 * `loadNightSkybox` / `loadTarConcreteMaterial` below), they are loaded from
 * plain relative, case-sensitive paths (e.g. `./assets/skybox/night/px.png`)
 * via the standard THREE loaders first, and this module is only used as an
 * automatic fallback so the game never fails to render.
 */

function makeCanvas(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

// ---------------------------------------------------------------------------
// Tar / Concrete rooftop floor
// ---------------------------------------------------------------------------

function drawConcreteDiffuse(ctx, size) {
  // Base tar colour
  ctx.fillStyle = '#232323';
  ctx.fillRect(0, 0, size, size);

  // Mottled concrete/tar patches
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 3;
    const shade = 26 + Math.floor(Math.random() * 18);
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.5)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tar seam lines (bitumen roof felt joints)
  ctx.strokeStyle = 'rgba(10,10,10,0.6)';
  ctx.lineWidth = 2;
  const step = size / 6;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }

  // Fine grain speckle for roughness read
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${Math.random() * 0.05})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawConcreteNormal(ctx, size) {
  // Neutral normal map base (pointing straight up: 128,128,255)
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, size, size);

  // Bumps: small light/dark pairs approximate raised aggregate
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 2.5;
    ctx.fillStyle = `rgba(150,150,255,0.5)`;
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(90,90,255,0.5)`;
    ctx.beginPath();
    ctx.arc(x + 1, y + 1, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grooves along the tar-felt seams (matches diffuse layout)
  ctx.strokeStyle = 'rgba(60,60,255,0.7)';
  ctx.lineWidth = 3;
  const step = size / 6;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }
}

function drawRoughness(ctx, size, base = 200, variance = 55) {
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = base + (Math.random() - 0.5) * variance;
    const c = Math.max(0, Math.min(255, Math.floor(v)));
    ctx.fillStyle = `rgb(${c},${c},${c})`;
    ctx.fillRect(x, y, 2, 2);
  }
}

/**
 * Builds a MeshStandardMaterial with procedural tar/concrete diffuse,
 * normal and roughness maps for the rooftop floor.
 */
export function createTarConcreteMaterial(repeat = 10) {
  const size = 512;

  const diffuseCanvas = makeCanvas(size);
  drawConcreteDiffuse(diffuseCanvas.getContext('2d'), size);
  const map = new THREE.CanvasTexture(diffuseCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.colorSpace = THREE.SRGBColorSpace;

  const normalCanvas = makeCanvas(size);
  drawConcreteNormal(normalCanvas.getContext('2d'), size);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeat, repeat);

  const roughCanvas = makeCanvas(size);
  drawRoughness(roughCanvas.getContext('2d'), size, 210, 60);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeat, repeat);

  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap,
    roughness: 1.0,
    metalness: 0.05,
    bumpMap: normalMap,
    bumpScale: 0.02
  });
}

/**
 * Attempts to load a real tar/concrete PBR material from relative,
 * case-sensitive asset paths; falls back to the procedural version above if
 * the files are not present on disk (common on a fresh LAMP deployment).
 */
export function loadTarConcreteMaterial(repeat = 10) {
  const basePath = './assets/textures/tar_concrete/';
  const loader = new THREE.TextureLoader();
  let failed = false;

  const tryLoad = (file) => new Promise((resolve) => {
    loader.load(
      basePath + file,
      (tex) => resolve(tex),
      undefined,
      () => { failed = true; resolve(null); }
    );
  });

  return Promise.all([
    tryLoad('diffuse.jpg'),
    tryLoad('normal.jpg'),
    tryLoad('roughness.jpg')
  ]).then(([diffuse, normal, roughness]) => {
    if (failed || !diffuse) {
      return createTarConcreteMaterial(repeat);
    }
    [diffuse, normal, roughness].forEach((t) => {
      if (!t) return;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
    });
    diffuse.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: diffuse,
      normalMap: normal || null,
      roughnessMap: roughness || null,
      roughness: 1.0,
      metalness: 0.05
    });
  });
}

// ---------------------------------------------------------------------------
// Brick (rooftop parapet walls)
// ---------------------------------------------------------------------------

function drawBrickDiffuse(ctx, size) {
  const rows = 8;
  const rowHeight = size / rows;
  const brickWidth = size / 4;

  ctx.fillStyle = '#2a2320'; // mortar base
  ctx.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row++) {
    const y = row * rowHeight;
    const offset = (row % 2 === 0) ? 0 : -brickWidth / 2;
    for (let x = offset; x < size; x += brickWidth) {
      const shade = 120 + Math.floor(Math.random() * 40);
      const r = shade + 20;
      const g = shade - 45;
      const b = shade - 65;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + 2, y + 2, brickWidth - 4, rowHeight - 4);

      // Subtle per-brick speckle for texture variation
      for (let i = 0; i < 6; i++) {
        const sx = x + 2 + Math.random() * (brickWidth - 4);
        const sy = y + 2 + Math.random() * (rowHeight - 4);
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
        ctx.fillRect(sx, sy, 2, 2);
      }
    }
  }
}

function drawBrickNormal(ctx, size) {
  const rows = 8;
  const rowHeight = size / rows;
  const brickWidth = size / 4;
  const mortarDepth = 'rgba(90,90,255,0.9)';

  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = mortarDepth;
  ctx.lineWidth = 4;
  for (let row = 0; row <= rows; row++) {
    const y = row * rowHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  for (let row = 0; row < rows; row++) {
    const y = row * rowHeight;
    const offset = (row % 2 === 0) ? 0 : -brickWidth / 2;
    for (let x = offset; x < size; x += brickWidth) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + rowHeight);
      ctx.stroke();
    }
  }

  // Gentle per-brick bulge so the faces catch moonlight unevenly.
  for (let row = 0; row < rows; row++) {
    const y = row * rowHeight;
    const offset = (row % 2 === 0) ? 0 : -brickWidth / 2;
    for (let x = offset; x < size; x += brickWidth) {
      const cx = x + brickWidth / 2;
      const cy = y + rowHeight / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, brickWidth / 2);
      grad.addColorStop(0, 'rgba(150,150,255,0.4)');
      grad.addColorStop(1, 'rgba(128,128,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, brickWidth, rowHeight);
    }
  }
}

/**
 * Builds a MeshStandardMaterial with a procedural brick diffuse + normal map
 * for the rooftop's low parapet walls.
 */
export function createBrickMaterial(repeat = 2) {
  const size = 512;

  const diffuseCanvas = makeCanvas(size);
  drawBrickDiffuse(diffuseCanvas.getContext('2d'), size);
  const map = new THREE.CanvasTexture(diffuseCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.colorSpace = THREE.SRGBColorSpace;

  const normalCanvas = makeCanvas(size);
  drawBrickNormal(normalCanvas.getContext('2d'), size);
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeat, repeat);

  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    bumpMap: normalMap,
    bumpScale: 0.03,
    roughness: 0.85,
    metalness: 0.02
  });
}

/**
 * Attempts to load a real brick PBR material from relative, case-sensitive
 * asset paths; falls back to the procedural version above if the files are
 * not present on disk.
 */
export function loadBrickMaterial(repeat = 2) {
  const basePath = './assets/textures/brick/';
  const loader = new THREE.TextureLoader();
  let failed = false;

  const tryLoad = (file) => new Promise((resolve) => {
    loader.load(
      basePath + file,
      (tex) => resolve(tex),
      undefined,
      () => { failed = true; resolve(null); }
    );
  });

  return Promise.all([
    tryLoad('diffuse.jpg'),
    tryLoad('normal.jpg')
  ]).then(([diffuse, normal]) => {
    if (failed || !diffuse) {
      return createBrickMaterial(repeat);
    }
    [diffuse, normal].forEach((t) => {
      if (!t) return;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
    });
    diffuse.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: diffuse,
      normalMap: normal || null,
      roughness: 0.85,
      metalness: 0.02
    });
  });
}

// ---------------------------------------------------------------------------
// Night sky skybox
// ---------------------------------------------------------------------------

function drawSkyFace(ctx, size, faceKey) {
  // Vertical gradient: deep navy zenith to a lighter horizon haze.
  const isTopOrBottom = faceKey === 'py' || faceKey === 'ny';
  const grad = isTopOrBottom
    ? ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 1.4)
    : ctx.createLinearGradient(0, 0, 0, size);

  if (faceKey === 'py') {
    grad.addColorStop(0, '#05060f');
    grad.addColorStop(1, '#0c1330');
  } else if (faceKey === 'ny') {
    grad.addColorStop(0, '#02030a');
    grad.addColorStop(1, '#050712');
  } else {
    grad.addColorStop(0, '#060814');
    grad.addColorStop(0.6, '#0b1330');
    grad.addColorStop(1, '#1b2648'); // faint city-glow horizon
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Stars - denser near the top faces, sparse near the glowing horizon
  const starCount = isTopOrBottom ? 260 : 160;
  for (let i = 0; i < starCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const brightness = Math.random();
    const r = brightness > 0.9 ? 1.6 : 0.8;
    ctx.fillStyle = `rgba(255,255,255,${0.3 + brightness * 0.7})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Soft moon glow accent on the +z face
  if (faceKey === 'pz') {
    const mx = size * 0.7;
    const my = size * 0.3;
    const moonGlow = ctx.createRadialGradient(mx, my, 0, mx, my, size * 0.28);
    moonGlow.addColorStop(0, 'rgba(220,225,255,0.9)');
    moonGlow.addColorStop(0.15, 'rgba(200,210,255,0.35)');
    moonGlow.addColorStop(1, 'rgba(200,210,255,0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#eef1ff';
    ctx.beginPath();
    ctx.arc(mx, my, size * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Chain-link fence (interior rooftop maze partitions)
// ---------------------------------------------------------------------------

function drawChainLinkAlpha(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.045;
  const step = size / 6;
  // Diagonal diamond lattice, drawn in both directions.
  for (let i = -6; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step + size, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(i * step, size);
    ctx.lineTo(i * step + size, 0);
    ctx.stroke();
  }
}

/**
 * Builds a metallic chain-link fence MeshStandardMaterial: an alpha-mapped
 * diamond lattice so the fence reads as an open mesh (zombies can be seen —
 * and can climb — through it) rather than a solid rooftop maze wall.
 */
export function createChainLinkMaterial(repeat = 3) {
  const size = 256;
  const alphaCanvas = makeCanvas(size);
  drawChainLinkAlpha(alphaCanvas.getContext('2d'), size);
  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.wrapS = alphaMap.wrapT = THREE.RepeatWrapping;
  alphaMap.repeat.set(repeat, repeat);

  return new THREE.MeshStandardMaterial({
    color: 0x9aa3ab,
    alphaMap,
    transparent: true,
    side: THREE.DoubleSide,
    metalness: 0.7,
    roughness: 0.45,
    depthWrite: true
  });
}

/** Builds a procedural nighttime CubeTexture (used as fallback skybox). */
export function createNightSkybox(size = 512) {
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const images = order.map((key) => {
    const canvas = makeCanvas(size);
    drawSkyFace(canvas.getContext('2d'), size, key);
    return canvas;
  });
  const cubeTexture = new THREE.CubeTexture(images);
  cubeTexture.needsUpdate = true;
  cubeTexture.colorSpace = THREE.SRGBColorSpace;
  return cubeTexture;
}

/**
 * Attempts to load a real nighttime cubemap from relative, case-sensitive
 * asset paths (./assets/skybox/night/{px,nx,py,ny,pz,nz}.png). Falls back to
 * the procedural starfield above if the files aren't present.
 */
export function loadNightSkybox() {
  return new Promise((resolve) => {
    const basePath = './assets/skybox/night/';
    const files = ['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'];
    const loader = new THREE.CubeTextureLoader().setPath(basePath);
    loader.load(
      files,
      (cubeTexture) => {
        cubeTexture.colorSpace = THREE.SRGBColorSpace;
        resolve(cubeTexture);
      },
      undefined,
      () => resolve(createNightSkybox())
    );
  });
}
