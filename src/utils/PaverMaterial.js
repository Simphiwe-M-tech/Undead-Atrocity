import * as THREE from 'three';

// Fine aggregate, pores and worn edges for natural buff concrete. The texture
// describes one paving slab; joints and the staggered layout are real geometry.
export function createPaverMaterial() {
  const size = 256;
  const diffuse = new Uint8Array(size * size * 4);
  const relief = new Uint8Array(size * size * 4);
  let seed = 4173;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
    const mottling = Math.sin(x * 0.041) * Math.sin(y * 0.033) * 3
      + Math.sin(x * 0.017 + y * 0.025) * 2;
    const grain = (random() - 0.5) * 9;
    const pore = random() < 0.012 ? -16 : 0;
    const wear = edge < 2 ? -5 : 0;
    const variation = mottling + grain + pore + wear;
    diffuse[index] = 194 + variation;
    diffuse[index + 1] = 184 + variation;
    diffuse[index + 2] = 164 + variation;
    diffuse[index + 3] = 255;
    const height = 150 + mottling + grain * 1.5 + pore - Math.max(0, 3 - edge) * 20;
    relief[index] = relief[index + 1] = relief[index + 2] = height;
    relief[index + 3] = 255;
  }
  const map = new THREE.DataTexture(diffuse, size, size);
  const bumpMap = new THREE.DataTexture(relief, size, size);
  for (const texture of [map, bumpMap]) {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    map, bumpMap, bumpScale: 0.008, roughness: 0.94, metalness: 0,
  });
  return { material, map, bumpMap };
}
