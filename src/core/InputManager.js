/**
 * InputManager - Centralised keyboard & mouse state.
 * Poll keys via .isDown('KeyW'), mouse via .mouseX/Y, .mouseButtons.
 */
export class InputManager {
  constructor() {
    this.keys = {};
    this.pressed = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.mouseButtons = {};
    this._pointerLocked = false;
    this.sensitivity = 0.002;

    window.addEventListener('keydown', (e) => {
      if (!e.repeat && !this.keys[e.code]) this.pressed.add(e.code);
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
      this.clearTransient();
    });

    window.addEventListener('mousemove', (e) => {
      if (this._pointerLocked) {
        this.mouseDeltaX += e.movementX || 0;
        this.mouseDeltaY += e.movementY || 0;
      }
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      this.mouseButtons[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons[e.button] = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement !== null;
    });
  }

  isDown(code) {
    return !!this.keys[code];
  }

  consumePress(code) {
    return this.pressed.delete(code);
  }

  endFrame() {
    this.pressed.clear();
  }

  clearTransient() {
    this.pressed.clear();
    this.mouseButtons = {};
    this.flushMouseDelta();
  }

  isMouseButtonDown(button = 0) {
    return !!this.mouseButtons[button];
  }

  flushMouseDelta() {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  get pointerLocked() {
    return this._pointerLocked;
  }

  requestPointerLock(element) {
    const request = element.requestPointerLock();
    request?.catch(() => {}); // Browser may require a fresh click after Escape.
  }
}
