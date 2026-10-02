-- Map Tab
-- Levels: a zone's level range on the continent map.
--
-- Point at a zone on the continent map and the game names it in the label at the top of the map.
-- Blizzard's label code (AreaLabelFrameMixin:OnUpdate) adds the zone's level range to that name,
-- "Westfall (10-20)", coloured by how hard the zone is for you, but only when C_Map.GetMapLevels has
-- numbers for the zone. On this client it has none: in build 1.60.1.70170 not one UiMap row carries
-- a ContentTuningID, which is where those numbers come from, so the label shows the bare name. Map
-- Tab adds the same text from its own table, coloured the same way.
--
-- It only reads the game's label and adds to the text on screen once the game has written it for
-- the frame. The label's own state (its table of labels by type) is never touched, so the game's
-- map code never runs on anything Map Tab wrote. Should a later build give the game its own
-- numbers, the game's text is left exactly as it is.

local ADDON, ns = ...

local report = ns.report
local Levels = {}
ns.Levels = Levels

-- Level ranges by UiMap id. The original zones carry the ranges players know from the classic
-- game, which the WoW Forever zone guides list unchanged. The Forever zones are read off the levels
-- of their creatures in Wowhead's Forever database, which comes from the beta itself: Zephras Isle
-- (the Skyborne starting zone, which has two map ids) 1-12, Shen'dralas 40-45, Riverglades 35-45,
-- Mount Hyjal 55-60. Zephras Isle and Riverglades agree with the zone guides and the wiki, and
-- Riverglades with the client's own exploration levels; the client holds no levels at all for
-- Shen'dralas, and the guides' "Mount Hyjal at 60" is when players go there, while its creatures
-- start at 55. Left out on purpose: the capital cities and Moonglade, which have no range.
Levels.RANGES = {
	-- Eastern Kingdoms
	[1429] = { 1, 10 },  -- Elwynn Forest
	[1426] = { 1, 10 },  -- Dun Morogh
	[1420] = { 1, 10 },  -- Tirisfal Glades
	[1436] = { 10, 20 }, -- Westfall
	[1432] = { 10, 20 }, -- Loch Modan
	[1421] = { 10, 20 }, -- Silverpine Forest
	[1433] = { 15, 25 }, -- Redridge Mountains
	[1431] = { 18, 30 }, -- Duskwood
	[1437] = { 20, 30 }, -- Wetlands
	[1424] = { 20, 30 }, -- Hillsbrad Foothills
	[1416] = { 30, 40 }, -- Alterac Mountains
	[1417] = { 30, 40 }, -- Arathi Highlands
	[1434] = { 30, 45 }, -- Stranglethorn Vale
	[1418] = { 35, 45 }, -- Badlands
	[1435] = { 35, 45 }, -- Swamp of Sorrows
	[2548] = { 35, 45 }, -- Riverglades
	[1425] = { 40, 50 }, -- The Hinterlands
	[1427] = { 43, 50 }, -- Searing Gorge
	[1419] = { 45, 55 }, -- Blasted Lands
	[1428] = { 50, 58 }, -- Burning Steppes
	[1422] = { 51, 58 }, -- Western Plaguelands
	[1423] = { 53, 60 }, -- Eastern Plaguelands
	[1430] = { 55, 60 }, -- Deadwind Pass
	-- Kalimdor
	[1411] = { 1, 10 },  -- Durotar
	[1412] = { 1, 10 },  -- Mulgore
	[1438] = { 1, 10 },  -- Teldrassil
	[1439] = { 10, 20 }, -- Darkshore
	[1413] = { 10, 25 }, -- The Barrens
	[1442] = { 15, 27 }, -- Stonetalon Mountains
	[1440] = { 18, 30 }, -- Ashenvale
	[1441] = { 25, 35 }, -- Thousand Needles
	[1443] = { 30, 40 }, -- Desolace
	[1445] = { 35, 45 }, -- Dustwallow Marsh
	[1444] = { 40, 50 }, -- Feralas
	[1446] = { 40, 50 }, -- Tanaris
	[1447] = { 45, 55 }, -- Azshara
	[1448] = { 48, 55 }, -- Felwood
	[1449] = { 48, 55 }, -- Un'Goro Crater
	[1451] = { 55, 60 }, -- Silithus
	[1452] = { 55, 60 }, -- Winterspring
	[2652] = { 40, 45 }, -- Shen'dralas
	[2482] = { 55, 60 }, -- Mount Hyjal
	-- Zephras Isle, under both of its map ids
	[2521] = { 1, 12 },
	[2665] = { 1, 12 },
}

local hooked = false

-- The game's quest difficulty colours, for a client that does not carry its table.
local FALLBACK = {
	impossible = { r = 1.00, g = 0.10, b = 0.10 },
	verydifficult = { r = 1.00, g = 0.50, b = 0.25 },
	difficult = { r = 1.00, g = 0.82, b = 0.00 },
	standard = { r = 0.25, g = 0.75, b = 0.25 },
	trivial = { r = 0.50, g = 0.50, b = 0.50 },
}

local function Plain(value)
	if issecretvalue and issecretvalue(value) then return nil end
	if type(value) ~= "number" then return nil end
	return value
end

-- Whether Map Tab shows the ranges right now: the option, and Map Tab's own switch, since with the
-- map switched off Map Tab adds nothing to the map at all.
local function On()
	if not (ns.db and ns.db.map and ns.db.map.zoneLevels) then return false end
	return ns.MapOn and ns.MapOn() and true or false
end
Levels.On = On

local function Colour(key)
	local colours = type(QuestDifficultyColors) == "table" and QuestDifficultyColors or FALLBACK
	local c = colours[key]
	if type(c) == "table" and type(c.r) == "number" then return c end
	return FALLBACK[key]
end

local function PlayerLevel()
	if not UnitLevel then return 1 end
	local ok, level = pcall(UnitLevel, "player")
	return ok and Plain(level) or 1
end

-- How hard something of `level` is for you, coloured the way the game colours a quest of that level.
local function Difficulty(level, playerLevel)
	if GetQuestDifficultyColor then
		local ok, c = pcall(GetQuestDifficultyColor, level)
		if ok and type(c) == "table" and type(c.r) == "number" then return c end
	end
	-- The same steps as the game's own, for a client without the function.
	local diff = level - playerLevel
	if diff >= 5 then return Colour("impossible") end
	if diff >= 3 then return Colour("verydifficult") end
	if diff >= -4 then return Colour("difficult") end
	local range = 5
	if UnitQuestTrivialLevelRange then
		local ok, r = pcall(UnitQuestTrivialLevelRange, "player")
		if ok and Plain(r) then range = r end
	end
	if -diff <= range then return Colour("standard") end
	return Colour("trivial")
end

local function ColourCode(c)
	local function byte(v) return math.max(0, math.min(255, math.floor(v * 255 + 0.5))) end
	return string.format("|cff%02x%02x%02x", byte(c.r), byte(c.g), byte(c.b))
end

-- " (10-20)" in the colour the game would give it, or " (15)" for a zone of a single level; nil for
-- a zone with no range. The colour follows the game's own rule: a zone above you is coloured by its
-- lowest level, one below you by two under its highest (so a zone you have outgrown is not yellow),
-- and one you are inside is yellow.
function Levels.RangeText(mapID, playerLevel)
	local range = Levels.RANGES[mapID]
	if not range then return nil end
	local low, high = range[1], range[2]
	playerLevel = playerLevel or PlayerLevel()
	local c
	if playerLevel < low then
		c = Difficulty(low, playerLevel)
	elseif playerLevel > high then
		c = Difficulty(high - 2, playerLevel)
	else
		c = Colour("difficult")
	end
	local span = (low ~= high) and (low .. "-" .. high) or tostring(high)
	return ColourCode(c) .. " (" .. span .. ")|r"
end

-- Whether the game has its own range for a zone, in which case its label already shows one.
local function GameHasLevels(mapID)
	if not (C_Map and C_Map.GetMapLevels) then return false end
	local ok, low, high = pcall(C_Map.GetMapLevels, mapID)
	if not ok then return false end
	low, high = Plain(low), Plain(high)
	return (low and high and low > 0 and high > 0) and true or false
end

local function MapOf(frame)
	local provider = frame.dataProvider
	if type(provider) == "table" and type(provider.GetMap) == "function" then
		local ok, map = pcall(provider.GetMap, provider)
		if ok and type(map) == "table" then return map end
	end
	return _G.WorldMapFrame
end

-- The child map under the cursor, the way the game's label finds it: nil unless the cursor is on the
-- map's canvas and over a map other than the one on show (a zone, on the continent map).
local function Hovered(map)
	if not (map and map.IsCanvasMouseFocus and map.GetMapID and map.GetNormalizedCursorPosition) then return nil end
	local okFocus, focus = pcall(map.IsCanvasMouseFocus, map)
	if not (okFocus and focus) then return nil end
	local okID, mapID = pcall(map.GetMapID, map)
	if not okID or type(mapID) ~= "number" then return nil end
	local okXY, x, y = pcall(map.GetNormalizedCursorPosition, map)
	x, y = okXY and Plain(x), okXY and Plain(y)
	if not x or not y then return nil end
	if not (C_Map and C_Map.GetMapInfoAtPosition) then return nil end
	local ok, info = pcall(C_Map.GetMapInfoAtPosition, mapID, x, y)
	if not ok or type(info) ~= "table" or type(info.mapID) ~= "number" or info.mapID == mapID then return nil end
	if type(info.name) ~= "string" or info.name == "" then return nil end
	return info
end

-- Runs after the game's own OnUpdate on the label, every frame the map is open.
local function OnLabelUpdate(frame)
	if not On() then return end
	local name = frame.Name
	if not (name and name.GetText and name.SetText) then return end
	local info = Hovered(MapOf(frame))
	if not info then return end
	-- Only the label the game wrote for this zone, bare: not a point of interest's label, which wins
	-- over the zone's, and not one that already carries a range.
	if name:GetText() ~= info.name then return end
	if GameHasLevels(info.mapID) then return end
	local suffix = Levels.RangeText(info.mapID)
	if not suffix then return end
	name:SetText(info.name .. suffix)
	Levels.lastShown = info.name .. suffix
end

-- The area label is a frame the map's area label data provider made. The providers sit in the
-- map's dataProviders table, keyed by provider; this only reads that table.
local function FindLabel()
	local map = _G.WorldMapFrame
	if type(map) ~= "table" then return nil, "WorldMapFrame is not on this client" end
	if type(map.dataProviders) ~= "table" then return nil, "the world map keeps no data providers on this client" end
	for provider in pairs(map.dataProviders) do
		local frame = type(provider) == "table" and provider.Label
		if type(frame) == "table" and type(frame.Name) == "table" and frame.HookScript and frame.EvaluateLabels then
			return frame
		end
	end
	return nil, "the map's area label was not found"
end

local function Hook()
	if hooked then return true end
	local frame, why = FindLabel()
	if not frame then
		report["zone levels"] = why
		return false
	end
	-- Wrapped, so that nothing going wrong here could ever stop the game's own label working.
	local ok = pcall(frame.HookScript, frame, "OnUpdate", function(self) pcall(OnLabelUpdate, self) end)
	if not ok then
		report["zone levels"] = "the map's area label would not take a hook"
		return false
	end
	Levels.labelFrame, hooked = frame, true
	report["zone levels"] = "hooked into the map's area label"
	return true
end

function Levels.IsHooked()
	return hooked
end

function Levels.Apply()
	report["zone levels shown"] = On() and "yes, when pointing at a zone on the continent map"
		or "no (switched off in the options, or Map Tab is switched off)"
end

function Levels.Init()
	local n = 0
	for _ in pairs(Levels.RANGES) do n = n + 1 end
	report["zone level table"] = n .. " zones"
	if not Hook() then
		-- The label is made when the map adds its data providers; look again when the map opens.
		local map = _G.WorldMapFrame
		if type(map) == "table" and map.HookScript then
			pcall(map.HookScript, map, "OnShow", function() if not hooked then Hook() end end)
		end
	end
	Levels.Apply()
end
