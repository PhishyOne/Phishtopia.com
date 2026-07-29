(() => {
  const stage = document.querySelector('.error-stage');
  if (!stage) return;

  const match = stage.className.match(/error-stage--(403|404|429|500)/);
  if (!match) return;

  const scenePaths = Object.freeze({
    '403': '/images/errors/403.webp',
    '404': '/images/errors/404.webp',
    '429': '/images/errors/429.webp',
    '500': '/images/errors/500.webp'
  });
  const scenePath = scenePaths[match[1]];
  const scene = new Image();
  scene.decoding = 'async';

  scene.onload = () => {
    stage.style.setProperty('--error-scene', `url("${scenePath}")`);
    stage.classList.add('error-stage--scene-ready');
  };

  scene.src = scenePath;
})();
