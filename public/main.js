const $ = s => document.querySelector(s);

/* ---------- OBFUSCATE ---------- */
$('#go').onclick = async () => {
  const code = $('#src').value.trim();
  if (!code) { alert('Paste code'); return; }
  const options = {
    junk: $('#junk').checked,
    watermark: $('#wm').value.trim(),
    split: clamp(parseInt($('#split').value||'10',10), 5, 48),
    latePieces: clamp(parseInt($('#late').value||'14',10), 6, 64),
    delayFrames: clamp(parseInt($('#delay').value||'2',10), 0, 10)
  };
  const res = await fetch('/obfuscate', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ code, options })
  });
  const j = await res.json();
  $('#out').value = j.ok ? j.output : ('Error: ' + j.error);
};

$('#copy').onclick = async () => {
  const t = $('#out').value; if (!t) return;
  await navigator.clipboard.writeText(t);
};

$('#download').onclick = () => {
  const blob = new Blob([$('#out').value||''], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'obfuscated.lua';
  a.click();
};

function clamp(x, a, b){ x=isNaN(x)?a:x; return Math.max(a, Math.min(b, x)); }

/* ---------- PREVIEW + CANVAS ---------- */
$('#previewBtn').onclick = async () => {
  const url = $('#url').value.trim();
  if (!url) { alert('Enter a URL'); return; }
  const res = await fetch('/preview', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ url, screenshot: $('#shot').checked })
  });
  const j = await res.json();
  if (!j.ok) { alert('Preview failed: ' + j.error); return; }

  $('#cardImg').src = j.image || '';
  $('#cardIcon').src = j.icon || '';
  $('#cardSite').textContent = j.siteName || '';
  $('#cardTitle').textContent = j.title || j.url;
  $('#cardDesc').textContent = j.description || '';
  $('#cardLink').href = j.url;
  $('#cardLink').classList.remove('hidden');

  drawCanvas(j);
};

async function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = reject;
    // proxy through /img to avoid taint
    i.src = src ? `/img?url=${encodeURIComponent(src)}` : '';
  });
}

async function drawCanvas(meta) {
  const c = $('#canvas'); const ctx = c.getContext('2d');
  // background
  ctx.fillStyle = '#12141a'; ctx.fillRect(0,0,c.width,c.height);

  // image left
  let hero = null;
  if (meta.image) {
    try { hero = await loadImg(meta.image); } catch {}
  }
  if (hero) {
    ctx.drawImage(hero, 0, 0, 540, 630);
  } else {
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0,0,540,630);
  }

  // text area bg
  ctx.fillStyle = '#0f1115'; roundRect(ctx, 560, 30, 610, 570, 16, true, false);

  // site row
  const iconImg = meta.icon ? await safeTry(() => loadImg(meta.icon)) : null;
  if (iconImg) ctx.drawImage(iconImg, 580, 50, 24, 24);
  ctx.fillStyle = '#cfcfd4'; ctx.font = '18px Inter, system-ui, Arial';
  ctx.fillText(meta.siteName || '', 612, 68);

  // title
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px Inter, system-ui, Arial';
  wrapText(ctx, (meta.title||meta.url||'').slice(0,140), 580, 120, 560, 44, 3);

  // desc
  ctx.fillStyle = '#b8b8be'; ctx.font = '22px Inter, system-ui, Arial';
  wrapText(ctx, (meta.description||'').slice(0,260), 580, 250, 560, 32, 6);
}

function roundRect(ctx, x, y, w, h, r, fill, stroke){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines){
  const words = text.split(/\s+/);
  let line = '', lines = 0;
  for (let n=0;n<words.length;n++){
    const test = line ? (line + ' ' + words[n]) : words[n];
    if (ctx.measureText(test).width > maxWidth && line){
      ctx.fillText(line, x, y);
      line = words[n];
      y += lineHeight;
      lines++; if (lines >= maxLines - 1) break;
    } else line = test;
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y);
}

async function safeTry(fn){ try { return await fn(); } catch { return null; } }

$('#savePng').onclick = () => {
  const c = $('#canvas');
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = 'preview.png';
  a.click();
};
