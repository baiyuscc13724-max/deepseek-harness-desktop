#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef MyAppId
  #define MyAppId "A116521E-7A92-4B10-9F64-315E8ED7A499"
#endif

#define MyAppName "Harness Desktop"
#define MyAppPublisher "Harness Desktop Contributors"
#define MyAppExeName "Harness Desktop.exe"
#ifndef MySourceDir
  #define MySourceDir "..\dist\win-unpacked"
#endif
#ifndef MyOutputDir
  #define MyOutputDir "..\dist"
#endif
#ifndef MyOutputBaseFilename
  #define MyOutputBaseFilename "Harness-Desktop-" + MyAppVersion + "-win-x64"
#endif
#define MyUninstallRoot "Software\Microsoft\Windows\CurrentVersion\Uninstall"
#define MyUninstallKey MyUninstallRoot + "\{" + MyAppId + "}_is1"

[Setup]
AppId={{{#MyAppId}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://github.com/baiyuscc13724-max/deepseek-harness-desktop
AppSupportURL=https://github.com/baiyuscc13724-max/deepseek-harness-desktop/issues
AppUpdatesURL=https://github.com/baiyuscc13724-max/deepseek-harness-desktop/releases
DefaultDirName={code:GetDefaultDirName}
UsePreviousAppDir=yes
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#MyOutputDir}
OutputBaseFilename={#MyOutputBaseFilename}
SetupIconFile=..\dist\.icon-ico\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
MinVersion=10.0

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
Root: HKCU; Subkey: "Software\Harness Desktop"; ValueType: string; ValueName: "LastInstallLocation"; ValueData: "{app}"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "运行 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function ExistingDirectoryFromValue(const Value: String): String;
var
  Candidate: String;
  CommaIndex: Integer;
begin
  Result := '';
  Candidate := Trim(Value);
  CommaIndex := Pos(',', Candidate);
  if CommaIndex > 0 then
    Candidate := Copy(Candidate, 1, CommaIndex - 1);
  Candidate := RemoveQuotes(Trim(Candidate));

  if DirExists(Candidate) then
    Result := RemoveBackslashUnlessRoot(Candidate)
  else if FileExists(Candidate) then
    Result := ExtractFileDir(Candidate);
end;

function ReadRegisteredInstallDirectory(RootKey: Integer; const Subkey: String; var Directory: String): Boolean;
var
  Value: String;
begin
  Result := False;
  if RegQueryStringValue(RootKey, Subkey, 'InstallLocation', Value) then
    Directory := ExistingDirectoryFromValue(Value);
  if (Directory = '') and RegQueryStringValue(RootKey, Subkey, 'DisplayIcon', Value) then
    Directory := ExistingDirectoryFromValue(Value);
  if (Directory = '') and RegQueryStringValue(RootKey, Subkey, 'UninstallString', Value) then
    Directory := ExistingDirectoryFromValue(Value);
  Result := (Directory <> '') and FileExists(AddBackslash(Directory) + '{#MyAppExeName}');
end;

function ReadInstallHint(var Directory: String): Boolean;
var
  Value: AnsiString;
begin
  Directory := '';
  if LoadStringFromFile(ExpandConstant('{srcexe}') + '.install-dir', Value) then
    Directory := ExistingDirectoryFromValue(String(Value));
  Result := (Directory <> '') and FileExists(AddBackslash(Directory) + '{#MyAppExeName}');
end;

function ReadUserInstallLocationFile(var Directory: String): Boolean;
var
  Value: AnsiString;
begin
  Directory := '';
  if LoadStringFromFile(ExpandConstant('{userappdata}\deepseek-harness-desktop\install-location.txt'), Value) then
    Directory := ExistingDirectoryFromValue(String(Value));
  Result := Directory <> '';
end;

function ReadLastInstallDirectory(var Directory: String): Boolean;
var
  Value: String;
begin
  Directory := '';
  if RegQueryStringValue(HKCU, 'Software\Harness Desktop', 'LastInstallLocation', Value) then
    Directory := ExistingDirectoryFromValue(Value);
  Result := Directory <> '';
end;

function FindLegacyInstallDirectory(RootKey: Integer; var Directory: String): Boolean;
var
  Subkeys: TArrayOfString;
  Index: Integer;
  Subkey: String;
  DisplayName: String;
begin
  Result := False;
  if not RegGetSubkeyNames(RootKey, '{#MyUninstallRoot}', Subkeys) then
    Exit;

  for Index := 0 to GetArrayLength(Subkeys) - 1 do
  begin
    Subkey := '{#MyUninstallRoot}\' + Subkeys[Index];
    if RegQueryStringValue(RootKey, Subkey, 'DisplayName', DisplayName) and
       (Pos('{#MyAppName}', DisplayName) = 1) and
       ReadRegisteredInstallDirectory(RootKey, Subkey, Directory) then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function GetDefaultDirName(Param: String): String;
var
  Directory: String;
begin
  Directory := '';

  { An updater hint is authoritative because it is written by the currently
    running packaged app immediately before the verified installer starts. }
  if ReadInstallHint(Directory) or
     ReadUserInstallLocationFile(Directory) or
     { Keep a stable last location outside the uninstall entry so reinstalling
       or repairing registration does not silently jump back to C:. }
     ReadLastInstallDirectory(Directory) or
     { Prefer the stable Inno Setup identity used by current releases. }
     ReadRegisteredInstallDirectory(HKCU, '{#MyUninstallKey}', Directory) or
     ReadRegisteredInstallDirectory(HKLM64, '{#MyUninstallKey}', Directory) or
     ReadRegisteredInstallDirectory(HKLM32, '{#MyUninstallKey}', Directory) or
     { Older NSIS releases used a generated uninstall key and often omitted
       InstallLocation, so recover their directory from DisplayIcon instead. }
     FindLegacyInstallDirectory(HKCU, Directory) or
     FindLegacyInstallDirectory(HKLM64, Directory) or
     FindLegacyInstallDirectory(HKLM32, Directory) then
    Result := Directory
  else
    Result := ExpandConstant('{localappdata}\Programs\{#MyAppName}');
end;

function HasCommandLineParameter(const Value: String): Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do
  begin
    if CompareText(ParamStr(Index), Value) = 0 then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  { rc.7 passed this exact silent-only flag. Relaunch once as a visible Chinese wizard. }
  if WizardSilent and HasCommandLineParameter('/CLOSEAPPLICATIONS') then
  begin
    if Exec(ExpandConstant('{srcexe}'), '/NORESTART /LANG=chinesesimp', '', SW_SHOWNORMAL, ewNoWait, ResultCode) then
      Result := False;
  end;
end;
