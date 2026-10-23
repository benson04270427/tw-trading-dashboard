Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set l = sh.CreateShortcut(sh.SpecialFolders("Startup") & "\EquiLens.lnk")
l.TargetPath = "wscript.exe"
l.Arguments = """" & root & "\EquiLens.vbs"""
l.WorkingDirectory = root
l.IconLocation = root & "\icons\equilens-tw.ico"
l.Save
MsgBox "EquiLens will start in the background after Windows sign-in." & vbCrLf & "To undo, delete EquiLens in shell:startup.", 64, "EquiLens"
