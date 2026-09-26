import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, properties) { Object.assign(this, properties); }
};

// Parse the shipped meshes, UVs, rig and clips in Node. Chromium covers the
// embedded atlas decoding; no image canvas emulation is needed for these tests.
export const kitLoader = { async loadAsync(url) {
  const file = url.split('/').at(-1);
  const data = JSON.parse(await readFile(new URL(`../../public/assets/cube-world/${file}`, import.meta.url), 'utf8'));
  delete data.images;
  delete data.textures;
  for (const material of data.materials) delete material.pbrMetallicRoughness.baseColorTexture;
  return new GLTFLoader().parseAsync(JSON.stringify(data), '');
} };

export const withKitLoader = Level => class extends Level {
  async _loadZombieModels() { await super._loadZombieModels(kitLoader); }
};
