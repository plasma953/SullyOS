#!/usr/bin/env pwsh
#Requires -Version 5.1
<#
.SYNOPSIS
  Register Windows logon autostart for opencode serve + SullyOS CORS proxy.
.DESCRIPTION
  Creates two per-user Scheduled Tasks (no admin needed):
    <Prefix>-serve  - runs `opencode serve` bound to loopback at logon
    <Prefix>-proxy  - runs `node scripts/opencode-proxy.mjs` at logon
  Both restart on failure (999x, 1 min interval) and start hidden.
  Idempotent: re-running updates the tasks in place.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/opencode-autostart-win.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/opencode-autostart-win.ps1 -ServePort 4096 -ProxyPort 18062 -CorsOrigin http://localhost:5173
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/opencode-autostart-win.ps1 -Unregister
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [int]$ServePort = 4096,
  [int]$ProxyPort = 18062,
  [string]$CorsOrigin = 'http://localhost:5173',
  [string]$ServeHost = '127.0.0.1',
  [string]$Password = '',
  [string]$RepoDir = '',
  [string]$TaskPrefix = 'sullyos-opencode',
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoDir {
  param([string]$Hint)
  if ($Hint -and (Test-Path -LiteralPath $Hint)) { return (Resolve-Path -LiteralPath $Hint).Path }
  $here = Split-Path -Parent $PSCommandPath
  $root = Split-Path -Parent $here
  if (Test-Path -LiteralPath (Join-Path $root 'scripts/opencode-proxy.mjs')) { return $root }
  return (Get-Location).Path
}

function Remove-AutostartTasks {
  param([string]$Prefix)
  foreach ($name in @("$Prefix-serve", "$Prefix-proxy")) {
    $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($t) {
      if ($PSCmdlet.ShouldProcess($name, 'Unregister scheduled task')) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Output "removed: $name"
      }
    } else {
      Write-Output "not found (skip): $name"
    }
  }
}

if ($Unregister) {
  Remove-AutostartTasks -Prefix $TaskPrefix
  return
}

$repo = Resolve-RepoDir -Hint $RepoDir
$proxyScript = Join-Path $repo 'scripts/opencode-proxy.mjs'
if (-not (Test-Path -LiteralPath $proxyScript)) {
  throw "proxy script not found: $proxyScript (pass -RepoDir <sullyos checkout>)"
}
if (-not (Get-Command 'opencode' -ErrorAction SilentlyContinue)) {
  Write-Warning 'opencode CLI not found on PATH. The serve task is still registered, but install opencode first.'
}
if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) {
  Write-Warning 'node not found on PATH. The proxy task is still registered, but install Node.js first.'
}
if (-not $Password) {
  Write-Warning 'No -Password given: serve will run WITHOUT auth. Only use on a trusted network; set a strong password for any public/remote link.'
}

# Serve action: keep loopback-only by default. Password is baked into the task
# action (machine-local, same visibility as the task itself). Prefer a local-only
# account; never reuse an important password here.
$serveCmd = "opencode serve --port $ServePort --hostname $ServeHost --cors `"$CorsOrigin`""
if ($Password) {
  $serveCmd = "`$env:OPENCODE_SERVER_PASSWORD='$($Password.Replace("'", "''"))'; $serveCmd"
}
$serveAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -Command `"$serveCmd`"" `
  -WorkingDirectory $env:USERPROFILE

$proxyAction = New-ScheduledTaskAction -Execute 'node.exe' `
  -Argument "`"$proxyScript`" --port $ProxyPort" `
  -WorkingDirectory $repo

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

foreach ($pair in @(
  @{ Name = "$TaskPrefix-serve"; Action = $serveAction; Desc = "SullyOS: opencode serve autostart (loopback :$ServePort)" },
  @{ Name = "$TaskPrefix-proxy"; Action = $proxyAction; Desc = "SullyOS: opencode CORS proxy autostart (:$ProxyPort)" }
)) {
  if ($PSCmdlet.ShouldProcess($pair.Name, 'Register logon scheduled task')) {
    $existing = Get-ScheduledTask -TaskName $pair.Name -ErrorAction SilentlyContinue
    if ($existing) { Unregister-ScheduledTask -TaskName $pair.Name -Confirm:$false }
    Register-ScheduledTask -TaskName $pair.Name -Action $pair.Action `
      -Trigger $trigger -Settings $settings -Principal $principal `
      -Description $pair.Desc | Out-Null
    Start-ScheduledTask -TaskName $pair.Name -ErrorAction SilentlyContinue
    Write-Output "registered+started: $($pair.Name)"
  }
}

Write-Output ''
Write-Output "Serve : http://${ServeHost}:${ServePort} (cors: $CorsOrigin)"
Write-Output "Proxy : http://127.0.0.1:${ProxyPort}/"
Write-Output 'Manage: Get-ScheduledTask -TaskName "$TaskPrefix-*" | Get-ScheduledTaskInfo'
Write-Output "Remove: powershell -NoProfile -ExecutionPolicy Bypass -File `"$($PSCommandPath)`" -Unregister"
