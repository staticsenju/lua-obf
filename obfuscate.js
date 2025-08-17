// obfuscate.js
const fs = require("fs");

// === CONFIG ===
const strictChecks = false; // false = warn instead of error
const embedOrder   = true;  // true = ship explicit shuffle order

// === UTIL ===
function xorshift32(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= (s << 13) >>> 0;
    s ^= (s >>> 17) >>> 0;
    s ^= (s << 5) >>> 0;
    return s >>> 0;
  };
}

// split b64 string into shuffled pieces
function splitAndShuffle(b64, nPieces) {
  const n = Math.max(5, Math.min(48, nPieces | 0));
  const pieceSize = Math.max(64, Math.floor(b64.length / n));
  const pieces = [];
  for (let i = 0; i < b64.length; i += pieceSize) {
    pieces.push(b64.slice(i, i + pieceSize));
  }

  const seed = (Math.random() * 0xffffffff) >>> 0;
  const rnd = xorshift32(seed);
  const ord = Array.from({ length: pieces.length }, (_, i) => i);

  for (let i = ord.length - 1; i > 0; i--) {
    const j = rnd() % (i + 1);
    [ord[i], ord[j]] = [ord[j], ord[i]];
  }

  const shuffled = Array(pieces.length);
  for (let i = 0; i < pieces.length; i++) shuffled[ord[i]] = pieces[i];

  return { pieces: shuffled, ord: ord.map(x => x + 1) }; // 1-based for Lua
}

// === MAIN ===
function obfuscate(luaSource) {
  const b64 = Buffer.from(luaSource, "utf8").toString("base64");
  const { pieces, ord } = splitAndShuffle(b64, 16);

  // encode pieces as Lua table
  const luaPieces = pieces.map(p => `"${p}"`).join(",");
  const luaOrder  = ord.join(",");

  // === Lua STUB ===
  const stub = `
local pieces={${luaPieces}}
${embedOrder ? "local ORD={" + luaOrder + "}" : ""}

-- join pieces
local function join(pieces, ord)
  local t = {}
  if ord then
    for i=1,#ord do
      t[#t+1] = pieces[ ord[i] ]
    end
  else
    -- fallback concat
    for i=1,#pieces do
      t[#t+1] = pieces[i]
    end
  end
  return table.concat(t)
end

local b64 = join(pieces, ${embedOrder ? "ORD" : "nil"})
local raw = (game:GetService("HttpService")):Base64Decode(b64)

-- integrity checks
local function sum32(str)
  local s=0
  for i=1,#str do s=(s+string.byte(str,i))%4294967296 end
  return s
end
local function lz(str) return #str .. "-" .. sum32(str) end

if ${strictChecks} then
  if sum32(raw) ~= sum32(raw) then error("sum1",0) end
else
  if sum32(raw) ~= sum32(raw) then warn("sum1 mismatch") end
end

-- execute
loadstring(raw)()
`;

  return stub;
}

// === CLI ===
if (require.main === module) {
  const input = fs.readFileSync(process.argv[2], "utf8");
  const out = obfuscate(input);
  fs.writeFileSync(process.argv[3] || "out.lua", out);
}