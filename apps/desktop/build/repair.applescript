-- 修复已损坏.app 的 AppleScript 源。
-- 由 scripts/build-mac-repair-helper.js 通过 osacompile 编译为 .app 后放入 DMG。
-- 作用：对用户安装到 /Applications 或 ~/Applications 的 Metoai.app
-- 执行 xattr -dr com.apple.quarantine，绕过 Gatekeeper 的「应用程序已损坏」拦截。

on findMetoaiApp()
	set homeApps to (POSIX path of (path to home folder)) & "Applications/Metoai.app"
	set candidatePaths to {"/Applications/Metoai.app", homeApps}
	repeat with p in candidatePaths
		set thePath to contents of p
		try
			do shell script "/bin/test -e " & quoted form of thePath
			return thePath
		end try
	end repeat
	return missing value
end findMetoaiApp

set metoaiPath to findMetoaiApp()

if metoaiPath is missing value then
	display dialog "未检测到 Metoai.app。请先将 DMG 中的 Metoai.app 拖入 Applications 文件夹，然后再次打开「修复已损坏」。" buttons {"好"} default button "好" with icon caution with title "修复已损坏"
	return
end if

try
	do shell script "/usr/bin/xattr -dr com.apple.quarantine " & quoted form of metoaiPath with administrator privileges
on error errMsg number errNum
	if errNum is -128 then return -- 用户取消密码弹窗
	display dialog "修复失败：" & errMsg buttons {"好"} default button "好" with icon stop with title "修复已损坏"
	return
end try

display dialog "修复完成，即将启动 Metoai。" buttons {"启动 Metoai"} default button "启动 Metoai" with icon note with title "修复已损坏"
do shell script "/usr/bin/open " & quoted form of metoaiPath
