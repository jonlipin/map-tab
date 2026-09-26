-- Map Tab
-- Reveal: drawing the parts of the world map you have not explored yet, with an optional tint so
-- they can still be told from the parts you have.
--
-- How the game's map works on this client: the base art is the blank, unexplored look, and the
-- explored areas are painted OVER it from overlay textures the client hands out through
-- C_MapExplorationInfo.GetExploredMapTextures. The game only hands out the overlays for areas
-- this character has explored, so to draw the rest the addon needs its own list of every overlay
-- a map has. That list comes from two places, merged:
--   * ns.Reveal.DATA, shipped with the addon, keyed by map art id in the shape
--     [artID] = { ["width:height:offsetX:offsetY"] = "fileDataID, fileDataID, ..." };
--   * MapTabAccountDB.overlays, harvested at run time: every overlay any character on this
--     account has ever been handed is remembered, so an alt sees what the main has explored.
-- "/maptab mapdata" reports how much of the shown map is known, and "/maptab mapdata dump"
-- opens the harvested table in a box that can be copied out and folded into DATA.
--
-- Each overlay is a grid of 256 pixel tiles, the last row and column trimmed, exactly the way the
-- game's own MapExplorationDataProvider lays them out. Ours go one sublevel under the game's, so
-- an area you explore later paints over ours, tint and all.

local ADDON, ns = ...

local report = ns.report
-- Data/MapOverlays.lua loads first and hands over the shipped table on ns.Reveal.DATA.
local Reveal = ns.Reveal or {}
ns.Reveal = Reveal

Reveal.DATA = Reveal.DATA or {}

local TILE = 256
local pool, live = {}, {}
local canvas, drawnFor, ticker
local lastPoll = 0

Reveal.TINTS = {
	{ value = "none", label = "No tint", color = nil },
	{ value = "blue", label = "Blue", color = { 0.62, 0.72, 1.0 } },
	{ value = "sepia", label = "Sepia", color = { 0.95, 0.85, 0.65 } },
	{ value = "grey", label = "Grey", color = { 0.7, 0.7, 0.72 } },
}

-- ------------------------------------------------------------------
-- Finding the map's canvas and its ids
-- ------------------------------------------------------------------

local function Canvas()
	if canvas then return canvas end
	local frame = _G.WorldMapFrame
	local container = frame and frame.ScrollContainer
	local child = container and container.Child
	if child and child.CreateTexture then canvas = child end
	return canvas
end

local function ShownMapID()
	local frame = _G.WorldMapFrame
	if not frame then return nil end
	if frame.GetMapID then
		local ok, id = pcall(frame.GetMapID, frame)
		if ok and type(id) == "number" then return id end
	end
	return type(frame.mapID) == "number" and frame.mapID or nil
end

local function ArtID(mapID)
	if not (mapID and C_Map and C_Map.GetMapArtID) then return nil end
	local ok, art = pcall(C_Map.GetMapArtID, mapID)
	if ok and type(art) == "number" then return art end
	return nil
end

local function MapName(mapID)
	if not (mapID and C_Map and C_Map.GetMapInfo) then return "map " .. tostring(mapID) end
	local ok, info = pcall(C_Map.GetMapInfo, mapID)
	if ok and type(info) == "table" and info.name then return info.name end
	return "map " .. tostring(mapID)
end

-- The overlays the game will hand over right now: explored ones, keyed the same way as DATA.
local function Explored(mapID)
	local out = {}
	if not (mapID and C_MapExplorationInfo and C_MapExplorationInfo.GetExploredMapTextures) then return out end
	local ok, list = pcall(C_MapExplorationInfo.GetExploredMapTextures, mapID)
	if not ok or type(list) ~= "table" then return out end
	for _, info in ipairs(list) do
		local width = info.textureWidth or 0
		if width > 0 and type(info.fileDataIDs) == "table" then
			-- Whole numbers, so a key built here always matches one written into the shipped table.
			local function whole(v) return math.floor((tonumber(v) or 0) + 0.5) end
			local key = whole(width) .. ":" .. whole(info.textureHeight) .. ":" .. whole(info.offsetX) .. ":" .. whole(info.offsetY)
			local ids = {}
			for i, id in ipairs(info.fileDataIDs) do ids[i] = tostring(id) end
			out[key] = table.concat(ids, ", ")
		end
	end
	return out
end

-- ------------------------------------------------------------------
-- The store
-- ------------------------------------------------------------------

local function Harvest()
	MapTabAccountDB = MapTabAccountDB or {}
	MapTabAccountDB.overlays = MapTabAccountDB.overlays or {}
	return MapTabAccountDB.overlays
end

-- Remembers whatever the game handed over for this map, for every character on the account.
local function Remember(artID, explored)
	if not artID then return 0 end
	local store = Harvest()
	store[artID] = store[artID] or {}
	local added = 0
	for key, ids in pairs(explored) do
		if store[artID][key] ~= ids then
			store[artID][key] = ids
			added = added + 1
		end
	end
	return added
end

-- Everything known about a map: shipped first, then harvested on top.
local function Known(artID)
	local out = {}
	if not artID then return out end
	for key, ids in pairs(Reveal.DATA[artID] or {}) do out[key] = ids end
	for key, ids in pairs(Harvest()[artID] or {}) do out[key] = ids end
	return out
end

-- ------------------------------------------------------------------
-- Drawing
-- ------------------------------------------------------------------

local function Acquire()
	local texture = table.remove(pool)
	if not texture then
		texture = Canvas():CreateTexture(nil, "ARTWORK", nil, -1)
	end
	live[#live + 1] = texture
	return texture
end

local function Clear()
	for _, texture in ipairs(live) do
		texture:Hide()
		texture:SetVertexColor(1, 1, 1)
		pool[#pool + 1] = texture
	end
	live = {}
	drawnFor = nil
end

local function TintColor()
	local wanted = ns.db.map.revealTint or "none"
	for _, entry in ipairs(Reveal.TINTS) do
		if entry.value == wanted then return entry.color end
	end
	return nil
end

-- The file behind a tile is a power of two wide and tall; the tile shows only its used part.
local function FileSize(pixels)
	local size = 16
	while size < pixels do size = size * 2 end
	return size
end

local function DrawOverlay(key, ids, tint)
	local width, height, offsetX, offsetY = key:match("^(%d+):(%d+):(%-?%d+):(%-?%d+)$")
	width, height, offsetX, offsetY = tonumber(width), tonumber(height), tonumber(offsetX), tonumber(offsetY)
	if not (width and height and offsetX and offsetY) then return 0 end
	local files = {}
	for id in tostring(ids):gmatch("%d+") do files[#files + 1] = tonumber(id) end

	local wide, tall = math.ceil(width / TILE), math.ceil(height / TILE)
	local drawn = 0
	for j = 1, tall do
		local pixelH = (j < tall) and TILE or (height % TILE)
		if pixelH == 0 then pixelH = TILE end
		for k = 1, wide do
			local pixelW = (k < wide) and TILE or (width % TILE)
			if pixelW == 0 then pixelW = TILE end
			local file = files[(j - 1) * wide + k]
			if file then
				local texture = Acquire()
				texture:ClearAllPoints()
				texture:SetSize(pixelW, pixelH)
				texture:SetTexCoord(0, pixelW / FileSize(pixelW), 0, pixelH / FileSize(pixelH))
				texture:SetPoint("TOPLEFT", Canvas(), "TOPLEFT", offsetX + TILE * (k - 1), -(offsetY + TILE * (j - 1)))
				pcall(texture.SetTexture, texture, file, nil, nil, "TRILINEAR")
				if tint then texture:SetVertexColor(tint[1], tint[2], tint[3]) end
				texture:Show()
				drawn = drawn + 1
			end
		end
	end
	return drawn
end

-- Draws every known overlay the game is NOT already drawing for the shown map.
function Reveal.Refresh(force)
	local db = ns.db
	if not (db and db.enabled and db.windows.worldmap and db.map.reveal) then
		Clear()
		return
	end
	local frame = _G.WorldMapFrame
	if not (frame and frame:IsShown() and Canvas()) then return end

	local mapID = ShownMapID()
	local artID = ArtID(mapID)
	if not artID then Clear() return end

	local explored = Explored(mapID)
	local added = Remember(artID, explored)
	if not force and drawnFor == artID and added == 0 then return end

	Clear()
	local tint = TintColor()
	local known, unexplored, tiles = 0, 0, 0
	for key, ids in pairs(Known(artID)) do
		known = known + 1
		if not explored[key] then
			unexplored = unexplored + 1
			tiles = tiles + DrawOverlay(key, ids, tint)
		end
	end
	drawnFor = artID
	Reveal.last = { mapID = mapID, artID = artID, name = MapName(mapID), known = known, unexplored = unexplored, tiles = tiles }
	report["map reveal"] = MapName(mapID) .. ": " .. known .. " overlays known, " .. unexplored .. " drawn (" .. tiles .. " tiles)"
end

-- ------------------------------------------------------------------
-- The report and the dump
-- ------------------------------------------------------------------

function Reveal.Describe()
	local mapID = ShownMapID()
	if not mapID then return "open the map first." end
	local artID = ArtID(mapID)
	local explored = Explored(mapID)
	local known = Known(artID)
	local nKnown, nExplored = 0, 0
	for _ in pairs(known) do nKnown = nKnown + 1 end
	for _ in pairs(explored) do nExplored = nExplored + 1 end
	local shipped = 0
	for _ in pairs(Reveal.DATA[artID] or {}) do shipped = shipped + 1 end
	local maps = 0
	for _ in pairs(Harvest()) do maps = maps + 1 end
	return MapName(mapID) .. " (art " .. tostring(artID) .. "): " .. nExplored .. " overlays explored by this character, "
		.. nKnown .. " known in all (" .. shipped .. " shipped, the rest harvested). " .. maps .. " maps harvested on this account."
end

-- The harvested table as Lua, in a box that can be copied out.
function Reveal.Dump()
	local lines = {}
	local store = Harvest()
	local artIDs = {}
	for artID in pairs(store) do artIDs[#artIDs + 1] = artID end
	table.sort(artIDs)
	for _, artID in ipairs(artIDs) do
		lines[#lines + 1] = "[" .. artID .. "] = {"
		local keys = {}
		for key in pairs(store[artID]) do keys[#keys + 1] = key end
		table.sort(keys)
		for _, key in ipairs(keys) do
			lines[#lines + 1] = '\t["' .. key .. '"] = "' .. store[artID][key] .. '",'
		end
		lines[#lines + 1] = "},"
	end
	ns.CopyBox("Map Tab map data", table.concat(lines, "\n"))
	return #artIDs
end

-- ------------------------------------------------------------------
-- Wiring
-- ------------------------------------------------------------------

function Reveal.Apply()
	Reveal.Refresh(true)
end

function Reveal.OnEvent(event)
	if event == "MAP_EXPLORATION_UPDATED" then
		Reveal.Refresh(true)
	end
end

function Reveal.Init()
	local frame = _G.WorldMapFrame
	if not frame then
		report["map reveal"] = "WorldMapFrame is not on this client"
		return
	end
	report["map reveal api"] = (C_MapExplorationInfo and C_MapExplorationInfo.GetExploredMapTextures)
		and "GetExploredMapTextures found" or "GetExploredMapTextures is not on this client"

	local shipped = 0
	for _ in pairs(Reveal.DATA) do shipped = shipped + 1 end
	report["map reveal data"] = shipped .. " maps shipped, harvest on"

	frame:HookScript("OnShow", function() ns.After(0, function() pcall(Reveal.Refresh, true) end) end)
	frame:HookScript("OnHide", function() lastPoll = 0 end)

	-- The map can change zone without being re-shown, so the shown map is checked lightly while
	-- the window is open, and the harvest picks up anything newly handed over.
	if frame.SetMapID and hooksecurefunc then
		pcall(hooksecurefunc, frame, "SetMapID", function() ns.After(0, function() pcall(Reveal.Refresh) end) end)
	end
	frame:HookScript("OnUpdate", function(_, elapsed)
		lastPoll = lastPoll + (elapsed or 0)
		if lastPoll < 0.5 then return end
		lastPoll = 0
		pcall(Reveal.Refresh)
	end)
end
