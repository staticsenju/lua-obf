const $ = s => document.querySelector(s);

$('#go').onclick = async () => {
  const code = $('#src').value.trim();
  if (!code) { toast('Paste code first'); return; }
  const options = {
    junk: $('#junk').checked,
    watermark: $('#wm').value.trim(),
    split: clamp(parseInt($('#split').value||'10',10), 5, 48),
    latePieces: clamp(parseInt($('#late').value||'14',10), 6, 64),
    delayFrames: clamp(parseInt($('#delay').value||'1',10), 0, 10)
  };
  setBusy(true);
  try{
    const r = await fetch('/obfuscate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ code, options })
    });
    const j = await r.json();
    $('#out').value = j.ok ? j.output : ('Error: ' + j.error);
    if (j.ok) toast('Obfuscation complete');
    else toast('Failed: '+j.error);
  }catch(e){ $('#out').value = 'Error: '+e.message; toast('Network error'); }
  setBusy(false);
};

$('#copy').onclick = async () => {
  const t = $('#out').value; if (!t) return;
  await navigator.clipboard.writeText(t); toast('Copied to clipboard');
};
$('#download').onclick = () => {
  const blob = new Blob([$('#out').value||''], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'obfuscated.lua'; a.click();
};

function clamp(x,a,b){ x=isNaN(x)?a:x; return Math.max(a, Math.min(b, x)); }
function toast(msg){
  const el = document.createElement('div');
  el.className='toast'; el.textContent=msg; document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'),10);
  setTimeout(()=>{el.classList.remove('show'); setTimeout(()=>el.remove(),250)}, 2000);
}
function setBusy(b){ document.body.classList.toggle('busy', !!b); }