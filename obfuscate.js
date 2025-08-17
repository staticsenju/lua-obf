
import luamin from 'luamin';

/* ---------- helpers ---------- */
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

/* strings → __STR__(i) placeholders */
function extractStrings(lua) {
  const lits = [];
  let i = 0, out = [];
  while (i < lua.length) {
    const ch = lua[i];
    if (ch === '\'' || ch === '"') {
      const q = ch; let j = i+1, esc = false;
      while (j < lua.length) {
        const c = lua[j];
        if (esc) { esc=false; j++; continue; }
        if (c === '\\') { esc=true; j++; continue; }
        if (c === q) break;
        j++;
      }
      const raw = lua.slice(i+1, j);
      const idx = lits.push(raw) - 1;
      out.push(`__STR__(${idx})`);
      i = j + 1;
    } else { out.push(ch); i++; }
  }
  return { code: out.join(''), strings: lits };
}
function encStr(s) {
  const key = rint(7,251);
  const shift = rint(1,25);
  let b = Buffer.from(s, 'utf8');
  b = xorBytes(b, key);
  b = caesar(b, shift);
  return { b64: Buffer.from(b).toString('base64'), key, shift };
}

/* LCG permutation for shuffled base64 reassembly (no explicit order table) */
function lcgPerm(n, seed) {
  const a = 1103515245>>>0, c = 12345>>>0, m = 0x80000000>>>0;
  let s = seed>>>0;
  const arr = Array.from({length:n},(_,i)=>i+1);
  for (let i=n; i>1; i--) {
    s = ((a * s + c) % m)>>>0;
    const j = 1 + (s % i);
    const tmp = arr[i-1]; arr[i-1] = arr[j-1]; arr[j-1] = tmp;
  }
  return {perm: arr, seed, a, c, m};
}
function splitAndShuffle(b64, nPieces) {
  const n = Math.max(5, Math.min(48, nPieces|0));
  const pieceSize = Math.max(64, Math.floor(b64.length / n));
  const pieces = chunk(b64, pieceSize);
  const seed = rint(0x2000, 0x7fffffff);
  const {perm,a,c,m} = lcgPerm(pieces.length, seed);
  const shuffled = Array(pieces.length);
  for (let i=0;i<pieces.length;i++) shuffled[perm[i]-1] = pieces[i];
  return { pieces: shuffled, seed, a, c, m };
}

/* split raw for late-stitch second stage */
function splitRawLate(rawBuf, pieces=14) {
  const n = Math.max(6, Math.min(64, pieces|0));
  const sz = Math.max(48, Math.floor(rawBuf.length / n));
  const out = [];
  for (let i=0;i<rawBuf.length;i+=sz) {
    const slice = rawBuf.subarray(i, i+sz);
    const k = rint(7,251), sh = rint(1,25);
    const enc = caesar(xorBytes(slice, k), sh);
    out.push({ b64: Buffer.from(enc).toString('base64'), k, sh, len: slice.length });
  }
  return out;
}

export function obfuscate(source, opts) {
  const opt = {
    junk: true,
    watermark: "",
    split: 10,          // stage-1 base64 pieces count
    delayFrames: 2,     // decode after N frames
    useDecoy: true,
    latePieces: 14,     // stage-2 raw split count
    remoteGate: false,  // require server key?
    gateUrl: ""         // e.g. https://your.site/key?id=<wm>
  , ...opts};

  // 1) minify
  let mini = luamin.minify(source);
  // 2) watermark + junk
  if (opt.watermark) mini = `local __wm='${opt.watermark}'; _G.__wm=(_G.__wm or __wm)\n` + mini;
  if (opt.junk)      mini = `local __j=0 for __i=1,3 do __j=__j+__i end\n` + mini;

  // 3) per-string encryption
  const { code: noStr, strings } = extractStrings(mini);
  const encTable = strings.map(encStr);

  // 4) build stage-2 (late-stitch final script from many chunks)
  const L = {
    XOR: randIdent(), CA: randIdent(), DEC: randIdent(),
    S32: randIdent(), HSH: randIdent(), GATE: randIdent(),
    P2: randIdent(), K2: randIdent(), S2: randIdent(), L2: randIdent(),
    SSB: randIdent(), SSK: randIdent(), SSS: randIdent(), SSC: randIdent()
  };

  const stage2Chunks = splitRawLate(Buffer.from(
    `local function _S(idx) return __STR__(idx) end
` + noStr.replace(/__STR__\((\d+)\)/g, '_S(%1)')
  , 'utf8'), opt.latePieces);

  const P2 = stage2Chunks.map(c => c.b64);
  const K2 = stage2Chunks.map(c => c.k);
  const S2 = stage2Chunks.map(c => c.sh);
  const L2 = stage2Chunks.map(c => c.len);

  const finalPlain = Buffer.from(noStr.replace(/__STR__\((\d+)\)/g, '_S($1)'), 'utf8');
  const FINAL_LEN = finalPlain.length>>>0;
  const FINAL_SUM = sum32(finalPlain);
  const FINAL_HSH = mulHash(finalPlain);

  const stage2 = `-- stage-2 late stitch
local ${L.SSB}={ ${encTable.map(e=>`[[${e.b64}]]`).join(',')} }
local ${L.SSK}={ ${encTable.map(e=>e.key).join(',')} }
local ${L.SSS}={ ${encTable.map(e=>e.shift).join(',')} }
local ${L.SSC}={}
local function __STR__(i)
  local v=${L.SSC}[i] if v then return v end
  local b64=${L.SSB}[i] if not b64 then return '' end
  local packed=${L.DEC}(b64)
  local unsh=${L.CA}(packed, ${L.SSS}[i])
  local raw=${L.XOR}(unsh, ${L.SSK}[i])
  ${L.SSC}[i]=raw
  return raw
end

local ${L.P2}={ ${P2.map(s=>`[[${s}]]`).join(',')} }
local ${L.K2}={ ${K2.join(',')} }
local ${L.S2}={ ${S2.join(',')} }
local ${L.L2}={ ${L2.join(',')} }

local __gate = (${opt.remoteGate && opt.gateUrl ? `${L.GATE} or 0` : '0'})
local function _join_final()
  local t={}
  for i=1,#${L.P2} do
    local p=${L.DEC}(${L.P2}[i])
    p=${L.CA}(p, ${L.S2}[i])
    p=${L.XOR}(p, bit32.bxor(${L.K2}[i], __gate))
    t[#t+1]=p
  end
  return table.concat(t)
end

local _final = _join_final()
if #_final ~= ${FINAL_LEN} then error('final len mismatch',0) end
if ${L.S32}(_final) ~= ${FINAL_SUM} then error('final sum mismatch',0) end
if ${L.HSH}(_final) ~= ${FINAL_HSH} then error('final hash mismatch',0) end

local f,err=(loadstring or load)(_final)
if not f then error(err,0) end
f()
`;

  // 5) stage-1 packs stage-2 text
  const raw2Buf = Buffer.from(stage2, 'utf8');
  const LEN1 = raw2Buf.length>>>0;
  const SUM1 = sum32(raw2Buf);
  const HSH1 = mulHash(raw2Buf);
  const KEY1 = rint(7,251);
  const SHIFT1 = rint(1,25);

  let buf1 = caesar(xorBytes(raw2Buf, KEY1), SHIFT1);
  const b641 = Buffer.from(buf1).toString('base64');
  const { pieces: P1, seed, a, c, m } = splitAndShuffle(b641, opt.split);

  // 6) polymorphic names for stage-1
  const ID = {
    K: randIdent(), SH: randIdent(), SM: randIdent(), SL: randIdent(), HH: randIdent(),
    P: randIdent(), SEED: randIdent(), A: randIdent(), C: randIdent(), M: randIdent(),
    B: randIdent(), DEC: randIdent(), CA: randIdent(), XOR: randIdent(),
    S32: randIdent(), LZ: randIdent(), W: randIdent(), R: randIdent(),
    GATE: randIdent()
  };

  // 7) stage-1 stub
  const stub = `--[[ lua-obf v1.4 (hard, no VM) ]]
do
  local ${ID.K}=${KEY1} local ${ID.SH}=${SHIFT1}
  local ${ID.SL}=${LEN1} local ${ID.SM}=${SUM1} local ${ID.HH}=${HSH1}
  local ${ID.P}={ ${P1.map(s=>`[[${s}]]`).join(',')} }
  local ${ID.SEED}=${seed} local ${ID.A}=${a} local ${ID.C}=${c} local ${ID.M}=${m}

  local ${ID.B}='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  local function ${ID.DEC}(s)
    local T,out={},{}
    for i=1,#${ID.B} do T[${ID.B}:sub(i,i)]=i-1 end
    local v,b=0,0
    for i=1,#s do
      local ch=s:sub(i,i); local t=T[ch]
      if t~=nil then v=v*64+t; b=b+6
        if b>=8 then b=b-8; out[#out+1]=string.char(math.floor(v/(2^b))%256) end
      end
    end
    return table.concat(out)
  end
  local function ${ID.CA}(str,shift)
    local o={} for i=1,#str do local by=str:byte(i); o[i]=string.char((by-shift)%256) end
    return table.concat(o)
  end
  local function ${ID.XOR}(str,k)
    local o={} for i=1,#str do o[i]=string.char(bit32.bxor(str:byte(i),k)) end
    return table.concat(o)
  end
  local function ${ID.S32}(s)
    local n=0 for i=1,#s do n=(n+s:byte(i))%4294967296 end
    return n
  end
  local function ${ID.LZ}(s)
    local h=2166136261
    for i=1,#s do h=( (h*16777619) % 4294967296 ); h=bit32.bxor(h, s:byte(i)) end
    return h
  end
  local function ${ID.R}(n,seed,a,c,m)
    local s=seed local idx={} for i=1,n do idx[i]=i end
    for i=n,2,-1 do s=((a*s + c) % m) local j=1+(s % i) idx[i],idx[j]=idx[j],idx[i] end
    local t={} for i=1,n do t[#t+1]=${ID.P}[ idx[i] ] end
    return table.concat(t)
  end

  -- expose remote gate number to stage-2 (if you use /key)
  local function ${ID.GATE}()
    return 0 -- stage-2 can be given a number directly via env if needed
  end
  rawset(_G,'__OBF_GATE', ${ID.GATE})

  local ${ID.W} = (task and task.wait) or (function(t) local ts=os.clock(); while os.clock()-ts < (t or 0.016) do end end)
  for _=1,${opt.delayFrames|0} do ${ID.W}(0.016) end

  local joined = ${ID.R}(#${ID.P}, ${ID.SEED}, ${ID.A}, ${ID.C}, ${ID.M})
  local packed = ${ID.DEC}(joined)
  local xored  = ${ID.CA}(packed, ${ID.SH})
  local raw    = ${ID.XOR}(xored, ${ID.K})

  if #raw ~= ${ID.SL} then error('len1 mismatch',0) end
  if ${ID.S32}(raw) ~= ${ID.SM} then error('sum1 mismatch',0) end
  if ${ID.LZ}(raw)  ~= ${ID.HH} then error('hash1 mismatch',0) end

  -- run stage-2 with helpers & optional gate value
  local env = setmetatable({
    bit32=bit32, task=task, game=game, os=os, tostring=tostring
  }, {__index=_G})

  env[ [=[${L.XOR}]=] ] = ${ID.XOR}
  env[ [=[${L.CA}]=] ]  = ${ID.CA}
  env[ [=[${L.DEC}]=] ] = ${ID.DEC}
  env[ [=[${L.S32}]=] ] = ${ID.S32}
  env[ [=[${L.HSH}]=] ] = ${ID.LZ}
  env[ [=[${L.GATE}]=] ]= (_G.__OBF_GATE and _G.__OBF_GATE()) or 0

  local f,err = (loadstring or load)(raw, nil, nil, env)
  if not f then error(err,0) end
  f()
end
`;
  return stub;
}