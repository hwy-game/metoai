#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef Arch
  #error Arch is required
#endif

[Setup]
AppId={{A2B92798-AB76-4F6B-A9B9-C252DBCB617C}
AppName=Metoai
AppVerName=Metoai {#AppVersion}
AppVersion={#AppVersion}
AppPublisher=Metoai
DefaultDirName={localappdata}\Programs\Metoai
DefaultGroupName=Metoai
; 品牌改名后不再沿用旧安装目录：旧版装在 Programs\Vetta，沿用会让改名只做一半。
; 旧目录由 [Code] 的 RemoveLegacyBrandDirectories() 在安装成功后清理。
UsePreviousAppDir=no
OutputDir={#OutputDir}
OutputBaseFilename=Metoai-{#AppVersion}-win-{#Arch}
SetupIconFile={#SourceDir}\versions\{#AppVersion}\resources\build\icon.ico
UninstallDisplayIcon={app}\Metoai.exe
Compression=lzma2/max
SolidCompression=no
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
AllowNoIcons=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
MinVersion=10.0
VersionInfoVersion={#AppVersion}
Uninstallable=not IsBackgroundUpdate
CreateUninstallRegKey=not IsBackgroundUpdate

#if Arch == "x64"
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#else
  #error Unsupported architecture
#endif

[Languages]
; 顺序既是语言选择页的排列顺序，也是系统语言不在列表里时的兜底：Inno 按用户界面语言
; 匹配 LanguageID，匹配不到才取第一项（实测：zh-CN 系统 + 只列西/法的语言表 → 落到 spanish）。
; 所以 english 放第一，与应用内「未识别系统语言 → 英文」的默认一致；中文、日文等
; 被系统语言直接命中的不受影响。
; 简体中文与印尼语、越南语用仓库自带的 .isl——Inno 官方语言包（compiler:Languages\*.isl）
; 只覆盖西/法/俄/日，没有这三种；其余语言直接引用官方语言包。
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl,{#SourcePath}\installer.zh-cn.isl"
Name: "spanish"; MessagesFile: "compiler:Default.isl,compiler:Languages\Spanish.isl"
Name: "french"; MessagesFile: "compiler:Default.isl,compiler:Languages\French.isl"
Name: "indonesian"; MessagesFile: "compiler:Default.isl,{#SourcePath}\installer.id-id.isl"
Name: "vietnamese"; MessagesFile: "compiler:Default.isl,{#SourcePath}\installer.vi-vn.isl"
Name: "russian"; MessagesFile: "compiler:Default.isl,compiler:Languages\Russian.isl"
Name: "japanese"; MessagesFile: "compiler:Default.isl,compiler:Languages\Japanese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Dirs]
Name: "{app}\versions"; Check: IsNotBackgroundUpdate

[Files]
Source: "{#SourceDir}\Metoai.exe"; DestDir: "{app}"; Flags: ignoreversion; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\current.json"; DestDir: "{app}"; Flags: ignoreversion; Check: IsNotBackgroundUpdate
; app.asar is already an archive. Keeping it uncompressed lets the outer blockmap
; reuse unchanged chunks instead of invalidating one large LZMA2 stream.
Source: "{#SourceDir}\versions\{#AppVersion}\*"; DestDir: "{app}\versions\{#AppVersion}"; Excludes: "resources\app.asar"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\versions\{#AppVersion}\resources\app.asar"; DestDir: "{app}\versions\{#AppVersion}\resources"; Flags: ignoreversion nocompression; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\versions\{#AppVersion}\*"; DestDir: "{code:GetUpdateVersionDirectory}"; Excludes: "resources\app.asar"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsBackgroundUpdate
Source: "{#SourceDir}\versions\{#AppVersion}\resources\app.asar"; DestDir: "{code:GetUpdateVersionDirectory}\resources"; Flags: ignoreversion nocompression; Check: IsBackgroundUpdate

[Icons]
Name: "{group}\Metoai"; Filename: "{app}\Metoai.exe"; Check: IsNotBackgroundUpdate
Name: "{autodesktop}\Metoai"; Filename: "{app}\Metoai.exe"; Tasks: desktopicon; Check: IsNotBackgroundUpdate

[Registry]
Root: HKCU; Subkey: "Software\Classes\vetta"; ValueType: string; ValueName: ""; ValueData: "URL:Metoai Protocol"; Flags: uninsdeletekey; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\vetta"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\vetta\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Metoai.exe,0"; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\vetta\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Metoai.exe"" ""%1"""; Check: IsNotBackgroundUpdate
; MetaToken 授权回调（metoai://metotoken/callback）。运行时 main 也会用
; setAsDefaultProtocolClient 自注册，但那要等应用启动过一次；安装期写入让
; 「装完直接点深链」也能工作。vetta 仍被云服务登录与远程配对使用，保留。
Root: HKCU; Subkey: "Software\Classes\metoai"; ValueType: string; ValueName: ""; ValueData: "URL:Metoai Protocol"; Flags: uninsdeletekey; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\metoai"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\metoai\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Metoai.exe,0"; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\metoai\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Metoai.exe"" ""%1"""; Check: IsNotBackgroundUpdate

[Run]
Filename: "{app}\Metoai.exe"; Description: "{cm:LaunchProgram,Metoai}"; Flags: nowait postinstall skipifsilent; Check: IsNotBackgroundUpdate

[InstallDelete]
; 旧品牌残留：旧快捷方式指向 {app}\Vetta.exe，改名后这个文件不再存在，
; 留着会让「点一下没反应」，所以正常安装时一并清掉（后台更新不动 {app}）。
Type: files; Name: "{app}\Vetta.exe"; Check: IsNotBackgroundUpdate
Type: files; Name: "{app}\VettaLauncher.exe"; Check: IsNotBackgroundUpdate
Type: files; Name: "{group}\Vetta.lnk"; Check: IsNotBackgroundUpdate
Type: files; Name: "{autodesktop}\Vetta.lnk"; Check: IsNotBackgroundUpdate

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\Metoai\versions"
Type: filesandordirs; Name: "{localappdata}\Metoai\installer"
Type: filesandordirs; Name: "{localappdata}\Metoai\staging"
Type: files; Name: "{localappdata}\Metoai\current.json"

[Code]
function CreateHardLinkW(
  NewFileName: String;
  ExistingFileName: String;
  SecurityAttributes: LongWord
): Boolean;
  external 'CreateHardLinkW@kernel32.dll stdcall';

function IsBackgroundUpdate(): Boolean;
begin
  Result := CompareText(ExpandConstant('{param:VETTAUPDATE|false}'), 'true') = 0;
end;

function IsNotBackgroundUpdate(): Boolean;
begin
  Result := not IsBackgroundUpdate();
end;

function GetUpdateVersionDirectory(Value: String): String;
begin
  Result := AddBackslash(ExpandConstant('{param:VETTASTOREROOT}')) + 'versions\{#AppVersion}';
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsBackgroundUpdate() and (Trim(ExpandConstant('{param:VETTASTOREROOT}')) = '') then
  begin
    Log('VETTASTOREROOT is required for a background update.');
    Result := False;
  end;
end;

procedure SeedUpdaterDifferentialCache();
var
  CacheDirectory: String;
  CachedBlockmapPath: String;
  CachedInstallerPath: String;
  SourceInstallerPath: String;
  TemporaryInstallerPath: String;
begin
  CacheDirectory := ExpandConstant('{localappdata}\metoai-updater');
  CachedBlockmapPath := AddBackslash(CacheDirectory) + 'current.blockmap';
  CachedInstallerPath := AddBackslash(CacheDirectory) + 'installer.exe';
  SourceInstallerPath := ExpandConstant('{srcexe}');
  TemporaryInstallerPath := AddBackslash(CacheDirectory) + 'installer.exe.installing';

  if not ForceDirectories(CacheDirectory) then
  begin
    Log('Unable to create updater cache directory: ' + CacheDirectory);
    exit;
  end;

  DeleteFile(TemporaryInstallerPath);
  if not CreateHardLinkW(TemporaryInstallerPath, SourceInstallerPath, 0) then
  begin
    if not FileCopy(SourceInstallerPath, TemporaryInstallerPath, False) then
    begin
      Log('Unable to stage updater installer cache: ' + SourceInstallerPath);
      exit;
    end;
  end;

  if FileExists(CachedInstallerPath) and not DeleteFile(CachedInstallerPath) then
  begin
    DeleteFile(TemporaryInstallerPath);
    Log('Unable to replace updater installer cache: ' + CachedInstallerPath);
    exit;
  end;

  if not RenameFile(TemporaryInstallerPath, CachedInstallerPath) then
  begin
    DeleteFile(TemporaryInstallerPath);
    Log('Unable to commit updater installer cache: ' + CachedInstallerPath);
    exit;
  end;

  { A manually installed version may replace an older cached installer. Remove
    the old blockmap so electron-updater fetches the matching versioned one. }
  DeleteFile(CachedBlockmapPath);
  Log('Updater differential cache seeded: ' + CachedInstallerPath);
end;

var
  LastReportedProgress: Integer;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
var
  CurrentProgress: Integer;
  ProgressFilePath: String;
begin
  if not IsBackgroundUpdate() then
    exit;

  ProgressFilePath := ExpandConstant('{param:VETTAPROGRESS}');
  if (ProgressFilePath = '') or (MaxProgress <= 0) then
    exit;

  CurrentProgress := (CurProgress * 100) div MaxProgress;
  if CurrentProgress <> LastReportedProgress then
  begin
    LastReportedProgress := CurrentProgress;
    SaveStringToFile(
      ProgressFilePath,
      IntToStr(CurProgress) + ',' + IntToStr(MaxProgress),
      False
    );
  end;
end;

function IsLegacyBrandInstall(): Boolean;
begin
  { 旧品牌安装的启动器只有两个可能位置：Inno 装到 Programs\Vetta，MSI 的载荷根是
    Programs\Metoai。两处的启动器都叫 Vetta.exe，据此判断是否需要兼容垫片。 }
  Result :=
    FileExists(ExpandConstant('{localappdata}\Programs\Vetta\Vetta.exe')) or
    FileExists(ExpandConstant('{localappdata}\Programs\Metoai\Vetta.exe'));
end;

procedure LinkLegacyLauncherName();
var
  VersionDirectory: String;
  CurrentExecutable: String;
  LegacyExecutable: String;
begin
  if not IsLegacyBrandInstall() then
    exit;

  VersionDirectory := GetUpdateVersionDirectory('');
  CurrentExecutable := AddBackslash(VersionDirectory) + 'Metoai.exe';
  LegacyExecutable := AddBackslash(VersionDirectory) + 'Vetta.exe';
  if not FileExists(CurrentExecutable) then
  begin
    Log('Legacy launcher compatibility link skipped; missing ' + CurrentExecutable);
    exit;
  end;
  if FileExists(LegacyExecutable) then
    exit;

  { 同一目录内的硬链接不占额外空间；失败时退化为复制，宁可多占一份也要让旧客户端
    能把新版本启动起来。两种情况都只记日志，不阻断安装。 }
  if not CreateHardLinkW(LegacyExecutable, CurrentExecutable, 0) then
  begin
    if FileCopy(CurrentExecutable, LegacyExecutable, False) then
      Log('Legacy launcher compatibility link created by copy: ' + LegacyExecutable)
    else
      Log('Unable to create the legacy launcher compatibility link: ' + LegacyExecutable);
  end;
end;

procedure RemoveLegacyBrandDirectories();
var
  LegacyProgramsDir: String;
  LegacyStoreRoot: String;
begin
  { 旧品牌的安装目录：确认里面确实是本产品（启动器或 versions 目录）才删，并且不删
    当前安装目录本身。删不掉（例如旧版本仍在运行）只记日志。 }
  LegacyProgramsDir := ExpandConstant('{localappdata}\Programs\Vetta');
  if (CompareText(LegacyProgramsDir, ExpandConstant('{app}')) <> 0)
     and (FileExists(AddBackslash(LegacyProgramsDir) + 'Vetta.exe')
          or DirExists(AddBackslash(LegacyProgramsDir) + 'versions')) then
  begin
    if DelTree(LegacyProgramsDir, True, True, True) then
      Log('Removed the legacy install directory: ' + LegacyProgramsDir)
    else
      Log('Unable to remove the legacy install directory: ' + LegacyProgramsDir);
  end;

  { 旧品牌的更新暂存根：里面只有暂存版本、安装日志与版本指针，删掉不影响已安装版本。 }
  LegacyStoreRoot := ExpandConstant('{localappdata}\Vetta');
  if DirExists(AddBackslash(LegacyStoreRoot) + 'versions')
     or FileExists(AddBackslash(LegacyStoreRoot) + 'current.json') then
  begin
    if DelTree(LegacyStoreRoot, True, True, True) then
      Log('Removed the legacy update store: ' + LegacyStoreRoot)
    else
      Log('Unable to remove the legacy update store: ' + LegacyStoreRoot);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if IsBackgroundUpdate() then
    begin
      { 旧品牌客户端写死了 versions\<版本>\Vetta.exe：下载安装新版之后它按这个名字找
        新版本的可执行文件，找不到就判定更新失败。所以先补一个同名硬链接，再写完成标记。 }
      LinkLegacyLauncherName();
      if not SaveStringToFile(
        AddBackslash(GetUpdateVersionDirectory('')) + '.install-complete',
        '{#AppVersion}',
        False
      ) then
        RaiseException('Failed to write update completion marker.');
    end
    else
    begin
      SeedUpdaterDifferentialCache();
      DeleteFile(ExpandConstant('{localappdata}\Metoai\current.json'));
      RemoveLegacyBrandDirectories();
    end;
  end;
end;
