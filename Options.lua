-- Map Tab
-- Options: one set of controls, shown either in the game's own options list
-- (Esc > Options > AddOns > Map Tab) or in a standalone window opened with "/maptab window".
--
-- The page is registered as a CANVAS category and holds only this addon's own widgets. It
-- deliberately does not create Settings proxy settings: on this client those taint Blizzard code
-- paths and produce "secret number value" errors in unrelated frames. Registering a canvas
-- category and drawing into it is safe.

local ADDON, ns = ...

local report = ns.report

local CONTENT_W, CONTENT_H = 640, 624
local NAV_W = 146
local PANE_X = NAV_W + 14
local PANE_W = CONTENT_W - PANE_X - 14

local content, window, page
local pages, navButtons = {}, {}
local widgets = {}
local uniqueID = 0

local function NextName(prefix)
	uniqueID = uniqueID + 1
	return "MapTab" .. prefix .. uniqueID
end

-- ------------------------------------------------------------------
-- Layout helper: a simple top down flow inside one page
-- ------------------------------------------------------------------

local function NewLayout(parent)
	return { parent = parent, y = 4 }
end

local function Place(layout, region, height, indent)
	region:ClearAllPoints()
	region:SetPoint("TOPLEFT", layout.parent, "TOPLEFT", indent or 0, -layout.y)
	layout.y = layout.y + height
end

-- ------------------------------------------------------------------
-- Widgets
-- ------------------------------------------------------------------

local function Header(layout, label)
	local fs = layout.parent:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	fs:SetText(label)
	Place(layout, fs, 20)
	local line = layout.parent:CreateTexture(nil, "ARTWORK")
	line:SetColorTexture(1, 0.82, 0, 0.35)
	line:SetSize(PANE_W, 1)
	Place(layout, line, 12)
end

local function Note(layout, label, indent, lines)
	local fs = layout.parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	fs:SetWidth(PANE_W - (indent or 0))
	fs:SetJustifyH("LEFT")
	fs:SetWordWrap(true)
	fs:SetText(label)
	-- GetStringHeight can report 0 before the first layout pass, so the caller says how many
	-- lines to budget for anything that wraps.
	local height = math.max((lines or 1) * 13, fs:GetStringHeight()) + 8
	Place(layout, fs, height, indent)
	return fs
end

local function Check(layout, label, tooltip, get, set, indent)
	local cb
	for _, template in ipairs({ "UICheckButtonTemplate", "ChatConfigCheckButtonTemplate" }) do
		local ok, made = pcall(CreateFrame, "CheckButton", NextName("Check"), layout.parent, template)
		if ok and made then cb = made break end
	end
	if not cb then
		cb = CreateFrame("CheckButton", NextName("Check"), layout.parent)
		cb:SetNormalTexture("Interface\\Buttons\\UI-CheckBox-Up")
		cb:SetPushedTexture("Interface\\Buttons\\UI-CheckBox-Down")
		cb:SetHighlightTexture("Interface\\Buttons\\UI-CheckBox-Highlight")
		cb:SetCheckedTexture("Interface\\Buttons\\UI-CheckBox-Check")
	end
	cb:SetSize(24, 24)

	local fs = cb.Text or cb.text or (cb.GetName and _G[cb:GetName() .. "Text"])
	if not fs then
		fs = cb:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
		fs:SetPoint("LEFT", cb, "RIGHT", 2, 0)
	end
	fs:SetText(label)
	fs:SetFontObject("GameFontHighlight")

	cb:SetScript("OnClick", function(self)
		set(self:GetChecked() and true or false)
		ns.Refresh()
		ns.SyncOptions()
	end)
	ns.Tooltip(cb, label, tooltip)

	Place(layout, cb, 26, indent)
	widgets[#widgets + 1] = { refresh = function() cb:SetChecked(get() and true or false) end }
	return cb
end

-- The world map switch, with a Reset button at the right hand end of its row that forgets the
-- map's position and puts it back to 100 percent. It is Map Tab's only on/off switch: the saved
-- `enabled` (Casement's master switch, which covered the bags and bank as well) and
-- `windows.worldmap` show here as one, and turning it on turns both on.
local function MapSwitch(layout, label, tooltip)
	local top = layout.y
	local cb = Check(layout, label, tooltip,
		function() return ns.db.enabled and ns.db.windows.worldmap end,
		function(value)
			ns.db.windows.worldmap = value
			if value then
				ns.db.enabled = true
			else
				ns.Windows.ResetGroup("worldmap")
			end
		end)

	local reset = ns.Button(layout.parent, "Reset", 60, 20, function()
		ns.Windows.ResetGroup("worldmap")
		if ns.Map.ResetSize then ns.Map.ResetSize() end
		ns.Print("the world map is back where the game had it, at 100 percent.")
		ns.SyncOptions()
	end)
	reset:SetPoint("TOPRIGHT", layout.parent, "TOPRIGHT", 0, -top - 2)
	ns.Tooltip(reset, "Reset", "Forgets where the map was left and hands it back to the game, at 100 percent.")

	local count = layout.parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	count:SetPoint("RIGHT", reset, "LEFT", -6, 0)
	widgets[#widgets + 1] = { refresh = function()
		local moved = ns.Windows.MovedCount("worldmap") > 0
		local sized = math.floor((ns.db.map.scale or 1) * 100 + 0.5) ~= 100
		local parts = {}
		if moved then parts[#parts + 1] = "moved" end
		if sized then parts[#parts + 1] = math.floor((ns.db.map.scale or 1) * 100 + 0.5) .. "%" end
		count:SetText(table.concat(parts, ", "))
		reset:SetEnabled(moved or sized)
	end }
	return cb
end

local SLIDER_TEMPLATES = { "MinimalSliderTemplate", "UISliderTemplate", "OptionsSliderTemplate" }

local function Slider(layout, label, minV, maxV, step, get, set, format, tooltip, indent)
	local name = NextName("Slider")
	local holder = CreateFrame("Frame", nil, layout.parent)
	holder:SetSize(PANE_W - (indent or 0), 40)

	local caption = holder:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	caption:SetPoint("TOPLEFT", 0, 0)
	caption:SetText(label)

	local value = holder:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
	value:SetPoint("TOPRIGHT", 0, -1)

	local slider, used
	for _, template in ipairs(SLIDER_TEMPLATES) do
		local ok, made = pcall(CreateFrame, "Slider", name, holder, template)
		if ok and made then slider, used = made, template break end
	end
	if not slider then
		slider = CreateFrame("Slider", name, holder)
		slider:SetOrientation("HORIZONTAL")
		slider:SetThumbTexture("Interface\\Buttons\\WHITE8X8")
		local thumb = slider:GetThumbTexture()
		if thumb then thumb:SetSize(10, 18) thumb:SetColorTexture(0.62, 0.62, 0.66, 0.9) end
		used = "bare"
	end
	report["slider template"] = used

	-- OptionsSliderTemplate brings its own captions, we draw our own.
	for _, suffix in ipairs({ "Low", "High", "Text" }) do
		local extra = _G[name .. suffix]
		if extra then extra:SetText("") extra:Hide() end
	end

	slider:SetPoint("TOPLEFT", 2, -18)
	slider:SetSize(PANE_W - (indent or 0) - 6, 18)
	slider:SetMinMaxValues(minV, maxV)
	if slider.SetValueStep then slider:SetValueStep(step) end
	if slider.SetObeyStepOnDrag then pcall(slider.SetObeyStepOnDrag, slider, true) end

	local function Label(v) value:SetText(format and format(v) or tostring(v)) end

	slider:SetScript("OnValueChanged", function(self, v)
		v = math.floor(v / step + 0.5) * step
		Label(v)
		if self.mtSyncing then return end
		set(v)
		ns.Refresh()
		-- Everything else on the page follows (the map switch's Reset and its percentage), but
		-- not this slider itself: setting its value again in the middle of a drag would fight it.
		ns.SyncOptions(self)
	end)
	ns.Tooltip(slider, label, tooltip)

	Place(layout, holder, 44, indent)
	widgets[#widgets + 1] = { owner = slider, refresh = function()
		local v = get()
		slider.mtSyncing = true
		slider:SetValue(v)
		slider.mtSyncing = false
		Label(v)
	end }
	return slider
end

local function Choice(layout, label, options, get, set, tooltip, indent)
	local holder = CreateFrame("Frame", nil, layout.parent)
	holder:SetSize(PANE_W - (indent or 0), 44)

	local caption = holder:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	caption:SetPoint("TOPLEFT", 0, 0)
	caption:SetText(label)

	local buttons = {}
	local x = 0
	for index, option in ipairs(options) do
		local button = ns.Button(holder, option.label, 44, 21)
		local textWidth = button:GetFontString() and button:GetFontString():GetStringWidth() or 40
		button:SetWidth(math.max(44, textWidth + 18))
		button:SetPoint("TOPLEFT", x, -20)
		x = x + button:GetWidth() + 4
		button.mtValue = option.value
		button:SetScript("OnClick", function(self)
			set(self.mtValue)
			ns.Refresh()
			ns.SyncOptions()
		end)
		ns.Tooltip(button, label, option.tooltip or tooltip)
		buttons[index] = button
	end

	Place(layout, holder, 46, indent)
	widgets[#widgets + 1] = { refresh = function()
		local current = get()
		for _, button in ipairs(buttons) do
			if button.mtValue == current then
				if button.LockHighlight then button:LockHighlight() end
				if button.SetNormalFontObject then pcall(button.SetNormalFontObject, button, "GameFontNormalSmall") end
			else
				if button.UnlockHighlight then button:UnlockHighlight() end
				if button.SetNormalFontObject then pcall(button.SetNormalFontObject, button, "GameFontDisableSmall") end
			end
		end
	end }
	return holder
end

local function ButtonRow(layout, buttons)
	local holder = CreateFrame("Frame", nil, layout.parent)
	holder:SetSize(PANE_W, 24)
	local x = 0
	for _, spec in ipairs(buttons) do
		local button = ns.Button(holder, spec.label, spec.width or 130, 22, spec.onClick)
		button:SetPoint("LEFT", x, 0)
		x = x + button:GetWidth() + 6
		ns.Tooltip(button, spec.label, spec.tooltip)
		if spec.refresh then widgets[#widgets + 1] = { refresh = function() spec.refresh(button) end } end
	end
	Place(layout, holder, 30)
	return holder
end

-- ------------------------------------------------------------------
-- Pages
-- ------------------------------------------------------------------

local function BuildMapPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "World map")

	MapSwitch(layout, "Move and resize the world map", "Map Tab's on and off switch, the one /maptab lock and /maptab unlock turn off and on. Off, Map Tab adds nothing to the map and leaves it entirely to the game: it goes back where the game puts it, at its own size, and the tab and the reveal go with it.")

	Note(layout, "Everything Map Tab adds lives in a tab under the map, so nothing covers the map's own interface. Resizing scales the whole window: the grip, the buttons and the slider set the same number, and the map, its pins and its text stay in proportion. The map never goes off screen, and a maximized map is left alone.", 0, 4)

	Check(layout, "Drag the map by its top bar", "The clear stretches of the top bar move the map. The game's own buttons up there are measured and left alone.",
		function() return ns.db.map.topBarDrag end,
		function(value) ns.db.map.topBarDrag = value end)

	Check(layout, "Always show the corner handle", "A small gold handle in the map's top left corner. It appears on its own if the top bar has no room to spare.",
		function() return ns.db.map.cornerHandle end,
		function(value) ns.db.map.cornerHandle = value end, 24)

	Choice(layout, "Hold this key to drag the map from anywhere", {
		{ value = "none", label = "Off" },
		{ value = "shift", label = "Shift" },
		{ value = "ctrl", label = "Ctrl" },
		{ value = "alt", label = "Alt" },
	}, function() return ns.db.dragModifier end,
		function(value) ns.db.dragModifier = value end,
		"While the key is held, the map can be grabbed anywhere on it, not just by its top bar. Nothing shows on screen unless the drag areas are switched on below.")

	Check(layout, "Show me where the drag areas are", "Paints a faint blue band over the parts of the top bar that drag the map, and tints the map while the drag key is held.",
		function() return ns.db.showGrips end,
		function(value) ns.db.showGrips = value end)

	Check(layout, "Percentage buttons in the tab", "Minus, the current percentage, plus, and a button back to 100 percent.",
		function() return ns.db.map.scaleButtons end,
		function(value) ns.db.map.scaleButtons = value end)

	Check(layout, "Resize grip in the tab", "Drag it to scale the map. Hold shift while dragging to snap to the step below. Double-click it for 100 percent.",
		function() return ns.db.map.resizeGrip end,
		function(value) ns.db.map.resizeGrip = value end)

	Slider(layout, "Map size", 50, 200, 5,
		function() return math.floor((ns.db.map.scale or 1) * 100 + 0.5) end,
		function(value) ns.Map.SetScale(value / 100, false) end,
		function(v) return v .. "%" end,
		"The same number the buttons and the grip set.")

	Slider(layout, "The buttons move in steps of", 5, 25, 5,
		function() return ns.db.map.step or 10 end,
		function(value) ns.db.map.step = value end,
		function(v) return v .. "%" end,
		"How far one click of the plus or minus button moves the size. Clicks always land on a round multiple of this.")

	Check(layout, "Coordinates in the tab", "Your position, at the left end of the tab, with a button that puts it into chat (or right-click for a box to copy it from). The tab grows to the left to make room.",
		function() return ns.db.map.coords end,
		function(value) ns.db.map.coords = value end)

	Check(layout, "Cursor coordinates too", "A second line under your position with where the mouse is pointing on the map.",
		function() return ns.db.map.coordsCursor end,
		function(value) ns.db.map.coordsCursor = value end, 24)

	Check(layout, "Draw the parts of the map you have not explored", "Paints the unexplored areas in with their real art. Map Tab can only draw an area it knows the art for: what is shipped with it, plus everything any character on this account has ever had revealed. /maptab mapdata says how much of the open map that covers.",
		function() return ns.db.map.reveal end,
		function(value) ns.db.map.reveal = value end)

	Choice(layout, "Tint the areas you have not explored", {
		{ value = "none", label = "No tint" },
		{ value = "blue", label = "Blue" },
		{ value = "sepia", label = "Sepia" },
		{ value = "grey", label = "Grey" },
	}, function() return ns.db.map.revealTint end,
		function(value) ns.db.map.revealTint = value end,
		"So the drawn in areas can still be told from the ones you have actually been to.", 24)

	ButtonRow(layout, {
		{ label = "Back to 100%", width = 110, onClick = function() ns.Map.ResetSize() end },
		{ label = "Forget its position", width = 140, onClick = function()
			ns.Windows.ResetGroup("worldmap")
			ns.Print("the map is back where the game had it.")
		end },
	})
end

local function BuildAboutPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "About Map Tab")

	Note(layout, "Map Tab version " .. ns.version .. ". The world map half of what used to be Casement; the bag, bank and saved bank half is Bank Tabs.", 0, 2)
	Note(layout, "Commands:", 0, 1)
	local lines = {
		"/maptab opens these options",
		"/maptab window opens them in a window of their own",
		"/maptab scale 120 sets the map size",
		"/maptab reset puts the map back where the game had it, at 100 percent",
		"/maptab lock or unlock turns the world map switch off or on",
		"/maptab coords puts your coordinates in a box to copy",
		"/maptab mapdata says how much of the open map the reveal knows",
		"/maptab grips outlines the parts of the map you can drag",
		"/maptab debug prints what resolved on this client",
	}
	for _, line in ipairs(lines) do Note(layout, "|cffffff00" .. line .. "|r", 12, 1) end

	Note(layout, "If the map will not move, or the tab is missing, run /maptab debug and send the output along with the report. Every part of this addon probes the client first and says in there what it found.", 0, 3)

	ButtonRow(layout, {
		{ label = "Print the debug report", width = 170, onClick = function()
			SlashCmdList["MAPTAB"]("debug")
		end },
		{ label = "Reset all settings", width = 140, onClick = function() ns.ResetToDefaults() end },
	})
end

local PAGES = {
	{ key = "map", label = "World map", build = BuildMapPage },
	{ key = "about", label = "About", build = BuildAboutPage },
}

local function ShowPage(key)
	for _, entry in ipairs(PAGES) do
		if pages[entry.key] then pages[entry.key]:SetShown(entry.key == key) end
		local button = navButtons[entry.key]
		if button then
			if entry.key == key then
				if button.LockHighlight then button:LockHighlight() end
			else
				if button.UnlockHighlight then button:UnlockHighlight() end
			end
		end
	end
	ns.SyncOptions()
end

-- ------------------------------------------------------------------
-- The shared content block
-- ------------------------------------------------------------------

local function BuildContent()
	if content then return end

	content = CreateFrame("Frame", "MapTabOptions", UIParent)
	content:SetSize(CONTENT_W, CONTENT_H)

	local title = content:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	title:SetPoint("TOPLEFT", 0, 0)
	title:SetText("Map Tab")

	local subtitle = content:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	subtitle:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -2)
	subtitle:SetText("Move and resize the world map from a tab under it, with coordinates and an optional fog reveal.")

	local nav = CreateFrame("Frame", nil, content)
	nav:SetPoint("TOPLEFT", 0, -44)
	nav:SetSize(NAV_W, CONTENT_H - 44)

	local navY = 0
	for _, entry in ipairs(PAGES) do
		local button = ns.Button(nav, entry.label, NAV_W - 8, 24, function() ShowPage(entry.key) end)
		button:SetPoint("TOPLEFT", 0, -navY)
		navButtons[entry.key] = button
		navY = navY + 28
	end

	local divider = content:CreateTexture(nil, "ARTWORK")
	divider:SetColorTexture(1, 1, 1, 0.12)
	divider:SetPoint("TOPLEFT", NAV_W, -44)
	divider:SetSize(1, CONTENT_H - 54)

	for _, entry in ipairs(PAGES) do
		local frame = CreateFrame("Frame", nil, content)
		frame:SetPoint("TOPLEFT", PANE_X, -44)
		frame:SetSize(PANE_W, CONTENT_H - 50)
		frame:Hide()
		pages[entry.key] = frame
		local ok, err = pcall(entry.build, frame)
		report["page " .. entry.key] = ok and "ok" or ("failed: " .. tostring(err))
	end

	ShowPage("map")
	-- Stays out of sight until a host (the window or the options page) asks for it.
	content:Hide()
end

-- Brings every widget in line with the saved settings. `skip` is a control that is being used
-- right now and already shows its own value.
function ns.SyncOptions(skip)
	if not content or not ns.db then return end
	for _, widget in ipairs(widgets) do
		if skip == nil or widget.owner ~= skip then pcall(widget.refresh) end
	end
end

local function HostContent(host, x, y, scale)
	content:SetParent(host)
	content:ClearAllPoints()
	content:SetPoint("TOPLEFT", host, "TOPLEFT", x, y)
	content:SetScale(scale or 1)
	content:Show()
end

-- ------------------------------------------------------------------
-- Standalone window
-- ------------------------------------------------------------------

local function BuildWindow()
	if window then return end
	window = ns.CreatePanel("MapTabWindow")
	window:SetSize(CONTENT_W + 32, CONTENT_H + 52)
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:Hide()
	window.mtTitle:SetText("Map Tab")

	window:SetScript("OnShow", function(self)
		HostContent(self, 18, -36, 1)
		ns.SyncOptions()
	end)

	tinsert(UISpecialFrames, "MapTabWindow")
end

-- ------------------------------------------------------------------
-- The entry in Esc > Options > AddOns
-- ------------------------------------------------------------------

-- The category's ID, which is what Settings.OpenToCategory actually documents. Passing the
-- category itself is accepted by some builds and quietly ignored by others.
local function CategoryID()
	local category = ns.optionsCategory
	if not category then return nil end
	if category.GetID then
		local ok, id = pcall(category.GetID, category)
		if ok and id then return id end
	end
	return category.ID or category.id
end

local function PanelIsOpen()
	if SettingsPanel and SettingsPanel.IsShown then return SettingsPanel:IsShown() and true or false end
	return false
end

-- True once our page is actually on screen. Everything below is judged against this rather than
-- against whether a call raised an error, because the call that does nothing does not error.
local function PageIsOpen()
	if not page then return false end
	if page.IsVisible then return page:IsVisible() and true or false end
	return page:IsShown() and true or false
end

local function ShowPanel()
	if not SettingsPanel then return end
	if SettingsPanel.Open then
		if pcall(SettingsPanel.Open, SettingsPanel) then return end
	end
	if ShowUIPanel then pcall(ShowUIPanel, SettingsPanel) end
end

-- Settings.OpenToCategory NAVIGATES to a category, it does not necessarily open the window. With
-- the window shut it can quietly do nothing, which is why the first route opens the window itself
-- before navigating. Each route is tried in turn and judged on whether the page ended up visible.
local OPEN_ROUTES = {
	{
		name = "opening the window, then the category id",
		run = function()
			ShowPanel()
			local id = CategoryID()
			if id and Settings and Settings.OpenToCategory then pcall(Settings.OpenToCategory, id) end
		end,
	},
	{
		name = "the category id",
		run = function()
			local id = CategoryID()
			if id and Settings and Settings.OpenToCategory then pcall(Settings.OpenToCategory, id) end
		end,
	},
	{
		name = "the category itself",
		run = function()
			if Settings and Settings.OpenToCategory then pcall(Settings.OpenToCategory, ns.optionsCategory) end
		end,
	},
	{
		name = "the older interface options route",
		run = function()
			if InterfaceOptionsFrame_OpenToCategory and page then
				-- This one wants two goes at it to land on the right panel.
				pcall(InterfaceOptionsFrame_OpenToCategory, page)
				pcall(InterfaceOptionsFrame_OpenToCategory, page)
			end
		end,
	},
}

function ns.OpenBlizzardOptions()
	if not ns.optionsCategory then return false end
	local panelWasOpen = PanelIsOpen()

	for _, route in ipairs(OPEN_ROUTES) do
		route.run()
		if PageIsOpen() then
			report["open options"] = "ok, via " .. route.name
			return true
		end
	end

	if not panelWasOpen and PanelIsOpen() then
		if HideUIPanel then pcall(HideUIPanel, SettingsPanel) end
	end
	report["open options"] = "no route worked, using the addon's own window"
	return false
end

function ns.ToggleOptions(forceWindow)
	BuildContent()
	BuildWindow()

	if window:IsShown() then window:Hide() return end
	if PageIsOpen() then
		-- Closing the game's own panel from addon code is protected here, so the user closes it.
		return
	end

	if not forceWindow and ns.OpenBlizzardOptions() then return end
	window:Show()
end

local function BuildOptionsCategory()
	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		report["options category"] = "Settings API missing, use /maptab window"
		return
	end

	page = CreateFrame("Frame")
	page:Hide()
	page.name = "Map Tab"
	-- The canvas mixin looks for these; ours have nothing to do because every control writes its
	-- value straight into the saved variables when it is used.
	page.OnCommit = function() end
	page.OnDefault = function() ns.ResetToDefaults() end
	page.OnRefresh = function() ns.SyncOptions() end

	local function Fit()
		local w, h = page:GetWidth() or 0, page:GetHeight() or 0
		if w <= 0 or h <= 0 then return end
		local scale = math.min(1, (w - 24) / CONTENT_W, (h - 24) / CONTENT_H)
		HostContent(page, 12, -12, scale)
	end

	page:SetScript("OnShow", function()
		if window and window:IsShown() then window:Hide() end
		Fit()
		ns.SyncOptions()
	end)
	page:SetScript("OnSizeChanged", function() if page:IsShown() then Fit() end end)

	local category = Settings.RegisterCanvasLayoutCategory(page, "Map Tab")
	Settings.RegisterAddOnCategory(category)
	ns.optionsCategory = category
	report["options category"] = "ok (canvas page)"
end

function ns.SetupOptions()
	BuildContent()
	BuildWindow()
	local ok, err = pcall(BuildOptionsCategory)
	if not ok then report["options category"] = "failed: " .. tostring(err) end
	ns.SyncOptions()
end
