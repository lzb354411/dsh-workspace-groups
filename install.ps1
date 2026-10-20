# 安装 dsh-workspace-groups 到 DSH 桌面端（系统级操作）
# 说明：中文放在 .ps1 里（UTF-8 带 BOM），因为 .bat 里的 UTF-8 中文会被 cmd.exe 按 GBK 解析而拆坏命令。
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'

Write-Host '============================================================'
Write-Host ' dsh-workspace-groups  安装'
Write-Host ' 把本插件装进 DSH 桌面端（系统级操作，会影响所有工作区）'
Write-Host ' 装完之后必须重启一次 DSH 才会完全生效'
Write-Host '============================================================'
Write-Host ''

if (-not (Test-Path $cli)) {
  Write-Host '[错误] 找不到 DSH 命令行工具：'
  Write-Host "       $cli"
  Write-Host '       请确认 DeepSeek Harness 装在哪里，或改用项目 README 第二节里的命令。'
  exit 1
}

$plugin = Join-Path $here 'plugin'
$spec = 'file:' + ($plugin -replace '\\', '/')
Write-Host "插件目录：$plugin"
Write-Host ''
Write-Host '当前状态：'
& $cli plugin --profile desktop why dsh-workspace-groups
Write-Host ''
Write-Host '开始安装（先卸旧版再装，确保文件被重新复制）…'
& $cli plugin --profile desktop remove dsh-workspace-groups 2>&1 | Out-Null
& $cli plugin --profile desktop add $spec
Write-Host ''
if ($LASTEXITCODE -ne 0) {
  Write-Host '[失败] 安装没有成功，请把上面的报错整段发我。'
  exit 1
}
Write-Host '安装完成。'
Write-Host '请重启 DSH：托盘图标右键 → 退出，然后双击桌面图标重新打开。'
Write-Host ''
Write-Host '想撤销这次安装：双击本项目里的 rollback.bat'
exit 0
