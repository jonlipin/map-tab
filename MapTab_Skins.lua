-- Map Tab
-- Skins: Map Tab's own pieces in the window styles. Styles.lua does the choosing and the drawing
-- (Blizzard, Dark, or EllesmereUI's look); this file says what Map Tab restyles.
--
-- Only what Map Tab builds itself: the tab under the map, the options window and the copy box.
-- Left as they are:
--  * the world map itself, its zone and level labels, and the map art the reveal paints in: they
--    are the game's, or EllesmereUI's when it restyles the map;
--  * the drag strips, the corner handle and the drag tint: faint marks laid over the map, which
--    only show when asked for, and which a window backdrop would only cover the map with;
--  * the resize grip, the game's own grabber art, which no flat style has a match for;
--  * the options themselves: one block of controls, shown both in the game's own options panel
--    (which no style reaches into) and in the options window, so it keeps the game's look in both.

local ADDON, ns = ...
local Styles = ns.Styles
local Try = Styles.Try

local function S() return Styles.S end

local function Fonts(...)
	for i = 1, select("#", ...) do
		local fs = select(i, ...)
		if type(fs) == "table" and fs.GetFont then S().Font(fs) end
	end
end

-- A border a style lays over a window is a frame above everything in it, so the window's own
-- close button is put back on top of it.
local function RaiseAbove(button, win)
	if type(button) ~= "table" or not button.SetFrameLevel then return end
	local top = win:GetFrameLevel() or 0
	for _, child in ipairs(ns.Children(win)) do
		if child ~= button then
			local level = child.GetFrameLevel and child:GetFrameLevel()
			if type(level) == "number" and level > top then top = level end
		end
	end
	button:SetFrameLevel(top + 1)
end

-- ---- pieces built later, as they are needed ----------------------------------------------------

-- The options window and the copy box, both made by ns.CreatePanel.
function ns.SkinWindow(win)
	if not S() or type(win) ~= "table" then return end
	Try("window " .. tostring(win.GetName and win:GetName() or "?"), function()
		S().Shell(win)
		-- A title the window template did not bring is white too, as the shell makes its own.
		Fonts(win.mtTitle)
		if type(win.mtTitle) == "table" then S().White(win.mtTitle) end
		local close = win.mtClose
		if type(close) == "table" then
			S().CloseButton(close)
			RaiseAbove(close, win)
		end
	end)
end

-- The tab under the map, made the first time the map opens.
function ns.SkinTab(tab)
	if not S() or type(tab) ~= "table" then return end
	Try("map tab", function()
		S().Panel(tab)
		if type(tab.NineSlice) == "table" then S().FadeNineSlice(tab.NineSlice) end
		local parts = type(tab.parts) == "table" and tab.parts or {}
		for _, key in ipairs({ "minus", "plus" }) do
			local button = parts[key]
			if type(button) == "table" then
				S().Button(button)
				S().WhiteButtonLabel(button)
				Fonts(button.GetFontString and button:GetFontString())
			end
		end
		-- The reset and copy icons lose their bevel and get a pixel edge; where an icon did not
		-- load, the button's word stands in and only its font changes.
		for _, key in ipairs({ "reset", "copy" }) do
			local button = parts[key]
			if type(button) == "table" then
				local icon = button.mtIcon
				if type(icon) == "table" and icon:IsShown() then S().SquareIcon(icon, button) end
				Fonts(button.mtText)
			end
		end
		local coords = parts.coords
		Fonts(parts.label, type(coords) == "table" and coords.player, type(coords) == "table" and coords.cursor)
	end)
end

-- ---- everything that exists when a style is applied ---------------------------------------------

local function SkinAll()
	ns.SkinWindow(_G.MapTabWindow)
	ns.SkinWindow(_G.MapTabCopyBox)
	ns.SkinTab(_G.MapTabTab)
end

Styles.Setup({
	addon = ADDON,
	title = "Map Tab",
	db = function() return ns.db end,
	report = ns.report,
	accent = { 0.35, 0.72, 1 }, -- the blue of the drag areas
	skin = SkinAll,
})
