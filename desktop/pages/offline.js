// Offline screen: the server did not answer. Keep knocking, gently.
(async () => {
  const shell = window.tardisShell;
  const params = new URLSearchParams(window.location.search);
  const where = document.getElementById('where');
  const reason = document.getElementById('reason');
  const count = document.getElementById('count');
  const retryBtn = document.getElementById('retry');
  const changeBtn = document.getElementById('change');

  const state = await shell.getState();
  where.textContent = state.serverUrl || '';
  reason.textContent = params.get('reason') || '';

  let wait = 5;
  let left = wait;
  let timer = 0;
  let busy = false;

  function show() {
    count.textContent = busy ? 'Materialising…' : `Retrying in ${left}s…`;
  }

  async function retry() {
    if (busy) return;
    busy = true;
    window.clearInterval(timer);
    show();
    const result = await shell.retry();
    busy = false;
    if (result && result.ok) {
      count.textContent = 'Found the ship. Materialising…';
      return;
    }
    if (result && result.error) reason.textContent = result.error;
    wait = Math.min(20, wait + 4);
    left = wait;
    arm();
  }

  function arm() {
    window.clearInterval(timer);
    show();
    timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        void retry();
        return;
      }
      show();
    }, 1000);
  }

  retryBtn.addEventListener('click', () => void retry());
  changeBtn.addEventListener('click', () => void shell.changeServer());
  arm();
})();
