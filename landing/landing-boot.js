import { initGlslHills } from './glsl-hills.js';

const canvas = document.getElementById('hillsCanvas');
const wrap = document.querySelector('.hero-canvas-wrap');

if (canvas && wrap) {
  initGlslHills(canvas, wrap, { cameraZ: 125, speed: 0.45 });
}

await import('../landing-demo.js');