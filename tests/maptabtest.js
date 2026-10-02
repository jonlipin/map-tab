// Offline harness for Map Tab: stubs the WoW API in fengari and walks the main paths.
//
//   node tests/maptabtest.js [addon dir] [--bare] [--verbose] [--noenum]
//
//   --bare    every UI template is missing, the way an unexpected client build would look
//   --noenum  no Enum.BagIndex; Map Tab never reads it, and this proves it
//
// The stub carries a small layout engine (points, anchors, scales) because almost everything this
// addon does is geometry: clamping the map to the screen, keeping a corner still while the map is
// scaled, and putting the map back after the game has re-anchored it.
//
// Each scenario runs in a fresh Lua state: a clean install (the long walk through every feature),
// then the ways Casement's data can be waiting at the first login (the old data stub, the old
// Casement still running, nothing at all, and already brought over).
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const argDir = process.argv.slice(2).find(a => !a.startsWith('--'));
const DIR = (argDir || path.resolve(__dirname, '..')).split(path.sep).join('/').replace(/\/?$/, '/');
const files = ['Core.lua', 'Windows.lua', 'Map.lua', 'Data/MapOverlays.lua', 'Reveal.lua', 'Levels.lua', 'Options.lua'];

const stub = String.raw`
local VERBS = { "Set", "Get", "Is", "Create", "Register", "Enable", "Clear", "Hook", "Start", "Stop", "Has", "Num", "Add", "Unregister", "Disable", "Raise", "Lower", "Lock", "Unlock", "Show", "Hide", "Insert", "Toggle" }
local function isMethod(k)
  if type(k) ~= "string" then return false end
  for _, v in ipairs(VERBS) do if k:sub(1, #v) == v then return true end end
  return false
end

FRAMES = {}
TEXTURES = {}
FONTSTRINGS = {}
SCREEN_W, SCREEN_H = 1920, 1080

local FRACX = { LEFT = 0, RIGHT = 1, TOPLEFT = 0, BOTTOMLEFT = 0, TOPRIGHT = 1, BOTTOMRIGHT = 1, TOP = 0.5, BOTTOM = 0.5, CENTER = 0.5 }
local FRACY = { BOTTOM = 0, TOP = 1, BOTTOMLEFT = 0, BOTTOMRIGHT = 0, TOPLEFT = 1, TOPRIGHT = 1, LEFT = 0.5, RIGHT = 0.5, CENTER = 0.5 }

local function EffScale(f)
  local s = f.scale or 1
  local p, guard = f.parent, 0
  while p and guard < 20 do s = s * (p.scale or 1) p = p.parent guard = guard + 1 end
  return s
end

local resolving = {}
function ScreenRect(f)
  if f == nil then return 0, 0, SCREEN_W, SCREEN_H end
  if f == UIParent then return 0, 0, SCREEN_W, SCREEN_H end
  if resolving[f] then return 0, 0, 0, 0 end
  resolving[f] = true
  local eff = EffScale(f)
  local w, h = (f.w or 0) * eff, (f.h or 0) * eff
  local l, b = 0, 0
  if f.allPoints then
    l, b, w, h = ScreenRect(f.allPoints)
  elseif f.points and f.points[1] then
    local p = f.points[1]
    local rel = p[2] or f.parent or UIParent
    local rl, rb, rw, rh = ScreenRect(rel)
    local ax = rl + (FRACX[p[3]] or 0.5) * rw
    local ay = rb + (FRACY[p[3]] or 0.5) * rh
    local sx = ax + (p[4] or 0) * eff
    local sy = ay + (p[5] or 0) * eff
    l = sx - (FRACX[p[1]] or 0.5) * w
    b = sy - (FRACY[p[1]] or 0.5) * h
  end
  resolving[f] = nil
  return l, b, w, h
end

local unpack = unpack or table.unpack

local function obj(kind, template, name)
  local o = { shown = true, scripts = {}, w = 0, h = 0, scale = 1, kind = kind, template = template,
    name = name, points = {}, level = 1, id = 0, mouse = false, enabled = true, kids = {} }
  return setmetatable(o, { __index = function(t, k)
    -- Real child lists matter here: the addon walks the map's children to find the clear parts of
    -- its title bar and to work out what it has to sit above.
    if k == "GetChildren" then return function(s) return unpack(s.kids or {}) end end
    if k == "GetNumChildren" then return function(s) return #(s.kids or {}) end end
    if k == "Show" then return function(s) local was = s.shown s.shown = true if not was and s.scripts.OnShow then s.scripts.OnShow(s) end end end
    if k == "Hide" then return function(s) local was = s.shown s.shown = false if was and s.scripts.OnHide then s.scripts.OnHide(s) end end end
    if k == "SetShown" then return function(s, v) if v then s:Show() else s:Hide() end end end
    if k == "IsShown" or k == "IsVisible" then return function(s) return s.shown end end
    if k == "GetObjectType" then return function(s) return s.kind end end
    if k == "GetName" then return function(s) return s.name end end
    if k == "GetParent" then return function(s) return s.parent end end
    if k == "SetParent" then return function(s, p)
      if s.parent and s.parent.kids then
        for i, kid in ipairs(s.parent.kids) do if kid == s then table.remove(s.parent.kids, i) break end end
      end
      s.parent = p
      if p and p.kids then p.kids[#p.kids + 1] = s end
    end end
    if k == "SetID" then return function(s, v) s.id = v end end
    if k == "GetID" then return function(s) return s.id end end
    if k == "SetScript" then return function(s, e, f) s.scripts[e] = f end end
    if k == "GetScript" then return function(s, e) return s.scripts[e] end end
    if k == "HookScript" then return function(s, e, f) local old = s.scripts[e] s.scripts[e] = function(...) if old then old(...) end f(...) end end end
    if k == "SetSize" then return function(s, w, h) s.w, s.h = w, h end end
    if k == "SetWidth" then return function(s, w) s.w = w end end
    if k == "SetHeight" then return function(s, h) s.h = h end end
    if k == "GetWidth" then return function(s) return s.w end end
    if k == "GetHeight" then return function(s) return s.h end end
    if k == "GetSize" then return function(s) return s.w, s.h end end
    if k == "GetLeft" then return function(s) local l = ScreenRect(s) return l / EffScale(s) end end
    if k == "GetBottom" then return function(s) local _, b = ScreenRect(s) return b / EffScale(s) end end
    if k == "GetRight" then return function(s) local l, _, w = ScreenRect(s) return (l + w) / EffScale(s) end end
    if k == "GetTop" then return function(s) local _, b, _, h = ScreenRect(s) return (b + h) / EffScale(s) end end
    if k == "GetCenter" then return function(s) local l, b, w, h = ScreenRect(s) local e = EffScale(s) return (l + w / 2) / e, (b + h / 2) / e end end
    if k == "SetPoint" then return function(s, a1, a2, a3, a4, a5)
      local rel, relPoint, ox, oy
      if type(a2) == "number" then rel, relPoint, ox, oy = s.parent, a1, a2, a3
      elseif a2 == nil then rel, relPoint, ox, oy = s.parent, a1, 0, 0
      else rel, relPoint, ox, oy = a2, a3 or a1, a4 or 0, a5 or 0 end
      s.points[#s.points + 1] = { a1, rel, relPoint, ox, oy }
      SETPOINTS = SETPOINTS + 1
    end end
    if k == "GetPoint" then return function(s, i)
      local p = s.points[i or 1]
      if not p then return nil end
      return p[1], p[2], p[3], p[4], p[5]
    end end
    if k == "GetNumPoints" then return function(s) return #s.points end end
    if k == "ClearAllPoints" then return function(s) s.points = {} s.allPoints = nil end end
    if k == "SetAllPoints" then return function(s, other) s.allPoints = other or s.parent end end
    if k == "SetScale" then return function(s, v) if type(v) ~= "number" or v <= 0 then error("bad scale") end s.scale = v end end
    if k == "GetScale" then return function(s) return s.scale or 1 end end
    if k == "GetEffectiveScale" then return function(s) return EffScale(s) end end
    if k == "SetMovable" then return function(s, v) s.movable = v end end
    if k == "IsMovable" then return function(s) return s.movable end end
    if k == "SetClampedToScreen" then return function(s, v) s.clamped = v end end
    if k == "StartMoving" then return function(s) if not s.movable then error("frame is not movable") end s.moving = true MOVING = s end end
    if k == "StopMovingOrSizing" then return function(s) s.moving = false MOVING = false end end
    if k == "SetAttribute" then return function(s, key, v) s.attributes = s.attributes or {} s.attributes[key] = v end end
    if k == "GetAttribute" then return function(s, key) return s.attributes and s.attributes[key] end end
    if k == "SetFrameLevel" then return function(s, v) s.level = v end end
    if k == "GetFrameLevel" then return function(s) return s.level end end
    if k == "SetFrameStrata" then return function(s, v)
      local valid = { BACKGROUND = 1, LOW = 1, MEDIUM = 1, HIGH = 1, DIALOG = 1, FULLSCREEN = 1,
        FULLSCREEN_DIALOG = 1, TOOLTIP = 1 }
      if not valid[v] then error("bad strata " .. tostring(v)) end
      s.strata = v
    end end
    if k == "EnableMouse" then return function(s, v) s.mouse = v end end
    if k == "IsMouseEnabled" then return function(s) return s.mouse end end
    if k == "EnableMouseWheel" then return function(s, v) s.wheel = v end end
    if k == "RegisterForDrag" then return function(s, ...) s.dragButtons = { ... } end end
    if k == "RegisterForClicks" then return function() end end
    if k == "SetText" then return function(s, x) s.text = x end end
    if k == "GetText" then return function(s) return s.text end end
    if k == "SetFontObject" or k == "SetNormalFontObject" then return function(s, f) s.font = f end end
    if k == "GetStringWidth" then return function(s) return #tostring(s.text or "") * 6 end end
    if k == "GetStringHeight" then return function(s) return 12 end end
    if k == "SetChecked" then return function(s, v) s.checked = v end end
    if k == "GetChecked" then return function(s) return s.checked end end
    if k == "SetEnabled" then return function(s, v) s.enabled = v end end
    if k == "IsEnabled" then return function(s) return s.enabled end end
    if k == "SetValue" then return function(s, v)
      if s.minV and (v < s.minV - 0.001 or v > s.maxV + 0.001) then error("slider value out of range") end
      s.value = v
      if s.scripts.OnValueChanged then s.scripts.OnValueChanged(s, v) end
    end end
    if k == "GetValue" then return function(s) return s.value or 0 end end
    if k == "SetMinMaxValues" then return function(s, a, b) s.minV, s.maxV = a, b end end
    if k == "GetMinMaxValues" then return function(s) return s.minV or 0, s.maxV or 0 end end
    if k == "SetValueStep" then return function(s, v) s.step = v end end
    if k == "SetOrientation" then return function(s, v) s.orientation = v end end
    if k == "SetThumbTexture" then return function(s, v) s.thumb = obj("texture") s.thumb.parent = s s.thumb.texture = v end end
    if k == "GetThumbTexture" then return function(s) return s.thumb end end
    if k == "SetScrollChild" then return function(s, c) s.scrollChild = c c.parent = s end end
    if k == "SetVerticalScroll" then return function(s, v) s.scrollY = v end end
    if k == "GetVerticalScroll" then return function(s) return s.scrollY or 0 end end
    if k == "SetTexture" then return function(s, x) s.texture = x end end
    if k == "GetTexture" then return function(s) return s.texture end end
    if k == "SetAtlas" then return function(s, x) if BAD_ATLAS then error("no atlas " .. tostring(x)) end s.atlas = x end end
    if k == "SetColorTexture" then return function(s, r, g, b, a) s.color = { r, g, b, a } s.texture = nil end end
    if k == "SetVertexColor" then return function(s, r, g, b) s.vertex = { r, g, b } end end
    if k == "SetTexCoord" then return function(s, a, b, c, d) s.texCoord = { a, b, c, d } end end
    if k == "GetTexCoord" then return function(s) return unpack(s.texCoord or { 0, 1, 0, 1 }) end end
    if k == "SetAlpha" then return function(s, x) s.alpha = x end end
    if k == "GetAlpha" then return function(s) return s.alpha or 1 end end
    if k == "SetJustifyH" or k == "SetJustifyV" or k == "SetWordWrap" then return function() end end
    if k == "SetAutoFocus" or k == "ClearFocus" or k == "SetFocus" then return function() end end
    if k == "SetFontString" then return function(s, f) s.fontString = f end end
    if k == "GetFontString" then return function(s) return s.fontString end end
    if k == "SetNormalTexture" then return function(s, v) s.art = v s.normalArt = v end end
    if k == "GetNormalTexture" then return function(s) return { GetTexture = function() return s.normalArt end } end end
    if k == "SetPushedTexture" or k == "SetHighlightTexture" or k == "SetCheckedTexture" then
      return function(s, v) s.art = v end
    end
    if k == "SetBackdrop" then return function(s, b) s.backdrop = b end end
    if k == "LockHighlight" then return function(s) s.highlighted = true end end
    if k == "UnlockHighlight" then return function(s) s.highlighted = false end end
    if k == "CreateTexture" then return function(s, n, layer, tmpl, sub)
      local r = obj("texture") r.parent = s r.layer = layer r.sub = sub TEXTURES[#TEXTURES + 1] = r return r
    end end
    if k == "CreateFontString" then return function(s, n, layer, font)
      local r = obj("fontstring") r.parent = s r.font = font FONTSTRINGS[#FONTSTRINGS + 1] = r return r
    end end
    if k:sub(1, 6) == "Create" then return function() return obj("region") end end
    if isMethod(k) then return function() end end
    return nil
  end })
end

BAD_TEMPLATES = BAD_TEMPLATES or {}
BAD_ATLAS = BAD_ATLAS or false
SETPOINTS = 0
function CreateFrame(kind, name, parent, template)
  if template and BAD_TEMPLATES[template] then error("Couldn't find inherited node " .. template) end
  local f = obj(kind, template, name)
  f.parent = parent
  if parent and parent.kids then parent.kids[#parent.kids + 1] = f end
  if template == "ButtonFrameTemplate" or template == "DefaultPanelFlatTemplate" or template == "DefaultPanelTemplate" then
    f.NineSlice = obj("Frame") f.TitleText = obj("fontstring") f.Inset = obj("Frame")
  end
  if template == "TooltipBackdropTemplate" or template == "BackdropTemplate" then f.SetBackdrop = function(s, b) s.backdrop = b end end
  if template == "UIPanelButtonTemplate" then f.fontString = obj("fontstring") end
  FRAMES[#FRAMES + 1] = f
  if name then _G[name] = f end
  return f
end

UIParent = obj("Frame") UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
WorldFrame = obj("Frame")
DEFAULT_CHAT_FRAME = { AddMessage = function(_, m) CHAT[#CHAT + 1] = m if VERBOSE then print(m) end end }
CHAT = {}
SlashCmdList = {} UISpecialFrames = {} tinsert = table.insert
time = os.time
date = os.date

NOW = 1000
function GetTime() return NOW end

-- Timers. RunTimers advances the clock and fires anything due, repeatedly, so a callback that
-- schedules another timer is picked up in the same run.
TIMERS = {}
C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { at = NOW + (delay or 0), fn = fn } end }
function RunTimers(seconds)
  local target = NOW + (seconds or 0)
  for _ = 1, 400 do
    local soonest, index = nil, nil
    for i, t in ipairs(TIMERS) do
      if t.at <= target and (not soonest or t.at < soonest) then soonest, index = t.at, i end
    end
    if not index then break end
    local entry = table.remove(TIMERS, index)
    NOW = math.max(NOW, entry.at)
    local ok, err = pcall(entry.fn)
    if not ok then TIMER_ERRORS[#TIMER_ERRORS + 1] = tostring(err) end
  end
  NOW = target
end
TIMER_ERRORS = {}

function hooksecurefunc(name, fn)
  if type(name) == "table" then error("table form not stubbed") end
  local old = _G[name]
  if type(old) ~= "function" then error("no such function " .. tostring(name)) end
  _G[name] = function(...) local r = old(...) fn(...) return r end
  HOOKED[#HOOKED + 1] = name
end
HOOKED = {}

CURSOR = { 900, 600 }
function GetCursorPosition() return CURSOR[1], CURSOR[2] end

SHIFT, CTRL, ALT = false, false, false
function IsShiftKeyDown() return SHIFT end
function IsControlKeyDown() return CTRL end
function IsAltKeyDown() return ALT end

function GetFileIDFromPath(p) return 12345 end
function ChatEdit_InsertLink(link) INSERTED = link end
-- Scratch globals the stub writes to, set up front so they never look like something Map Tab made.
INSERTED, MOVING, OPENED_CHAT = false, false, false

UIPanelWindows = { BankFrame = { area = "left" }, GuildBankFrame = { area = "left" } }
function ShowUIPanel(f) if f then f:Show() end end
function HideUIPanel(f) if f then f:Hide() end end

NO_ENUM = NO_ENUM or false
if not NO_ENUM then
  Enum = { BagIndex = { Backpack = 0, Bag_1 = 1, Bag_2 = 2, Bag_3 = 3, Bag_4 = 4, ReagentBag = 5, Bank = -1 } }
else
  Enum = {}
end

-- The addon list. Nothing but Map Tab is installed unless a scenario says so. LoadAddOn reads an
-- addon's saved variables and fires ADDON_LOADED, which is all a stub with no code does.
--
-- GetAddOnInfo answers with what a scenario sets. The client reports a load on demand addon that
-- is switched on but not loaded yet as NOT loadable, with the reason DEMAND_LOADED (the reason is
-- only given when an addon cannot be loaded right now), so that is what the scenarios use; one
-- scenario keeps the other reading. DISABLED is only reported for an addon that is off for every
-- character; one that is off for this character only (charDisabled) shows up in
-- GetAddOnEnableState and in LoadAddOn's refusal. LoadAddOn decides on its own, as the client does.
ADDONS = {}
LOADED, DISABLED, ENABLED = {}, {}, {}
SAVED_ADDONS = 0
ENABLE_STATE_WHO = false -- the character GetAddOnEnableState was last asked about
ADDON_INFO_ERRORS = ADDON_INFO_ERRORS or false
function UnitName(unit) return "Vatik" end
function UnitGUID(unit) return "Player-70-0A1B2C3D" end
C_AddOns = {
  GetAddOnInfo = function(name)
    local a = ADDONS[name]
    if not a then
      -- Some builds error on a name that is not installed rather than answering MISSING.
      if ADDON_INFO_ERRORS then error("AddOn " .. tostring(name) .. " not found") end
      return name, nil, nil, false, "MISSING"
    end
    return name, a.title or name, "", a.loadable, a.reason
  end,
  IsAddOnLoaded = function(name) return ADDONS[name] ~= nil and ADDONS[name].loaded == true end,
  LoadAddOn = function(name)
    LOADED[#LOADED + 1] = name
    local a = ADDONS[name]
    if not a then return false, "MISSING" end
    if a.loaded then return true end
    if a.refuse then return false, a.refuse end
    if a.reason == "DISABLED" or a.charDisabled then return false, "DISABLED" end
    if not a.lod then return false, "NOT_DEMAND_LOADED" end
    a.loaded = true
    a.loadable, a.reason = true, nil
    if a.onLoad then a.onLoad() end
    if MapTabFrame then MapTabFrame.scripts.OnEvent(MapTabFrame, "ADDON_LOADED", name) end
    return true
  end,
  IsAddOnLoadOnDemand = function(name) return ADDONS[name] ~= nil and ADDONS[name].lod == true end,
  -- 0 off, 1 on for some characters, 2 on for all; with a character, that character's state.
  -- stateZero stands for a client that answers 0 for a character argument it reads differently.
  GetAddOnEnableState = function(name, character)
    ENABLE_STATE_WHO = character
    local a = ADDONS[name]
    if not a or a.reason == "DISABLED" or a.stateZero then return 0 end
    if a.charDisabled then return character ~= nil and 0 or 1 end
    return 2
  end,
  DisableAddOn = function(name) DISABLED[#DISABLED + 1] = name if ADDONS[name] then ADDONS[name].enabled = false end end,
  -- Switching an addon on takes effect at once for LoadAddOn, as it does in the client.
  EnableAddOn = function(name)
    ENABLED[#ENABLED + 1] = name
    local a = ADDONS[name]
    if not a then return end
    a.charDisabled = nil
    if a.reason == "DISABLED" then
      if a.lod then a.loadable, a.reason = false, "DEMAND_LOADED" else a.loadable, a.reason = true, nil end
    end
  end,
  SaveAddOns = function() SAVED_ADDONS = SAVED_ADDONS + 1 end,
}
if NO_ENABLE_STATE then C_AddOns.GetAddOnEnableState = nil end
if NO_ADDON_API then C_AddOns = nil end

-- ------------------------------------------------------------------
-- The world map
-- ------------------------------------------------------------------

WorldMapFrame = CreateFrame("Frame", "WorldMapFrame", UIParent)
WorldMapFrame:SetSize(700, 500)
WorldMapFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 20, -100)
WorldMapFrame.ScrollContainer = CreateFrame("Frame", nil, WorldMapFrame)
-- The canvas the map art is drawn on, at the art's native size, and the map ids around it.
WorldMapFrame.ScrollContainer.Child = CreateFrame("Frame", nil, WorldMapFrame.ScrollContainer)
WorldMapFrame.ScrollContainer.Child:SetSize(1002, 668)
WorldMapFrame.ScrollContainer.Child:SetPoint("TOPLEFT", WorldMapFrame.ScrollContainer, "TOPLEFT", 0, 0)
SHOWN_MAP = 1440
rawset(WorldMapFrame, "GetMapID", function() return SHOWN_MAP end)
CURSOR_NORM = { 0.123, 0.456 }
rawset(WorldMapFrame.ScrollContainer, "GetNormalizedCursorPosition", function()
  if not CURSOR_NORM then return nil end
  return CURSOR_NORM[1], CURSOR_NORM[2]
end)

-- Secret values: a widget takes them, arithmetic on them is an error, exactly like the client.
SECRETS = setmetatable({}, { __mode = "k" })
function issecretvalue(v) return SECRETS[v] == true end
function MakeSecret() local t = {} SECRETS[t] = true return t end

PLAYER_MAP = 1440
PLAYER_POS = { 0.452, 0.678 }
MAP_NAMES = { [1440] = "The Barrens", [1414] = "Kalimdor" }
MAP_ART = { [1440] = 5, [1414] = 12 }
C_Map = {
  GetBestMapForUnit = function() return PLAYER_MAP end,
  GetPlayerMapPosition = function(mapID, unit)
    if not PLAYER_POS then return nil end
    return { x = PLAYER_POS[1], y = PLAYER_POS[2], GetXY = function(self) return self.x, self.y end }
  end,
  GetMapArtID = function(mapID) return MAP_ART[mapID] end,
  GetMapInfo = function(mapID) if MAP_NAMES[mapID] then return { name = MAP_NAMES[mapID], mapID = mapID } end return nil end,
}

-- What the game hands over for explored areas, in the shape the real API uses.
EXPLORED = {
  [1440] = {
    { textureWidth = 300, textureHeight = 200, offsetX = 100, offsetY = 50, fileDataIDs = { 111, 112 } },
  },
}
C_MapExplorationInfo = {
  GetExploredMapTextures = function(mapID) return EXPLORED[mapID] end,
}

-- The map's area label, standing in for the game's AreaLabelFrameMixin. Every frame its OnUpdate
-- writes the name of the map under the cursor, when that is a child of the map on show, adding the
-- game's own range only when C_Map.GetMapLevels has one (on this client it never does); a point of
-- interest's label wins over the zone's. With LABEL_WRITES_ON_CHANGE it rewrites the name only when
-- the text it wants differs from the last it wrote, the way the game's label skips a frame that is
-- not dirty. In --bare the game's quest difficulty colours are missing, so Map Tab's own are used.
PLAYER_LEVEL = 20
function UnitLevel() return PLAYER_LEVEL end
HOVER = nil
CANVAS_FOCUS = false
GAME_LEVELS = {}
POI_LABEL = nil
LABEL_WRITES_ON_CHANGE = false
GAME_LEVELS_ON_DESCRIPTION = false
C_Map.GetMapInfoAtPosition = function(mapID, x, y) return HOVER end
C_Map.GetMapLevels = function(mapID) local l = GAME_LEVELS[mapID] if l then return l[1], l[2], 0, 0 end end
rawset(WorldMapFrame, "IsCanvasMouseFocus", function() return CANVAS_FOCUS end)
rawset(WorldMapFrame, "GetNormalizedCursorPosition", function()
  if not CURSOR_NORM then return nil end
  return CURSOR_NORM[1], CURSOR_NORM[2]
end)
if not BARE then
  QuestDifficultyColors = {
    impossible = { r = 1.00, g = 0.10, b = 0.10 }, verydifficult = { r = 1.00, g = 0.50, b = 0.25 },
    difficult = { r = 1.00, g = 0.82, b = 0.00 }, standard = { r = 0.25, g = 0.75, b = 0.25 },
    trivial = { r = 0.50, g = 0.50, b = 0.50 },
  }
  function UnitQuestTrivialLevelRange() return 5 end
  function GetQuestDifficultyColor(level)
    local diff = level - PLAYER_LEVEL
    if diff >= 5 then return QuestDifficultyColors.impossible end
    if diff >= 3 then return QuestDifficultyColors.verydifficult end
    if diff >= -4 then return QuestDifficultyColors.difficult end
    if -diff <= UnitQuestTrivialLevelRange() then return QuestDifficultyColors.standard end
    return QuestDifficultyColors.trivial
  end
end
AREA_LABEL = CreateFrame("Frame", nil, WorldMapFrame.ScrollContainer)
AREA_LABEL.Name = AREA_LABEL:CreateFontString(nil, "OVERLAY")
AREA_LABEL.Description = AREA_LABEL:CreateFontString(nil, "OVERLAY")
rawset(AREA_LABEL, "EvaluateLabels", function() end)
AREA_LABEL:SetScript("OnUpdate", function(self)
  local text = ""
  if WorldMapFrame:IsCanvasMouseFocus() then
    local x, y = WorldMapFrame:GetNormalizedCursorPosition()
    local info = C_Map.GetMapInfoAtPosition(WorldMapFrame:GetMapID(), x, y)
    if info and info.mapID ~= WorldMapFrame:GetMapID() then
      text = info.name
      local low, high = C_Map.GetMapLevels(info.mapID)
      if low and high and low > 0 and high > 0 then
        if GAME_LEVELS_ON_DESCRIPTION then self.Description:SetText("Level " .. low .. "-" .. high)
        else text = text .. "|cffffd100 (" .. low .. "-" .. high .. ")|r" end
      end
    end
  end
  if POI_LABEL then text = POI_LABEL end
  if LABEL_WRITES_ON_CHANGE and text == self.lastWritten then return end
  self.lastWritten = text
  self.Name:SetText(text)
end)
AREA_PROVIDER = { Label = AREA_LABEL, GetMap = function() return WorldMapFrame end }
AREA_LABEL.dataProvider = AREA_PROVIDER
WorldMapFrame.dataProviders = { [AREA_PROVIDER] = true, [{ Label = { NotTheAreaLabel = true } }] = true, [{}] = true }
function UpdateAreaLabel() AREA_LABEL.scripts.OnUpdate(AREA_LABEL) end

-- The chat line: either open (text goes in at the cursor) or shut (a fresh line is opened).
CHAT_EDIT = obj("EditBox")
CHAT_EDIT:Hide()
rawset(CHAT_EDIT, "Insert", function(self, text) self.inserted = (self.inserted or "") .. text end)
function ChatEdit_GetActiveWindow() return CHAT_EDIT end
function ChatFrame_OpenChat(text) OPENED_CHAT = text end

local function tooltipObj(name)
  local t = obj("GameTooltip", nil, name)
  t.lines = {}
  rawset(t, "SetOwner", function(self) self.lines = {} end)
  rawset(t, "AddLine", function(self, text) self.lines[#self.lines + 1] = { text } end)
  rawset(t, "AddDoubleLine", function(self, left, right) self.lines[#self.lines + 1] = { left, right } end)
  _G[name] = t
  return t
end
GameTooltip = tooltipObj("GameTooltip")
WorldMapFrame:Hide()

-- The map's own top bar: a nav bar on the left and buttons on the right, both taking the mouse.
-- Anything the addon lays across the top bar has to leave these alone.
MAP_NAV = CreateFrame("Frame", "HarnessMapNav", WorldMapFrame)
MAP_NAV:SetSize(220, 24)
MAP_NAV:SetPoint("TOPLEFT", WorldMapFrame, "TOPLEFT", 8, -2)
MAP_NAV:EnableMouse(true)
MAP_NAV:SetFrameLevel(4)

MAP_CLOSE = CreateFrame("Button", "HarnessMapClose", WorldMapFrame)
MAP_CLOSE:SetSize(30, 26)
MAP_CLOSE:SetPoint("TOPRIGHT", WorldMapFrame, "TOPRIGHT", -4, -2)
MAP_CLOSE:EnableMouse(true)
MAP_CLOSE:SetFrameLevel(4)

-- The quest panel. This is the frame that broke the first version: it covers the right hand side
-- of the map, takes the mouse, and sits well above the map's own frame level, so a grip only a few
-- levels up from the map was visible but never received a click.
QuestMapFrame = CreateFrame("Frame", "QuestMapFrame", WorldMapFrame)
QuestMapFrame:SetSize(330, 500)
QuestMapFrame:SetPoint("TOPRIGHT", WorldMapFrame, "TOPRIGHT", 0, 0)
QuestMapFrame:EnableMouse(true)
QuestMapFrame:SetFrameLevel(20)
QUEST_SCROLL = CreateFrame("ScrollFrame", nil, QuestMapFrame)
QUEST_SCROLL:SetSize(330, 470)
QUEST_SCROLL:SetPoint("TOPLEFT", QuestMapFrame, "TOPLEFT", 0, 0)
QUEST_SCROLL:EnableMouse(true)
QUEST_SCROLL:SetFrameLevel(24)
QuestMapFrame:Hide()

-- The game's panel positioning: it re-anchors a panel window to its own spot, and it runs AFTER
-- the window has changed size. That ordering is what made a placed map show a frame at the game's
-- spot when the quest log toggled: the size change was caught, the re-anchor that followed was not.
PANEL_POSITIONINGS = 0
function UpdateUIPanelPositions(frame)
  PANEL_POSITIONINGS = PANEL_POSITIONINGS + 1
  if frame == WorldMapFrame then
    WorldMapFrame:ClearAllPoints()
    WorldMapFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 20, -100)
  end
end

-- Opening and closing the quest panel widens and narrows the map, exactly as the real one does,
-- then the game positions the panel again.
function OpenQuestPanel(open)
  if open then
    WorldMapFrame:SetSize(1030, 500)
    QuestMapFrame:Show()
  else
    WorldMapFrame:SetSize(700, 500)
    QuestMapFrame:Hide()
  end
  if WorldMapFrame.scripts.OnSizeChanged then WorldMapFrame.scripts.OnSizeChanged(WorldMapFrame) end
  UpdateUIPanelPositions(WorldMapFrame)
end

MOUSE_DOWN = false
function IsMouseButtonDown(which) return MOUSE_DOWN end

-- ------------------------------------------------------------------
-- Windows that belong to the other half (Bank Tabs), which Map Tab must leave alone
-- ------------------------------------------------------------------

Minimap = CreateFrame("Frame", "Minimap", UIParent)
Minimap:SetSize(140, 140)
Minimap:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -20, -20)

BankFrame = CreateFrame("Frame", "BankFrame", UIParent)
BankFrame:SetSize(400, 500)
BankFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 40, -120)
BankFrame:Hide()

for i = 1, 3 do
  local f = CreateFrame("Frame", "ContainerFrame" .. i, UIParent)
  f:SetSize(340, 400)
  f:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -20 - (i - 1) * 10, 100)
  f:SetID(i - 1)
  f:Hide()
end
ContainerFrameCombinedBags = CreateFrame("Frame", "ContainerFrameCombinedBags", UIParent)
ContainerFrameCombinedBags:SetSize(420, 600)
ContainerFrameCombinedBags:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -20, 100)
ContainerFrameCombinedBags:Hide()

-- The game re-stacks every open bag window through this one.
function UpdateContainerFrameAnchors()
  local y = 100
  for i = 1, 3 do
    local f = _G["ContainerFrame" .. i]
    if f and f.shown then
      f:ClearAllPoints()
      f:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -20, y)
      y = y + 40
    end
  end
end

-- ------------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------------

CATEGORIES = {}
OPEN_NEEDS_PANEL = OPEN_NEEDS_PANEL ~= false
SettingsPanel = obj("Frame") SettingsPanel:Hide()
SettingsPanel.Open = function(self) self:Show() end
local nextCategoryID = 0
Settings = {
  RegisterCanvasLayoutCategory = function(frame, name)
    nextCategoryID = nextCategoryID + 1
    local c = { frame = frame, name = name, id = "category" .. nextCategoryID }
    c.GetID = function(self) return self.id end
    CATEGORIES[#CATEGORIES + 1] = c
    return c
  end,
  RegisterAddOnCategory = function(c) c.registered = true end,
  OpenToCategory = function(which)
    local cat
    for _, c in ipairs(CATEGORIES) do
      if c.id == which or c == which then cat = c end
    end
    if not cat then return end
    if OPEN_NEEDS_PANEL and not SettingsPanel:IsShown() then return end
    SettingsPanel:Show()
    cat.frame.w, cat.frame.h = 760, 620
    cat.frame:Show()
  end,
}
if NO_SETTINGS then Settings = nil end
`;

// Shared by every scenario: the check helpers, and loading the addon's files in TOC order.
const common = String.raw`
PASS, FAIL = 0, 0
SCENARIO = SCENARIO or "?"
function check(label, cond, extra)
  if cond then PASS = PASS + 1 else FAIL = FAIL + 1 print("FAIL: [" .. SCENARIO .. "] " .. label .. (extra and ("  [" .. tostring(extra) .. "]") or "")) end
end
function near(a, b, slack)
  if type(a) ~= "number" or type(b) ~= "number" then return false end
  return math.abs(a - b) <= (slack or 0.5)
end
function fire(...) MapTabFrame.scripts.OnEvent(MapTabFrame, ...) end
function ChatSaying(text)
  local n = 0
  for _, line in ipairs(CHAT) do if line:find(text, 1, true) then n = n + 1 end end
  return n
end
NS = false
-- Every global in place before Map Tab loads, so what it adds can be told apart.
function LoadMapTab()
  GLOBALS_BEFORE = {}
  for k in pairs(_G) do GLOBALS_BEFORE[k] = true end
  local ns = {}
  for _, file in ipairs(FILES) do
    local chunk, err = load(SOURCES[file], "@" .. file)
    if not chunk then error("SYNTAX " .. tostring(err)) end
    chunk("MapTab", ns)
  end
  NS = ns
  return ns
end
function NewGlobals()
  local out = {}
  for k in pairs(_G) do if not GLOBALS_BEFORE[k] then out[#out + 1] = tostring(k) end end
  table.sort(out)
  return out
end
-- Only Map Tab's own names: everything prefixed MapTab, and its slash command.
function ForeignGlobals(allowed)
  local out = {}
  for _, k in ipairs(NewGlobals()) do
    if not (k:find("^MapTab") or k == "SLASH_MAPTAB1" or (allowed and allowed[k])) then out[#out + 1] = k end
  end
  return out
end
function ReportFailures()
  local failures = {}
  for key, value in pairs(NS.report) do
    if type(value) == "string" and value:find("failed") then failures[#failures + 1] = key .. ": " .. value end
  end
  return failures
end
function Blizzard()
  for _, name in ipairs(LOADED) do if tostring(name):find("^Blizzard_") then return name end end
  return nil
end
`;

// ------------------------------------------------------------------
// Scenario 1: a clean install, the long walk through every feature
// ------------------------------------------------------------------
const cleanInstall = String.raw`
MapTabDB = {}
local ns = LoadMapTab()

-- Drags a window the way a player would: the game moves the frame, then the drag stop script runs.
local function DragTo(frame, region, x, y)
  region.scripts.OnDragStart(region)
  frame:ClearAllPoints()
  frame:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", x, y)
  region.scripts.OnDragStop(region)
end

-- ------------------------------------------------------------------
-- 1. Load
-- ------------------------------------------------------------------
fire("ADDON_LOADED", "MapTab")

check("db built", type(ns.db) == "table" and ns.db.windows ~= nil)
check("defaults filled in", ns.db.map.step == 10 and ns.db.dragModifier == "alt")
check("the new defaults are in", ns.db.map.topBarDrag == true and ns.db.map.cornerHandle == false and ns.db.windows.worldmap == true)
check("only the world map's settings are here", ns.db.minimap == nil and ns.db.vault == nil and ns.db.tooltips == nil
  and ns.db.windows.bags == nil and ns.db.windows.bank == nil)
check("windows module ok", ns.report["windows"] == "ok", ns.report["windows"])
check("map module ok", ns.report["world map"] == "ok", ns.report["world map"])
check("reveal module ok", ns.report["reveal"] == "ok", ns.report["reveal"])
check("options module ok", ns.report["options"] == "ok", ns.report["options"])
check("options category registered", ns.report["options category"] == "ok (canvas page)", ns.report["options category"])
check("category handed to the addon list", CATEGORIES[1] and CATEGORIES[1].registered == true)
for _, key in ipairs({ "map", "about" }) do
  check("page " .. key .. " built", ns.report["page " .. key] == "ok", ns.report["page " .. key])
end
check("every event registered", ns.report["events"]:find("^%d+/%d+ registered$") ~= nil, ns.report["events"])
check("windows were found", (ns.report["windows found"] or ""):find("^%d+"), ns.report["windows found"])
check("no Blizzard addon was loaded by us", Blizzard() == nil, Blizzard())

do -- scope: 1b. The TOC matches what is loaded
  local listed = {}
  for line in TOC_TEXT:gmatch("[^\r\n]+") do
    if not line:find("^##") and line:find("%S") then listed[#listed + 1] = (line:gsub("\\", "/"):gsub("%s+$", "")) end
  end
  local same = #listed == #FILES
  for i, file in ipairs(FILES) do if listed[i] ~= file then same = false end end
  check("the TOC loads exactly the files the harness loads, in that order", same, table.concat(listed, ", "))
  check("the TOC calls it Map Tab, version 1.1.1, like the code does", TOC_TEXT:find("## Title: Map Tab", 1, true) ~= nil
    and TOC_TEXT:find("## Version: 1.1.1", 1, true) ~= nil and ns.version == "1.1.1")
  check("the TOC names Map Tab's own saved variables", TOC_TEXT:find("## SavedVariables: MapTabAccountDB", 1, true) ~= nil
    and TOC_TEXT:find("## SavedVariablesPerCharacter: MapTabDB", 1, true) ~= nil)
  check("the TOC's icon is the map scroll", TOC_TEXT:find("## IconTexture: Interface\\Icons\\INV_Misc_Map_01", 1, true) ~= nil)
  check("the TOC points at Map Tab's own home", TOC_TEXT:find("## X-Website: https://github.com/jonlipin/map-tab", 1, true) ~= nil)
end

do -- scope: 1c. The first login on a clean install: no Casement anywhere
  fire("PLAYER_LOGIN")
  check("with no Casement anywhere, nothing is loaded on demand", #LOADED == 0, #LOADED)
  check("the report says there was nothing to bring over", (ns.report["casement data"] or ""):find("^nothing to bring over") ~= nil, ns.report["casement data"])
  check("the account notes there was nothing, to look again at the next login", MapTabAccountDB.importedCasement == "none")
  check("and so does this character", ns.db.importedCasement == "none")
  check("no chat line about Casement on a clean install", ChatSaying("Casement") == 0, CHAT[#CHAT])
  check("no old Casement is running", ns.report["old casement"] == "not running", ns.report["old casement"])
  check("nothing was switched off", #DISABLED == 0)
end

-- ------------------------------------------------------------------
-- 2. Moving the world map
-- ------------------------------------------------------------------
WorldMapFrame:Show()
RunTimers(1)

local map = WorldMapFrame
check("map is movable", map.movable == true)
check("map is clamped to the screen", map.clamped == true)

-- The corner handle still exists, but it only shows itself when the top bar has no room.
local grip
for _, f in ipairs(FRAMES) do
  if f.parent == map and f.dragButtons and f.w == 22 and f.h == 22 then grip = f end
end
check("map has a corner handle built", grip ~= nil)
check("the handle stays out of the way while the top bar works", grip and grip.shown == false)

-- The draggable stretches of the top bar.
local function TopStrips()
  local out = {}
  for _, f in ipairs(FRAMES) do
    if f.parent == map and f.dragButtons and f.shown and f ~= grip and f.h ~= 22 then out[#out + 1] = f end
  end
  return out
end
local strips = TopStrips()
check("the top bar has a draggable stretch", #strips > 0, #strips)
check("the report says how many", (ns.report["map top bar"] or ""):find("stretches"), ns.report["map top bar"])

-- Nothing the addon laid on the top bar may cover one of the game's own controls.
local function Overlaps(a, b)
  local al, ab, aw = ns.Windows.Measure(a)
  local bl, bb, bw = ns.Windows.Measure(b)
  if not al or not bl then return false end
  return al < bl + bw and bl < al + aw
end
local covered = false
for _, strip in ipairs(strips) do
  if Overlaps(strip, MAP_NAV) or Overlaps(strip, MAP_CLOSE) then covered = true end
end
check("the top bar strips leave the game's own buttons clear", covered == false)

local strip1 = strips[1]
DragTo(map, strip1, 300, 200)
check("map position saved", ns.db.positions["worldmap"] ~= nil)
check("saved x is right", near(ns.db.positions["worldmap"].x, 300), ns.db.positions["worldmap"].x)
check("map actually sits there", near(map:GetLeft(), 300), map:GetLeft())

-- Off the left edge
DragTo(map, strip1, -400, 200)
check("dragged off the left edge is pulled back", near(ns.db.positions["worldmap"].x, 0), ns.db.positions["worldmap"].x)
-- Off the right edge
DragTo(map, strip1, 5000, 200)
check("dragged off the right edge is pulled back", near(ns.db.positions["worldmap"].x, SCREEN_W - 700), ns.db.positions["worldmap"].x)
-- Off the bottom
DragTo(map, strip1, 300, -900)
check("dragged below the screen is pulled back", near(ns.db.positions["worldmap"].y, 0), ns.db.positions["worldmap"].y)
-- Off the top
DragTo(map, strip1, 300, 4000)
check("dragged above the screen is pulled back", near(ns.db.positions["worldmap"].y, SCREEN_H - 500), ns.db.positions["worldmap"].y)
DragTo(map, strip1, 300, 200)

-- The game hides and shows the map again: our position has to win.
map:Hide()
map:ClearAllPoints()
map:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
map:Show()
RunTimers(1)
check("position survives the game re-placing the map", near(map:GetLeft(), 300), map:GetLeft())

-- ------------------------------------------------------------------
-- 3. Scaling the map
-- ------------------------------------------------------------------
local tab = MapTabTab
do -- scope: 3
ns.Map.SetScale(1.3)
check("scale applied to the frame", near(map:GetScale(), 1.3, 0.001), map:GetScale())
check("scale remembered", near(ns.db.map.scale, 1.3, 0.001))
-- GetLeft is in the frame own units, so a scaled frame is measured through the addon helper.
local ml = ns.Windows.Measure(map)
check("map stays put after scaling", near(ml, 300, 1), ml)

ns.Map.SetScale(9)
check("scale is capped at the maximum", near(ns.db.map.scale, 2.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(0.05)
check("scale is capped at the minimum", near(ns.db.map.scale, 0.5, 0.001), ns.db.map.scale)

-- Snapping: from an odd number the buttons land on round tens.
ns.Map.SetScale(0.97)
ns.Map.Step(1)
check("plus snaps up to the next ten percent", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.Step(1)
check("plus again is one whole step", near(ns.db.map.scale, 1.1, 0.001), ns.db.map.scale)
ns.Map.Step(-1)
check("minus comes back", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(1.03)
ns.Map.Step(-1)
check("minus snaps down to the previous ten percent", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(0.5)
ns.Map.Step(-1)
check("minus cannot go under the minimum", near(ns.db.map.scale, 0.5, 0.001), ns.db.map.scale)
ns.Map.SetScale(2.0)
ns.Map.Step(1)
check("plus cannot go over the maximum", near(ns.db.map.scale, 2.0, 0.001), ns.db.map.scale)

ns.db.map.step = 25
ns.Map.SetScale(1.0)
ns.Map.Step(1)
check("a different step is obeyed", near(ns.db.map.scale, 1.25, 0.001), ns.db.map.scale)
ns.db.map.step = 10
ns.Map.ResetSize()
check("reset goes back to 100 percent", near(ns.db.map.scale, 1.0, 0.001))

-- The tab under the map holds everything the addon adds, and stays the same size on screen
-- whatever the map is scaled to.
check("the map tab was built", tab ~= nil)
check("the tab wears the game's panel art", (ns.report["map tab panel"] or "") ~= "", ns.report["map tab panel"])
check("the tab hangs off the map itself", tab and tab.parent == map)
check("the resize grip lives in the tab, not on the map", MapTabGrip and MapTabGrip.parent == tab)
ns.Map.SetScale(2.0)
check("the tab counters the map scale", near(tab:GetScale(), 0.5, 0.001), tab:GetScale())
ns.Map.SetScale(1.0)
end -- scope

-- ------------------------------------------------------------------
-- 4. Resizing by the corner
-- ------------------------------------------------------------------
ns.Windows.Place(map, 300, 200)
local mapGrip = MapTabGrip
do -- scope: 4. The resize drag
local before = ns.db.map.scale
MOUSE_DOWN = true
-- The grip starts 700 across and 500 down from the top left corner of the map.
CURSOR = { 1000, 700 }
mapGrip.scripts.OnMouseDown(mapGrip)
CURSOR = { 1150, 600 }
mapGrip.scripts.OnUpdate(mapGrip)
check("dragging the corner out makes the map bigger", ns.db.map.scale > before, ns.db.map.scale)
local ml2, mb2, mw2, mh2 = ns.Windows.Measure(map)
local topAfter = mb2 + mh2
check("the opposite corner stayed still", near(topAfter, 700, 2), topAfter)
CURSOR = { 950, 780 }
mapGrip.scripts.OnUpdate(mapGrip)
check("dragging the corner in makes it smaller", ns.db.map.scale < 1.2, ns.db.map.scale)
SHIFT = true
CURSOR = { 1120, 630 }
mapGrip.scripts.OnUpdate(mapGrip)
local pct = ns.db.map.scale * 100
check("holding shift snaps the drag to ten percent", near(pct % 10, 0, 0.01) or near(pct % 10, 10, 0.01), pct)
SHIFT = false
mapGrip.scripts.OnMouseUp(mapGrip)
check("the resize loop stops when the mouse is let go", mapGrip.scripts.OnUpdate == nil)
check("the position is saved once the drag is over", ns.db.positions["worldmap"] ~= nil)

-- The grip slides away from under the cursor as the map grows, so a mouse up on the grip itself
-- may never arrive. The loop watches the button instead.
CURSOR = { 1000, 700 }
MOUSE_DOWN = true
mapGrip.scripts.OnMouseDown(mapGrip)
CURSOR = { 1100, 640 }
mapGrip.scripts.OnUpdate(mapGrip)
check("the resize is running", mapGrip.scripts.OnUpdate ~= nil)
MOUSE_DOWN = false
mapGrip.scripts.OnUpdate(mapGrip)
check("letting go anywhere on screen ends the resize", mapGrip.scripts.OnUpdate == nil)
ns.Map.SetScale(1.0)
end -- scope

do -- scope: 4b. The quest panel, which is what broke the first version
OpenQuestPanel(true)
RunTimers(1)
check("the quest panel is above the map's own level", QUEST_SCROLL.level > map.level)
check("the tab climbs above the quest panel", tab.level > QUEST_SCROLL.level, tab.level .. " vs " .. QUEST_SCROLL.level)
check("the report names the layer it reached", (ns.report["map tab layer"] or ""):find("%d"), ns.report["map tab layer"])

local wideStrips = TopStrips()
check("the top bar still has somewhere to grab with the panel open", #wideStrips > 0, #wideStrips)
local clash = false
for _, s in ipairs(wideStrips) do
  if Overlaps(s, MAP_NAV) or Overlaps(s, MAP_CLOSE) or Overlaps(s, QuestMapFrame) then clash = true end
end
check("and it still avoids the panel and the buttons", clash == false)

-- Resizing has to work with the panel open, which is the bug that was reported.
local pressesBefore = ns.Map.gripPresses
local scaleBefore = ns.db.map.scale
local ql, qb, qw, qh = ns.Windows.Measure(map)
CURSOR = { ql + qw, qb }
MOUSE_DOWN = true
mapGrip.scripts.OnMouseDown(mapGrip)
check("the grip in the tab took the click with the panel open", ns.Map.gripPresses == pressesBefore + 1)
CURSOR = { ql + qw + 120, qb - 80 }
mapGrip.scripts.OnUpdate(mapGrip)
check("and the map resized", ns.db.map.scale > scaleBefore, ns.db.map.scale)
MOUSE_DOWN = false
mapGrip.scripts.OnUpdate(mapGrip)
ns.Map.SetScale(1.0)

OpenQuestPanel(false)
RunTimers(1)
check("closing the panel leaves the top bar working", #TopStrips() > 0)
end -- scope
local bar = tab

do -- scope: 4b2. A placed map through the quest log toggling
-- The game re-anchors the map AFTER changing its width when the quest log toggles. A placed map
-- must be back in place the instant that finishes, with no frame drawn at the game's spot.
check("the game's panel positioning was hooked", (ns.report["panel position hook"] or ""):find("UpdateUIPanelPositions") ~= nil, ns.report["panel position hook"])
DragTo(map, strip1, 420, 260)
local savedX = ns.db.positions["worldmap"].x
check("the map was placed", near(savedX, 420), savedX)
local before = PANEL_POSITIONINGS
OpenQuestPanel(true)
check("the game positioned the panel", PANEL_POSITIONINGS == before + 1)
check("the map holds its place the instant the quest log opens", near(ns.Windows.Measure(map), savedX, 1), ns.Windows.Measure(map))
RunTimers(1)
check("and a moment later", near(ns.Windows.Measure(map), savedX, 1), ns.Windows.Measure(map))
OpenQuestPanel(false)
check("the map holds its place the instant the quest log closes", near(ns.Windows.Measure(map), savedX, 1), ns.Windows.Measure(map))
RunTimers(1)
check("and stays there", near(ns.Windows.Measure(map), savedX, 1), ns.Windows.Measure(map))

-- A map the user has never touched is still left entirely to the game.
ns.db.positions["worldmap"] = nil
OpenQuestPanel(true)
OpenQuestPanel(false)
RunTimers(1)
check("an unplaced map is left where the game puts it", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
DragTo(map, strip1, 420, 260)

-- A window the user is holding is never snapped back by the game's positioning.
strip1.scripts.OnDragStart(strip1)
map:ClearAllPoints()
map:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", 600, 300)
UpdateUIPanelPositions(map)
check("the game's positioning is ignored while the map is being dragged", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
strip1.scripts.OnDragStop(strip1)
DragTo(map, strip1, 420, 260)
end -- scope

do -- scope: 4c. The hover tint
-- The hover tint on a drag strip answers to the "show me where the drag strips are" switch, which
-- is off by default: a header must not light up under a passing mouse.
ns.db.showGrips = false
ns.Refresh()
local hintTex
for _, t in ipairs(TEXTURES) do
  if t.parent == strip1 and t.color and t.color[1] == 0.35 and t.color[4] == 0.20 then hintTex = t end
end
check("a drag strip carries a hover tint", hintTex ~= nil)
strip1.scripts.OnEnter(strip1)
check("but hovering the header does not light it up by default", hintTex and hintTex.shown == false)
strip1.scripts.OnLeave(strip1)
ns.db.showGrips = true
ns.Refresh()
strip1.scripts.OnEnter(strip1)
check("it lights up once the drag areas are switched on", hintTex and hintTex.shown == true)
strip1.scripts.OnLeave(strip1)
ns.db.showGrips = false
ns.Refresh()
end -- scope

do -- scope: 4d. Coordinates in the tab, and the copy button
map:Show()
RunTimers(1)
local coordsPart = MapTabCoords
local copyBtn = MapTabCopy
check("the tab carries a coordinates part", coordsPart ~= nil and coordsPart.parent == tab)
check("and a copy button", copyBtn ~= nil and copyBtn.parent == tab)
check("coordinates are on by default and shown", ns.db.map.coords == true and coordsPart.shown == true)
check("the coordinates sit at the left end of the tab", coordsPart.points[1] and coordsPart.points[1][4] == 10, coordsPart.points[1] and coordsPart.points[1][4])
local minusBtn
for _, f in ipairs(FRAMES) do if f.parent == tab and f.text == "-" then minusBtn = f end end
check("the sizing controls sit to the right of them", minusBtn and minusBtn.points[1][4] > coordsPart.points[1][4] + coordsPart.w)
local wideTab = tab.w
ns.db.map.coords = false
ns.Refresh()
check("switching the coordinates off hides them", coordsPart.shown == false and copyBtn.shown == false)
check("and the tab shrinks back from the left", tab.w < wideTab, tab.w .. " vs " .. wideTab)
local minusX = minusBtn.points[1][4]
ns.db.map.coords = true
ns.Refresh()
check("switching them on grows the tab leftwards, the sizing end staying put", tab.w > minusX and minusBtn.points[1][4] > minusX)

-- The readout.
local function LineStarting(prefix)
  for _, fs in ipairs(FONTSTRINGS) do
    if fs.parent == coordsPart and type(fs.text) == "string" and fs.text:sub(1, #prefix) == prefix then return fs end
  end
  return nil
end
coordsPart.scripts.OnUpdate(coordsPart, 1)
check("your position is printed as hundredths", LineStarting("You") and LineStarting("You").text == "You  45.2, 67.8", LineStarting("You") and LineStarting("You").text)
check("the cursor position too", LineStarting("Cursor") and LineStarting("Cursor").text == "Cursor  12.3, 45.6", LineStarting("Cursor") and LineStarting("Cursor").text)
CURSOR_NORM = nil
coordsPart.scripts.OnUpdate(coordsPart, 1)
check("a cursor off the map shows dashes", LineStarting("Cursor").text == "Cursor  --")
CURSOR_NORM = { 0.123, 0.456 }
ns.db.map.coordsCursor = false
ns.Refresh()
coordsPart.scripts.OnUpdate(coordsPart, 1)
check("the cursor line can be switched off on its own", LineStarting("Cursor").shown == false)
ns.db.map.coordsCursor = true
ns.Refresh()

-- A position this client keeps secret is shown as unknown, never compared.
local realPos = PLAYER_POS
PLAYER_POS = { MakeSecret(), MakeSecret() }
local okSecret = pcall(coordsPart.scripts.OnUpdate, coordsPart, 1)
check("a secret position does not error", okSecret)
check("and is shown as unknown", LineStarting("You").text == "You  --", LineStarting("You").text)
PLAYER_POS = realPos
coordsPart.scripts.OnUpdate(coordsPart, 1)

-- The copy button.
check("the copy text names the zone first", ns.Map.PlayerCoordText() == "The Barrens 45.2, 67.8", ns.Map.PlayerCoordText())
CHAT_EDIT:Hide()
OPENED_CHAT = false
copyBtn.scripts.OnClick(copyBtn, "LeftButton")
check("with no chat line open, the click opens one with the position in it", OPENED_CHAT == "The Barrens 45.2, 67.8", OPENED_CHAT)
CHAT_EDIT:Show()
CHAT_EDIT.inserted = nil
copyBtn.scripts.OnClick(copyBtn, "LeftButton")
check("with a chat line open, the click puts the position into it", CHAT_EDIT.inserted == "The Barrens 45.2, 67.8", CHAT_EDIT.inserted)
CHAT_EDIT:Hide()
copyBtn.scripts.OnClick(copyBtn, "RightButton")
check("right-click opens the copy box", MapTabCopyBox ~= nil and MapTabCopyBox.shown == true)
check("with the position in it", MapTabCopyBox and MapTabCopyBox.edit.text == "The Barrens 45.2, 67.8")
MapTabCopyBox:Hide()
PLAYER_POS = nil
copyBtn.scripts.OnClick(copyBtn, "LeftButton")
check("with no position to give, the click says so instead", CHAT[#CHAT]:find("not available") ~= nil, CHAT[#CHAT])
check("in Map Tab's own name", CHAT[#CHAT]:find("Map Tab", 1, true) ~= nil, CHAT[#CHAT])
PLAYER_POS = realPos
SlashCmdList["MAPTAB"]("coords")
check("/maptab coords opens the copy box", MapTabCopyBox.shown == true)
MapTabCopyBox:Hide()
end -- scope

do -- scope: 4e. Drawing the unexplored map
local canvasChild = WorldMapFrame.ScrollContainer.Child
local function RevealTiles()
  local out = {}
  for _, t in ipairs(TEXTURES) do
    if t.parent == canvasChild and t.shown and t.texture then out[#out + 1] = t end
  end
  return out
end

check("the reveal found the exploration API", ns.report["map reveal api"] == "GetExploredMapTextures found", ns.report["map reveal api"])
check("the reveal is off by default", ns.db.map.reveal == false)

-- The shipped table, straight from the client's WorldMapOverlay and WorldMapOverlayTile tables.
local shippedMaps = 0
for _ in pairs(ns.Reveal.DATA) do shippedMaps = shippedMaps + 1 end
check("the shipped overlay table is present", shippedMaps >= 60, shippedMaps)
check("the report counts it", (ns.report["map reveal data"] or ""):find("^" .. shippedMaps .. " maps shipped") ~= nil, ns.report["map reveal data"])
-- Overlay 84 in the tables: map art 1244, 160 by 210 at 382,281, one tile, file 272826.
check("a known overlay is in it with its tile", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["160:210:382:281"] == "272826", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["160:210:382:281"])
-- Overlay 85: 315 wide, so two tiles across, in row-major order.
check("a two tile overlay lists its tiles left to right", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["315:256:101:247"] == "272806, 272812", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["315:256:101:247"])
-- Every entry in the table has exactly the tiles its size calls for.
local badShape = 0
for _, overlays in pairs(ns.Reveal.DATA) do
  for key, ids in pairs(overlays) do
    local w, h = key:match("^(%d+):(%d+):")
    local want = math.ceil(tonumber(w) / 256) * math.ceil(tonumber(h) / 256)
    local got = 0
    for _ in tostring(ids):gmatch("%d+") do got = got + 1 end
    if got ~= want then badShape = badShape + 1 end
  end
end
check("every shipped overlay has exactly the tiles its size needs", badShape == 0, badShape)
ns.Reveal.Refresh(true)
check("off, it draws nothing", #RevealTiles() == 0, #RevealTiles())

-- Shipped data for The Barrens' art: the explored overlay the game already draws, one it does
-- not, and one that spans two tiles.
ns.Reveal.DATA[5] = {
  ["300:200:100:50"] = "111, 112",
  ["120:80:600:300"] = "201",
  ["500:200:0:400"] = "301, 302",
}
ns.db.map.reveal = true
ns.db.map.revealTint = "blue"
ns.Refresh()
local tiles = RevealTiles()
check("on, it draws the overlays the game is not drawing", #tiles == 3, #tiles)
local function TileAt(x, y)
  for _, t in ipairs(tiles) do
    if t.points[1] and t.points[1][4] == x and t.points[1][5] == y then return t end
  end
  return nil
end
check("the explored overlay is left to the game", TileAt(100, -50) == nil)
local small = TileAt(600, -300)
check("a small overlay is one tile at its offset", small ~= nil and small.texture == 201)
check("sized to the overlay, not to the tile", small and small.w == 120 and small.h == 80)
check("showing only the used part of its file", small and small.texCoord and near(small.texCoord[2], 120 / 128, 0.001) and near(small.texCoord[4], 80 / 128, 0.001))
local first, second = TileAt(0, -400), TileAt(256, -400)
check("a wide overlay is cut into 256 pixel tiles", first ~= nil and second ~= nil)
check("the first tile is a full 256 wide", first and first.w == 256 and first.texture == 301)
check("the last tile is the remainder", second and second.w == 244 and second.h == 200 and second.texture == 302)
check("the last tile shows 244 of a 256 file", second and second.texCoord and near(second.texCoord[2], 244 / 256, 0.001))
check("the drawn in areas are tinted", small and small.vertex and near(small.vertex[1], 0.62, 0.001) and near(small.vertex[3], 1.0, 0.001))
check("the tiles sit under the game's own overlays", small and small.sub == -1)
check("the report says what was drawn", (ns.report["map reveal"] or ""):find("2 drawn") ~= nil, ns.report["map reveal"])

ns.db.map.revealTint = "none"
ns.Refresh()
small = TileAt(600, -300)
check("no tint leaves the art as it is", small and (small.vertex == nil or (near(small.vertex[1], 1, 0.001) and near(small.vertex[2], 1, 0.001))))

-- The harvest: what the game handed over is remembered account wide.
check("the explored overlay was harvested", MapTabAccountDB.overlays and MapTabAccountDB.overlays[5] and MapTabAccountDB.overlays[5]["300:200:100:50"] == "111, 112")

-- Exploring an area takes it out of our drawing on the next update.
EXPLORED[1440][#EXPLORED[1440] + 1] = { textureWidth = 120, textureHeight = 80, offsetX = 600, offsetY = 300, fileDataIDs = { 201 } }
fire("MAP_EXPLORATION_UPDATED")
tiles = RevealTiles()
check("an area explored since is handed back to the game", TileAt(600, -300) == nil and #tiles == 2, #tiles)

-- An overlay only the harvest knows about (say, from another character) is drawn too.
MapTabAccountDB.overlays[5]["64:64:900:600"] = "401"
ns.Reveal.Refresh(true)
tiles = RevealTiles()
check("harvested overlays are drawn like shipped ones", TileAt(900, -600) ~= nil and TileAt(900, -600).texture == 401)

check("the report describes the shown map", ns.Reveal.Describe():find("The Barrens") ~= nil, ns.Reveal.Describe())
local dumped = ns.Reveal.Dump()
check("the dump opens the copy box with the harvest as Lua", dumped == 1 and MapTabCopyBox.shown == true and MapTabCopyBox.edit.text:find('%[5%] = {') ~= nil)
check("with every harvested overlay in it", MapTabCopyBox.edit.text:find('%["64:64:900:600"%] = "401"') ~= nil)
check("the copy box is titled for Map Tab", MapTabCopyBox.mtTitle and MapTabCopyBox.mtTitle.text == "Map Tab map data", MapTabCopyBox.mtTitle and MapTabCopyBox.mtTitle.text)
MapTabCopyBox:Hide()
SlashCmdList["MAPTAB"]("mapdata")
check("/maptab mapdata prints the report", CHAT[#CHAT]:find("The Barrens") ~= nil, CHAT[#CHAT])

-- Switching the world map feature off takes the reveal with it.
ns.db.windows.worldmap = false
ns.Refresh()
check("switching the map feature off clears the reveal", #RevealTiles() == 0)
ns.db.windows.worldmap = true
ns.db.map.reveal = false
ns.Reveal.DATA[5] = nil
ns.Refresh()
end -- scope

-- ------------------------------------------------------------------
-- 4f. Zone level ranges on the continent map
-- ------------------------------------------------------------------
do -- scope: 4f. Zone level ranges
  local L = ns.Levels
  check("the zone level module is built", type(L) == "table" and type(L.RANGES) == "table")
  check("it hooked into the map's area label, passing over the providers that are not it", L.IsHooked() and L.labelFrame == AREA_LABEL
    and ns.report["zone levels"] == "hooked into the map's area label", ns.report["zone levels"])
  check("it is on by default", ns.db.map.zoneLevels == true and (ns.report["zone levels shown"] or ""):find("^yes") ~= nil,
    ns.report["zone levels shown"])
  local count, sane = 0, true
  for id, r in pairs(L.RANGES) do
    count = count + 1
    if type(id) ~= "number" or type(r) ~= "table" or r[1] < 1 or r[2] > 60 or r[1] > r[2] then sane = false end
  end
  check("the table holds 44 zones, each a range inside 1 to 60", count == 44 and sane, count)
  check("the report counts them", ns.report["zone level table"] == "44 zones", ns.report["zone level table"])
  check("the Forever zones are in it", L.RANGES[2548] and L.RANGES[2548][1] == 35 and L.RANGES[2548][2] == 45
    and L.RANGES[2521] and L.RANGES[2521][2] == 12 and L.RANGES[2665] and L.RANGES[2482] and L.RANGES[2482][1] == 55 and L.RANGES[2482][2] == 60
    and L.RANGES[2652] and L.RANGES[2652][1] == 40 and L.RANGES[2652][2] == 45)
  check("and the zones with no range are not", L.RANGES[1450] == nil and L.RANGES[1453] == nil and L.RANGES[1454] == nil)

  -- The Eastern Kingdoms, pointing at Westfall.
  SHOWN_MAP, CANVAS_FOCUS, PLAYER_LEVEL = 1415, true, 20
  HOVER = { mapID = 1436, name = "Westfall" }
  UpdateAreaLabel()
  check("the zone's range follows its name, yellow while you are inside it", AREA_LABEL.Name:GetText() == "Westfall|cffffd100 (10-20)|r",
    AREA_LABEL.Name:GetText())
  check("and it is remembered for the report", L.lastShown == "Westfall|cffffd100 (10-20)|r")
  PLAYER_LEVEL = 5
  UpdateAreaLabel()
  check("red while it is five or more above you", AREA_LABEL.Name:GetText() == "Westfall|cffff1a1a (10-20)|r", AREA_LABEL.Name:GetText())
  PLAYER_LEVEL = 7
  UpdateAreaLabel()
  check("orange at three or four above you", AREA_LABEL.Name:GetText() == "Westfall|cffff8040 (10-20)|r", AREA_LABEL.Name:GetText())
  PLAYER_LEVEL = 21
  UpdateAreaLabel()
  check("still yellow just past the top, as the game colours a zone below you by two under its top",
    AREA_LABEL.Name:GetText() == "Westfall|cffffd100 (10-20)|r", AREA_LABEL.Name:GetText())
  PLAYER_LEVEL = 23
  UpdateAreaLabel()
  check("green once you have outgrown it", AREA_LABEL.Name:GetText() == "Westfall|cff40bf40 (10-20)|r", AREA_LABEL.Name:GetText())
  PLAYER_LEVEL = 40
  UpdateAreaLabel()
  check("grey once it is far below you", AREA_LABEL.Name:GetText() == "Westfall|cff808080 (10-20)|r", AREA_LABEL.Name:GetText())

  -- Kalimdor, and the Forever zones.
  SHOWN_MAP, PLAYER_LEVEL = 1414, 50
  HOVER = { mapID = 2482, name = "Mount Hyjal" }
  UpdateAreaLabel()
  check("Mount Hyjal is 55-60, its creatures' levels, and red at 50", AREA_LABEL.Name:GetText() == "Mount Hyjal|cffff1a1a (55-60)|r", AREA_LABEL.Name:GetText())
  HOVER = { mapID = 2652, name = "Shen'dralas" }
  PLAYER_LEVEL = 42
  UpdateAreaLabel()
  check("Shen'dralas is 40-45, yellow at 42", AREA_LABEL.Name:GetText() == "Shen'dralas|cffffd100 (40-45)|r", AREA_LABEL.Name:GetText())
  -- No zone in the table is a single level now; the format for one is checked with a stand in.
  L.RANGES[1450] = { 15, 15 }
  HOVER = { mapID = 1450, name = "Moonglade" }
  PLAYER_LEVEL = 20
  UpdateAreaLabel()
  check("a zone of a single level shows that level alone", AREA_LABEL.Name:GetText() == "Moonglade|cff808080 (15)|r", AREA_LABEL.Name:GetText())
  L.RANGES[1450] = nil
  HOVER = { mapID = 1443, name = "Desolace" }
  PLAYER_LEVEL = 33
  UpdateAreaLabel()
  check("Desolace at 33 is yellow", AREA_LABEL.Name:GetText() == "Desolace|cffffd100 (30-40)|r", AREA_LABEL.Name:GetText())
  HOVER = { mapID = 1450, name = "Moonglade" }
  UpdateAreaLabel()
  check("a zone with no range keeps its bare name", AREA_LABEL.Name:GetText() == "Moonglade", AREA_LABEL.Name:GetText())
  SHOWN_MAP, PLAYER_LEVEL = 947, 3
  HOVER = { mapID = 2521, name = "Zephras Isle" }
  UpdateAreaLabel()
  check("Zephras Isle, on the world map, is 1-12", AREA_LABEL.Name:GetText() == "Zephras Isle|cffffd100 (1-12)|r", AREA_LABEL.Name:GetText())
  SHOWN_MAP, PLAYER_LEVEL = 1415, 40
  HOVER = { mapID = 2548, name = "Riverglades" }
  UpdateAreaLabel()
  check("Riverglades is 35-45", AREA_LABEL.Name:GetText() == "Riverglades|cffffd100 (35-45)|r", AREA_LABEL.Name:GetText())

  -- What it must leave alone.
  PLAYER_LEVEL = 20
  HOVER = { mapID = 1436, name = "Westfall" }
  GAME_LEVELS[1436] = { 11, 21 }
  UpdateAreaLabel()
  check("where the game knows the range itself, its text stands and no second range is added",
    AREA_LABEL.Name:GetText() == "Westfall|cffffd100 (11-21)|r", AREA_LABEL.Name:GetText())
  -- A build might show the game's own range on the line under the name instead, the way retail
  -- shows battle pet levels there; the name is then bare, but the zone still has a range already.
  GAME_LEVELS_ON_DESCRIPTION = true
  UpdateAreaLabel()
  check("where the game shows its own range under the name, none is added to the name either",
    AREA_LABEL.Name:GetText() == "Westfall" and AREA_LABEL.Description:GetText() == "Level 11-21", AREA_LABEL.Name:GetText())
  GAME_LEVELS_ON_DESCRIPTION = false
  AREA_LABEL.Description:SetText("")
  GAME_LEVELS = {}
  POI_LABEL = "Sentinel Hill"
  UpdateAreaLabel()
  check("a point of interest's label is left as it is", AREA_LABEL.Name:GetText() == "Sentinel Hill", AREA_LABEL.Name:GetText())
  POI_LABEL = nil
  CANVAS_FOCUS = false
  UpdateAreaLabel()
  check("nothing is added with the mouse off the map", AREA_LABEL.Name:GetText() == "", AREA_LABEL.Name:GetText())
  CANVAS_FOCUS = true
  HOVER = { mapID = 1415, name = "Eastern Kingdoms" }
  UpdateAreaLabel()
  check("nor over the map on show itself", AREA_LABEL.Name:GetText() == "", AREA_LABEL.Name:GetText())
  HOVER = { mapID = 1436, name = "Westfall" }
  LABEL_WRITES_ON_CHANGE = true
  UpdateAreaLabel()
  UpdateAreaLabel()
  UpdateAreaLabel()
  local _, ranges = (AREA_LABEL.Name:GetText() or ""):gsub("%(", "")
  check("frames where the game does not rewrite the name never add a second range", ranges == 1
    and AREA_LABEL.Name:GetText() == "Westfall|cffffd100 (10-20)|r", AREA_LABEL.Name:GetText())
  LABEL_WRITES_ON_CHANGE = false
  AREA_LABEL.lastWritten = nil

  -- Switched off, the game's bare name comes back at once.
  ns.db.map.zoneLevels = false
  ns.Refresh()
  UpdateAreaLabel()
  check("switched off in the options, the zone shows its bare name", AREA_LABEL.Name:GetText() == "Westfall", AREA_LABEL.Name:GetText())
  check("and the report says so", (ns.report["zone levels shown"] or ""):find("^no") ~= nil, ns.report["zone levels shown"])
  ns.db.map.zoneLevels = true
  ns.Refresh()
  SlashCmdList["MAPTAB"]("lock")
  UpdateAreaLabel()
  check("with Map Tab locked, it adds nothing to the map, the ranges included", AREA_LABEL.Name:GetText() == "Westfall", AREA_LABEL.Name:GetText())
  SlashCmdList["MAPTAB"]("unlock")
  UpdateAreaLabel()
  check("unlocked, the range is back", AREA_LABEL.Name:GetText() == "Westfall|cffffd100 (10-20)|r", AREA_LABEL.Name:GetText())

  -- Nothing that goes wrong in Map Tab's part may stop the game's own label working.
  local keep = L.RANGES[1436]
  L.RANGES[1436] = "not a range"
  local ok = pcall(UpdateAreaLabel)
  check("a fault in the table stays inside Map Tab: the label still shows the zone", ok and AREA_LABEL.Name:GetText() == "Westfall",
    AREA_LABEL.Name:GetText())
  L.RANGES[1436] = keep

  SHOWN_MAP, CANVAS_FOCUS, PLAYER_LEVEL, HOVER = 1440, false, 20, nil
  UpdateAreaLabel()
end -- scope

-- ------------------------------------------------------------------
-- 5. Switching the map off
-- ------------------------------------------------------------------
do -- scope: 5
local originalLeft = 20
ns.db.windows.worldmap = false
ns.Refresh()
check("the handle goes away", grip.shown == false)
check("the map goes back where the game had it", near(map:GetLeft(), originalLeft), map:GetLeft())
check("the scale bar is hidden too", bar.shown == false)
check("the map is back to its normal size", near(map:GetScale(), 1, 0.001))
ns.db.windows.worldmap = true
ns.Refresh()
check("switching it back on restores the saved position", near(map:GetLeft(), 420, 1), map:GetLeft())
end -- scope

-- ------------------------------------------------------------------
-- 7. The drag anywhere modifier
-- ------------------------------------------------------------------
local overlay
for _, f in ipairs(FRAMES) do
  if f.parent == map and f.allPoints == map and f.dragButtons then overlay = f end
end
do -- scope: 7
check("the map has a whole window drag overlay", overlay ~= nil)
check("the overlay is out of the way to begin with", overlay.shown == false)
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("holding alt brings the overlay up", overlay.shown == true)
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
check("letting go puts it away", overlay.shown == false)
ns.db.dragModifier = "none"
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("with the modifier off the overlay stays away", overlay.shown == false)
ns.db.dragModifier = "shift"
SHIFT = true
fire("MODIFIER_STATE_CHANGED", "LSHIFT", 1)
check("shift can be chosen instead", overlay.shown == true)
SHIFT = false
ALT = false
fire("MODIFIER_STATE_CHANGED", "LSHIFT", 0)
ns.db.dragModifier = "alt"

-- A window that is not on screen never gets an overlay to click on.
map:Hide()
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("a hidden window gets no overlay", overlay.shown == false)
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
map:Show()
RunTimers(0.1)
end -- scope

-- ------------------------------------------------------------------
-- 8. Screen size changes
-- ------------------------------------------------------------------
do -- scope: 8
ns.Windows.Place(map, 1200, 500)
SCREEN_W, SCREEN_H = 1024, 768
UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
fire("DISPLAY_SIZE_CHANGED")
check("a smaller screen pulls the map back on to it", map:GetLeft() + 700 <= SCREEN_W + 0.5, map:GetLeft())
SCREEN_W, SCREEN_H = 1920, 1080
UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
fire("UI_SCALE_CHANGED")
end -- scope

do -- scope: 11e. The map tab's parts: the grip's art, the reset icon, double-click
local mapTab = MapTabTab
check("the resize grip is a button", mapGrip.kind == "Button")
check("it wears the chat frame's size grabber", (mapGrip.normalArt or ""):find("SizeGrabber") ~= nil, mapGrip.normalArt)
check("the report names that art", ns.report["map grip art"] == "chat frame grabber", ns.report["map grip art"])
check("the reset button wears an icon, even on a bare client", (ns.report["map reset icon"] or ""):find("Interface") ~= nil,
  ns.report["map reset icon"])
local resetButton = mapTab.parts and mapTab.parts.reset
check("the reset button is part of the tab", resetButton ~= nil and resetButton.parent == mapTab)
local resetIcon
for _, t in ipairs(TEXTURES) do if t.parent == resetButton and t.layer == "ARTWORK" then resetIcon = t end end
check("its icon is the map scroll", resetIcon and (resetIcon.texture or ""):find("INV_Misc_Map") ~= nil and resetIcon.shown,
  resetIcon and resetIcon.texture)
check("the icon is trimmed of its border", resetIcon and resetIcon.texCoord and resetIcon.texCoord[1] == 0.07)
ns.Map.SetScale(1.5)
resetButton.scripts.OnClick(resetButton)
check("clicking reset puts the map back to 100 percent", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(1.5)
mapGrip.scripts.OnDoubleClick(mapGrip)
check("double-clicking the grip does the same", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
check("and leaves no resize running", mapGrip.scripts.OnUpdate == nil)
check("the reset button's tooltip runs", pcall(resetButton.scripts.OnEnter, resetButton) and pcall(mapGrip.scripts.OnEnter, mapGrip))

-- The parts sit left to right in the order they are listed, and the tab is as wide as they need.
local order = { "minus", "label", "plus", "reset", "divider", "grip" }
local lastX, ordered, allShown = -1, true, true
for _, key in ipairs(order) do
  local part = mapTab.parts[key]
  local p = part and part.points[1]
  if not (part and part.shown and p and p[2] == mapTab and p[4] > lastX) then ordered = false end
  if part and not part.shown then allShown = false end
  if p then lastX = p[4] end
end
check("the tab's parts sit left to right in their listed order", ordered and allShown)
check("the tab is wide enough for all of them", mapTab.w >= lastX + 18)
ns.db.map.scaleButtons = false
ns.Refresh()
check("with the buttons off only the grip is left", mapTab.parts.minus.shown == false and mapTab.parts.grip.shown == true
  and mapTab.parts.divider.shown == false)
-- The coordinates block, when shown, still sits to the left of it.
local leftBlock = mapTab.parts.coords.shown and (mapTab.parts.coords.w + 4 + mapTab.parts.copy.w + 4 + mapTab.parts.divider2.w + 6) or 0
check("and the grip slides to the left", mapTab.parts.grip.points[1][4] == 10 + leftBlock, mapTab.parts.grip.points[1][4] .. " vs " .. (10 + leftBlock))
ns.db.map.scaleButtons = true
ns.Refresh()
check("switching the buttons back on brings them back", mapTab.parts.minus.shown == true and mapTab.parts.divider.shown == true)
end -- scope

do -- scope: 11g. The corner handle comes back when the top bar has no room
local hog = CreateFrame("Frame", nil, map)
hog:SetSize(700, 26)
hog:SetPoint("TOPLEFT", map, "TOPLEFT", 0, 0)
hog:EnableMouse(true)
hog:SetFrameLevel(6)
ns.Map.Apply()
check("a full top bar leaves no draggable stretches", ns.Map.stripCount == 0, ns.Map.stripCount)
check("so the corner handle shows itself instead", grip.shown == true)
hog:Hide()
ns.Map.Apply()
check("and goes away again once there is room", grip.shown == false)
check("the top bar is back", ns.Map.stripCount > 0)

ns.db.map.cornerHandle = true
ns.Refresh()
check("the handle can also be asked for outright", grip.shown == true)
ns.db.map.cornerHandle = false
ns.Refresh()
end -- scope

do -- scope: 11i. The drag anywhere overlay stays unseen unless asked for
map:Show()
RunTimers(0.1)
local mapOverlay
for _, f in ipairs(FRAMES) do
  if f.parent == map and f.allPoints == map and f.dragButtons and f.tint then mapOverlay = f end
end
check("the map's overlay carries a tint", mapOverlay ~= nil)
ns.db.showGrips = false
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("holding alt brings the overlay up", mapOverlay.shown == true)
check("but paints nothing by default", mapOverlay.tint.alpha == 0, mapOverlay.tint.alpha)
ns.db.showGrips = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("with the drag areas switched on the tint shows", mapOverlay.tint.alpha == 1)
ns.db.showGrips = false
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
check("letting go puts it away", mapOverlay.shown == false)
end -- scope

do -- scope: 11j. The bags, the bank and the minimap belong to Bank Tabs, and are left alone
BankFrame:Show()
ContainerFrame1:Show()
ContainerFrameCombinedBags:Show()
UpdateContainerFrameAnchors()
fire("BANKFRAME_OPENED")
fire("BAG_OPEN", 0)
RunTimers(1)
local touched = false
for _, f in ipairs(FRAMES) do
  local p = f.parent
  if f.dragButtons and (p == BankFrame or p == ContainerFrame1 or p == ContainerFrameCombinedBags) then touched = true end
end
check("no drag strip is laid on the bank or a bag", touched == false)
check("the bank, the bags and the combined bag are not managed", ns.Windows.Entry(BankFrame) == nil and ns.Windows.Entry(ContainerFrame1) == nil
  and ns.Windows.Entry(ContainerFrameCombinedBags) == nil)
check("the bank is not made movable or taken out of the game's panel stack", BankFrame.movable == nil and BankFrame.attributes == nil)
local bagHook = false
for _, name in ipairs(HOOKED) do if name == "UpdateContainerFrameAnchors" or name == "ContainerFrame_SetPosition" then bagHook = true end end
check("the bag re-stacking is not hooked", bagHook == false)
check("no bag or bank event is even listened for", ns.report["events"] == "7/7 registered", ns.report["events"])
local onMinimap = false
for _, f in ipairs(FRAMES) do if f.parent == Minimap then onMinimap = true end end
check("there is no minimap button", onMinimap == false and _G.MapTabMinimapButton == nil)
BankFrame:Hide()
ContainerFrame1:Hide()
ContainerFrameCombinedBags:Hide()
end -- scope

do -- scope: 11k. Beside another move engine hooking the same panel functions (Bank Tabs does)
-- A second engine that post-hooks the same functions and puts only its own window back. Neither
-- may move the other's window, and the map must still end up where the user left it.
map:Show()
RunTimers(0.1)
DragTo(map, strip1, 420, 260)
local bankSpot = { x = 900, y = 300 }
local otherRuns = 0
local function OtherEngine()
  otherRuns = otherRuns + 1
  if BankFrame.shown then
    BankFrame:ClearAllPoints()
    BankFrame:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", bankSpot.x, bankSpot.y)
  end
end
hooksecurefunc("UpdateUIPanelPositions", OtherEngine)
hooksecurefunc("ShowUIPanel", OtherEngine)
ShowUIPanel(BankFrame)
check("the other engine puts its window where it wants it", near(BankFrame:GetLeft(), 900), BankFrame:GetLeft())
check("the map has not moved", near(ns.Windows.Measure(map), 420, 1), ns.Windows.Measure(map))
OpenQuestPanel(true)
check("the game's panel positioning ran both engines", otherRuns >= 2, otherRuns)
check("the map holds its place through it", near(ns.Windows.Measure(map), 420, 1), ns.Windows.Measure(map))
check("and the other engine's window is exactly where it put it", near(BankFrame:GetLeft(), 900) and near(BankFrame:GetBottom(), 300), BankFrame:GetLeft())
OpenQuestPanel(false)
HideUIPanel(BankFrame)
check("hiding the other window leaves the map in place", near(ns.Windows.Measure(map), 420, 1), ns.Windows.Measure(map))
end -- scope

-- ------------------------------------------------------------------
-- 12. Slash commands
-- ------------------------------------------------------------------
do -- scope: 12
local slash = SlashCmdList["MAPTAB"]
check("slash command registered", type(slash) == "function")
check("as /maptab, and nothing of Casement's or Bank Tabs'", SLASH_MAPTAB1 == "/maptab" and SlashCmdList["CASEMENT"] == nil
  and SlashCmdList["BANKTABS"] == nil and _G.SLASH_CASEMENT1 == nil)
slash("scale 140")
check("/maptab scale sets the size", near(ns.db.map.scale, 1.4, 0.001), ns.db.map.scale)
slash("scale 1.6")
check("/maptab scale also takes a fraction", near(ns.db.map.scale, 1.6, 0.001), ns.db.map.scale)
slash("scale 500")
check("/maptab scale is capped", near(ns.db.map.scale, 2.0, 0.001), ns.db.map.scale)
ns.Map.ResetSize()
check("the map has a saved spot going into the lock", ns.db.positions["worldmap"] ~= nil and near(ns.Windows.Measure(map), 420, 1), ns.Windows.Measure(map))
slash("lock")
check("/maptab lock turns the world map switch off", ns.db.windows.worldmap == false)
check("which hands the map back at its own size and hides the tab", MapTabTab.shown == false and grip.shown == false
  and near(map:GetScale(), 1, 0.001))
check("and puts it back where the game had it", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
-- Locked, the saved spot is kept for later but never used: the map is the game's.
OpenQuestPanel(true)
RunTimers(1)
check("a locked map is not put back at its saved spot when the quest log opens", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
OpenQuestPanel(false)
RunTimers(1)
check("nor when it closes", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
fire("UI_SCALE_CHANGED")
RunTimers(1)
check("nor on a UI scale change", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
map:Hide()
map:Show()
RunTimers(1)
check("nor when the map is shown again", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
slash("scale 150")
check("while locked, a size is remembered but not put on the map", near(ns.db.map.scale, 1.5, 0.001) and near(map:GetScale(), 1, 0.001), map:GetScale())
check("and the map stays where the game has it", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
slash("unlock")
check("/maptab unlock turns it back on", ns.db.windows.worldmap == true and MapTabTab.shown == true)
check("with its saved spot, at the size remembered while it was locked", near(ns.Windows.Measure(map), 420, 1) and near(map:GetScale(), 1.5, 0.001),
  ns.Windows.Measure(map))
slash("lock")
check("locked straight from 150 percent, the map goes back to the game's spot at its own size", near(ns.Windows.Measure(map), 20, 1)
  and near(map:GetScale(), 1, 0.001), ns.Windows.Measure(map))
slash("unlock")
-- The saved master switch (a Casement whose master switch was off comes over with it off).
ns.db.enabled = false
ns.Refresh()
check("with the saved master switch off the map is the game's", near(ns.Windows.Measure(map), 20, 1) and MapTabTab.shown == false
  and near(map:GetScale(), 1, 0.001), ns.Windows.Measure(map))
OpenQuestPanel(true)
RunTimers(1)
check("and stays at the game's spot through the quest log", near(ns.Windows.Measure(map), 20, 1), ns.Windows.Measure(map))
OpenQuestPanel(false)
RunTimers(1)
slash("unlock")
check("/maptab unlock turns the saved master switch back on as well", ns.db.enabled == true and ns.db.windows.worldmap == true)
check("so the map really is movable again, as the message says", MapTabTab.shown == true and near(ns.Windows.Measure(map), 420, 1)
  and CHAT[#CHAT]:find("movable and resizable", 1, true) ~= nil, ns.Windows.Measure(map))
ns.Map.SetScale(1.3)
slash("reset")
check("/maptab reset forgets every position", next(ns.db.positions) == nil)
check("and puts the map back to 100 percent", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
slash("debug")
check("/maptab debug prints the report in Map Tab's name", ChatSaying("Map Tab") > 0 and ChatSaying("casement data:") == 1)
slash("grips")
check("/maptab grips toggles the outlines", ns.db.showGrips == true)
slash("grips")
slash("")
slash("nonsense")
check("anything else prints the help", CHAT[#CHAT]:find("Map Tab", 1, true) ~= nil)
check("nothing above threw", true)
end -- scope

-- ------------------------------------------------------------------
-- 13. Options widgets
-- ------------------------------------------------------------------
do -- scope: 13
ns.SyncOptions()
local optionChecks, optionButtons = 0, 0
for _, f in ipairs(FRAMES) do
  if f.kind == "CheckButton" and (f.name or ""):find("^MapTabCheck") then optionChecks = optionChecks + 1 end
  if f.kind == "Button" and f.text ~= nil then optionButtons = optionButtons + 1 end
end
check("the options page has its switches", optionChecks >= 9, optionChecks)
check("the options page has its buttons", optionButtons >= 16, optionButtons)
check("one options category, named Map Tab", #CATEGORIES == 1 and CATEGORIES[1].name == "Map Tab", CATEGORIES[1] and CATEGORIES[1].name)
check("the options window and content carry Map Tab's names", MapTabOptions ~= nil and MapTabWindow ~= nil and MapTabWindow.mtTitle.text == "Map Tab")

local function Labelled(text)
  for _, f in ipairs(FRAMES) do
    if f.kind == "CheckButton" then
      for _, fs in ipairs(FONTSTRINGS) do
        if fs.parent == f and fs.text == text then return f end
      end
    end
  end
  return nil
end
-- The zone level switch, and the page still fitting its frame with it added.
local levelSwitch = Labelled("Zone level ranges on the continent map")
check("the zone level switch is on the World map page", levelSwitch ~= nil)
levelSwitch:SetChecked(false)
levelSwitch.scripts.OnClick(levelSwitch)
check("it writes through to the setting", ns.db.map.zoneLevels == false)
levelSwitch:SetChecked(true)
levelSwitch.scripts.OnClick(levelSwitch)
check("and back on", ns.db.map.zoneLevels == true)
check("the World map page still fits inside its frame", type(ns.optionsPageHeight) == "table" and type(ns.optionsPageHeight.map) == "number"
  and ns.optionsPageHeight.map <= ns.optionsPaneHeight, ns.report["page map height"])
-- Map Tab has one on/off switch, the world map switch, which /maptab lock and unlock flip. The
-- saved master switch shows through it, so no second switch does the same thing.
check("there is no separate master switch doing what the map switch does", Labelled("Map Tab is on") == nil)
local mapSwitch = Labelled("Move and resize the world map")
check("the world map switch is on the page", mapSwitch ~= nil)
mapSwitch:SetChecked(false)
mapSwitch.scripts.OnClick(mapSwitch)
check("it writes through to the world map switch", ns.db.windows.worldmap == false)
mapSwitch:SetChecked(true)
mapSwitch.scripts.OnClick(mapSwitch)
check("and back on", ns.db.windows.worldmap == true)
ns.db.enabled = false
ns.Refresh()
ns.SyncOptions()
check("with the saved master switch off, the map switch shows off", mapSwitch.checked == false)
mapSwitch:SetChecked(true)
mapSwitch.scripts.OnClick(mapSwitch)
check("and turning it on turns both on", ns.db.enabled == true and ns.db.windows.worldmap == true and MapTabTab.shown == true)
local resetRow
for _, f in ipairs(FRAMES) do if f.kind == "Button" and f.text == "Reset" then resetRow = f end end
DragTo(map, strip1, 500, 300)
ns.Map.SetScale(1.4)
-- Switched off here, the map switch does what /maptab lock does: the map goes back to the game,
-- and its saved spot and size wait for it to be switched on again. Only Reset forgets them.
local placed = ns.db.positions["worldmap"]
local placedX = placed and placed.x
mapSwitch:SetChecked(false)
mapSwitch.scripts.OnClick(mapSwitch)
check("switched off on the page, the map goes back to the game's spot at its own size", near(ns.Windows.Measure(map), 20, 1)
  and near(map:GetScale(), 1, 0.001), ns.Windows.Measure(map))
check("but its saved spot and size are kept, as /maptab lock keeps them", placedX ~= nil and ns.db.positions["worldmap"] ~= nil
  and ns.db.positions["worldmap"].x == placedX and near(ns.db.map.scale, 1.4, 0.001), ns.db.positions["worldmap"] and ns.db.positions["worldmap"].x)
mapSwitch:SetChecked(true)
mapSwitch.scripts.OnClick(mapSwitch)
check("switched back on, the map returns to its spot at its size", near(ns.Windows.Measure(map), placedX or -1, 1)
  and near(map:GetScale(), 1.4, 0.001), ns.Windows.Measure(map))
ns.SyncOptions()
check("its Reset is live once the map has been moved or sized", resetRow ~= nil and resetRow.enabled == true)
resetRow.scripts.OnClick(resetRow)
check("and forgets the position and the size together", ns.db.positions["worldmap"] == nil and near(ns.db.map.scale, 1.0, 0.001))
check("then goes quiet again", resetRow.enabled == false)

-- The size slider brings the rest of the page along as it moves, with no sync from outside.
local sizeSlider, sizeNote
for _, f in ipairs(FRAMES) do if f.kind == "Slider" and f.minV == 50 and f.maxV == 200 then sizeSlider = f end end
for _, fs in ipairs(FONTSTRINGS) do if fs.points[1] and fs.points[1][2] == resetRow then sizeNote = fs end end
check("the map size slider is on the page", sizeSlider ~= nil)
local sliderSets = 0
local realSetValue = sizeSlider.SetValue
rawset(sizeSlider, "SetValue", function(s, v) sliderSets = sliderSets + 1 return realSetValue(s, v) end)
sizeSlider.scripts.OnValueChanged(sizeSlider, 150)
check("moving the size slider sizes the map", near(ns.db.map.scale, 1.5, 0.001) and near(map:GetScale(), 1.5, 0.001), ns.db.map.scale)
check("and lights up the map switch's Reset straight away", resetRow.enabled == true)
check("with the new size shown beside it", sizeNote ~= nil and sizeNote.text == "150%", sizeNote and sizeNote.text)
check("without setting the slider being dragged back", sliderSets == 0, sliderSets)
rawset(sizeSlider, "SetValue", nil)
resetRow.scripts.OnClick(resetRow)
check("and Reset puts it all back", near(ns.db.map.scale, 1.0, 0.001) and resetRow.enabled == false)

-- The drag key and the drag outlines, as they apply to the map.
local altButton
for _, f in ipairs(FRAMES) do if f.kind == "Button" and f.text == "Ctrl" and f.mtValue == "ctrl" then altButton = f end end
check("the drag key can be chosen on the page", altButton ~= nil)
altButton.scripts.OnClick(altButton)
check("and choosing it writes through", ns.db.dragModifier == "ctrl")
ns.db.dragModifier = "alt"
ns.SyncOptions()
end -- scope

-- ------------------------------------------------------------------
-- 14. Saved variables
-- ------------------------------------------------------------------
do -- scope: 14
fire("PLAYER_LOGOUT")
check("the account copy was written at logout", MapTabAccountDB.profile ~= nil)
ns.db.map.scale = 1.2
ns.MirrorToAccount()
check("settings are mirrored account wide", MapTabAccountDB.profile.map.scale == 1.2)
check("the account copy is only the map's", MapTabAccountDB.vault == nil and MapTabAccountDB.profile.minimap == nil)

MapTabDB = {}
fire("PLAYER_LOGIN")
check("a blank character table adopts the account copy", near(ns.db.map.scale, 1.2, 0.001), ns.db.map.scale)
check("and the report says so", ns.report["db player login"] == "adopted the account copy", ns.report["db player login"])
check("positions are not inherited from another character", next(ns.db.positions) == nil)
check("nor the note that another character's Casement settings came over", ns.report["casement data"] ~= "already brought over",
  ns.report["casement data"])

local learned = MapTabAccountDB.overlays and MapTabAccountDB.overlays[5] and MapTabAccountDB.overlays[5]["64:64:900:600"]
ns.ResetToDefaults()
check("a reset keeps the learned map areas", learned == "401" and MapTabAccountDB.overlays[5]["64:64:900:600"] == "401")
check("a reset puts the settings back", near(ns.db.map.scale, 1.0, 0.001))
check("a reset keeps the note about Casement as it was", ns.db.importedCasement == "none")
end -- scope

-- ------------------------------------------------------------------
-- 15. Nothing broke along the way
-- ------------------------------------------------------------------
do -- scope: 15
check("no timer raised an error", #TIMER_ERRORS == 0, TIMER_ERRORS[1])
local failures = ReportFailures()
check("nothing in the report failed", #failures == 0, failures[1])
local chatErrors = 0
for _, line in ipairs(CHAT) do if line:find("failed") then chatErrors = chatErrors + 1 end end
check("no failures printed to chat", chatErrors == 0, chatErrors)
local foreign = ForeignGlobals()
check("every global Map Tab made carries its own name", #foreign == 0, table.concat(foreign, ", "))
check("no Blizzard addon was loaded along the way", Blizzard() == nil, Blizzard())
end -- scope
`;

// ------------------------------------------------------------------
// Scenarios 2 to 6: Casement's data at the first login
// ------------------------------------------------------------------

// What a Casement 1.2.3 user left behind, in the shape it saved it: settings for both halves on
// the character, the account mirror, the reveal's harvest and the saved banks on the account.
const casementData = String.raw`
function CasementAccount()
  return {
    version = "1.2.3",
    profile = { enabled = true, windows = { worldmap = true, bags = true }, dragModifier = "alt", showGrips = false,
      map = { scale = 1.6, coords = true }, positions = {} },
    overlays = {
      [5] = { ["300:200:100:50"] = "111, 112", ["64:64:1:1"] = "999" },
      [12] = { ["10:10:0:0"] = "7" },
    },
    vault = { chars = { ["Player-70-0A1B2C3D"] = { name = "Vatik", bank = { items = 3 } } }, guilds = {} },
  }
end
function CasementCharacter()
  return {
    enabled = true,
    windows = { worldmap = true, combined = true, bags = false, reagent = true, bank = true, guildbank = true },
    dragModifier = "ctrl", showGrips = true,
    minimap = { shown = false, angle = 10 },
    map = { scale = 1.3, step = 5, coords = false, reveal = true, revealTint = "sepia", topBarDrag = true, notAMapTabSetting = 1 },
    vault = { autoBank = false }, tooltips = { enabled = false },
    positions = { worldmap = { x = 250, y = 180 }, bag0 = { x = 1, y = 2 }, bank = { x = 3, y = 4 } },
  }
end
`;

const stubPresent = String.raw`
-- Bank Tabs replaced Casement's folder with its "old data" stub: load on demand, no code, only the
-- saved variables. Not loaded yet, the client reports it as not loadable, reason DEMAND_LOADED.
-- The user has also already used Map Tab a little: a step of 25 and one area.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, lod = true, reason = "DEMAND_LOADED", onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
MapTabDB = { map = { step = 25 } }
MapTabAccountDB = { overlays = { [5] = { ["64:64:1:1"] = "mine" } } }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
check("nothing is read from Casement before login", CasementAccountDB == nil and #LOADED == 0)
fire("PLAYER_LOGIN")
check("the old data stub was loaded on demand, once", #LOADED == 1 and LOADED[1] == "Casement", table.concat(LOADED, ","))
check("the map's size came over", near(ns.db.map.scale, 1.3, 0.001), ns.db.map.scale)
check("so did the map's position for this character", ns.db.positions.worldmap and ns.db.positions.worldmap.x == 250 and ns.db.positions.worldmap.y == 180)
check("and the map's switches and the drag key", ns.db.dragModifier == "ctrl" and ns.db.showGrips == true and ns.db.map.coords == false
  and ns.db.map.reveal == true and ns.db.map.revealTint == "sepia")
check("a setting already changed in Map Tab is kept", ns.db.map.step == 25, ns.db.map.step)
check("nothing of the bag and bank half came over", ns.db.minimap == nil and ns.db.vault == nil and ns.db.tooltips == nil
  and ns.db.windows.bags == nil and ns.db.windows.bank == nil and ns.db.positions.bag0 == nil and ns.db.positions.bank == nil)
check("nor the saved banks", MapTabAccountDB.vault == nil)
check("a Casement setting Map Tab does not have is not copied", ns.db.map.notAMapTabSetting == nil)
check("the reveal's learned areas came over for the account", MapTabAccountDB.overlays[12] and MapTabAccountDB.overlays[12]["10:10:0:0"] == "7"
  and MapTabAccountDB.overlays[5]["300:200:100:50"] == "111, 112")
check("an area Map Tab had already learned is kept as it was", MapTabAccountDB.overlays[5]["64:64:1:1"] == "mine")
check("Casement's own tables are read, never changed", CasementDB.map.scale == 1.3 and CasementDB.positions.worldmap.x == 250
  and CasementAccountDB.overlays[5]["64:64:1:1"] == "999" and CasementDB.positions.bag0 ~= nil)
check("the account is marked done", MapTabAccountDB.importedCasement == true)
check("and so is this character", ns.db.importedCasement == true)
check("one chat line says so", ChatSaying("from Casement") == 1, CHAT[#CHAT])
check("naming what came over", ChatSaying("2 map areas") == 1, CHAT[#CHAT])
check("the report says where it came from", (ns.report["casement data"] or ""):find("loaded on demand", 1, true) ~= nil
  and ns.report["casement data"]:find("from this character", 1, true) ~= nil, ns.report["casement data"])
check("the account copy of the settings has them", MapTabAccountDB.profile.map.scale == 1.3)
check("the stub is not the old addon, so nothing is switched off", #DISABLED == 0 and ChatSaying("two addons") == 0)
check("nor is the old Casement remembered as switched off by the notice", MapTabAccountDB.casementStoodDown == nil)

WorldMapFrame:Show()
RunTimers(1)
check("the map opens at the size it had in Casement", near(WorldMapFrame:GetScale(), 1.3, 0.001), WorldMapFrame:GetScale())
check("and where it was left", near(ns.Windows.Measure(WorldMapFrame), 250, 1), ns.Windows.Measure(WorldMapFrame))
check("loading the stub mid-login broke nothing", #ReportFailures() == 0 and #TIMER_ERRORS == 0, ReportFailures()[1] or TIMER_ERRORS[1])
check("no Blizzard addon was loaded", Blizzard() == nil)
local foreign = ForeignGlobals({ CasementAccountDB = true, CasementDB = true })
check("besides the stub's own saved variables, only Map Tab's names were added", #foreign == 0, table.concat(foreign, ", "))
`;

const oldRunning = String.raw`
-- The whole old Casement is still installed and ran this session: its code made CasementFrame
-- and its saved variables are already in memory.
ADDONS.Casement = { title = "Casement", loadable = true, lod = false, loaded = true }
CasementFrame = CreateFrame("Frame", "CasementFrame", UIParent)
CasementAccountDB = CasementAccount()
CasementDB = CasementCharacter()

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("nothing is loaded: the old addon's data is already in memory", #LOADED == 0, table.concat(LOADED, ","))
check("its world map settings came over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.positions.worldmap and ns.db.positions.worldmap.x == 250)
check("its learned map areas came over", MapTabAccountDB.overlays[12] and MapTabAccountDB.overlays[12]["10:10:0:0"] == "7")
check("the report says the data was in memory", (ns.report["casement data"] or ""):find("already in memory", 1, true) ~= nil, ns.report["casement data"])
check("the old Casement is switched off for the next session", #DISABLED == 1 and DISABLED[1] == "Casement", table.concat(DISABLED, ","))
check("and the addon list is saved straight away", SAVED_ADDONS == 1, SAVED_ADDONS)
check("the old addon is never switched back on", #ENABLED == 0)
check("the user is told once, naming both halves", ChatSaying("Casement has been replaced by two addons: Bank Tabs") == 1, CHAT[#CHAT])
check("with how to finish the switch now", ChatSaying("/reload") == 1)
check("and that Map Tab's tab takes over after the reload", ChatSaying("takes over after the reload") == 1, CHAT[#CHAT])
check("Bank Tabs is not installed, so the line says where it comes from", ChatSaying("update Casement in the CurseForge app, where it is now Bank Tabs") == 1, CHAT[#CHAT])
check("the import has its own line as well", ChatSaying("from Casement") == 1)
check("the shared mark is set, so Bank Tabs coming second stays quiet", CASEMENT_REPLACED_NOTICE == "MapTab", CASEMENT_REPLACED_NOTICE)
check("and recorded in the report", (ns.report["old casement"] or ""):find("told the user", 1, true) ~= nil, ns.report["old casement"])

-- The old Casement handles the world map this session, so Map Tab keeps its hands off it: no
-- second tab, no second set of hooks placing the map from another saved spot.
WorldMapFrame:SetScale(1.25) -- the size the old Casement gave the map
WorldMapFrame:Show()
RunTimers(1)
local entry = ns.Windows.Entry(WorldMapFrame)
check("Map Tab leaves the map to the running old Casement this session", ns.MapOn() == false and entry ~= nil and entry.active == false)
check("no tab of Map Tab's is drawn beside the old Casement's", MapTabTab == nil or MapTabTab.shown == false)
check("Map Tab does not make the map movable itself", WorldMapFrame.movable == nil)
check("the size the old Casement gave the map is left alone", near(WorldMapFrame:GetScale(), 1.25, 0.001), WorldMapFrame:GetScale())
check("no draggable stretches are laid along the top bar", ns.Map.stripCount == 0, ns.Map.stripCount)
OpenQuestPanel(true)
RunTimers(1)
check("the map is not moved to Map Tab's saved spot when the quest log opens", near(ns.Windows.Measure(WorldMapFrame), 20 * 1.25, 1), ns.Windows.Measure(WorldMapFrame))
OpenQuestPanel(false)
check("the report says Map Tab stands aside", (ns.report["old casement"] or ""):find("leaves the world map to it", 1, true) ~= nil, ns.report["old casement"])
SlashCmdList["MAPTAB"]("unlock")
check("/maptab unlock says the old Casement has the map until a reload", CHAT[#CHAT]:find("until you /reload", 1, true) ~= nil, CHAT[#CHAT])
check("nothing failed", #ReportFailures() == 0 and #TIMER_ERRORS == 0, ReportFailures()[1] or TIMER_ERRORS[1])
local foreign = ForeignGlobals({ CASEMENT_REPLACED_NOTICE = true })
check("besides the shared notice mark, only Map Tab's names were added", #foreign == 0, table.concat(foreign, ", "))
check("the account remembers the old Casement was switched off by the notice", MapTabAccountDB.casementStoodDown == true)

-- The rest of the session the user works the map in the old Casement, which writes into its own
-- live tables, and changes one thing in Map Tab's options. At logout (or a /reload) the old
-- addon's later changes come over, but never over what was changed in Map Tab meanwhile.
CasementDB.map.scale = 1.2
CasementDB.positions.worldmap = { x = 300, y = 210 }
CasementDB.map.coordsCursor = false
CasementDB.map.revealTint = "blue"
CasementDB.dragModifier = "shift"
ns.db.map.revealTint = "grey"
CasementAccountDB.overlays[20] = { ["1:1:1:1"] = "5" }
fire("PLAYER_LOGOUT")
check("at logout, the size set in the old Casement since login comes over", near(ns.db.map.scale, 1.2, 0.001), ns.db.map.scale)
check("and where the map was moved to", ns.db.positions.worldmap and ns.db.positions.worldmap.x == 300 and ns.db.positions.worldmap.y == 210)
check("and a switch flipped there, and its drag key", ns.db.map.coordsCursor == false and ns.db.dragModifier == "shift")
check("but not over a setting changed in Map Tab since login", ns.db.map.revealTint == "grey", ns.db.map.revealTint)
check("a setting nobody changed stays as it came over", ns.db.map.reveal == true and ns.db.showGrips == true)
check("map areas the old Casement learned since login are merged in", MapTabAccountDB.overlays[20] and MapTabAccountDB.overlays[20]["1:1:1:1"] == "5")
check("the account copy written at logout has the followed values", MapTabAccountDB.profile.map.scale == 1.2 and MapTabAccountDB.profile.positions.worldmap.x == 300)
check("the report says what was followed", (ns.report["casement data"] or ""):find("4 later changes followed from the old Casement and 1 more learned map areas", 1, true) ~= nil,
  ns.report["casement data"])
check("Casement's own tables are still only read", CasementDB.map.revealTint == "blue" and CasementDB.positions.worldmap.x == 300)
check("nothing is said at logout", ChatSaying("later change") == 0)
`;

const oldRunningFollowReset = String.raw`
-- The old Casement is running; in it the user puts the map back where the game had it, which
-- forgets its saved spot. Map Tab forgets the spot it brought over at login as well.
ADDONS.Casement = { title = "Casement", loadable = true, lod = false, loaded = true }
CasementFrame = CreateFrame("Frame", "CasementFrame", UIParent)
CasementAccountDB = CasementAccount()
CasementDB = CasementCharacter()

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("the map's spot came over at login", ns.db.positions.worldmap and ns.db.positions.worldmap.x == 250)
CasementDB.positions.worldmap = nil
fire("PLAYER_LOGOUT")
check("a spot forgotten in the old Casement is forgotten here too", ns.db.positions.worldmap == nil)
check("the size, untouched in both, stays as it came over", near(ns.db.map.scale, 1.3, 0.001), ns.db.map.scale)
check("nothing failed", #ReportFailures() == 0 and #TIMER_ERRORS == 0, ReportFailures()[1] or TIMER_ERRORS[1])
`;

const oldRunningAlreadyImported = String.raw`
-- The old Casement runs again on a character whose settings Map Tab already brought over (the user
-- switched it back on). Nothing is imported this session, so nothing is followed at logout either.
ADDONS.Casement = { title = "Casement", loadable = true, lod = false, loaded = true }
CasementFrame = CreateFrame("Frame", "CasementFrame", UIParent)
CasementAccountDB = CasementAccount()
CasementDB = CasementCharacter()
MapTabAccountDB = { importedCasement = true, overlays = {} }
MapTabDB = { importedCasement = true, map = { scale = 1.1 } }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
CasementDB.map.scale = 1.7
fire("PLAYER_LOGOUT")
check("already brought over, the old Casement's size is not followed at logout", near(ns.db.map.scale, 1.1, 0.001), ns.db.map.scale)
check("and its learned areas are not merged", next(MapTabAccountDB.overlays) == nil)
check("it is still switched off, and the account remembers the notice did it", #DISABLED == 1 and MapTabAccountDB.casementStoodDown == true)
`;

const oldRunningMapTabFirst = String.raw`
-- The old Casement is running and Bank Tabs is installed too, but Map Tab reaches PLAYER_LOGIN
-- first: it speaks, and needs no word about where Bank Tabs comes from.
ADDONS.Casement = { title = "Casement", loadable = true, lod = false, loaded = true }
ADDONS.BankTabs = { title = "Bank Tabs", loadable = true, lod = false, loaded = true }
CasementFrame = CreateFrame("Frame", "CasementFrame", UIParent)
CasementAccountDB = CasementAccount()
CasementDB = CasementCharacter()

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("Map Tab tells the user once", ChatSaying("Casement has been replaced by two addons") == 1, CHAT[#CHAT])
check("with Bank Tabs installed, nothing about getting it", ChatSaying("CurseForge") == 0, CHAT[#CHAT])
check("and sets the shared mark", CASEMENT_REPLACED_NOTICE == "MapTab", CASEMENT_REPLACED_NOTICE)
check("the map is still left to the old Casement this session", ns.MapOn() == false)
`;

const oldRunningWithBankTabs = String.raw`
-- The old Casement is running, and so is Bank Tabs, which reached PLAYER_LOGIN first: it has
-- switched the old addon off, told the user and set the shared mark. Map Tab must stay quiet and
-- not switch it off a second time, but still bring its own half over.
ADDONS.Casement = { title = "Casement", loadable = true, lod = false, loaded = true }
ADDONS.BankTabs = { title = "Bank Tabs", loadable = true, lod = false, loaded = true }
CasementFrame = CreateFrame("Frame", "CasementFrame", UIParent)
BankTabsFrame = CreateFrame("Frame", "BankTabsFrame", UIParent)
CasementAccountDB = CasementAccount()
CasementDB = CasementCharacter()
CASEMENT_REPLACED_NOTICE = "BankTabs"
DISABLED[1] = "Casement"

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("with the mark already set, Map Tab says nothing about the old addon", ChatSaying("two addons") == 0, CHAT[#CHAT])
check("and leaves the mark as Bank Tabs set it", CASEMENT_REPLACED_NOTICE == "BankTabs")
check("nor switches it off a second time", #DISABLED == 1 and SAVED_ADDONS == 0, #DISABLED)
check("the report says who did", (ns.report["old casement"] or ""):find("BankTabs already switched it off", 1, true) ~= nil, ns.report["old casement"])
check("Map Tab's half still came over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.positions.worldmap and ns.db.positions.worldmap.x == 250)
check("with Map Tab's own one line", ChatSaying("from Casement") == 1, CHAT[#CHAT])
check("nothing of Bank Tabs' half was taken", MapTabAccountDB.vault == nil and ns.db.positions.bank == nil)
check("the map is left to the old Casement this session all the same", ns.MapOn() == false
  and (ns.report["old casement"] or ""):find("leaves the world map to it", 1, true) ~= nil, ns.report["old casement"])
check("with Bank Tabs having spoken, the account still remembers the notice switched it off", MapTabAccountDB.casementStoodDown == true)
`;

const oldSwitchedOff = String.raw`
-- The old, whole Casement is installed but switched off, so its files cannot be read without
-- running its code. Nothing is marked done: the settings come over at the first login it runs.
ADDONS.Casement = { title = "Casement", loadable = false, reason = "DISABLED", lod = false }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("the old addon switched off is neither switched on nor loaded", #ENABLED == 0 and #LOADED == 0, table.concat(ENABLED, ",") .. "/" .. table.concat(LOADED, ","))
check("nothing is marked done while it cannot be read", MapTabAccountDB.importedCasement == nil and ns.db.importedCasement == nil)
check("the report says it will look again", (ns.report["casement data"] or ""):find("looked for again at the next login", 1, true) ~= nil, ns.report["casement data"])
check("one chat line says why nothing came over", ChatSaying("cannot read the world map settings the old Casement saved while it is switched off") == 1, CHAT[#CHAT])
check("and both ways to fix it: the CurseForge update, or switching it on for one login", ChatSaying("Update Casement in the CurseForge app") == 1
  and ChatSaying("for one login") == 1, CHAT[#CHAT])
check("Map Tab still handles the map meanwhile", ns.MapOn() == true and ns.Windows.Entry(WorldMapFrame).active == true)
fire("PLAYER_LOGIN")
check("a later login while it is still off says nothing more", ChatSaying("cannot read") == 1, CHAT[#CHAT])
check("and still leaves the question open", MapTabAccountDB.importedCasement == nil)

-- The user switches it on for one login: its code runs, and everything happens then.
ADDONS.Casement = { title = "Casement", loadable = true, lod = false, loaded = true }
CasementFrame = CreateFrame("Frame", "CasementFrame", UIParent)
CasementAccountDB = CasementAccount()
CasementDB = CasementCharacter()
fire("PLAYER_LOGIN")
check("at the login it runs, the map's settings come over", near(ns.db.map.scale, 1.3, 0.001) and MapTabAccountDB.importedCasement == true
  and ns.db.importedCasement == true)
check("and it is switched off again, with the one notice", #DISABLED == 1 and ChatSaying("two addons") == 1)
check("the map is handed back to it the moment it is found running", ns.MapOn() == false and ns.Windows.Entry(WorldMapFrame).active == false)
`;

const stubSwitchedOff = String.raw`
-- The data stub is there but switched off: an earlier session switched the old Casement off
-- before it was updated to the stub, and the switch stayed with the folder. The stub runs no code,
-- so it is switched back on and read.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DISABLED", lod = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("a switched off data stub is switched on to be read", #ENABLED == 1 and ENABLED[1] == "Casement", table.concat(ENABLED, ","))
check("then loaded on demand", #LOADED == 1 and LOADED[1] == "Casement")
check("and the map's settings came over", near(ns.db.map.scale, 1.3, 0.001) and MapTabAccountDB.importedCasement == true)
check("the report says it was switched on", (ns.report["casement data stub"] or ""):find("switched back on", 1, true) ~= nil, ns.report["casement data stub"])
check("the stub is not the old addon, so no notice", ChatSaying("two addons") == 0 and #DISABLED == 0)
`;

const stubOffHere = String.raw`
-- The data stub is switched off for this character only. GetAddOnInfo does not say DISABLED for
-- that (only for an addon off for every character); the per character enable state does.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DEMAND_LOADED", lod = true, charDisabled = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("a stub switched off for this character only is switched on to be read", #ENABLED == 1 and ENABLED[1] == "Casement", table.concat(ENABLED, ","))
check("then loaded on demand, once", #LOADED == 1 and LOADED[1] == "Casement", table.concat(LOADED, ","))
check("and the map's settings came over", near(ns.db.map.scale, 1.3, 0.001) and MapTabAccountDB.importedCasement == true and ns.db.importedCasement == true)
check("the report says it was off for this character", (ns.report["casement data stub"] or ""):find("for this character", 1, true) ~= nil, ns.report["casement data stub"])
`;

const stubOffHereNoState = String.raw`
-- The same, on a client with no enable state to ask: LoadAddOn's own refusal says it, and the
-- stub is switched on and loaded at the second try instead of being retried at every login.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DEMAND_LOADED", lod = true, charDisabled = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("refused as switched off, the stub is switched on", #ENABLED == 1 and ENABLED[1] == "Casement", table.concat(ENABLED, ","))
check("and loaded at the second try", #LOADED == 2 and ADDONS.Casement.loaded == true, table.concat(LOADED, ","))
check("so the map's settings came over at this login", near(ns.db.map.scale, 1.3, 0.001) and MapTabAccountDB.importedCasement == true)
`;

const stubRefused = String.raw`
-- The data stub is there and switched on, but the game will not load it. Nothing is marked done,
-- the user is told once per account, and it is tried again at the next login.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DEMAND_LOADED", lod = true, refuse = "INCOMPATIBLE" }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("the load was tried", #LOADED == 1, table.concat(LOADED, ","))
check("nothing is marked done", MapTabAccountDB.importedCasement == nil and ns.db.importedCasement == nil)
check("the report names the game's reason", (ns.report["casement data"] or ""):find("could not be loaded (incompatible)", 1, true) ~= nil, ns.report["casement data"])
check("one chat line says so", ChatSaying("could not open the data the old Casement left behind") == 1, CHAT[#CHAT])
check("a stub that is switched on is not switched on again", #ENABLED == 0)
fire("PLAYER_LOGIN")
check("it is tried again at the next login", #LOADED == 2, #LOADED)
check("without a second chat line", ChatSaying("could not open") == 1)
`;

const stubNothingNew = String.raw`
-- The stub holds Casement data, but every world map setting in it is already Map Tab's default and
-- the reveal had learned nothing. The first import still says, in one line, that it looked.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DEMAND_LOADED", lod = true, onLoad = function()
  CasementAccountDB = { version = "1.2.3", overlays = {}, vault = { chars = {}, guilds = {} } }
  CasementDB = { enabled = true, windows = { worldmap = true, bags = true }, dragModifier = "alt", map = { scale = 1.0, step = 10 } }
end }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("the stub was read", #LOADED == 1 and MapTabAccountDB.importedCasement == true and ns.db.importedCasement == true)
check("the report counts nothing brought over", (ns.report["casement data"] or ""):find("0 settings", 1, true) ~= nil
  and ns.report["casement data"]:find("0 learned map areas", 1, true) ~= nil, ns.report["casement data"])
check("one chat line still says Casement's data was found and nothing needed changing", ChatSaying("nothing in it needed bringing over") == 1, CHAT[#CHAT])
check("and no line claiming something came over", ChatSaying("brought your world map over") == 0)
`;

const stubReportedLoadable = String.raw`
-- The other reading of GetAddOnInfo for a load on demand addon that is switched on: loadable, with
-- no reason. It is loaded on demand all the same.
ADDONS.Casement = { title = "Casement (old data)", loadable = true, lod = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("a stub reported loadable is loaded on demand, once", #LOADED == 1 and LOADED[1] == "Casement", table.concat(LOADED, ","))
check("and nothing is switched on or off", #ENABLED == 0 and #DISABLED == 0)
check("the map's settings came over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.positions.worldmap and ns.db.positions.worldmap.x == 250)
check("with the one chat line", ChatSaying("from Casement") == 1, CHAT[#CHAT])
`;

const nothingPresent = String.raw`
-- No Casement at all, on a client whose addon list errors on a name that is not installed.
ADDON_INFO_ERRORS = true

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("an addon list that errors on an unknown name is taken in its stride", (ns.report["casement data"] or ""):find("not installed", 1, true) ~= nil,
  ns.report["casement data"])
check("nothing is loaded", #LOADED == 0)
check("nothing is switched off", #DISABLED == 0)
check("the account and this character note there was nothing, to look again", MapTabAccountDB.importedCasement == "none" and ns.db.importedCasement == "none")
check("no chat line about Casement", ChatSaying("Casement") == 0)
check("the defaults stand", near(ns.db.map.scale, 1.0, 0.001) and ns.db.positions.worldmap == nil)
WorldMapFrame:Show()
RunTimers(1)
check("the map tab is built as usual", MapTabTab ~= nil and MapTabTab.shown == true)
check("nothing failed", #ReportFailures() == 0 and #TIMER_ERRORS == 0, ReportFailures()[1] or TIMER_ERRORS[1])
`;

const stubTurnsUpLater = String.raw`
-- Map Tab was installed first, on an account with no Casement anywhere. Later Bank Tabs arrives
-- and brings the "old data" stub with it (the author's old Casement files were still in WTF). The
-- clean login must not have closed the question: the next login finds the stub and brings the
-- map's settings over, once.
local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("the clean login loads nothing and says nothing", #LOADED == 0 and ChatSaying("Casement") == 0, table.concat(LOADED, ","))
check("and only notes there was nothing", MapTabAccountDB.importedCasement == "none" and ns.db.importedCasement == "none")

ADDONS.Casement = { title = "Casement (old data)", loadable = false, lod = true, reason = "DEMAND_LOADED", onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
fire("PLAYER_LOGIN")
check("at the next login the stub that turned up is loaded, once", #LOADED == 1 and LOADED[1] == "Casement", table.concat(LOADED, ","))
check("and the map's settings come over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.positions.worldmap ~= nil
  and ns.db.positions.worldmap.x == 250)
check("with the learned areas", MapTabAccountDB.overlays[12] and MapTabAccountDB.overlays[12]["10:10:0:0"] == "7")
check("now both are marked done", MapTabAccountDB.importedCasement == true and ns.db.importedCasement == true)
check("with one chat line", ChatSaying("from Casement") == 1, CHAT[#CHAT])
fire("PLAYER_LOGIN")
check("a third login loads nothing more", #LOADED == 1, table.concat(LOADED, ","))
`;

const noAddOnApi = String.raw`
-- No Casement, and a client with no addon list API under either name.
local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("with no addon list API there is simply nothing to bring over", (ns.report["casement data"] or ""):find("^nothing to bring over") ~= nil,
  ns.report["casement data"])
check("and nothing failed", #ReportFailures() == 0, ReportFailures()[1])
WorldMapFrame:Show()
RunTimers(1)
check("the map tab is still built", MapTabTab ~= nil and MapTabTab.shown == true)
`;

const alreadyImported = String.raw`
-- Brought over at an earlier login. The stub is still there, holding different numbers now; none
-- of them may come back.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, lod = true, reason = "DEMAND_LOADED", onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
MapTabAccountDB = { importedCasement = true, overlays = {} }
MapTabDB = { importedCasement = true, map = { scale = 1.1 } }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("already brought over: nothing is loaded", #LOADED == 0, table.concat(LOADED, ","))
check("Map Tab's own settings are left alone", near(ns.db.map.scale, 1.1, 0.001) and ns.db.positions.worldmap == nil)
check("the learned areas are not merged again", next(MapTabAccountDB.overlays) == nil)
check("no chat line", ChatSaying("Casement") == 0)
check("the report says it was done before", ns.report["casement data"] == "already brought over", ns.report["casement data"])
`;

const secondCharacter = String.raw`
-- The account's share came over when another character logged in; this character has never run
-- Map Tab, so its table is empty and adopts the account copy (which carries the first character's
-- "done" mark and a changed size). Nothing in that adopted table is this character's own choice,
-- so this character's own Casement settings replace it, the way Bank Tabs treats the settings the
-- two share, and without a second chat line.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, lod = true, reason = "DEMAND_LOADED", onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
MapTabAccountDB = { importedCasement = true, overlays = {},
  profile = { importedCasement = true, enabled = true, windows = { worldmap = true }, map = { scale = 1.4, topBarDrag = false }, positions = { worldmap = { x = 5, y = 5 } } } }
MapTabDB = nil

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
check("the new character adopted the account copy", ns.report["db addon loaded"] == "adopted the account copy", ns.report["db addon loaded"])
check("but not the first character's done mark", ns.db.importedCasement == nil)
fire("PLAYER_LOGIN")
check("the stub is loaded for this character's own settings", #LOADED == 1 and LOADED[1] == "Casement", table.concat(LOADED, ","))
check("this character's map position came over", ns.db.positions.worldmap and ns.db.positions.worldmap.x == 250)
check("a setting still at its default came over", ns.db.map.coords == false and ns.db.dragModifier == "ctrl")
check("this character's own Casement size replaces the one the adopted account copy had", near(ns.db.map.scale, 1.3, 0.001), ns.db.map.scale)
check("as do its own switches", ns.db.showGrips == true and ns.db.map.reveal == true and ns.db.map.revealTint == "sepia" and ns.db.map.step == 5)
-- Casement filled every setting it had no value for with its default, so this character's
-- Casement table says topBarDrag = true without anyone choosing it. That must not undo a Map Tab
-- choice from another character that the adopted account copy carries.
check("this character's Casement table has the top bar drag at its default", CasementDB.map.topBarDrag == true)
check("which does not undo the Map Tab choice the adopted account copy carries", ns.db.map.topBarDrag == false, ns.db.map.topBarDrag)
check("the account's share is not merged a second time", next(MapTabAccountDB.overlays) == nil)
check("no chat line for a later character", ChatSaying("Casement") == 0, CHAT[#CHAT])
check("but the report records it", (ns.report["casement data"] or ""):find("came over earlier", 1, true) ~= nil, ns.report["casement data"])
check("this character is marked done", ns.db.importedCasement == true)
`;

const neverRanCasement = String.raw`
-- The stub is there, but this character never ran Casement, so it has no Casement settings of its
-- own. It gets what Casement would have given it, the account copy, minus anyone's map position.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, lod = true, reason = "DEMAND_LOADED", onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementAccountDB.profile.positions = { worldmap = { x = 777, y = 77 } }
  CasementDB = nil
end }

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("a character that never ran Casement gets Casement's account copy of the settings", near(ns.db.map.scale, 1.6, 0.001), ns.db.map.scale)
check("but not another character's map position", ns.db.positions.worldmap == nil)
check("the report says where the settings came from", (ns.report["casement data"] or ""):find("from the account copy", 1, true) ~= nil, ns.report["casement data"])
check("the account's learned areas came over too", MapTabAccountDB.overlays[12] and MapTabAccountDB.overlays[12]["10:10:0:0"] == "7")
check("with the one chat line", ChatSaying("from Casement") == 1, CHAT[#CHAT])
`;

const stubOffAfterImport = String.raw`
-- The account's share came over when another character logged in, with the stub switched on.
-- Since then the user has switched "Casement (old data)" off in the AddOns list. This character is
-- new to Map Tab. Only its own map settings are left to bring over, which is no reason to switch
-- the stub back on for every character: it is left off, without a word, and this character's
-- question stays open for if the user switches it on again. Bank Tabs does the same (its harness
-- case E2), so with both installed neither switches the stub on behind the user's back.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DISABLED", lod = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
MapTabAccountDB = { importedCasement = true, overlays = {} }
MapTabDB = nil

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
fire("PLAYER_LOGIN")
check("a stub switched off after the account came over is not switched back on", #ENABLED == 0, table.concat(ENABLED, ","))
check("nor loaded", #LOADED == 0 and CasementDB == nil, table.concat(LOADED, ","))
check("nothing is said, at either login", ChatSaying("Casement") == 0, CHAT[#CHAT])
check("this character's question stays open", ns.db.importedCasement == nil and MapTabAccountDB.importedCasement == true)
check("the user is not marked as told", MapTabAccountDB.casementUnreadableTold == nil)
check("the report says why", (ns.report["casement data"] or ""):find("switched off for every character and the account's share came over", 1, true) ~= nil,
  ns.report["casement data"])
check("the defaults stand meanwhile", near(ns.db.map.scale, 1.0, 0.001) and ns.db.positions.worldmap == nil)

-- The user switches it on again: this character's settings come over at the next login.
ADDONS.Casement.reason = "DEMAND_LOADED"
fire("PLAYER_LOGIN")
check("switched on again by the user, it is loaded", #LOADED == 1 and #ENABLED == 0, table.concat(LOADED, ","))
check("and this character's map settings come over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.positions.worldmap ~= nil
  and ns.db.positions.worldmap.x == 250 and ns.db.importedCasement == true)
check("still without a chat line: the account's line was the first time", ChatSaying("Casement") == 0, CHAT[#CHAT])
`;

const stubOffHereAfterImportNoState = String.raw`
-- The same, with the stub switched off for this character only, on a client with no enable state
-- to ask: LoadAddOn's own refusal says so, and the stub is left off rather than switched on.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DEMAND_LOADED", lod = true, charDisabled = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
MapTabAccountDB = { importedCasement = true, overlays = {} }
MapTabDB = nil

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("refused as switched off here, after the account came over, the stub is left off", #ENABLED == 0 and #LOADED == 1 and CasementDB == nil,
  table.concat(ENABLED, ",") .. "/" .. table.concat(LOADED, ","))
check("without a word", ChatSaying("Casement") == 0, CHAT[#CHAT])
check("and this character's question stays open", ns.db.importedCasement == nil)
check("the report says it is off for this character", (ns.report["casement data"] or ""):find("switched off for this character and the account's share came over", 1, true) ~= nil,
  ns.report["casement data"])
`;

const oldOffAfterImport = String.raw`
-- A later character. The account's share came over at an earlier login, while the old Casement
-- still ran, and the notice switched it off then. The old addon is still installed, not updated
-- yet. Only this character's map settings are left, which is no reason to ask for the old addon to
-- be run again (the notice already said to update it): nothing is said and the question stays open.
ADDONS.Casement = { title = "Casement", loadable = false, reason = "DISABLED", lod = false }
MapTabAccountDB = { importedCasement = true, casementStoodDown = true, overlays = {} }
MapTabDB = nil

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("the old addon, switched off by the notice, is neither switched on nor loaded", #ENABLED == 0 and #LOADED == 0,
  table.concat(ENABLED, ",") .. "/" .. table.concat(LOADED, ","))
check("nothing is said: the notice already told the user to update it", ChatSaying("Casement") == 0, CHAT[#CHAT])
check("the user is not marked as told", MapTabAccountDB.casementUnreadableTold == nil)
check("this character's question stays open", ns.db.importedCasement == nil and MapTabAccountDB.importedCasement == true)
check("the report says why", (ns.report["casement data"] or ""):find("the account's share came over at an earlier login, so nothing is said", 1, true) ~= nil,
  ns.report["casement data"])

-- Then Casement is updated to the data stub, which keeps the folder's switch: still off, but by
-- the notice, not the user. It is switched on for this character's settings.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DISABLED", lod = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
fire("PLAYER_LOGIN")
check("updated to the stub, still off from the notice, the stub is switched on", #ENABLED == 1 and ENABLED[1] == "Casement", table.concat(ENABLED, ","))
check("and loaded", #LOADED == 1 and LOADED[1] == "Casement", table.concat(LOADED, ","))
check("so this character's map settings come over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.positions.worldmap ~= nil
  and ns.db.positions.worldmap.x == 250 and ns.db.importedCasement == true)
check("still without a chat line", ChatSaying("Casement") == 0, CHAT[#CHAT])
check("and the notice's mark is cleared once the stub has been read", MapTabAccountDB.casementStoodDown == nil)
`;

const stubStoodDownAfterImport = String.raw`
-- Both Map Tab and Bank Tabs brought the account over in the session the old Casement still ran,
-- and it was switched off by the notice. Casement was then updated to the data stub, which keeps
-- the folder's switch. A later character new to Map Tab finds the stub switched off for every
-- character: not the user's doing, so it is switched on and read, once, without a word.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DISABLED", lod = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
MapTabAccountDB = { importedCasement = true, casementStoodDown = true, overlays = {} }
MapTabDB = nil

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("a stub left off by the notice's switch off is switched on", #ENABLED == 1 and ENABLED[1] == "Casement", table.concat(ENABLED, ","))
check("and loaded, once", #LOADED == 1 and LOADED[1] == "Casement", table.concat(LOADED, ","))
check("so this character's map settings come over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.positions.worldmap ~= nil
  and ns.db.positions.worldmap.x == 250 and ns.db.importedCasement == true)
check("the account's share is not merged a second time", next(MapTabAccountDB.overlays) == nil)
check("without a word", ChatSaying("Casement") == 0, CHAT[#CHAT])
check("the report says it was switched back on", (ns.report["casement data stub"] or ""):find("switched back on", 1, true) ~= nil, ns.report["casement data stub"])
check("the notice's mark is cleared once the stub has been read", MapTabAccountDB.casementStoodDown == nil)

-- The user switches the stub off after that, and another character new to Map Tab logs in (its
-- Casement tables not loaded, its question open). Now the switch off is the user's: left off.
ADDONS.Casement.loaded, ADDONS.Casement.loadable, ADDONS.Casement.reason = false, false, "DISABLED"
CasementAccountDB, CasementDB = nil, nil
ns.db.importedCasement = nil
fire("PLAYER_LOGIN")
check("switched off by the user after it was read, the stub is left off", #ENABLED == 1 and #LOADED == 1,
  table.concat(ENABLED, ",") .. "/" .. table.concat(LOADED, ","))
check("still without a word", ChatSaying("Casement") == 0, CHAT[#CHAT])
check("and that character's question stays open", ns.db.importedCasement == nil)
`;

const stubStateZeroAfterImport = String.raw`
-- The account's share came over earlier, and the stub is switched on, but the client answers 0
-- when asked about this character (clients differ in what they take as the character). That
-- answer alone must not leave the stub unread: LoadAddOn decides, and loads it.
ADDONS.Casement = { title = "Casement (old data)", loadable = false, reason = "DEMAND_LOADED", lod = true, stateZero = true, onLoad = function()
  CasementAccountDB = CasementAccount()
  CasementDB = CasementCharacter()
end }
MapTabAccountDB = { importedCasement = true, overlays = {} }
MapTabDB = nil

local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("the enable state is asked for by character name, as Bank Tabs asks", ENABLE_STATE_WHO == "Vatik", tostring(ENABLE_STATE_WHO))
check("an enable state of 0 alone does not leave a loadable stub unread", #LOADED == 1 and CasementDB ~= nil, table.concat(LOADED, ","))
check("nothing needed switching on", #ENABLED == 0, table.concat(ENABLED, ","))
check("so this character's map settings come over", near(ns.db.map.scale, 1.3, 0.001) and ns.db.importedCasement == true)
check("without a word", ChatSaying("Casement") == 0, CHAT[#CHAT])
`;


const areaLabelLate = String.raw`
-- The map has no data providers yet when Map Tab loads (an older client, or a map built later):
-- the report says so, and the label is hooked the first time the map opens.
WorldMapFrame.dataProviders = nil
local ns = LoadMapTab()
fire("ADDON_LOADED", "MapTab")
fire("PLAYER_LOGIN")
check("with no data providers on the map, the report says why there are no ranges",
  ns.report["zone levels"] == "the world map keeps no data providers on this client", ns.report["zone levels"])
WorldMapFrame.dataProviders = { [{}] = true }
WorldMapFrame:Hide()
WorldMapFrame:Show()
check("with providers but no area label among them, it says that instead", not ns.Levels.IsHooked()
  and ns.report["zone levels"] == "the map's area label was not found", ns.report["zone levels"])
WorldMapFrame.dataProviders = { [AREA_PROVIDER] = true }
WorldMapFrame:Hide()
WorldMapFrame:Show()
check("once the label exists, it is hooked when the map opens", ns.Levels.IsHooked()
  and ns.report["zone levels"] == "hooked into the map's area label", ns.report["zone levels"])
SHOWN_MAP, CANVAS_FOCUS, PLAYER_LEVEL = 1415, true, 20
HOVER = { mapID = 1436, name = "Westfall" }
UpdateAreaLabel()
check("and the range shows", AREA_LABEL.Name:GetText() == "Westfall|cffffd100 (10-20)|r", AREA_LABEL.Name:GetText())
WorldMapFrame:Hide()
WorldMapFrame:Show()
UpdateAreaLabel()
local _, ranges = (AREA_LABEL.Name:GetText() or ""):gsub("%(", "")
check("opening the map again does not hook it twice", ranges == 1, AREA_LABEL.Name:GetText())
`;

// ------------------------------------------------------------------
// The runner
// ------------------------------------------------------------------

function run(L, code, name) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
    console.log('LUA ERROR in ' + name + ': ' + lua.lua_tojsstring(L, -1)); process.exit(1);
  }
}

function globalNumber(L, name) {
  lua.lua_getglobal(L, to_luastring(name));
  const value = lua.lua_tonumber(L, -1);
  lua.lua_pop(L, 1);
  return value;
}

const modes = (process.argv.includes('--bare')
  ? 'BARE=true\nBAD_ATLAS=true\nBAD_TEMPLATES={TooltipBackdropTemplate=true,UICheckButtonTemplate=true,ChatConfigCheckButtonTemplate=true,MinimalSliderTemplate=true,UISliderTemplate=true,OptionsSliderTemplate=true,UIPanelButtonTemplate=true,UIPanelCloseButton=true,DefaultPanelFlatTemplate=true,DefaultPanelTemplate=true,ButtonFrameTemplate=true,BasicFrameTemplate=true,BackdropTemplate=true,SearchBoxTemplate=true,InputBoxTemplate=true}\n'
  : '') + (process.argv.includes('--verbose') ? 'VERBOSE=true\n' : '')
  + (process.argv.includes('--noenum') ? 'NO_ENUM=true\n' : '');

const tocText = fs.readFileSync(DIR + 'MapTab.toc', 'utf8');
let pass = 0, fail = 0;

function scenario(name, body, extraPre) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  lua.lua_newtable(L);
  for (const f of files) { lua.lua_pushstring(L, to_luastring(fs.readFileSync(DIR + f, 'utf8'))); lua.lua_setfield(L, -2, to_luastring(f)); }
  lua.lua_setglobal(L, to_luastring('SOURCES'));
  lua.lua_newtable(L); files.forEach((f, i) => { lua.lua_pushstring(L, to_luastring(f)); lua.lua_rawseti(L, -2, i + 1); });
  lua.lua_setglobal(L, to_luastring('FILES'));
  lua.lua_pushstring(L, to_luastring(tocText)); lua.lua_setglobal(L, to_luastring('TOC_TEXT'));
  run(L, modes + (extraPre || '') + stub, name + ' (stub)');
  run(L, 'SCENARIO = ' + JSON.stringify(name) + '\n' + common + casementData, name + ' (common)');
  run(L, body, name);
  const p = globalNumber(L, 'PASS'), f = globalNumber(L, 'FAIL');
  if (process.argv.includes('--verbose')) console.log(`${name}: pass=${p} fail=${f}`);
  pass += p; fail += f;
}

scenario('clean install', cleanInstall);
scenario('Casement stub present', stubPresent);
scenario('old Casement running', oldRunning);
scenario('old Casement running, its spot forgotten there', oldRunningFollowReset);
scenario('old Casement running, already brought over', oldRunningAlreadyImported);
scenario('old Casement running, Bank Tabs first', oldRunningWithBankTabs);
scenario('old Casement running, Map Tab first beside Bank Tabs', oldRunningMapTabFirst);
scenario('old Casement switched off', oldSwitchedOff);
scenario('Casement stub switched off', stubSwitchedOff);
scenario('Casement stub switched off for this character', stubOffHere);
scenario('Casement stub switched off for this character, no enable state', stubOffHereNoState, 'NO_ENABLE_STATE=true\n');
scenario('Casement stub the game will not load', stubRefused);
scenario('Casement stub with nothing new in it', stubNothingNew);
scenario('Casement stub reported loadable', stubReportedLoadable);
scenario('nothing present', nothingPresent);
scenario('no Casement, then the stub turns up', stubTurnsUpLater);
scenario('area label made after load', areaLabelLate);
scenario('no addon list API', noAddOnApi, 'NO_ADDON_API=true\n');
scenario('already brought over', alreadyImported);
scenario('a second character', secondCharacter);
scenario('a character that never ran Casement', neverRanCasement);
scenario('Casement stub switched off after the account came over', stubOffAfterImport);
scenario('Casement stub switched off here after the account came over, no enable state', stubOffHereAfterImportNoState, 'NO_ENABLE_STATE=true\n');
scenario('old Casement switched off by the notice, a later character', oldOffAfterImport);
scenario('Casement stub left off by the notice, a later character', stubStoodDownAfterImport);
scenario('Casement stub whose enable state reads 0, after the account came over', stubStateZeroAfterImport);

console.log(`RESULT pass=${pass} fail=${fail}`);
