// Connect screen: ask where the ship is, prove it answers, remember it.
(async () => {
  const shell = window.tardisShell;
  const form = document.getElementById('form');
  const input = document.getElementById('url');
  const status = document.getElementById('status');
  const go = document.getElementById('go');
  const force = document.getElementById('force');
  const version = document.getElementById('version');

  const state = await shell.getState();
  version.textContent = `Type 40 TT Capsule · v${state.version}`;
  if (state.serverUrl) input.value = state.serverUrl;
  input.focus();
  input.select();

  let busy = false;
  async function attempt(saveWithoutCheck) {
    if (busy) return;
    busy = true;
    go.disabled = true;
    force.hidden = true;
    status.className = 'status';
    status.textContent = saveWithoutCheck ? 'Saving…' : 'Materialising…';
    document.body.classList.add('busy');
    try {
      const result = await shell.connect(input.value, saveWithoutCheck);
      if (!result.ok) {
        status.className = 'status err';
        status.textContent = result.error || 'Could not connect.';
        force.hidden = false;
      } else {
        status.className = 'status ok';
        status.textContent = 'Found the ship. Materialising…';
      }
    } finally {
      busy = false;
      go.disabled = false;
      document.body.classList.remove('busy');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void attempt(false);
  });
  force.addEventListener('click', () => void attempt(true));
})();
