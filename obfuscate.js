import fs from "fs";

// === numeric guard prelude (Lua) ===
const guard = `-- === numeric guard prelude ===
local _bit = bit32 or bit
local function _N(v)
  local tv = typeof and typeof(v) or type(v)
  if tv == "number" then return v end
  if tv == "boolean" then return v and 1 or 0 end
  if v == nil then return 0 end
  if tv == "string" then
    local n = tonumber(v)
    return n or 0
  end
  if tv == "Instance" then
    if v:IsA("NumberValue") or v:IsA("IntValue") then
      return tonumber(v.Value) or 0
    end
    if v:IsA("TextLabel") or v:IsA("TextBox") then
      return tonumber(v.Text) or 0
    end
    local ok, val = pcall(function() return v.Value end)
    if ok and type(val) == "number" then return val end
    ok, val = pcall(function() return v.Text end)
    if ok then return tonumber(val) or 0 end
    return 0
  end
  if tv == "table" then
    local val = rawget(v, "Value")
    if type(val) == "number" then return val end
    if type(val) == "string" then return tonumber(val) or 0 end
  end
  local ok, n = pcall(function() return tonumber(v) end)
  return (ok and n) or 0
end

do
  local _tonumber = tonumber
  function tonumber(x, base)
    local n = _N(x); if base ~= nil then return _tonumber(n, base) end
    return n
  end
  local m = math
  if m then
    local _floor, _ceil, _abs, _clamp, _max, _min, _round =
      m.floor, m.ceil, m.abs, m.clamp, m.max, m.min, m.round
    if _floor then function m.floor(x) return _floor(_N(x)) end end
    if _ceil  then function m.ceil(x)  return _ceil(_N(x))  end end
    if _abs   then function m.abs(x)   return _abs(_N(x))   end end
    if _round then function m.round(x) return _round(_N(x)) end end
    if _clamp then function m.clamp(x,a,b) return _clamp(_N(x), _N(a), _N(b)) end end
    if _max   then function m.max(a,b,...) return _max(_N(a), _N(b), ...) end end
    if _min   then function m.min(a,b,...) return _min(_N(a), _N(b), ...) end end
  end
end
-- === end guard ===
`;

export function obfuscate(code) {
  // stage1 – encode strings
  const strings = [];
  const noStr = code.replace(/"(.*?)"/g, (_, str) => {
    const idx = strings.push(str) - 1;
    return `__STR__(${idx})`;
  });

  // stage2 – runtime string decoder + numeric guard
  const stage2 = `${guard}
local __STRINGS__ = {${strings.map(s => '"' + s.replace(/"/g, '\\"') + '"').join(",")}}
local function __STR__(i) return __STRINGS__[i+1] end

local function _S(idx) return __STR__(idx) end
` + noStr.replace(/__STR__\((\d+)\)/g, "_S(%1)");

  // final wrap
  return `
do
${stage2}
end
`;
}

// CLI
if (process.argv[1].endsWith("obfuscate.js")) {
  const input = fs.readFileSync(process.argv[2], "utf8");
  const output = obfuscate(input);
  console.log(output);
}