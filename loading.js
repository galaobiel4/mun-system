(() => {
  const splash = document.getElementById('loading-screen');
  const content = document.getElementById('app-content');
  const started = performance.now();
  let closed = false;
  content.inert = true;
  function close() {
    if (closed) return;
    closed = true;
    splash.classList.add('is-leaving');
    splash.setAttribute('aria-hidden', 'true');
    content.inert = false;
    document.body.classList.remove('is-loading');
    setTimeout(() => { splash.hidden = true; }, 300);
  }
  const ready = () => setTimeout(close, Math.max(0, 1600 - (performance.now() - started)));
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });
  setTimeout(close, 4000);
})();
