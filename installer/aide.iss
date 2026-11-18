#define AppName "AIDE"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef StageDir
  #define StageDir "..\dist-package\AIDE-0.1.0"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist-package"
#endif

[Setup]
AppId={{8C4E2B71-5A3D-4F6B-9E2A-7D1C3B5A9F20}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion} (internal test)
AppPublisher=AIDE
DefaultDirName={localappdata}\Programs\AIDE
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=AIDE-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion={#AppVersion}.0
UninstallDisplayName={#AppName}
SetupLogging=yes
CloseApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\AIDE"; Filename: "{app}\start-aide.cmd"; WorkingDir: "{app}"
Name: "{group}\Stop AIDE"; Filename: "{app}\stop-aide.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\AIDE"; Filename: "{app}\start-aide.cmd"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\start-aide.cmd"; Description: "Start AIDE"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
