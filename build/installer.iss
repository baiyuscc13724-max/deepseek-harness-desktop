#ifndef MyAppVersion
  #define MyAppVersion "0.9.0-rc.6"
#endif

#define MyAppName "Harness Desktop"
#define MyAppPublisher "Harness Desktop Contributors"
#define MyAppExeName "Harness Desktop.exe"
#define MySourceDir "..\dist\win-unpacked"

[Setup]
AppId={{A116521E-7A92-4B10-9F64-315E8ED7A499}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://github.com/baiyuscc13724-max/deepseek-harness-desktop
AppSupportURL=https://github.com/baiyuscc13724-max/deepseek-harness-desktop/issues
AppUpdatesURL=https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=Harness-Desktop-{#MyAppVersion}-win-x64
SetupIconFile=..\dist\.icon-ico\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
MinVersion=10.0

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
