-- Map Tab
-- Core: saved variables, defaults, the shared event frame, carrying Casement's data over, and the
-- slash commands.
--
-- Client notes that shape this file:
--  * Every character's settings are mirrored into an account wide copy, and a character whose
--    own table comes back empty adopts that copy at load, positions aside.
--  * Anything that might not exist on this client is probed once and recorded in `report`, which
--    "/maptab debug" prints. Nothing in this addon should ever hard error.
--  * Nothing here registers COMBAT_LOG_EVENT_UNFILTERED, loads a Blizzard_ addon or creates
--    Settings proxy objects. All three taint this client.

local ADDON, ns = ...

ns.version = "1.1.0"
ns.report = {}

local report = ns.report

local function Print(msg)
	DEFAULT_CHAT_FRAME:AddMessage("|cff8fd3ffMap Tab|r " .. tostring(msg))
end
ns.Print = Print

-- ------------------------------------------------------------------
-- Defaults
-- ------------------------------------------------------------------

ns.defaults = {
	enabled = true,

	-- The world map switch. Turning it off puts the map back under the game's own control, at
	-- its own size, and takes the tab and the reveal away with it.
	windows = {
		worldmap = true,
	},

	-- Hold this key and drag anywhere on the map to move it. "none" turns it off and leaves only
	-- the top bar working.
	dragModifier = "alt",

	-- Draw a faint outline over the parts of the map that can be dragged.
	showGrips = false,

	map = {
		resizeGrip = true,
		scaleButtons = true,
		topBarDrag = true,
		cornerHandle = false, -- the handle appears on its own when the top bar has no room
		scale = 1.0,
		step = 10, -- percent per click of the scale buttons
		minScale = 0.5,
		maxScale = 2.0,
		-- Your position and the cursor's, at the left end of the tab, with a button that puts
		-- your position into chat.
		coords = true,
		coordsCursor = true,
		-- Drawing the unexplored parts of the map, tinted so they can still be told apart.
		reveal = false,
		revealTint = "blue",
		-- A zone's level range after its name, pointing at it on the continent map, coloured by
		-- how hard it is for you, as the game does where it knows the range itself.
		zoneLevels = true,
	},

	-- Where the map was left, in UIParent units.
	positions = {},
}

-- ------------------------------------------------------------------
-- Table helpers
-- ------------------------------------------------------------------

local function DeepCopy(src)
	local out = {}
	for k, v in pairs(src) do
		if type(v) == "table" then out[k] = DeepCopy(v) else out[k] = v end
	end
	return out
end
ns.DeepCopy = DeepCopy

-- Fills in anything the saved table is missing without touching what the user set.
local function FillDefaults(dst, src)
	for k, v in pairs(src) do
		if type(v) == "table" then
			if type(dst[k]) ~= "table" then dst[k] = {} end
			FillDefaults(dst[k], v)
		elseif dst[k] == nil then
			dst[k] = v
		end
	end
	return dst
end

local function CountKeys(t)
	local n = 0
	if type(t) == "table" then for _ in pairs(t) do n = n + 1 end end
	return n
end
ns.CountKeys = CountKeys

function ns.Round(value, places)
	local mult = 10 ^ (places or 0)
	return math.floor(value * mult + 0.5) / mult
end

function ns.Clamp(value, low, high)
	if value < low then return low end
	if value > high then return high end
	return value
end

-- A later timer than C_Timer on a client that somehow lacks it: the shared event frame runs the
-- queue in OnUpdate instead, so nothing in the addon has to care which one it got.
local pending = {}
function ns.After(delay, fn)
	if C_Timer and C_Timer.After then
		C_Timer.After(delay, function() pcall(fn) end)
		return
	end
	pending[#pending + 1] = { at = GetTime() + delay, fn = fn }
end

-- ------------------------------------------------------------------
-- Saved variables
-- ------------------------------------------------------------------

local function MirrorToAccount()
	if not ns.db then return end
	MapTabAccountDB = MapTabAccountDB or {}
	MapTabAccountDB.profile = DeepCopy(ns.db)
	MapTabAccountDB.version = ns.version
end
ns.MirrorToAccount = MirrorToAccount

-- A character whose own table is empty (a character's first run with Map Tab) adopts the account
-- mirror, so every character starts from the settings last used anywhere on the account.
-- `ns.dbFresh` remembers that the table was made or adopted this session: nothing in it is yet
-- this character's own choice, so this character's own Casement settings may replace it.
local function LoadDB(phase)
	local fresh = CountKeys(MapTabDB) == 0
	ns.dbFresh = fresh
	if fresh and type(MapTabAccountDB) == "table" and type(MapTabAccountDB.profile) == "table" then
		MapTabDB = DeepCopy(MapTabAccountDB.profile)
		-- The map's position belongs to the character that set it, not to whoever logged in first,
		-- and so does the note that this character's Casement settings were brought over.
		MapTabDB.positions = {}
		MapTabDB.importedCasement = nil
		report["db " .. phase] = "adopted the account copy"
	else
		MapTabDB = type(MapTabDB) == "table" and MapTabDB or {}
		report["db " .. phase] = fresh and "fresh (first run)" or "loaded from this character"
	end
	FillDefaults(MapTabDB, ns.defaults)
	ns.db = MapTabDB

	MapTabAccountDB = type(MapTabAccountDB) == "table" and MapTabAccountDB or {}

	MirrorToAccount()
end

function ns.ResetToDefaults()
	-- Whether this character's Casement settings were already brought over is not a setting, and
	-- a reset must not let them be brought over again at the next login.
	local imported = ns.db and ns.db.importedCasement
	MapTabDB = DeepCopy(ns.defaults)
	MapTabDB.importedCasement = imported
	ns.db = MapTabDB
	MirrorToAccount()
	if ns.Windows and ns.Windows.ResetAll then pcall(ns.Windows.ResetAll) end
	ns.Refresh()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
	Print("Settings reset to defaults. The map areas the reveal has learned were kept.")
end

-- ------------------------------------------------------------------
-- Whether Map Tab is handling the world map
-- ------------------------------------------------------------------

-- True while both saved switches are on and the old, whole Casement is not running beside Map Tab
-- this session. The options show the two switches as one ("Move and resize the world map"); the
-- second, `enabled`, is kept so that a Casement whose master switch was off comes over as off.
-- While the old Casement runs it handles the map itself, so Map Tab leaves the map to it until
-- the next session, when the old addon has been switched off.
function ns.MapOn()
	local db = ns.db
	return (db and db.enabled and type(db.windows) == "table" and db.windows.worldmap and not ns.oldCasementRunning) and true or false
end

-- The old Casement's own event frame: its code ran this session.
local function OldCasementRunning()
	return type(_G.CasementFrame) == "table"
end

-- ------------------------------------------------------------------
-- Refresh fan out. Every setter in the options calls this.
-- ------------------------------------------------------------------

function ns.Refresh()
	MirrorToAccount()
	if ns.Windows and ns.Windows.Apply then pcall(ns.Windows.Apply) end
	if ns.Map and ns.Map.Apply then pcall(ns.Map.Apply) end
	if ns.Reveal and ns.Reveal.Apply then pcall(ns.Reveal.Apply) end
	if ns.Levels and ns.Levels.Apply then pcall(ns.Levels.Apply) end
end

-- ------------------------------------------------------------------
-- Carrying Casement's data over
--
-- Map Tab is the world map half of Casement, split out of it. Saved variables are named after
-- the addon's folder, so Casement's never reach this addon by themselves. Once, at PLAYER_LOGIN
-- (after every addon has loaded), the world map's share of them is copied across: the map's
-- size, position and switches for this character, and the reveal's learned map areas for the
-- account. Casement's tables are only read, never changed, and a value the user has already
-- changed in Map Tab is never overwritten.
--
-- The data is found in one of two places: the old Casement itself, if it is still installed and
-- running, or the small "Casement (old data)" stub Bank Tabs ships in Casement's place, which holds
-- nothing but the saved variables and is loaded on demand here so they can be read.
--
-- While Casement is installed but cannot be read (the old addon switched off, say), nothing is
-- marked done, so the map's settings still come over at the first login it can be read, and one
-- chat line per account says how to make it readable. Once the account's share has come over,
-- nothing more is said: a stub the user has switched off since is left off, and the old addon
-- switched off is left to the notice that switched it off (see FindCasementData). A login with no
-- Casement at all notes that and looks again at the next one, as Bank Tabs does, so data that
-- turns up later still comes over; only bringing it over closes the question for good.
--
-- In the session the old Casement still runs, it keeps the map, so the map's share is read once
-- more at logout, and what the user changed on the map in the old addon comes over as well.
-- ------------------------------------------------------------------

local OLD = "Casement"

-- Set by whichever of Map Tab and Bank Tabs tells the user about the old Casement first, so the
-- other does not say it again this session. Both addons use this one name.
local NOTICE = "CASEMENT_REPLACED_NOTICE"

-- Calls an addon list function by whichever name this client has it under, never erroring.
local function AddOnCall(name, ...)
	local fn = (C_AddOns and C_AddOns[name]) or _G[name]
	if type(fn) ~= "function" then return false, "no " .. name end
	return pcall(fn, ...)
end

-- Whether Casement is switched off, and for whom. GetAddOnInfo only reports DISABLED when an addon
-- is off for every character, so the state for this character is asked for as well where the
-- client can say. Returns nil while it is switched on. The per character answer is only a hint:
-- clients differ in what they take as the character, so it is never the only reason to leave the
-- stub unread (LoadAddOn's own refusal is what counts, see FindCasementData).
local function SwitchedOff(reason)
	if reason == "DISABLED" then return "for every character" end
	local ok, state
	if type(C_AddOns) == "table" and type(C_AddOns.GetAddOnEnableState) == "function" then
		-- The character by name, as the older form and Bank Tabs ask.
		ok, state = pcall(C_AddOns.GetAddOnEnableState, OLD, UnitName and UnitName("player"))
	elseif type(_G.GetAddOnEnableState) == "function" then
		-- The older form takes the character first.
		ok, state = pcall(_G.GetAddOnEnableState, UnitName and UnitName("player"), OLD)
	end
	if ok and state == 0 then return "for this character" end
	return nil
end

-- Switches the old data stub on. The stub runs no code, so this is always safe. The old addon
-- itself is never switched on here: its code would run.
local function SwitchStubOn(who)
	local ok = AddOnCall("EnableAddOn", OLD)
	report["casement data stub"] = ok and ("was switched off " .. who .. ", switched back on to be read")
		or ("is switched off " .. who .. " and could not be switched on")
	return ok
end

-- Makes Casement's saved variables readable, if there are any. Returns how they were found, or
-- nil, why not, whether that is because nothing is installed (noted as "none" and looked for again
-- at the next login) or a Casement that cannot be read yet,
-- which Casement it was ("old" for the whole old addon, "stub" for the data stub), and whether
-- nothing needs saying (the user's own choice, or already told). `needAccount` says the account's
-- share has not come over yet; `stoodDown` says the old Casement was switched off by the notice
-- (see RetireOldCasement) and the stub has not been read since.
local function FindCasementData(needAccount, stoodDown)
	if type(CasementAccountDB) == "table" or type(CasementDB) == "table" then return "already in memory" end
	local ok, name, _, _, loadable, reason = AddOnCall("GetAddOnInfo", OLD)
	if not ok or not name or reason == "MISSING" then return nil, "not installed", true end

	local okLod, lod = AddOnCall("IsAddOnLoadOnDemand", OLD)
	if not (okLod and lod) and reason ~= "DEMAND_LOADED" then
		-- The old, whole addon. Switched on, its code has run and its data is already in memory,
		-- so here it is switched off or failed to load. It is left alone: its code would run.
		-- Once the account's share has come over, Casement was read at an earlier login: as a rule
		-- the old addon ran then and the notice switched it off, which already said to update it.
		-- Only this character's map settings are left, which is no reason to ask for the old addon
		-- to be run again, so this goes to the report alone.
		local off = SwitchedOff(reason)
		local state = off and "switched off" or ("not running (" .. string.lower(tostring(reason or (loadable and "not loaded" or "not loadable"))) .. ")")
		if not needAccount then
			return nil, "installed but " .. state .. ", and the account's share came over at an earlier login, so nothing is said", false, "old", true
		end
		return nil, "installed but " .. state, false, "old"
	end

	-- The old data stub. A load on demand addon that has not been loaded yet reports itself as not
	-- loadable, with the reason DEMAND_LOADED, so the answer that counts is LoadAddOn's own. A stub
	-- that is switched off is switched back on first while the account's share is still to come
	-- over, and while the old Casement's own switch off may be what left it off: an earlier session
	-- switched the old Casement off with the notice before it was updated to the stub, and the
	-- switch stays with the folder. Otherwise a stub switched off after the account's share came
	-- over is the user's doing: only this character's map settings are left, which is not worth
	-- overruling them for, or switching it back on for every character, so it is left off and they
	-- come over if it is switched on again. Bank Tabs leaves the stub off in the same case.
	local overrule = needAccount or stoodDown
	local function LeftOff(who)
		return nil, "(old data) is switched off " .. who .. " and the account's share came over at an earlier login, so it is left off", false, "stub", true
	end
	local switched = false
	local off = SwitchedOff(reason)
	if off then
		if overrule then
			switched = SwitchStubOn(off)
		elseif reason == "DISABLED" then
			return LeftOff(off)
		end
		-- Off for this character by the enable state alone: only a hint, so LoadAddOn decides.
	end
	local okLoad, loaded, why = AddOnCall("LoadAddOn", OLD)
	if okLoad and not loaded and why == "DISABLED" and not switched then
		-- Off for this character, which the client could not say (or not surely) beforehand.
		if not overrule then return LeftOff("for this character") end
		switched = SwitchStubOn("for this character")
		okLoad, loaded, why = AddOnCall("LoadAddOn", OLD)
	end
	if not (okLoad and loaded) then
		local because = okLoad and string.lower(tostring(why or "refused")) or tostring(loaded)
		return nil, "could not be loaded (" .. because .. ")", false, "stub"
	end
	if type(CasementAccountDB) ~= "table" and type(CasementDB) ~= "table" then return nil, "was loaded, but it holds no saved data", true end
	return "loaded on demand"
end

-- Copies one plain value across. Only over a value that is still the default here, unless `fresh`
-- says this character's table was made or adopted this session, so nothing in it is this
-- character's own choice yet and this character's own Casement value is the one to keep. Even
-- then a Casement value that is only the default is not copied: Casement filled every missing
-- setting in with its default, which is no choice of this character's, and would otherwise undo
-- a choice made in Map Tab on another character that the adopted account copy carries.
local function Adopt(dst, src, defaults, key, fresh)
	local value = src[key]
	if value == nil or type(value) ~= type(defaults[key]) then return 0 end
	if fresh and value == defaults[key] then return 0 end
	if not fresh and dst[key] ~= defaults[key] then return 0 end
	if dst[key] == value then return 0 end
	dst[key] = value
	return 1
end

-- The world map's share of one Casement settings table.
local function ImportSettings(src, withPosition, fresh)
	local db, defaults = ns.db, ns.defaults
	local n = 0
	for _, key in ipairs({ "enabled", "dragModifier", "showGrips" }) do n = n + Adopt(db, src, defaults, key, fresh) end
	if type(src.windows) == "table" then n = n + Adopt(db.windows, src.windows, defaults.windows, "worldmap", fresh) end
	if type(src.map) == "table" then
		for key in pairs(defaults.map) do n = n + Adopt(db.map, src.map, defaults.map, key, fresh) end
	end
	local pos = withPosition and type(src.positions) == "table" and src.positions.worldmap
	if type(pos) == "table" and type(pos.x) == "number" and type(pos.y) == "number" and not db.positions.worldmap then
		db.positions.worldmap = { x = pos.x, y = pos.y }
		n = n + 1
	end
	return n
end

-- The reveal's learned map areas, merged in beside anything Map Tab has learned itself.
local function ImportOverlays(src)
	if type(src) ~= "table" then return 0 end
	MapTabAccountDB.overlays = type(MapTabAccountDB.overlays) == "table" and MapTabAccountDB.overlays or {}
	local store = MapTabAccountDB.overlays
	local n = 0
	for artID, overlays in pairs(src) do
		if type(overlays) == "table" then
			for key, ids in pairs(overlays) do
				if type(key) == "string" and type(ids) == "string" then
					store[artID] = type(store[artID]) == "table" and store[artID] or {}
					if store[artID][key] == nil then
						store[artID][key] = ids
						n = n + 1
					end
				end
			end
		end
	end
	return n
end

-- The world map settings as they stand right after this character's import, for FollowCasement.
local function Snapshot()
	local db = ns.db
	local snap = { top = {}, windows = { worldmap = db.windows.worldmap }, map = {} }
	for _, key in ipairs({ "enabled", "dragModifier", "showGrips" }) do snap.top[key] = db[key] end
	for key in pairs(ns.defaults.map) do snap.map[key] = db.map[key] end
	local pos = db.positions.worldmap
	snap.pos = type(pos) == "table" and { x = pos.x, y = pos.y } or false
	return snap
end

-- One plain value, followed from the old Casement: only while Map Tab still holds what it had
-- right after the import, since anything changed in Map Tab since is the newer choice.
local function Follow(dst, src, defaults, key, was)
	local value = src[key]
	if value == nil or type(value) ~= type(defaults[key]) then return 0 end
	if dst[key] ~= was or dst[key] == value then return 0 end
	dst[key] = value
	return 1
end

-- The session the old Casement is still running, it keeps the world map until the next one (see
-- ns.MapOn), and this character's settings were brought over at login. Whatever the user did to
-- the map in the old Casement since, moving it, sizing it, flipping its switches, would otherwise
-- be lost when the old addon is switched off, so at logout (a /reload included) the map's share
-- is read once more from Casement's live tables. The reveal's learned areas are merged again too.
local function FollowCasement()
	local snap = ns.casementFollow
	ns.casementFollow = nil
	local src, db = _G.CasementDB, ns.db
	if not snap or type(src) ~= "table" or type(db) ~= "table" then return end
	local defaults, n = ns.defaults, 0
	for key, was in pairs(snap.top) do n = n + Follow(db, src, defaults, key, was) end
	if type(src.windows) == "table" and type(db.windows) == "table" then
		n = n + Follow(db.windows, src.windows, defaults.windows, "worldmap", snap.windows.worldmap)
	end
	if type(src.map) == "table" and type(db.map) == "table" then
		for key, was in pairs(snap.map) do n = n + Follow(db.map, src.map, defaults.map, key, was) end
	end
	if type(db.positions) == "table" then
		local mine, was = db.positions.worldmap, snap.pos
		local untouched = (was == false and mine == nil)
			or (was and type(mine) == "table" and mine.x == was.x and mine.y == was.y)
		local theirs = type(src.positions) == "table" and src.positions.worldmap or nil
		if untouched then
			if type(theirs) == "table" and type(theirs.x) == "number" and type(theirs.y) == "number" then
				if not (was and theirs.x == was.x and theirs.y == was.y) then
					db.positions.worldmap = { x = theirs.x, y = theirs.y }
					n = n + 1
				end
			elseif theirs == nil and was then
				-- Put back where the game had it in the old Casement: forgotten here too.
				db.positions.worldmap = nil
				n = n + 1
			end
		end
	end
	local old = _G.CasementAccountDB
	local areas = type(old) == "table" and ImportOverlays(old.overlays) or 0
	report["casement data"] = tostring(report["casement data"]) .. "; at logout, " .. n .. " later change"
		.. (n == 1 and "" or "s") .. " followed from the old Casement and " .. areas .. " more learned map areas"
end

function ns.ImportCasement()
	local account, db = MapTabAccountDB, ns.db
	-- Each flag is true once brought over. A login that finds no Casement at all sets "none"
	-- instead, and every login looks again, so data that turns up later (Bank Tabs installed after
	-- Map Tab brings the "old data" stub with it, or an old folder put back) still comes over.
	local needAccount = account.importedCasement ~= true
	local needCharacter = db.importedCasement ~= true
	if not needAccount and not needCharacter then
		report["casement data"] = "already brought over"
		return
	end

	local how, why, final, kind, quiet = FindCasementData(needAccount, account.casementStoodDown)
	if not how then
		if final then
			if account.importedCasement ~= true then account.importedCasement = "none" end
			if db.importedCasement ~= true then db.importedCasement = "none" end
			report["casement data"] = "nothing to bring over, Casement " .. tostring(why) .. " (looked for again at each login)"
		else
			report["casement data"] = "not brought over yet, Casement " .. tostring(why) .. "; looked for again at the next login"
			-- The user's own choice needs no chat line.
			if quiet then return end
			-- Said once per account, so the user knows why nothing came over and what to do; the
			-- report above says it at every login.
			if not account.casementUnreadableTold then
				account.casementUnreadableTold = true
				if kind == "old" then
					Print("cannot read the world map settings the old Casement saved while it is " .. (why:find("switched off", 1, true) and "switched off" or "not running")
						.. ". Update Casement in the CurseForge app, where it is now Bank Tabs, or switch the old Casement on in the AddOns list for one login, and they come over then.")
				else
					Print("could not open the data the old Casement left behind: it " .. tostring(why) .. ". Map Tab tries again at your next login.")
				end
			end
		end
		return
	end

	local settings, overlays, from = 0, 0, nil
	local old = type(CasementAccountDB) == "table" and CasementAccountDB or nil
	if needAccount and old then overlays = ImportOverlays(old.overlays) end
	if needCharacter then
		if type(CasementDB) == "table" and next(CasementDB) ~= nil then
			-- This character's own settings. A table made or adopted this session holds nothing
			-- this character chose, so they replace it; otherwise they only fill in defaults.
			settings, from = ImportSettings(CasementDB, true, ns.dbFresh), "this character"
			-- The old Casement running this session keeps the map until the next one, so what the
			-- user changes on it meanwhile comes over again at logout (see FollowCasement).
			if ns.oldCasementRunning then ns.casementFollow = Snapshot() end
		elseif old and type(old.profile) == "table" then
			-- A character that never ran Casement gets what Casement itself would have given it:
			-- the account copy of the settings, without anyone else's map position. Map Tab's own
			-- account copy is newer, so this only fills in what is still at its default.
			settings, from = ImportSettings(old.profile, false, false), "the account copy"
		end
	end
	account.importedCasement = true
	db.importedCasement = true
	-- Read with the old Casement gone, so a stub switched off from here on is the user's doing.
	if not ns.oldCasementRunning then account.casementStoodDown = nil end

	report["casement data"] = "brought over (" .. how .. "): " .. settings .. " settings from " .. tostring(from or "nowhere")
		.. ", " .. overlays .. " learned map areas" .. (needAccount and "" or " (the account's share came over earlier)")
	MirrorToAccount()
	-- One line, the first time the account's share is looked at.
	if needAccount then
		if settings + overlays > 0 then
			Print("brought your world map over from Casement: " .. settings .. " setting" .. (settings == 1 and "" or "s")
				.. " (its size, position and switches) and " .. overlays .. " map area" .. (overlays == 1 and "" or "s")
				.. " the reveal had learned.")
		else
			Print("found Casement's saved data, but nothing in it needed bringing over: its world map settings match what Map Tab already has, and the reveal had learned no new map areas.")
		end
	end
end

-- Whether Bank Tabs, the other half, is installed.
local function BankTabsInstalled()
	if type(_G.BankTabsFrame) == "table" then return true end
	local ok, name, _, _, _, reason = AddOnCall("GetAddOnInfo", "BankTabs")
	return (ok and name and reason ~= "MISSING") and true or false
end

-- The old, whole Casement still installed and running beside this addon: it handles the world
-- map as well, so Map Tab leaves the map to it for this session (see ns.MapOn), and it is switched
-- off for the next session with one chat line. Bank Tabs, the other half, does the same, so
-- whichever of the two reaches PLAYER_LOGIN first switches it off, tells the user and sets the
-- shared mark; the other finds the mark and stays quiet.
--
-- Either way the account remembers that the old Casement was switched off by the notice
-- (`casementStoodDown`): updated to the data stub, the folder keeps that switch, and a stub found
-- switched off is then not the user's doing, so FindCasementData switches it on for a later
-- character's settings until the stub has been read once.
local function RetireOldCasement()
	if not OldCasementRunning() then
		report["old casement"] = "not running"
		return
	end
	MapTabAccountDB.casementStoodDown = true
	local aside = "; Map Tab leaves the world map to it until the next session"
	if _G[NOTICE] then
		report["old casement"] = "running this session; " .. tostring(_G[NOTICE]) .. " already switched it off and told the user" .. aside
		return
	end
	_G[NOTICE] = ADDON
	local disabled = AddOnCall("DisableAddOn", OLD)
	if disabled then AddOnCall("SaveAddOns") end
	-- Switching the old addon off takes the bags, bank and saved banks with it, so a user who has
	-- only Map Tab so far is told where the other half comes from.
	local bankTabs = BankTabsInstalled()
	Print("Casement has been replaced by two addons: Bank Tabs (the bags, bank and saved banks) and Map Tab (the world map tab, coordinates and fog reveal)."
		.. (disabled and " The old Casement is switched off from your next login; type /reload to finish the switch now. Until then it keeps the world map, and Map Tab's tab takes over after the reload."
			or " Please switch the old Casement off in the AddOns list and /reload. Until then it keeps the world map, and Map Tab leaves the map to it.")
		.. (bankTabs and "" or " Bank Tabs is not installed yet: update Casement in the CurseForge app, where it is now Bank Tabs, to keep your bags, bank and saved banks."))
	report["old casement"] = "was running, " .. (disabled and "switched off from the next session" or "could not be switched off") .. "; told the user"
		.. (bankTabs and "" or ", and where Bank Tabs comes from") .. aside
end

-- ------------------------------------------------------------------
-- Shared window art
--
-- Blizzard's FrameXML is not on disk on this client, so a template can only be tested by trying
-- it. Each candidate is created inside a pcall and checked for the parts it should have brought
-- with it, and whichever one worked is named in the debug report.
-- ------------------------------------------------------------------

local PANEL_TEMPLATES = {
	{ "DefaultPanelFlatTemplate", function(f) return f.NineSlice ~= nil end },
	{ "DefaultPanelTemplate", function(f) return f.NineSlice ~= nil end },
	{ "ButtonFrameTemplate", function(f) return f.NineSlice ~= nil or f.Inset ~= nil end },
	{ "BasicFrameTemplate" },
}

-- A frame wearing the game's own panel art: the border and the background, nothing else. Used for
-- the options window and the copy box.
function ns.CreatePanelFrame(name, parent, key)
	local panel, used
	for _, candidate in ipairs(PANEL_TEMPLATES) do
		local ok, made = pcall(CreateFrame, "Frame", name, parent or UIParent, candidate[1])
		if ok and made and (not candidate[2] or candidate[2](made)) then
			panel, used = made, candidate[1]
			break
		end
		if ok and made then made:Hide() end
	end
	if not panel then
		local ok, made = pcall(CreateFrame, "Frame", name, parent or UIParent, "BackdropTemplate")
		panel = (ok and made) or CreateFrame("Frame", name, parent or UIParent)
		used = "backdrop"
		if panel.SetBackdrop then
			panel:SetBackdrop({
				bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
				edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
				tile = true, tileSize = 16, edgeSize = 14,
				insets = { left = 3, right = 3, top = 3, bottom = 3 },
			})
			panel:SetBackdropColor(0.05, 0.05, 0.05, 0.94)
		else
			-- Nothing at all resolved, so the panel is painted by hand rather than left invisible.
			local backing = panel:CreateTexture(nil, "BACKGROUND")
			backing:SetAllPoints()
			backing:SetColorTexture(0.05, 0.05, 0.06, 0.94)
			for _, edge in ipairs({ { "TOPLEFT", "TOPRIGHT", 0, 1 }, { "BOTTOMLEFT", "BOTTOMRIGHT", 0, 1 },
				{ "TOPLEFT", "BOTTOMLEFT", 1, 0 }, { "TOPRIGHT", "BOTTOMRIGHT", 1, 0 } }) do
				local line = panel:CreateTexture(nil, "BORDER")
				line:SetColorTexture(0.75, 0.62, 0.32, 0.9)
				line:SetPoint(edge[1])
				line:SetPoint(edge[2])
				if edge[3] == 1 then line:SetWidth(1) else line:SetHeight(1) end
			end
		end
	end
	report[(key or "window") .. " panel"] = used

	if used == "ButtonFrameTemplate" then
		if ButtonFrameTemplate_HidePortrait then pcall(ButtonFrameTemplate_HidePortrait, panel) end
		if ButtonFrameTemplate_HideButtonBar then pcall(ButtonFrameTemplate_HideButtonBar, panel) end
		if panel.Inset then panel.Inset:Hide() end
	end
	panel.mtTemplate = used
	return panel
end

-- A small panel, for the tab under the world map. The big window templates are not used here: the
-- metal NineSlice border those bring breaks below roughly 156 by 110, and this is a third of that.
-- The tooltip backdrop is the game's own art and holds up at any size.
function ns.CreateTabPanel(name, parent, key)
	local panel, used
	local ok, made = pcall(CreateFrame, "Frame", name, parent, "TooltipBackdropTemplate")
	if ok and made and (made.NineSlice or made.SetBackdrop) then
		panel, used = made, "TooltipBackdropTemplate"
	elseif ok and made then
		made:Hide()
	end

	if not panel then
		local gotBackdrop, backdropFrame = pcall(CreateFrame, "Frame", name, parent, "BackdropTemplate")
		if gotBackdrop and backdropFrame and backdropFrame.SetBackdrop then
			panel, used = backdropFrame, "BackdropTemplate"
			panel:SetBackdrop({
				bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
				edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
				tile = true, tileSize = 16, edgeSize = 16,
				insets = { left = 4, right = 4, top = 4, bottom = 4 },
			})
			panel:SetBackdropColor(0.06, 0.06, 0.07, 0.95)
			panel:SetBackdropBorderColor(0.75, 0.62, 0.32, 1)
		elseif gotBackdrop and backdropFrame then
			backdropFrame:Hide()
		end
	end

	if not panel then
		panel, used = CreateFrame("Frame", name, parent), "painted"
		local backing = panel:CreateTexture(nil, "BACKGROUND")
		backing:SetAllPoints()
		backing:SetColorTexture(0.06, 0.06, 0.07, 0.95)
		for _, edge in ipairs({ { "TOPLEFT", "TOPRIGHT", false }, { "BOTTOMLEFT", "BOTTOMRIGHT", false },
			{ "TOPLEFT", "BOTTOMLEFT", true }, { "TOPRIGHT", "BOTTOMRIGHT", true } }) do
			local line = panel:CreateTexture(nil, "BORDER")
			line:SetColorTexture(0.75, 0.62, 0.32, 1)
			line:SetPoint(edge[1])
			line:SetPoint(edge[2])
			if edge[3] then line:SetWidth(1) else line:SetHeight(1) end
		end
	end

	report[(key or "tab") .. " panel"] = used
	panel.mtTemplate = used
	return panel
end

function ns.CreatePanel(name)
	local panel = ns.CreatePanelFrame(name, UIParent, "window")

	local title = panel.TitleText or (panel.TitleContainer and panel.TitleContainer.TitleText)
	if not title then
		title = panel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
		title:SetPoint("TOP", 0, -6)
	end
	panel.mtTitle = title

	if not panel.CloseButton then
		local ok, button = pcall(CreateFrame, "Button", nil, panel, "UIPanelCloseButton")
		if ok and button then button:SetPoint("TOPRIGHT", 1, 1) end
	end

	panel:SetMovable(true)
	panel:SetClampedToScreen(true)
	panel:EnableMouse(true)
	panel:RegisterForDrag("LeftButton")
	panel:SetScript("OnDragStart", panel.StartMoving)
	panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
	return panel
end

-- A box with some text selected in it, for anything the game will not put on the clipboard
-- itself: Ctrl+C in a selected edit box does reach the system clipboard.
function ns.CopyBox(title, text)
	local box = _G.MapTabCopyBox
	if not box then
		box = ns.CreatePanel("MapTabCopyBox")
		box:SetSize(560, 400)
		box:SetPoint("CENTER")
		box:SetFrameStrata("DIALOG")
		local scroll = CreateFrame("ScrollFrame", nil, box)
		scroll:SetPoint("TOPLEFT", 16, -36)
		scroll:SetPoint("BOTTOMRIGHT", -30, 40)
		local edit = CreateFrame("EditBox", nil, scroll)
		edit:SetMultiLine(true)
		edit:SetAutoFocus(false)
		edit:SetFontObject("ChatFontNormal")
		edit:SetWidth(500)
		edit:SetScript("OnEscapePressed", function(self) self:ClearFocus() box:Hide() end)
		scroll:SetScrollChild(edit)
		box.edit = edit
		local hint = box:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
		hint:SetPoint("BOTTOMLEFT", 16, 16)
		hint:SetText("The text is selected: press Ctrl+C to copy it, Escape to close.")
		tinsert(UISpecialFrames, "MapTabCopyBox")
	end
	box.mtTitle:SetText(title or "Map Tab")
	box.edit:SetText(text or "")
	box:Show()
	box.edit:SetFocus()
	if box.edit.HighlightText then box.edit:HighlightText() end
	return box
end

-- ------------------------------------------------------------------
-- Getting on top of the world map
--
-- A grip laid over the map has to win the mouse against everything the map draws inside itself.
-- With the quest panel open, the panel's own frames sit above a grip that is merely a few levels
-- above the map, so the grip is visible but unclickable. This walks the window, finds the highest
-- strata and level anything inside it uses, and puts our region above all of it.
--
-- Our own frames are marked so that repeated calls do not climb a level higher every time.
-- ------------------------------------------------------------------

local STRATA = { "BACKGROUND", "LOW", "MEDIUM", "HIGH", "DIALOG", "FULLSCREEN", "FULLSCREEN_DIALOG", "TOOLTIP" }
local STRATA_INDEX = {}
for index, name in ipairs(STRATA) do STRATA_INDEX[name] = index end

local function Children(frame)
	local ok, list = pcall(function() return { frame:GetChildren() } end)
	if ok and type(list) == "table" then return list end
	return {}
end
ns.Children = Children

-- Walks a window and calls `visit(child)` on everything inside it that is not one of ours.
function ns.WalkChildren(host, visit, maxDepth, budget)
	local seen = 0
	local limit = budget or 400
	local function walk(frame, depth)
		if depth > (maxDepth or 4) or seen > limit then return end
		for _, child in ipairs(Children(frame)) do
			seen = seen + 1
			if seen > limit then return end
			if not child.mtOurs then
				visit(child)
				walk(child, depth + 1)
			end
		end
	end
	pcall(walk, host, 1)
	return seen
end

function ns.RaiseOver(region, host, extra)
	region.mtOurs = true
	local hostStrata, bestLevel = 3, 1
	local okStrata, strata = pcall(host.GetFrameStrata, host)
	if okStrata and STRATA_INDEX[strata or ""] then hostStrata = STRATA_INDEX[strata] end
	local okLevel, level = pcall(host.GetFrameLevel, host)
	if okLevel and type(level) == "number" then bestLevel = level end
	local bestStrata = hostStrata

	ns.WalkChildren(host, function(child)
		local gotStrata, childStrata = pcall(child.GetFrameStrata, child)
		local gotLevel, childLevel = pcall(child.GetFrameLevel, child)
		-- A child whose strata cannot be read is in the same strata as the window holding it,
		-- which is what inheriting one means. Treating it as unknown would throw away its frame
		-- level and leave us underneath it.
		local s = (gotStrata and STRATA_INDEX[childStrata or ""]) or hostStrata
		local l = (gotLevel and type(childLevel) == "number") and childLevel or 0
		if s > bestStrata then
			bestStrata, bestLevel = s, l
		elseif s == bestStrata and l > bestLevel then
			bestLevel = l
		end
	end)

	local wanted = STRATA[math.min(bestStrata, #STRATA)]
	local wantedLevel = math.min(bestLevel + (extra or 3), 9999)
	pcall(region.SetFrameStrata, region, wanted)
	pcall(region.SetFrameLevel, region, wantedLevel)
	return wanted .. " " .. wantedLevel
end

function ns.TextureExists(path)
	if not GetFileIDFromPath then return true end
	local ok, id = pcall(GetFileIDFromPath, path)
	return ok and id ~= nil
end

function ns.Tooltip(widget, title, body)
	if not title and not body then return end
	widget:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText(title or "", 1, 1, 1)
		if body then GameTooltip:AddLine(body, nil, nil, nil, true) end
		GameTooltip:Show()
	end)
	widget:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

-- A plain button that falls back to art of its own where the template is missing.
function ns.Button(parent, text, width, height, onClick)
	local button
	local ok, made = pcall(CreateFrame, "Button", nil, parent, "UIPanelButtonTemplate")
	if ok and made then button = made else button = CreateFrame("Button", nil, parent) end
	if not button.GetFontString or not button:GetFontString() then
		local backing = button:CreateTexture(nil, "BACKGROUND")
		backing:SetAllPoints()
		backing:SetColorTexture(0.18, 0.18, 0.2, 0.9)
		local fs = button:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
		fs:SetAllPoints()
		button:SetFontString(fs)
	end
	button:SetSize(width, height or 22)
	button:SetText(text)
	if onClick then button:SetScript("OnClick", onClick) end
	return button
end

-- ------------------------------------------------------------------
-- Event frame
-- ------------------------------------------------------------------

local frame = CreateFrame("Frame", "MapTabFrame", UIParent)
ns.frame = frame

local EVENTS = {
	"ADDON_LOADED",
	"PLAYER_LOGIN",
	"PLAYER_LOGOUT",
	"UI_SCALE_CHANGED",
	"DISPLAY_SIZE_CHANGED",
	"MODIFIER_STATE_CHANGED",
	"MAP_EXPLORATION_UPDATED",
}

-- Some of these do not exist on every build. RegisterEvent on an unknown event errors, so each
-- one goes through pcall and the tally lands in the debug report.
local registered, skipped = 0, {}
for _, event in ipairs(EVENTS) do
	if pcall(frame.RegisterEvent, frame, event) then
		registered = registered + 1
	else
		skipped[#skipped + 1] = event
	end
end
report["events"] = registered .. "/" .. #EVENTS .. " registered"
	.. (#skipped > 0 and (" (missing: " .. table.concat(skipped, ", ") .. ")") or "")

frame:SetScript("OnUpdate", function()
	if #pending == 0 then return end
	local now = GetTime()
	for i = #pending, 1, -1 do
		if pending[i].at <= now then
			local fn = pending[i].fn
			table.remove(pending, i)
			pcall(fn)
		end
	end
end)

local function Init()
	LoadDB("addon loaded")
	-- Casement sorts before Map Tab, so an old Casement that is running has normally loaded by
	-- now; PLAYER_LOGIN looks again in case it loaded later.
	ns.oldCasementRunning = OldCasementRunning()

	if ns.Windows and ns.Windows.Init then
		local ok, err = pcall(ns.Windows.Init)
		report["windows"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.Map and ns.Map.Init then
		local ok, err = pcall(ns.Map.Init)
		report["world map"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.Reveal and ns.Reveal.Init then
		local ok, err = pcall(ns.Reveal.Init)
		report["reveal"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.Levels and ns.Levels.Init then
		local ok, err = pcall(ns.Levels.Init)
		report["zone level module"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.SetupOptions then
		local ok, err = pcall(ns.SetupOptions)
		report["options"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	ns.Refresh()
end

frame:SetScript("OnEvent", function(self, event, ...)
	if event == "ADDON_LOADED" then
		local name = ...
		if name == ADDON then
			Init()
		elseif ns.Windows and ns.Windows.Sweep then
			-- A build that loads the world map on demand only has it once the game has needed it,
			-- so every addon that loads gets a second look.
			pcall(ns.Windows.Sweep, "addon " .. tostring(name))
		end
		return

	elseif event == "PLAYER_LOGIN" then
		-- Second chance at the saved table, see the note above LoadDB.
		if CountKeys(MapTabDB) == 0 then LoadDB("player login") end
		if OldCasementRunning() then ns.oldCasementRunning = true end
		local ok, err = pcall(ns.ImportCasement)
		if not ok then report["casement data"] = "failed: " .. tostring(err) end
		local retired, why = pcall(RetireOldCasement)
		if not retired then report["old casement"] = "failed: " .. tostring(why) end
		ns.Refresh()
		if ns.Windows and ns.Windows.Sweep then pcall(ns.Windows.Sweep, "login") end
		if ns.SyncOptions then pcall(ns.SyncOptions) end

	elseif event == "PLAYER_LOGOUT" then
		if ns.casementFollow then
			local ok, err = pcall(FollowCasement)
			if not ok then report["casement data"] = "failed at logout: " .. tostring(err) end
		end
		MirrorToAccount()
		return
	end

	if ns.Windows and ns.Windows.OnEvent then pcall(ns.Windows.OnEvent, event, ...) end
	if ns.Map and ns.Map.OnEvent then pcall(ns.Map.OnEvent, event, ...) end
	if ns.Reveal and ns.Reveal.OnEvent then pcall(ns.Reveal.OnEvent, event, ...) end
end)

-- ------------------------------------------------------------------
-- Slash commands
-- ------------------------------------------------------------------

local function PrintDebug()
	Print("version " .. ns.version .. ", debug report:")
	local keys = {}
	for k in pairs(report) do keys[#keys + 1] = k end
	table.sort(keys)
	for _, k in ipairs(keys) do
		DEFAULT_CHAT_FRAME:AddMessage("   |cffaaaaaa" .. k .. ":|r " .. tostring(report[k]))
	end
end

local function PrintHelp()
	Print("commands:")
	local lines = {
		"|cffffff00/maptab|r opens the options, |cffffff00/maptab window|r in a window of their own",
		"|cffffff00/maptab scale <50-200>|r sets the world map's size",
		"|cffffff00/maptab reset|r puts the map back where the game had it, at 100 percent",
		"|cffffff00/maptab lock|r or |cffffff00unlock|r turns the world map switch off or on",
		"|cffffff00/maptab coords|r puts your coordinates in a box to copy",
		"|cffffff00/maptab mapdata|r reports how much of the shown map the reveal knows; |cffffff00dump|r opens all of it",
		"|cffffff00/maptab grips|r outlines the parts of the map you can drag",
		"|cffffff00/maptab debug|r prints what resolved on this client",
	}
	for _, line in ipairs(lines) do DEFAULT_CHAT_FRAME:AddMessage("   " .. line) end
	DEFAULT_CHAT_FRAME:AddMessage("   Options also live in Esc > Options > AddOns > Map Tab.")
end

SLASH_MAPTAB1 = "/maptab"
SlashCmdList["MAPTAB"] = function(msg)
	msg = (msg or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
	local cmd, rest = msg:match("^(%S*)%s*(.-)$")

	if cmd == "" then
		if ns.ToggleOptions then ns.ToggleOptions() else Print("The options are not built on this client, see /maptab debug.") end

	elseif cmd == "debug" then
		PrintDebug()

	elseif cmd == "window" then
		if ns.ToggleOptions then ns.ToggleOptions(true) end

	elseif cmd == "reset" then
		if ns.Windows and ns.Windows.ResetAll then ns.Windows.ResetAll() end
		if ns.Map and ns.Map.ResetSize then ns.Map.ResetSize() end
		Print("the world map is back where the game had it, at 100 percent.")

	elseif cmd == "lock" or cmd == "unlock" then
		-- The world map switch. The options show it and the saved `enabled` as one switch, so
		-- unlocking turns both on; a Casement whose master switch was off came over with it off.
		local want = (cmd == "unlock")
		ns.db.windows.worldmap = want
		if want then ns.db.enabled = true end
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("the world map is now " .. (want and "movable and resizable" or "locked and back under the game's control") .. "."
			.. ((want and ns.oldCasementRunning) and " The old Casement still has it until you /reload." or ""))

	elseif cmd == "scale" then
		local value = tonumber(rest)
		if not value then Print("use /maptab scale 50 to 200.") return end
		if value <= 5 then value = value * 100 end
		ns.db.map.scale = ns.Clamp(value / 100, ns.db.map.minScale, ns.db.map.maxScale)
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("world map scale " .. math.floor(ns.db.map.scale * 100 + 0.5) .. "%.")

	elseif cmd == "mapdata" then
		if not ns.Reveal then Print("The map reveal is not built on this client.") return end
		if rest == "dump" then
			local maps = ns.Reveal.Dump()
			Print(maps .. " maps of harvested overlay data are in the box; Ctrl+C copies them out.")
		else
			Print(ns.Reveal.Describe())
		end

	elseif cmd == "coords" then
		local text = ns.Map and ns.Map.PlayerCoordText and ns.Map.PlayerCoordText()
		if text then ns.CopyBox("Your position", text) else Print("your position on the map is not available here.") end

	elseif cmd == "grips" then
		ns.db.showGrips = not ns.db.showGrips
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("the map's drag areas are now " .. (ns.db.showGrips and "outlined" or "invisible") .. ".")

	else
		PrintHelp()
	end
end
