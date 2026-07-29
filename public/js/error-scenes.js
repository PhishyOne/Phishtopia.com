(() => {
  const stage = document.querySelector('.error-stage');
  if (!stage) return;

  const match = stage.className.match(/error-stage--(403|404|429|500)/);
  if (!match) return;

  const scenePath = `/images/errors/${match[1]}.webp`;
  const scene = new Image();
  scene.decoding = 'async';

  scene.onload = () => {
    stage.style.setProperty('--error-scene', `url("${scenePath}")`);
    stage.classList.add('error-stage--scene-ready');
  };

  scene.src = scenePath;
})();
