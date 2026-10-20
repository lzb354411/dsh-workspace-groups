# 卸载 / 回滚 dsh-workspace-groups
# 说明：中文放在 .ps1 里（UTF-8 带 BOM），因为 .bat 里的 UTF-8 中文会被 cmd.exe 按 GBK 解析而拆坏命令。
$ErrorActionPreference = 'Continue'
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'

Write-Host '============================================================'
Write-Host ' dsh-workspace-groups  回滚 / 卸载'
Write-Host ' 作用：把本插件从 DSH 桌面端卸掉。'
Write-Host '       卸载后组合补丁随包消失，官方那一行侧栏列表会自动恢复。'
Write-Host ' 卸完必须重启一次 DSH（托盘右键退出 → 双击桌面图标）。'
Write-Host '============================================================'
Write-Host ''

if (-not (Test-Path $cli)) {
  Write-Host '[错误] 找不到 DSH 命令行工具：'
  Write-Host "       $cli"
  Write-Host '       请确认 DeepSeek Harness 装在哪里，或改用项目 README 第二节里的命令。'
  exit 1
}

Write-Host '当前状态：'
& $cli plugin --profile desktop why dsh-workspace-groups
Write-Host ''
Write-Host '开始卸载…'
& $cli plugin --profile desktop remove dsh-workspace-groups
Write-Host ''
if ($LASTEXITCODE -ne 0) {
  Write-Host '[失败] 卸载没有成功，请把上面的报错整段发我。'
  Write-Host '兜底：用安装前的整份备份覆盖回去 ——'
  Write-Host '  <备份根>\_backup\20261020-104056\<用户主目录>\.dsh\profiles\desktop\'
  exit 1
}
Write-Host '卸载完成。'
Write-Host '请重启 DSH：托盘图标右键 → 退出，然后双击桌面图标重新打开。'
Write-Host '重启后请确认：侧栏里不再出现「＋ 新建分组」，工作区列表与原来一致。'
Write-Host ''
Write-Host '分组数据文件仍然留着（不会自动删除）：'
Write-Host '  <DSH_HOME>\storages\workspace-groups.json'
Write-Host '想彻底清掉就手动删它；不想丢分组就先备份它。'
exit 0
