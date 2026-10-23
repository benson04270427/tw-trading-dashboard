' EquiLens launcher: starts everything in the background without a console window.
'   EquiLens.vbs        -> Taiwan Nexus + phone server + tunnel, and US Nexus (used at Windows sign-in)
'   EquiLens.vbs tw     -> same, then opens the Taiwan dashboard
'   EquiLens.vbs us     -> same, then opens the US dashboard
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
mode = ""
If WScript.Arguments.Count > 0 Then mode = LCase(WScript.Arguments(0))
ps = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "
sh.Run ps & """" & root & "\EquiLens-Pocket\Start-Pocket.ps1""", 0, True
sh.Run ps & """" & root & "\EquiLens-Nexus\Start-NexusUS.ps1"" -NoBrowser", 0, True
If mode = "tw" Then sh.Run "http://127.0.0.1:4330/"
If mode = "us" Then sh.Run "http://127.0.0.1:4331/"
