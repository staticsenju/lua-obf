/* ========== helpers ========== */
const rint = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const randIdent = (len = rint(6,10))=>{
  const A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const B=A+'0123456789_';
  let s=A[rint(0,A.length-1)];
  for (let i=1;i<len;i++) s+=B[rint(0,B.length-1)];
  return s;
};
const xorBytes = (buf,key)=>{const o=Buffer.allocUnsafe(buf.length);for(let i=0;i<buf.length;i++)o[i]=buf[i]^key;return o;};
const caesar = (buf,shift)=>{const o=Buffer.allocUnsafe(buf.length);for(let i=0;i<buf.length;i++)o[i]=(buf[i]+shift)&0xff;return o;};
const sum32 = (buf)=>{let s=0>>>0;for(let i=0;i<buf.length;i++)s=(s+buf[i])>>>0;return s>>>0;};
const mulHash = (buf)=>{let h=2166136261>>>0;for (let i=0;i<buf.length;i++){h=(h*16777619)>>>0;h=(h^buf[i])>>>0;}return h>>>0;};
const chunk = (str,size)=>{const out=[];for(let i=0;i<str.length;i+=size)out.push(str.slice(i,i+size));return out;};

/* ========== Luau-safe simple minifier (no parser) ========== */
/* Strips --line and --[[block]] comments, preserves strings, trims whitespace */
function simpleMinify(lua){
  let out = '';
  let i = 0, n = lua.length;
  let inStr = false, q = '', esc = false, inLong = false;

  while (i < n) {
    const c = lua[i], c2 = lua[i+1];

    // strings
    if (!inLong && (c === '"' || c === "'")) {
      inStr = true; q = c; esc = false; out += c; i++; continue;
    }
    if (inStr) {
      out += c;
      if (esc) { esc = false; i++; continue; }
      if (c === '\\') { esc = true; i++; continue; }
      if (c === q) { inStr = false; }
      i++; continue;
    }

    // block comment start --[[
    if (!inLong && c === '-' && c2 === '-' && lua[i+2] === '[' && lua[i+3] === '[') {
      inLong = true; i += 4; continue;
    }
    // block comment end ]]
    if (inLong) {
      if (c === ']' && c2 === ']') { inLong = false; i += 2; continue; }
      i++; continue;
    }

    // line comment --
    if (c === '-' && c2 === '-') {
      i += 2;
      while (i < n && lua[i] !== '\n') i++;
      continue;
    }

    // collapse whitespace (keep newlines)
    if (/\s/.test(c)) {
      if (c === '\n') out += '\n';
      else if (out.length && !/\s/.test(out[out.length-1])) out += ' ';
      i++; continue;
    }

    out += c; i++;
  }
  return out.split('\n').map(s=>s.trimEnd()).join('\n');
}

/* ========== string literal handling (no parser) ========== */
function extractStrings(lua) {
  const lits = [];
  let i=0, out=[], n=lua.length;
  while (i<n) {
    const ch = lua[i];
    if (ch === "'" || ch === '"') {
      const q=ch; let j=i+1, esc=false;
      while (j<n) {
        const c=lua[j];
        if (esc){ esc=false; j++; continue; }
        if (c==='\\'){ esc=true; j++; continue; }
        if (c===q){ break; }
        j++;
      }
      const raw = lua.slice(i+1, j);
      const idx = lits.push(raw) - 1;
      out.push(`__STR__(${idx})`);
      i = j+1; continue;
    }
    out.push(ch); i++;
  }
  return { code: out.join(''), strings: lits };
}
function encStr(s) {
  const key = rint(7,251), shift = rint(1,25);
  let b = Buffer.from(s, 'utf8'); b = xorBytes(b,key); b = caesar(b,shift);
  return { b64: Buffer.from(b).toString('base64'), key, shift };
}

/* ========== XORSHIFT32 reorder (bit-exact in JS & Luau) ========== */
function xorshift32(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= (s << 13) >>> 0;
    s ^= (s >>> 17) >>> 0;
    s ^= (s << 5) >>> 0;
    return s >>> 0;
  };
}
function splitAndShuffle(b64, nPieces) {
  const n = Math.max(5, Math.min(48, nPieces|0));
  const pieceSize = Math.max(64, Math.floor(b64.length / n));
  const pieces = chunk(b64, pieceSize);
  const seed = (Math.random()*0xffffffff)>>>0;
  const rnd = xorshift32(seed);
  // Fisher–Yates using rnd()%i
  const idx = Array.from({length: pieces.length}, (_,i)=>i+1);
  for (let i=pieces.length; i>1; i--) {
    const j = (rnd() % i) + 1;
    const t = idx[i-1]; idx[i-1] = idx[j-1]; idx[j-1] = t;
  }
  const shuffled = Array(pieces.length);
  for (let i=0;i<pieces.length;i++) shuffled[idx[i]-1] = pieces[i];
  return { pieces: shuffled, seed };  // we only ship seed now
}

/* ========== stage-2 split (late stitch) ========== */
function splitRawLate(buf, pieces=14) {
  const n = Math.max(6, Math.min(64, pieces|0));
  const sz = Math.max(48, Math.floor(buf.length / n));
  const out=[];
  for (let i=0;i<buf.length;i+=sz) {
    const slice = buf.subarray(i, i+sz);
    const k=rint(7,251), sh=rint(1,25);
    const enc = caesar(xorBytes(slice,k), sh);
    out.push({ b64: Buffer.from(enc).toString('base64'), k, sh, len: slice.length });
  }
  return out;
}

/* ========== MAIN ========== */
export function obfuscate(source, optIn = {}) {
  const opt = {
    junk: true,
    watermark: "",
    split: 10,
    delayFrames: 1,
    latePieces: 14
  , ...optIn};

  // 1) minify safely
  let mini = simpleMinify(source);

  // 2) watermark + junk
  if (opt.watermark) mini = `local __wm='${opt.watermark}'; _G.__wm=(_G.__wm or __wm)\n` + mini;
  if (opt.junk)      mini = `local __j=0 for __i=1,3 do __j=__j+__i end\n` + mini;

  // 3) per-string encryption
  const { code: noStr, strings } = extractStrings(mini);
  const encTable = strings.map(encStr);

  // 4) stage-2 (late stitch)
  const L = { XOR: randIdent(), CA: randIdent(), DEC: randIdent(), S32: randIdent(), HSH: randIdent(),
              P2: randIdent(), K2: randIdent(), S2: randIdent(), L2: randIdent(),
              SSB: randIdent(), SSK: randIdent(), SSS: randIdent(), SSC: randIdent() };

  const stage2Chunks = splitRawLate(Buffer.from(
    `local function _S(idx) return __STR__(idx) end
` + noStr.replace(/__STR__\((\d+)\)/g, '_S(%1)'), 'utf8'), opt.latePieces);

  const P2 = stage2Chunks.map(c=>c.b64), K2 = stage2Chunks.map(c=>c.k),
        S2 = stage2Chunks.map(c=>c.sh),  L2 = stage2Chunks.map(c=>c.len);

  const finalPlain = Buffer.from(noStr.replace(/__STR__\((\d+)\)/g, '_S($1)'), 'utf8');
  const FINAL_LEN = finalPlain.length>>>0;
  const FINAL_SUM = sum32(finalPlain);
  const FINAL_HSH = mulHash(finalPlain);

  const stage2 = `-- stage-2
local ${L.SSB}={ ${encTable.map(e=>`[[${e.b64}]]`).join(',')} }
local ${L.SSK}={ ${encTable.map(e=>e.key).join(',')} }
local ${L.SSS}={ ${encTable.map(e=>e.shift).join(',')} }
local ${L.SSC}={}
local function __STR__(i)
  local v=${L.SSC}[i] if v then return v end
  local p=${L.DEC}(${L.SSB}[i]); p=${L.CA}(p, ${L.SSS}[i]); p=${L.XOR}(p, ${L.SSK}[i])
  ${L.SSC}[i]=p; return p
end
local ${L.P2}={ ${P2.map(s=>`[[${s}]]`).join(',')} }
local ${L.K2}={ ${K2.join(',')} }
local ${L.S2}={ ${S2.join(',')} }
local ${L.L2}={ ${L2.join(',')} }
local function _join()
  local t={}
  for i=1,#${L.P2} do
    local p=${L.DEC}(${L.P2}[i]); p=${L.CA}(p, ${L.S2}[i]); p=${L.XOR}(p, ${L.K2}[i]); t[#t+1]=p
  end
  return table.concat(t)
end
local _final=_join()
local function ${L.S32}(s) local n=0 for i=1,#s do n=(n+s:byte(i))%4294967296 end return n end
local function ${L.HSH}(s) local _b=bit32 or bit if not _b then error('bit lib',0) end
  local bxor=_b.bxor; local h=2166136261
  for i=1,#s do h=((h*16777619)%4294967296); h=bxor(h, s:byte(i)) end
  return h
end
if #_final~=${FINAL_LEN} then error('len mismatch',0) end
if ${L.S32}(_final)~=${FINAL_SUM} then error('sum mismatch',0) end
if ${L.HSH}(_final)~=${FINAL_HSH} then error('hash mismatch',0) end
local f,err=(loadstring or load)(_final); if not f then error(err,0) end; f()
`;

  // 5) stage-1: pack stage-2 with XOR+Caesar, split with xorshift32
  const raw2 = Buffer.from(stage2,'utf8');
  const LEN1=raw2.length>>>0, SUM1=sum32(raw2), HSH1=mulHash(raw2);
  const KEY1=rint(7,251), SHIFT1=rint(1,25);
  const b64 = Buffer.from(caesar(xorBytes(raw2,KEY1),SHIFT1)).toString('base64');
  const { pieces: P1, seed } = splitAndShuffle(b64, opt.split);

  // polymorphic names
  const ID = { K:randIdent(), SH:randIdent(), SL:randIdent(), SM:randIdent(), HH:randIdent(),
               P:randIdent(), SEED:randIdent(),
               B:randIdent(), DEC:randIdent(), CA:randIdent(), XOR:randIdent(),
               S32:randIdent(), LZ:randIdent(), R:randIdent(), W:randIdent(),
               BIT:randIdent(), BX:randIdent(), LS:randIdent(), RS:randIdent(), XS:randIdent() };

  const stub = `--[[ lua-obf v1.5.1 (xorshift32 reorder) ]]
do
  -- bit32/bit fallback
  local ${ID.BIT} = bit32 or bit
  if not ${ID.BIT} then error('bit library missing',0) end
  local ${ID.BX} = ${ID.BIT}.bxor
  local ${ID.LS} = ${ID.BIT}.lshift
  local ${ID.RS} = ${ID.BIT}.rshift

  local ${ID.K}=${KEY1} local ${ID.SH}=${SHIFT1}
  local ${ID.SL}=${LEN1} local ${ID.SM}=${SUM1} local ${ID.HH}=${HSH1}
  local ${ID.P}={ ${P1.map(s=>`[[${s}]]`).join(',')} }
  local ${ID.SEED}=${seed}

  -- base64
  local ${ID.B}='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  local function ${ID.DEC}(s)
    local T,out={},{}
    for i=1,#${ID.B} do T[${ID.B}:sub(i,i)]=i-1 end
    local v,b=0,0
    for i=1,#s do
      local ch=s:sub(i,i)
      local t=T[ch]
      if t~=nil then
        v=v*64+t; b=b+6
        if b>=8 then b=b-8; out[#out+1]=string.char(math.floor(v/(2^b))%256) end
      elseif ch=='=' then
        -- ignore padding
      end
    end
    return table.concat(out)
  end

  local function ${ID.CA}(s,sh) local o={} for i=1,#s do o[i]=string.char((s:byte(i)-sh)%256) end return table.concat(o) end
  local function ${ID.XOR}(s,k) local o={} for i=1,#s do o[i]=string.char(${ID.BX}(s:byte(i),k)) end return table.concat(o) end
  local function ${ID.S32}(s) local n=0 for i=1,#s do n=(n+s:byte(i))%4294967296 end return n end
  local function ${ID.LZ}(s)
    local h=2166136261
    for i=1,#s do h=((h*16777619)%4294967296); h=${ID.BX}(h, s:byte(i)) end
    return h
  end

  -- xorshift32 + Fisher–Yates (matches server exactly)
  local function ${ID.XS}(seed)
    local s = seed % 4294967296
    return function()
      s = ${ID.BX}(s, ${ID.LS}(s,13) % 4294967296)
      s = ${ID.BX}(s, ${ID.RS}(s,17))
      s = ${ID.BX}(s, ${ID.LS}(s,5) % 4294967296)
      return s % 4294967296
    end
  end
  local function ${ID.R}(pieces, seed)
    local n = #pieces
    local idx = {} for i=1,n do idx[i]=i end
    local rnd = ${ID.XS}(seed)
    for i=n,2,-1 do
      local j = (rnd() % i) + 1
      idx[i], idx[j] = idx[j], idx[i]
    end
    local t = {}
    for i=1,n do t[#t+1] = pieces[ idx[i] ] end
    return table.concat(t)
  end

  local ${ID.W} = (task and task.wait) or function(t) local st=os.clock() while os.clock()-st<(t or 0.016) do end end
  ${ID.W}(0.016*${opt.delayFrames|0})

  local joined=${ID.R}(${ID.P}, ${ID.SEED})
  local p=${ID.DEC}(joined); p=${ID.CA}(p,${ID.SH}); local raw=${ID.XOR}(p,${ID.K})

  if #raw~=${ID.SL} then error('len1',0) end
  if ${ID.S32}(raw)~=${ID.SM} then error('sum1',0) end
  if ${ID.LZ}(raw)~=${ID.HH} then error('hash1',0) end

  local f,err=(loadstring or load)(raw); if not f then error(err,0) end; f()
end
`;
  return stub;
}