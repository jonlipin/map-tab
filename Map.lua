-- Map Tab
-- Map: moving, resizing and scaling the world map.
--
-- Resizing is done by scaling the whole window rather than by stretching it. The world map on this
-- client is a canvas with its own layout, detail layers and pins, and stretching the frame leaves
-- all of that to be rebuilt by hand; scaling keeps every part of the map in proportion and is what
-- the resize grip and the percentage buttons both drive. The two controls are therefore two ways
-- of setting the same number: drag for a free size, click to land on a round ten percent.
--
-- Everything this addon adds to the map lives in a TAB that hangs off the bottom of it, wearing
-- the game's own panel art. Nothing is laid inside the map's own frame any more. The first version
-- put the resize grip in the map's bottom right corner, where the quest panel covered it: the grip
-- was drawn but the panel's frames took the mouse before it ever saw a click.
--
-- The map is dragged by the clear stretches of its top bar, worked out around the game's own
-- controls so that none of them are covered.

local ADDON, ns = ...

local report = ns.report
local Map = {}
ns.Map = Map

local map, tab, grip, label
local resizing = nil
local strips = {}
local rebuildQueued = false
-- Whether the map's current scale is one Map Tab set. Switched off, Map Tab only ever undoes its
-- own scale, never one something else (the old Casement, say) put on the map.
local scaled = false

-- How far down from the top edge of the map the draggable band reaches, in screen units.
local BAND = 26

Map.stripCount = 0
Map.gripPresses = 0

local function MapFrame()
	if map then return map end
	local frame = _G.WorldMapFrame
	if type(frame) == "table" and frame.GetObjectType then map = frame end
	return map
end

local function IsMaximized()
	local frame = MapFrame()
	if not frame then return false end
	if frame.IsMaximized then
		local ok, value = pcall(frame.IsMaximized, frame)
		if ok then return value and true or false end
	end
	return frame.isMaximized and true or false
end

local function Percent()
	return math.floor((ns.db.map.scale or 1) * 100 + 0.5)
end

-- Whether Map Tab is handling the map right now. Switched off (or with the old Casement running
-- this session) the map is the game's, and nothing here may place or scale it.
local function On()
	return ns.MapOn and ns.MapOn() or false
end

local function CursorInUIUnits()
	local x, y = GetCursorPosition()
	local scale = UIParent:GetEffectiveScale() or 1
	if scale == 0 then scale = 1 end
	return x / scale, y / scale
end

-- ------------------------------------------------------------------
-- Applying a scale
-- ------------------------------------------------------------------

-- Puts the map back where it was after a scale change. The saved position is held in UIParent
-- units, so it survives the change; this only has to re-place and re-clamp it.
local function Replace()
	local frame = MapFrame()
	if not frame then return end
	-- While the corner is being dragged the resize loop does the placing itself, one corner held
	-- still, so this stays out of the way.
	if resizing then return end
	-- Locked or switched off, the map is back under the game's control. The saved position is
	-- kept for when it is switched on again, but never used meanwhile.
	if not On() then return end
	local pos = ns.db.positions["worldmap"]
	if pos then
		ns.Windows.Place(frame, pos.x, pos.y)
	elseif frame:IsShown() then
		local x, y = ns.Windows.Measure(frame)
		if x then ns.Windows.Place(frame, x, y) end
	end
end

-- The tab hangs under the map by default, and flips above it when the map has been dragged to the
-- bottom of the screen and there is no room left below.
local function PlaceTab()
	local frame = MapFrame()
	if not tab or not frame then return end
	local _, bottom = ns.Windows.Measure(frame)
	-- The tab carries the inverse of the map's scale, so its height on screen is simply its own
	-- height, whatever the map is scaled to.
	local height = (tab:GetHeight() or 30) + 6
	tab:ClearAllPoints()
	if bottom and bottom < height + 4 then
		tab:SetPoint("BOTTOMRIGHT", frame, "TOPRIGHT", 0, 2)
	else
		tab:SetPoint("TOPRIGHT", frame, "BOTTOMRIGHT", 0, -2)
	end
end

-- Keeps the tab the same size on screen whatever the map is scaled to.
local function CounterScale()
	local scale = ns.db.map.scale or 1
	if scale <= 0 then scale = 1 end
	if tab then tab:SetScale(1 / scale) end
end

function Map.SetScale(value, save)
	local db = ns.db.map
	value = ns.Clamp(ns.Round(value, 3), db.minScale, db.maxScale)
	db.scale = value
	local frame = MapFrame()
	-- Switched off, the size is only remembered; it is put on the map when it is switched on.
	if frame and On() and not IsMaximized() then
		if pcall(frame.SetScale, frame, value) then scaled = true end
	end
	CounterScale()
	PlaceTab()
	if label then label:SetText(Percent() .. "%") end
	Replace()
	if save ~= false then
		ns.MirrorToAccount()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
	end
end

-- The percentage buttons always land on a multiple of the step, so repeated clicks walk 90, 100,
-- 110 even when a drag left the map on 97.
function Map.Step(direction)
	local db = ns.db.map
	local step = db.step or 10
	local pct = Percent()
	local target
	if direction > 0 then
		target = math.floor((pct + 0.001) / step) * step + step
	else
		target = math.ceil((pct - 0.001) / step) * step - step
	end
	Map.SetScale(target / 100)
end

function Map.ResetSize()
	Map.SetScale(1)
end

-- The move engine asks this before it re-places the map on a size change, so that our own resize
-- drag is left to do its own placing.
function Map.IsResizing()
	return resizing ~= nil
end

-- ------------------------------------------------------------------
-- Resizing, driven from the grip in the tab
-- ------------------------------------------------------------------

local function StopResize()
	if not resizing then return end
	grip:SetScript("OnUpdate", nil)
	resizing = nil
	ns.MirrorToAccount()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
	-- The position is only stored once the drag is over, so a resize cannot fill the saved
	-- variables with a hundred intermediate positions.
	local frame = MapFrame()
	if frame then
		local x, y, w, h = ns.Windows.Measure(frame)
		if x then
			x, y = ns.Windows.ClampXY(x, y, w, h)
			ns.db.positions["worldmap"] = { x = ns.Round(x, 1), y = ns.Round(y, 1) }
			ns.Windows.Place(frame, x, y)
		end
	end
	PlaceTab()
end

local function OnResizeUpdate()
	if not resizing then return end
	-- The grip moves away from under the cursor as the map grows, so the mouse button is watched
	-- directly rather than waiting for a mouse up on the grip that may never come.
	if IsMouseButtonDown and not IsMouseButtonDown("LeftButton") then
		StopResize()
		return
	end

	local cx, cy = CursorInUIUnits()
	local dx, dy = cx - resizing.left, resizing.top - cy
	local distance = math.sqrt(dx * dx + dy * dy)
	if distance < 8 then distance = 8 end
	local scale = resizing.scale * (distance / resizing.distance)
	-- Holding shift while dragging snaps to the same grid the buttons use.
	if IsShiftKeyDown and IsShiftKeyDown() then
		local step = (ns.db.map.step or 10) / 100
		scale = math.floor(scale / step + 0.5) * step
	end
	Map.SetScale(scale, false)

	-- The top left corner of the map stays where it is while the rest of it grows.
	local frame = MapFrame()
	local _, _, w, h = ns.Windows.Measure(frame)
	if w then ns.Windows.Place(frame, resizing.left, resizing.top - h) end
	PlaceTab()
end

local function StartResize()
	local frame = MapFrame()
	if not frame then return end
	-- Counted so that "/maptab debug" can tell a grip that never received the click apart from
	-- one that received it and did nothing.
	Map.gripPresses = Map.gripPresses + 1
	report["map resize grip"] = "pressed " .. Map.gripPresses .. " times"

	local left, bottom, w, h = ns.Windows.Measure(frame)
	if not left then return end
	local cx, cy = CursorInUIUnits()
	local top = bottom + h
	local dx, dy = cx - left, top - cy
	local distance = math.sqrt(dx * dx + dy * dy)
	if distance < 8 then distance = 8 end
	resizing = { left = left, top = top, distance = distance, scale = ns.db.map.scale or 1 }
	grip:SetScript("OnUpdate", OnResizeUpdate)
end

-- ------------------------------------------------------------------
-- The tab
-- ------------------------------------------------------------------

local function SmallButton(parent, text, width, onClick, tooltip)
	local button = ns.Button(parent, text, width, 20, onClick)
	if tooltip then
		button:SetScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_TOP")
			GameTooltip:SetText(tooltip, 1, 1, 1)
			GameTooltip:Show()
		end)
		button:SetScript("OnLeave", function() GameTooltip:Hide() end)
	end
	return button
end

-- Candidates for the reset button's icon, first one on this client wins. The map scroll is the
-- addon's own emblem: the map, back as it comes.
local RESET_ICONS = {
	"Interface\\Icons\\INV_Misc_Map02",
	"Interface\\Icons\\INV_Misc_Map_01",
}

-- The reset button wears an icon. Where none of the candidates resolves the button says 100%
-- instead, which is what it does.
local function ResetButton(parent)
	local button = CreateFrame("Button", nil, parent)
	button.mtOurs = true
	button:SetSize(24, 24)

	local icon = button:CreateTexture(nil, "ARTWORK")
	icon:SetPoint("TOPLEFT", 1, -1)
	icon:SetPoint("BOTTOMRIGHT", -1, 1)
	local path
	for _, candidate in ipairs(RESET_ICONS) do
		if ns.TextureExists(candidate) then path = candidate break end
	end
	if path then
		icon:SetTexture(path)
		icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
		report["map reset icon"] = path
	else
		icon:Hide()
		local text = button:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
		text:SetAllPoints()
		text:SetJustifyH("CENTER")
		text:SetText("100%")
		button:SetWidth(40)
		report["map reset icon"] = "text, the icon did not load"
	end

	-- The HIGHLIGHT layer only draws while the mouse is over the button.
	local glow = button:CreateTexture(nil, "HIGHLIGHT")
	glow:SetAllPoints()
	glow:SetColorTexture(1, 1, 1, 0.18)

	button:SetScript("OnClick", function() Map.ResetSize() end)
	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_TOP")
		GameTooltip:SetText("Back to the map's normal size", 1, 1, 1)
		GameTooltip:Show()
	end)
	button:SetScript("OnLeave", function() GameTooltip:Hide() end)
	return button
end

-- ------------------------------------------------------------------
-- Coordinates
--
-- Two lines at the left end of the tab: where you are, and where the cursor is on the map. Both
-- are hundredths of the map, the way every coordinate addon prints them. The copy button puts
-- your position into the chat box (zone name first, so it reads as a place), or, right-clicked,
-- into a box it can be copied out of.
-- ------------------------------------------------------------------

local coordsPart, copyButton, playerLine, cursorLine
local coordsElapsed = 0

-- Some values are secret to addons on this client; a position that comes back secret is shown
-- as unknown rather than compared, which would error.
local function Plain(value)
	if issecretvalue and issecretvalue(value) then return nil end
	if type(value) ~= "number" then return nil end
	return value
end

local function PlayerMapPosition()
	if not (C_Map and C_Map.GetBestMapForUnit and C_Map.GetPlayerMapPosition) then return nil end
	local ok, mapID = pcall(C_Map.GetBestMapForUnit, "player")
	if not ok or type(mapID) ~= "number" then return nil end
	local gotPos, pos = pcall(C_Map.GetPlayerMapPosition, mapID, "player")
	if not gotPos or type(pos) ~= "table" then return nil end
	local x, y
	if pos.GetXY then
		local ok2, gx, gy = pcall(pos.GetXY, pos)
		if ok2 then x, y = gx, gy end
	else
		x, y = pos.x, pos.y
	end
	x, y = Plain(x), Plain(y)
	if not x or not y then return nil end
	return mapID, x, y
end

local function CursorMapPosition()
	local frame = MapFrame()
	local container = frame and frame.ScrollContainer
	if container and container.GetNormalizedCursorPosition then
		local ok, x, y = pcall(container.GetNormalizedCursorPosition, container)
		x, y = ok and Plain(x), ok and Plain(y)
		if x and y and x >= 0 and x <= 1 and y >= 0 and y <= 1 then return x, y end
		return nil
	end
	-- No such method here, so the cursor is measured against the canvas itself.
	local child = container and container.Child
	if not child then return nil end
	local left, bottom, w, h = ns.Windows.Measure(child)
	if not left or w <= 0 or h <= 0 then return nil end
	local cx, cy = CursorInUIUnits()
	local x, y = (cx - left) / w, 1 - (cy - bottom) / h
	if x < 0 or x > 1 or y < 0 or y > 1 then return nil end
	return x, y
end

local function FormatXY(x, y)
	return string.format("%.1f, %.1f", x * 100, y * 100)
end

local function ZoneName(mapID)
	if not (mapID and C_Map and C_Map.GetMapInfo) then return nil end
	local ok, info = pcall(C_Map.GetMapInfo, mapID)
	if ok and type(info) == "table" and info.name then return info.name end
	return nil
end

-- The text the copy button hands over: "The Barrens 45.2, 67.8".
function Map.PlayerCoordText()
	local mapID, x, y = PlayerMapPosition()
	if not mapID then return nil end
	local zone = ZoneName(mapID)
	return (zone and (zone .. " ") or "") .. FormatXY(x, y)
end

-- Into whatever you are typing, or a fresh chat line if nothing is open.
local function CopyToChat(text)
	local edit = ChatEdit_GetActiveWindow and ChatEdit_GetActiveWindow()
	if edit and edit.IsShown and edit:IsShown() and edit.Insert then
		if pcall(edit.Insert, edit, text) then return "put into what you are typing" end
	end
	if ChatFrame_OpenChat and pcall(ChatFrame_OpenChat, text) then return "put into the chat box" end
	if ChatEdit_InsertLink and pcall(ChatEdit_InsertLink, text) then return "put into the chat box" end
	return nil
end

local function UpdateCoords()
	if not (coordsPart and coordsPart:IsShown()) then return end
	local mapID, x, y = PlayerMapPosition()
	playerLine:SetText(mapID and ("You  " .. FormatXY(x, y)) or "You  --")
	if ns.db.map.coordsCursor then
		local cx, cy = CursorMapPosition()
		cursorLine:SetText(cx and ("Cursor  " .. FormatXY(cx, cy)) or "Cursor  --")
		cursorLine:Show()
	else
		cursorLine:Hide()
	end
end

local function BuildCoords(parent)
	coordsPart = CreateFrame("Frame", "MapTabCoords", parent)
	coordsPart.mtOurs = true
	coordsPart:SetSize(112, 26)

	playerLine = coordsPart:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	playerLine:SetPoint("TOPLEFT", 0, 0)
	playerLine:SetJustifyH("LEFT")
	playerLine:SetText("You  --")

	cursorLine = coordsPart:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	cursorLine:SetPoint("TOPLEFT", 0, -13)
	cursorLine:SetJustifyH("LEFT")
	cursorLine:SetText("Cursor  --")

	-- Read ten times a second while the tab is up; the map's own OnUpdate would be overkill.
	coordsPart:SetScript("OnUpdate", function(_, elapsed)
		coordsElapsed = coordsElapsed + (elapsed or 0)
		if coordsElapsed < 0.1 then return end
		coordsElapsed = 0
		pcall(UpdateCoords)
	end)
	coordsPart:SetScript("OnShow", function() coordsElapsed = 1 end)
	return coordsPart
end

local COPY_ICONS = { "Interface\\Icons\\INV_Misc_Note_01", "Interface\\Icons\\INV_Scroll_03" }

local function BuildCopyButton(parent)
	copyButton = CreateFrame("Button", "MapTabCopy", parent)
	copyButton.mtOurs = true
	copyButton:SetSize(22, 22)
	copyButton:RegisterForClicks("LeftButtonUp", "RightButtonUp")

	local icon = copyButton:CreateTexture(nil, "ARTWORK")
	icon:SetPoint("TOPLEFT", 1, -1)
	icon:SetPoint("BOTTOMRIGHT", -1, 1)
	local path
	for _, candidate in ipairs(COPY_ICONS) do
		if ns.TextureExists(candidate) then path = candidate break end
	end
	if path then
		icon:SetTexture(path)
		icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
	else
		icon:Hide()
		local text = copyButton:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
		text:SetAllPoints()
		text:SetText("Copy")
		copyButton:SetWidth(36)
	end
	report["map copy icon"] = path or "text"

	local glow = copyButton:CreateTexture(nil, "HIGHLIGHT")
	glow:SetAllPoints()
	glow:SetColorTexture(1, 1, 1, 0.18)

	copyButton:SetScript("OnClick", function(_, button)
		local text = Map.PlayerCoordText()
		if not text then
			ns.Print("your position on the map is not available here.")
			return
		end
		if button == "RightButton" then
			ns.CopyBox("Your position", text)
			return
		end
		local how = CopyToChat(text)
		if how then
			ns.Print(text .. " " .. how .. ".")
		else
			ns.CopyBox("Your position", text)
		end
	end)
	copyButton:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_TOP")
		GameTooltip:SetText("Your coordinates", 1, 1, 1)
		GameTooltip:AddLine("Click: put them in the chat box, zone name first. Right-click: a box to copy them out of.",
			nil, nil, nil, true)
		GameTooltip:Show()
	end)
	copyButton:SetScript("OnLeave", function() GameTooltip:Hide() end)
	return copyButton
end

local function BuildTab()
	local frame = MapFrame()
	if not frame or tab then return end

	tab = ns.CreateTabPanel("MapTabTab", frame, "map tab")
	tab.mtOurs = true
	tab:SetSize(210, 36)
	tab:EnableMouse(true)
	if tab.CloseButton then tab.CloseButton:Hide() end
	if tab.TitleText then tab.TitleText:SetText("") end
	PlaceTab()

	tab.parts = {}
	local parts = tab.parts

	-- The coordinates go at the left end, so switching them on grows the tab leftwards, away
	-- from the sizing controls at the right.
	parts.coords = BuildCoords(tab)
	parts.copy = BuildCopyButton(tab)
	local divider2 = tab:CreateTexture(nil, "ARTWORK")
	divider2:SetColorTexture(1, 1, 1, 0.16)
	divider2:SetSize(1, 18)
	parts.divider2 = divider2

	parts.minus = SmallButton(tab, "-", 22, function() Map.Step(-1) end,
		"Smaller, in steps of " .. (ns.db.map.step or 10) .. " percent")

	label = tab:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	label:SetWidth(42)
	label:SetJustifyH("CENTER")
	label:SetText(Percent() .. "%")
	parts.label = label

	parts.plus = SmallButton(tab, "+", 22, function() Map.Step(1) end,
		"Bigger, in steps of " .. (ns.db.map.step or 10) .. " percent")

	parts.reset = ResetButton(tab)

	local divider = tab:CreateTexture(nil, "ARTWORK")
	divider:SetColorTexture(1, 1, 1, 0.16)
	divider:SetSize(1, 18)
	parts.divider = divider

	-- The resize grip. It lives here rather than on the map itself so that it can never sit on top
	-- of the quest panel or anything else the game draws inside the map.
	grip = CreateFrame("Button", "MapTabGrip", tab)
	grip.mtOurs = true
	grip:SetSize(18, 18)
	grip:EnableMouse(true)
	parts.grip = grip

	-- The game's own resize grabber, the one the chat windows carry. Everything under the Buttons
	-- folder fails to render on this client, but this family is known to.
	grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
	grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
	grip:SetPushedTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Down")
	report["map grip art"] = "chat frame grabber"

	grip:SetScript("OnMouseDown", StartResize)
	grip:SetScript("OnMouseUp", StopResize)
	grip:SetScript("OnHide", StopResize)
	grip:SetScript("OnDoubleClick", function() StopResize() Map.ResetSize() end)
	grip:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_TOP")
		GameTooltip:SetText("Resize the map", 1, 1, 1)
		GameTooltip:AddLine("Drag to scale the whole map. Hold shift to snap to "
			.. (ns.db.map.step or 10) .. " percent steps. Double-click for 100 percent.", nil, nil, nil, true)
		GameTooltip:Show()
	end)
	grip:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

-- The order the controls sit in, left to right. The tab is only as wide as the ones switched on,
-- and the grip slides over when the buttons are off.
local PART_ORDER = { "coords", "copy", "divider2", "minus", "label", "plus", "reset", "divider", "grip" }

local function LayoutTab()
	if not tab or not tab.parts then return end
	local buttons = ns.db.map.scaleButtons and true or false
	local resize = ns.db.map.resizeGrip and true or false
	local coords = ns.db.map.coords and true or false
	local x = 10
	for _, key in ipairs(PART_ORDER) do
		local part = tab.parts[key]
		local wanted
		if key == "grip" then
			wanted = resize
		elseif key == "divider" then
			wanted = buttons and resize
		elseif key == "coords" or key == "copy" then
			wanted = coords
		elseif key == "divider2" then
			wanted = coords and (buttons or resize)
		else
			wanted = buttons
		end
		part:SetShown(wanted)
		if wanted then
			part:ClearAllPoints()
			part:SetPoint("LEFT", tab, "LEFT", x, 0)
			x = x + (part:GetWidth() or 0) + ((key == "divider" or key == "divider2") and 6 or 4)
		end
	end
	tab:SetWidth(math.max(x + 6, 60))
	PlaceTab()
	if coords then pcall(UpdateCoords) end
end

-- ------------------------------------------------------------------
-- Dragging by the top bar
--
-- The map's top edge is full of the game's own controls, so a single strip laid across it would
-- swallow the clicks meant for them. Instead the band is cut into the stretches that none of the
-- map's own mouse-enabled frames are sitting on, and only those stretches take the mouse. The
-- pieces are worked out again whenever the map is shown or changes size, which is what happens
-- when the quest panel is opened.
-- ------------------------------------------------------------------

local function HideStrips()
	for _, strip in ipairs(strips) do strip:Hide() end
	Map.stripCount = 0
end

local function BuildStrips()
	local frame = MapFrame()
	if not frame then return end

	local on = On() and ns.db.map.topBarDrag
	if not on or not frame:IsShown() or IsMaximized() then
		HideStrips()
		if not on then report["map top bar"] = "switched off" end
		return
	end

	local left, bottom, width = ns.Windows.Measure(frame)
	if not left or width <= 0 then return end

	local gaps = ns.Windows.HeaderGaps(frame, BAND, 30)
	local ratio = ns.Windows.Ratio(frame)
	local index = 0

	for _, gap in ipairs(gaps) do
		index = index + 1
		local strip = strips[index]
		if not strip then
			strip = CreateFrame("Frame", nil, frame)
			strip.mtOurs = true
			local art = strip:CreateTexture(nil, "OVERLAY")
			art:SetAllPoints()
			strip.art = art
			local hint = strip:CreateTexture(nil, "OVERLAY")
			hint:SetAllPoints()
			hint:SetColorTexture(0.35, 0.72, 1, 0.20)
			hint:Hide()
			strip:SetScript("OnEnter", function() if ns.db.enabled and ns.db.showGrips then hint:Show() end end)
			strip:SetScript("OnLeave", function() hint:Hide() end)
			ns.Windows.WireRegion(strip, frame)
			strips[index] = strip
		end
		strip:ClearAllPoints()
		strip:SetPoint("TOPLEFT", frame, "TOPLEFT", (gap[1] - left) * ratio, 0)
		strip:SetSize(math.max(1, (gap[2] - gap[1]) * ratio), BAND * ratio)
		ns.RaiseOver(strip, frame, 3)
		strip.art:SetColorTexture(0.35, 0.72, 1, ns.db.showGrips and 0.14 or 0)
		strip:Show()
	end

	for i = index + 1, #strips do strips[i]:Hide() end
	Map.stripCount = index
	report["map top bar"] = index .. " draggable stretches along the top bar"
end

-- The corner handle is only worth showing when the top bar could not give us anywhere to grab, or
-- when the user has asked for it outright.
function Map.WantsHandle()
	if not (ns.db and ns.db.map) then return true end
	if ns.db.map.cornerHandle then return true end
	if not ns.db.map.topBarDrag then return true end
	return Map.stripCount == 0
end

-- Anything we lay over the map has to sit above whatever the map draws inside itself, or the quest
-- panel takes the mouse first.
local function RaiseControls()
	local frame = MapFrame()
	if not frame then return end
	if tab then report["map tab layer"] = ns.RaiseOver(tab, frame, 4) end
	local entry = ns.Windows.Entry(frame)
	if entry and entry.grip then ns.RaiseOver(entry.grip, frame, 4) end
	if entry and entry.overlay then ns.RaiseOver(entry.overlay, frame, 6) end
end

-- Called from the map's own OnSizeChanged, which fires while the user is dragging the grip too, so
-- the work is pushed to the end of the frame and only done once.
local function QueueRebuild()
	if rebuildQueued or resizing then return end
	rebuildQueued = true
	ns.After(0.05, function()
		rebuildQueued = false
		-- Opening or closing the quest log re-anchors the map, so a map the user has placed is put
		-- back. One that has never been moved is left to the game.
		if ns.db.positions["worldmap"] then pcall(Replace) end
		pcall(BuildStrips)
		pcall(RaiseControls)
		pcall(PlaceTab)
	end)
end

-- ------------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------------

function Map.Apply()
	local frame = MapFrame()
	if not frame then return end
	local db = ns.db
	local on = On()

	if on then BuildTab() end
	if tab then
		local wanted = on and (db.map.scaleButtons or db.map.resizeGrip or db.map.coords) and not IsMaximized()
		LayoutTab()
		tab:SetShown(wanted and true or false)
	end

	if on then
		Map.SetScale(db.map.scale, false)
	elseif scaled then
		-- With the feature switched off the map goes back to the size the game gives it. Where it
		-- sits is the game's business again: the move engine has already handed back its anchors.
		pcall(frame.SetScale, frame, 1)
		scaled = false
	end
	if label then label:SetText(Percent() .. "%") end

	BuildStrips()
	RaiseControls()
	-- The corner handle belongs to the shared move engine, and whether it is wanted depends on
	-- what the top bar just turned up.
	if ns.Windows and ns.Windows.UpdateGrips then ns.Windows.UpdateGrips() end
end

function Map.OnEvent(event)
	if event == "UI_SCALE_CHANGED" or event == "DISPLAY_SIZE_CHANGED" then
		Replace()
		QueueRebuild()
	end
end

function Map.Init()
	local frame = MapFrame()
	if not frame then
		report["world map frame"] = "WorldMapFrame is not on this client"
		return
	end
	report["world map frame"] = "found"
	report["world map canvas"] = frame.ScrollContainer and "has a ScrollContainer" or "no ScrollContainer"
	report["world map maximized"] = IsMaximized() and "yes, scaling is left alone while it is" or "no"

	-- Hidden windows report no position, so the tab, the strips and the scale are only set up once
	-- the map has actually been shown.
	frame:HookScript("OnShow", function()
		pcall(Map.Apply)
		ns.After(0, function() pcall(Map.Apply) end)
		-- The nav bar and the quest panel fill themselves in after the map appears, so the top bar
		-- is measured again once they have settled.
		ns.After(0.5, function() pcall(BuildStrips) pcall(RaiseControls) pcall(PlaceTab) end)
	end)

	-- Opening the quest panel makes the map wider. That is the moment the draggable stretches
	-- along the top bar have to be worked out again.
	frame:HookScript("OnSizeChanged", QueueRebuild)

	-- The map's own layout methods re-anchor it after they have changed its shape. A placed map
	-- is put straight back once each has finished, in the same frame, so it never shows anywhere
	-- else. Which of these exist varies by build; each is hooked only if it does.
	local hooked = 0
	for _, method in ipairs({ "SynchronizeDisplayState", "HandleUserActionToggleQuestLog", "OnQuestLogOpen",
		"OnQuestLogClose", "HandleUserActionMinimizeSelf", "HandleUserActionMaximizeSelf" }) do
		if type(frame[method]) == "function" and hooksecurefunc then
			local ok = pcall(hooksecurefunc, frame, method, function()
				if ns.db.positions["worldmap"] then Replace() end
			end)
			if ok then hooked = hooked + 1 end
		end
	end
	report["map layout hooks"] = hooked .. " of the map's layout methods hooked"

	-- Some builds toggle the side panel without changing the map's size.
	local panel = _G.QuestMapFrame
	if panel and panel.HookScript then
		pcall(panel.HookScript, panel, "OnShow", QueueRebuild)
		pcall(panel.HookScript, panel, "OnHide", QueueRebuild)
		report["quest panel"] = "found, watched for the top bar"
	else
		report["quest panel"] = "QuestMapFrame not on this client, the map's own size change is used"
	end
end
