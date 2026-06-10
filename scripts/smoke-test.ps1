$ErrorActionPreference = "Stop"
$Base = "http://127.0.0.1:3921"
$passed = 0
$failed = 0
$results = @()

function Test-Api {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  try {
    & $Action
    $script:passed++
    $script:results += [pscustomobject]@{ Name = $Name; Status = "PASS" }
    Write-Host "[PASS] $Name" -ForegroundColor Green
  } catch {
    $script:failed++
    $msg = $_.Exception.Message
    $script:results += [pscustomobject]@{ Name = $Name; Status = "FAIL"; Error = $msg }
    Write-Host "[FAIL] $Name — $msg" -ForegroundColor Red
  }
}

Write-Host "`n=== OpenX API Smoke Test ===`n" -ForegroundColor Cyan

Test-Api "GET /api/health" {
  $r = Invoke-RestMethod "$Base/api/health" -TimeoutSec 10
  if (-not $r.ok) { throw "health not ok" }
}

Test-Api "GET /api/settings" {
  $r = Invoke-RestMethod "$Base/api/settings" -TimeoutSec 10
  if ($null -eq $r.autoExecute) { throw "missing settings" }
}

Test-Api "GET /api/executors" {
  $r = Invoke-RestMethod "$Base/api/executors" -TimeoutSec 10
  if (-not $r.executors) { throw "no executors" }
}

Test-Api "GET /api/coach/status" {
  $r = Invoke-RestMethod "$Base/api/coach/status" -TimeoutSec 10
  if ($null -eq $r.coach) { throw "no coach status" }
}

Test-Api "GET /api/goals" {
  $r = Invoke-RestMethod "$Base/api/goals" -TimeoutSec 10
  if ($null -eq $r.goals) { throw "no goals array" }
}

Test-Api "POST /api/coach/chat (directory inspect)" {
  $body = @{ message = "列出当前目录有哪些文件" } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod "$Base/api/coach/chat" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 60
  if (-not $r.message) { throw "empty message" }
  if (-not $r.refined) { throw "expected refined for directory inspect" }
  if (-not $r.refined.executionPrompt) { throw "missing executionPrompt" }
}

$parentGoalId = $null
Test-Api "POST /api/goals (with subGoals)" {
  $body = @{
    userDraft = "冒烟测试：搭建演示模块"
    title = "冒烟测试-核心目标"
    acceptance = "子任务全部创建成功"
    executionPrompt = "协调子任务完成"
    constraints = @("仅测试")
    autoStart = $false
    subGoals = @(
      @{
        userDraft = "创建 README 占位"
        title = "冒烟-子任务A"
        acceptance = "README 存在"
        executionPrompt = "在工作目录创建 README.smoke.md，内容为 smoke test"
      },
      @{
        userDraft = "删除 README 占位"
        title = "冒烟-子任务B"
        acceptance = "README 已删除"
        executionPrompt = "删除 README.smoke.md（若存在）"
      }
    )
  } | ConvertTo-Json -Depth 5 -Compress
  $r = Invoke-RestMethod "$Base/api/goals" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 120
  if (-not $r.goal.id) { throw "no parent goal" }
  if (-not $r.children -or $r.children.Count -lt 2) { throw "expected 2 children" }
  $script:parentGoalId = $r.goal.id
}

Test-Api "GET /api/goals/:id/children" {
  if (-not $parentGoalId) { throw "no parent from previous step" }
  $r = Invoke-RestMethod "$Base/api/goals/$parentGoalId/children" -TimeoutSec 10
  if ($r.children.Count -lt 2) { throw "children count < 2" }
}

Test-Api "POST /api/goals/:id/sub-goals" {
  if (-not $parentGoalId) { throw "no parent" }
  $body = @{
    autoStart = $false
    subGoals = @(
      @{
        userDraft = "追加子任务 C"
        title = "冒烟-子任务C"
        acceptance = "日志记录成功"
        executionPrompt = "向 stdout 输出 smoke-ok-c"
      }
    )
  } | ConvertTo-Json -Depth 5 -Compress
  $r = Invoke-RestMethod "$Base/api/goals/$parentGoalId/sub-goals" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 120
  if ($r.children.Count -lt 1) { throw "sub-goals not created" }
}

Test-Api "POST /api/connect (register)" {
  $body = @{
    toolName = "smoke-agent"
    agentName = "Smoke Worker"
    executorId = "smoke-worker"
  } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod "$Base/api/connect" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
  if (-not $r.connectionId) { throw "no connectionId" }
  $script:connId = $r.connectionId
}

Test-Api "POST /api/connect/:id/heartbeat" {
  if (-not $connId) { throw "no connection" }
  $body = @{ connectionId = $connId } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod "$Base/api/connect/$connId/heartbeat" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
  if ($r.status -ne "alive") { throw "heartbeat failed" }
}

Test-Api "GET /api/coach/messages" {
  $r = Invoke-RestMethod "$Base/api/coach/messages" -TimeoutSec 10
  if ($null -eq $r.messages) { throw "no messages" }
}

Write-Host "`n=== Summary: $passed passed, $failed failed ===`n" -ForegroundColor Cyan
$results | Format-Table -AutoSize
if ($failed -gt 0) { exit 1 }
