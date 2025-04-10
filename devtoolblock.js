let devtoolsOpen = false;
const urlParams = new URLSearchParams(window.location.search);
const threshold = parseInt(urlParams.get('threshold')) || 200;
const redirectUrl = urlParams.get('url') || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const detectDevTools = () => {
  const widthThreshold = window.outerWidth - window.innerWidth > threshold;
  return widthThreshold;
};
setInterval(() => {
  if (detectDevTools()) {
    if (!devtoolsOpen) {
      devtoolsOpen = true;
      try {
        localStorage.clear();
        sessionStorage.clear();
        if ('caches' in window) {
          caches.keys().then(keys => {
            keys.forEach(key => caches.delete(key));
          });
        }
      } catch (e) {}
      window.location.replace(redirectUrl);
    }
  } else {
    devtoolsOpen = false;
  }
}, 500);
