' EquiLens launcher: starts everything in the background without a console window.
'   EquiLens.vbs        -> Taiwan Nexus + phone server + tunnel, and US Nexus (used at Windows sign-in)
'   EquiLens.vbs tw     -> same, then opens the Taiwan dashboard
'   EquiLens.vbs us     -> same, then opens the US dashboard
'   EquiLens.vbs restart -> restarts both Nexus instances and the phone server (phone URL unchanged)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
mode = ""
If WScript.Arguments.Count > 0 Then mode = LCase(WScript.Arguments(0))
ps = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "
If mode = "restart" Then
  sh.Run ps & """" & root & "\EquiLens-Pocket\Restart-Pocket.ps1"" -Nexus", 0, True
  sh.Run ps & """" & root & "\EquiLens-Nexus\Start-NexusUS.ps1"" -NoBrowser -Restart", 0, True
  MsgBox "EquiLens restarted.", 64, "EquiLens"
  WScript.Quit
End If
sh.Run ps & """" & root & "\EquiLens-Pocket\Start-Pocket.ps1""", 0, True
sh.Run ps & """" & root & "\EquiLens-Nexus\Start-NexusUS.ps1"" -NoBrowser", 0, True
If mode = "tw" Then sh.Run "http://127.0.0.1:4330/"
If mode = "us" Then sh.Run "http://127.0.0.1:4331/"
