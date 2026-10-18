-- Lumen.app: starts Lumen's bundled server and opens it in a browser window.
-- Quitting the app stops the server. Built by `npm run portable` (scripts/portable.mjs).

property appURL : "http://localhost:3939"
property serverPID : ""

on dataDir()
	return POSIX path of (path to application support folder from user domain) & "Lumen"
end dataDir

on lumenUp()
	try
		do shell script "curl -s --max-time 2 http://127.0.0.1:3939/ | grep -q '<title>Lumen'"
		return true
	on error
		return false
	end try
end lumenUp

on portBusy()
	try
		do shell script "lsof -tiTCP:3939 -sTCP:LISTEN"
		return true
	on error
		return false
	end try
end portBusy

-- Run a command in the user's login + interactive shell, so PATH matches their terminal
-- (nvm, Homebrew, ~/.local/bin): that's where node, claude and codex live.
on inShell(command)
	return "/bin/zsh -lic " & quoted form of command
end inShell

on startLumen()
	if lumenUp() then return true
	if portBusy() then
		display dialog "Port 3939 is already used by another app. Stop it, then open Lumen again." buttons {"OK"} default button 1 with icon caution with title "Lumen"
		return false
	end if
	try
		do shell script inShell("command -v node") & " < /dev/null"
	on error
		set answer to button returned of (display dialog "Lumen needs Node.js 20 or newer. Install it, then open Lumen again." buttons {"Cancel", "Get Node.js"} default button 2 with icon caution with title "Lumen")
		if answer is "Get Node.js" then open location "https://nodejs.org"
		return false
	end try

	set serverDir to POSIX path of (path to me) & "Contents/Resources/app"
	set dataPath to dataDir()
	set logFile to dataPath & "/server.log"
	set env to "LUMEN_DATA_DIR=" & quoted form of dataPath & " PORT=3939 HOSTNAME=127.0.0.1 "
	-- Redirect the whole background job, or do shell script waits for it forever.
	set serverPID to do shell script "mkdir -p " & quoted form of dataPath & "; (cd " & quoted form of serverDir & " && " & env & "exec " & inShell("exec node server.js") & ") > " & quoted form of logFile & " 2>&1 < /dev/null & echo $!"
	repeat 120 times
		if lumenUp() then return true
		delay 0.5
	end repeat
	display dialog "Lumen didn't start. Details are in ~/Library/Application Support/Lumen/server.log" buttons {"OK"} default button 1 with icon stop with title "Lumen"
	return false
end startLumen

-- The bundle id of the default web browser ("" if never changed, which means Safari).
on defaultBrowser()
	try
		return do shell script "defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | grep -B1 'LSHandlerURLScheme = https;' | sed -n 's/.*LSHandlerRoleAll = \"*\\([^\";]*\\)\"*;.*/\\1/p' | head -1"
	on error
		return ""
	end try
end defaultBrowser

-- Open Lumen in its own browser window. In Safari, an existing Lumen window is brought to the front.
on showLumen()
	set browserID to defaultBrowser()
	if browserID is "" or browserID is "com.apple.safari" then
		tell application "Safari"
			repeat with w in windows
				try
					if (count of tabs of w) is 1 and URL of current tab of w starts with appURL then
						set index of w to 1
						activate
						return
					end if
				end try
			end repeat
			make new document with properties {URL:appURL}
			activate
		end tell
	else if browserID is in {"com.google.chrome", "com.brave.browser", "com.microsoft.edgemac", "com.vivaldi.vivaldi", "company.thebrowser.browser"} then
		do shell script "open -n -b " & browserID & " --args --new-window " & appURL
	else if browserID is "org.mozilla.firefox" then
		do shell script "open -n -b " & browserID & " --args -new-window " & appURL
	else
		open location appURL
	end if
end showLumen

on run
	if startLumen() then
		showLumen()
	else
		quit
	end if
end run

on reopen
	run
end reopen

on quit
	if serverPID is not "" then
		try
			do shell script "pkill -TERM -P " & serverPID & "; kill " & serverPID & "; sleep 1; lsof -tiTCP:3939 -sTCP:LISTEN | xargs kill 2>/dev/null; true"
		end try
		set serverPID to ""
	end if
	continue quit
end quit
