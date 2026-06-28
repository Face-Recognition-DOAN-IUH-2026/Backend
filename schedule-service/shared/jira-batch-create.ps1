# Jira Batch Creator - IUH Library System
# Creates Workstreams and Tasks for all backend services

param(
    [string]$ProjectKey = "LIB",
    [string]$JiraUrl = "https://maihuynhduongtuankiet7924.atlassian.net",
    [string]$JiraEmail = "maihuynhduongtuankiet7924@gmail.com",
    [string]$JiraToken = "ATATT3xFfGF0TflyfhOHp4e3LaWtTRi3K0B92Mw4i-cuODgfrC0amecZjuEBIyO6DTuWW3SDrgy6mWsK9gP3-IuCVt4XNn8qGMhS9w_eFAXz_pVsOeKrjov_Ml5gWnRyXw7yLQyKiAY8oRQ83rlIvAdUPXqpZTRHDt0nU0ZPRQ-g0pfIWzHEUNM=77ABA92F",
    [switch]$DryRun,
    [switch]$SkipExisting
)

$pair = "${JiraEmail}:${JiraToken}"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($pair)
$base64 = [System.Convert]::ToBase64String($bytes)
$headers = @{
    "Authorization" = "Basic $base64"
    "Content-Type"  = "application/json"
}

function Invoke-JiraApi {
    param(
        [string]$Endpoint,
        [string]$Method = "GET",
        [object]$Body = $null,
        [int]$MaxRetries = 3
    )
    $url = "${JiraUrl}/rest/api/3/${Endpoint}"
    for ($i = 1; $i -le $MaxRetries; $i++) {
        try {
            $params = @{ Uri = $url; Method = $Method; Headers = $headers }
            if ($Body) { $params.Body = $Body | ConvertTo-Json -Depth 10 }
            $result = Invoke-RestMethod @params
            return $result
        }
        catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($statusCode -eq 429) {
                $waitTime = 10 * $i
                Write-Host "  Rate limited. Waiting ${waitTime}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $waitTime
            }
            elseif ($i -eq $MaxRetries) {
                Write-Host "  Failed: $($_.Exception.Message)" -ForegroundColor Red
                return $null
            }
            else { Start-Sleep -Seconds 2 }
        }
    }
    return $null
}

function Create-Issue {
    param(
        [string]$Summary,
        [string]$IssueType,
        [string]$Description = "",
        [string]$ParentKey = ""
    )
    $fields = @{
        project   = @{ key = $ProjectKey }
        summary   = $Summary
        issuetype = @{ name = $IssueType }
    }
    if ($Description) {
        $fields.description = @{
            type = "doc"; version = 1
            content = @(@{ type = "paragraph"; content = @(@{ type = "text"; text = $Description }) })
        }
    }
    if ($ParentKey) { $fields.parent = @{ key = $ParentKey } }
    $body = @{ fields = $fields }
    if ($DryRun) {
        Write-Host "  [DRY RUN] Would create: $Summary ($IssueType)" -ForegroundColor Yellow
        return @{ key = "DRY-RUN"; id = "0" }
    }
    $result = Invoke-JiraApi -Endpoint "issue" -Method "POST" -Body $body
    if ($result) {
        Write-Host "  Created: $($result.key) - $Summary" -ForegroundColor Green
        return $result
    }
    else {
        Write-Host "  Failed: $Summary" -ForegroundColor Red
        return $null
    }
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "  Jira Batch Creator - IUH Library System" -ForegroundColor Cyan
Write-Host "  Project: $ProjectKey" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

if ($DryRun) { Write-Host "DRY RUN MODE - No issues will be created`n" -ForegroundColor Yellow }

$services = @(
    @{
        Name = "User Management and Authentication"
        Service = "user-service"
        Port = 3001
        Description = "User registration, login, patron management, JWT authentication"
        Tasks = @(
            "GET /health - Service health check"
            "POST /auth/register - Register new user"
            "POST /auth/login - User login"
            "POST /auth/refresh - Refresh access token"
            "POST /auth/forgot-password - Request password reset"
            "POST /auth/verify-reset-code - Verify reset code"
            "POST /auth/reset-password - Reset password"
            "GET /users - List all users"
            "GET /users/me - Get current user"
            "GET /users/:id - Get user by ID"
            "PUT /users/:id/access-status - Update access status"
            "PUT /users/:id/restore - Restore user"
            "DELETE /users/:id - Delete user"
            "POST /users/me/avatar - Upload avatar"
            "DELETE /users/me/avatar - Delete avatar"
            "POST /patrons/register - Register patron"
            "POST /patrons/login - Patron login"
            "GET /patrons/me - Get current patron"
            "GET /patrons/search - Search patrons"
            "GET /patrons/lookup - Lookup patron"
            "GET /patrons/active - List active patrons"
            "GET /patrons/stats - Patron statistics"
            "GET /patrons/:id - Get patron by ID"
            "POST /patrons - Create patron"
            "PUT /patrons/:id - Update patron"
            "PUT /patrons/:id/password - Change password"
            "PUT /patrons/:id/restore - Restore patron"
            "POST /patrons/:id/card/suspend - Suspend card"
            "POST /patrons/:id/card/renew - Renew card"
            "POST /patrons/:id/card/lost - Report lost card"
            "DELETE /patrons/:id - Delete patron"
            "GET /internal/users - List users (internal)"
            "GET /internal/users/expiring-membership - Expiring memberships"
            "GET /internal/users/:id - Get user (internal)"
            "POST /internal/users/batch - Batch lookup"
            "GET /internal/staff - List staff"
            "GET /internal/patrons/lookup - Lookup patron (internal)"
            "GET /internal/patrons/search - Search patrons (internal)"
            "GET /internal/patrons/:id - Get patron (internal)"
            "POST /internal/patrons - Create patron (internal)"
            "PUT /internal/patrons/:id - Update patron (internal)"
            "DELETE /internal/patrons/:id - Delete patron (internal)"
        )
    },
    @{
        Name = "Staff Scheduling and Shift Management"
        Service = "schedule-service"
        Port = 3002
        Description = "Zone, shift, template, assignment management, availability, bidding, swaps"
        Tasks = @(
            "GET /health - Service health check"
            "GET /schedules/health - Detailed health"
            "GET /schedules/zones - List zones"
            "POST /schedules/zones - Create zone"
            "PUT /schedules/zones/:id - Update zone"
            "DELETE /schedules/zones/:id - Delete zone"
            "GET /schedules/shifts - List shifts"
            "POST /schedules/shifts - Create shift"
            "PUT /schedules/shifts/:id - Update shift"
            "DELETE /schedules/shifts/:id - Delete shift"
            "GET /schedules/templates - List templates"
            "POST /schedules/templates - Create template"
            "PUT /schedules/templates/:id - Update template"
            "DELETE /schedules/templates/:id - Delete template"
            "GET /schedules/preferences - List preferences"
            "POST /schedules/preferences - Create preference"
            "DELETE /schedules/preferences/:id - Delete preference"
            "GET /schedules/staff-options - List staff options"
            "POST /schedules/generate-from-template - Generate from template"
            "POST /schedules/auto-schedule - Auto-schedule"
            "GET /schedules/assignments - List assignments"
            "POST /schedules/assignments - Create assignment"
            "PUT /schedules/assignments/:id - Update assignment"
            "POST /schedules/assignments/:id/move - Move assignment"
            "DELETE /schedules/assignments/:id - Delete assignment"
            "POST /schedules/assignments/:id/confirm - Confirm assignment"
            "POST /schedules/assignments/:id/check-in - Check in"
            "POST /schedules/assignments/:id/check-out - Check out"
            "GET /schedules/availability - List availability"
            "POST /schedules/availability/:id/approve - Approve availability"
            "POST /schedules/availability/:id/reject - Reject availability"
            "GET /schedules/me/availability - Get my availability"
            "POST /schedules/me/availability - Submit availability"
            "GET /schedules/me - Get my schedule"
            "GET /schedules/open-shifts - List open shifts"
            "POST /schedules/bids - Bid on shift"
            "GET /schedules/bids - List bids"
            "POST /schedules/bids/:id/cancel - Cancel bid"
            "POST /schedules/bids/:id/approve - Approve bid"
            "POST /schedules/bids/:id/reject - Reject bid"
            "POST /schedules/swaps - Request swap"
            "GET /schedules/swaps - List swaps"
            "POST /schedules/swaps/:id/respond - Respond to swap"
            "GET /schedules/geofence - List geofence configs"
            "PUT /schedules/geofence - Set geofence"
            "DELETE /schedules/geofence/:zoneId - Delete geofence"
            "GET /schedules/audit-logs - List audit logs"
            "GET /schedules/today - Today assignments"
            "GET /schedules/upcoming - Upcoming assignments"
        )
    },
    @{
        Name = "Library Entry Exit Access Control"
        Service = "access-service"
        Port = 3003
        Description = "Realtime access monitoring, face recognition events, patron status tracking"
        Tasks = @(
            "GET /health - Service health check"
            "GET /access/events - SSE event stream"
            "GET /access/recent - Recent events"
            "GET /access/logs - Access logs"
            "GET /access/active - Active patrons"
            "GET /access/frequency - Access frequency"
            "GET /access/stats - Access statistics"
            "POST /access/test-broadcast - Test broadcast"
            "POST /access/force-exit - Force exit"
            "WS /access/ws - WebSocket realtime"
            "POST /internal/access/recognition-events - Record event"
            "GET /internal/access/patrons/:id/status - Get status"
            "POST /internal/access/patrons/:id/status - Set status"
            "GET /internal/access/stats - Statistics (internal)"
            "GET /internal/access/active - Active (internal)"
            "POST /internal/access/force-exit - Force exit (internal)"
        )
    },
    @{
        Name = "AI Chatbot Command Center and Insights"
        Service = "ai-service"
        Port = 3004
        Description = "AI-powered chatbot, book recommendations, command center dashboard"
        Tasks = @(
            "GET /health - Service health check"
            "GET /ai/health - AI health check"
            "POST /ai/chat - Send message"
            "GET /ai/chat/sessions/:sessionId - Get session"
            "POST /chat - Chat (backward compat)"
            "GET /chat/sessions/:sessionId - Session (backward compat)"
            "POST /ai/confirm - Confirm action"
            "POST /confirm - Confirm (backward compat)"
            "GET /ai/sessions/:sessionId - Session details"
            "GET /ai/command-center/summary - Dashboard"
            "POST /ai/command-center/refresh - Refresh"
            "POST /ai/command-center/chat - Command chat"
            "GET /ai/insights - List insights"
            "POST /ai/insights/:id/dismiss - Dismiss insight"
            "GET /ai/insights/:id/explain - Explain insight"
            "GET /ai/recommendations/patron/:studentCode - Recommendations"
        )
    },
    @{
        Name = "In-App Notifications and Email Delivery"
        Service = "notification-service"
        Port = 3006
        Description = "Realtime notifications via SSE/WebSocket, email delivery"
        Tasks = @(
            "GET /health - Service health check"
            "GET /notifications - List notifications"
            "GET /notifications/unread-count - Unread count"
            "PUT /notifications/:id/read - Mark read"
            "PUT /notifications/read-all - Mark all read"
            "GET /notifications/events - SSE stream"
            "WS /notifications/ws - WebSocket"
            "POST /internal/notifications - Create notification"
            "POST /internal/notifications/bulk - Bulk create"
            "GET /internal/notifications/:id - Get notification"
            "POST /internal/notifications/send-password-reset - Password reset email"
            "POST /internal/notifications/send-overdue-email - Overdue email"
            "POST /internal/notifications/send-fine-email - Fine email"
            "POST /internal/notifications/send-membership-expiry-email - Membership email"
        )
    },
    @{
        Name = "Scheduled Tasks and Cron Jobs"
        Service = "automation-service"
        Port = 3007
        Description = "Cron job management, event processing, scheduled task execution"
        Tasks = @(
            "GET /health - Service health check"
            "GET /automation/tasks - List tasks"
            "GET /automation/tasks/:id - Get task"
            "PUT /automation/tasks/:id/toggle - Toggle task"
            "POST /automation/tasks/:id/run - Run task"
            "GET /automation/runs - List runs"
            "GET /automation/runs/:id - Get run"
            "POST /automation/events - Publish event"
            "GET /internal/tasks - List tasks (internal)"
            "GET /internal/runs - List runs (internal)"
            "POST /internal/events - Publish event (internal)"
        )
    },
    @{
        Name = "Book Borrowing Returns and Library Catalog"
        Service = "borrow-service"
        Port = 8000
        Description = "Book borrowing, returns, reservations, catalog management, 3D library visualization"
        Tasks = @(
            "GET /healthz - Health check"
            "GET /ready - Readiness check"
            "GET /borrow/patron/inside-status - Inside status"
            "GET /borrow/patron/active - Active borrows"
            "GET /borrow/history - Borrow history"
            "POST /borrow/reserve - Reserve book"
            "GET /borrow/reservations - List reservations"
            "DELETE /borrow/reservations/:id - Cancel reservation"
            "POST /borrow/renew - Renew borrow"
            "POST /borrow - Borrow book"
            "POST /borrow/staff/slip/lookup - Slip lookup"
            "POST /borrow/staff/slip/confirm - Confirm slip"
            "POST /borrow/staff/slip/create - Create slip"
            "GET /borrow/staff/active-borrowers - Active borrowers"
            "GET /borrow/staff/patrons/:student_code/active - Patron active"
            "GET /borrow/staff/patrons/:student_code/history - Patron history"
            "GET /borrow/staff/patrons/id/:patron_id/history - History by ID"
            "GET /borrow/staff/stats - Borrow stats"
            "GET /borrow/staff/active - Active records"
            "POST /borrow/staff-return - Staff return"
            "POST /borrow/staff-return/by-patron - Return by patron"
            "POST /borrow/staff-return/batch - Batch return"
            "POST /borrow/staff-return/record/:record_id - Return by record"
            "GET /borrow/barcode/:barcode - Lookup barcode"
            "GET /borrow/book/:isbn - Lookup ISBN"
            "GET /borrow/books - List books"
            "GET /borrow/books/search - Search books"
            "GET /borrow/books/template - Download template"
            "GET /borrow/books/export - Export books"
            "GET /borrow/barcodes - List barcodes"
            "GET /borrow/books/:book_id - Get book details"
            "PUT /borrow/books/:book_id/quantity - Update quantity"
            "POST /borrow/books/delete - Bulk delete"
            "POST /borrow/books/import/preview - Preview import"
            "POST /borrow/books/import - Import books"
            "POST /borrow/books/import/filtered - Filtered import"
            "POST /borrow/isbn-import/batch - ISBN batch import"
            "GET /library/shelves - 3D library shelves"
            "GET /borrow/internal/overdue - Overdue records"
            "GET /borrow/internal/due-soon - Due soon"
            "GET /borrow/internal/patron/:patronId - Patron borrows"
            "GET /borrow/internal/shelves - Shelves"
            "GET /borrow/internal/books/search - Search books (internal)"
            "GET /borrow/internal/books/lookup - Lookup book (internal)"
            "POST /borrow/internal/books - Create book (internal)"
            "PUT /borrow/internal/books/:book_id/quantity - Update quantity (internal)"
            "POST /borrow/internal/return - Return (internal)"
            "POST /borrow/internal/batch-return - Batch return (internal)"
            "POST /borrow/internal/renew - Renew (internal)"
            "GET /borrow/internal/active-borrowers - Active borrowers (internal)"
        )
    }
)

$createdWorkstreams = @()
$createdTasks = @()
$failedItems = @()

$totalWorkstreams = $services.Count
$currentWorkstream = 0

foreach ($service in $services) {
    $currentWorkstream++
    Write-Host "`n[$currentWorkstream/$totalWorkstreams] $($service.Name) ($($service.Service))" -ForegroundColor Cyan

    $workstream = Create-Issue -Summary $service.Name -IssueType "Workstream" -Description "$($service.Description). Service: $($service.Service). Port: $($service.Port)"

    if ($workstream) {
        $createdWorkstreams += $workstream
        $workstreamKey = $workstream.key

        $totalTasks = $service.Tasks.Count
        $currentTask = 0

        foreach ($taskSummary in $service.Tasks) {
            $currentTask++
            $issue = Create-Issue -Summary $taskSummary -IssueType "Task" -ParentKey $workstreamKey
            if ($issue) { $createdTasks += $issue }
            else { $failedItems += $taskSummary }
        }

        Write-Host "  Completed: $($service.Tasks.Count) tasks" -ForegroundColor Green
    }
    else {
        $failedItems += "Workstream: $($service.Name)"
    }
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "`nWorkstreams created: $($createdWorkstreams.Count)" -ForegroundColor Green
$createdWorkstreams | ForEach-Object { Write-Host "  - $($_.key): $($_.fields.summary)" -ForegroundColor Gray }
Write-Host "`nTasks created: $($createdTasks.Count)" -ForegroundColor Green
if ($failedItems.Count -gt 0) {
    Write-Host "`nFailed items: $($failedItems.Count)" -ForegroundColor Red
    $failedItems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
Write-Host "`nProject URL: $JiraUrl/browse/$ProjectKey" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

$output = @{
    projectKey = $ProjectKey
    jiraUrl = $JiraUrl
    timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    workstreams = $createdWorkstreams | ForEach-Object { @{ key = $_.key; summary = $_.fields.summary } }
    tasks = $createdTasks | ForEach-Object { @{ key = $_.key; summary = $_.fields.summary } }
    failed = $failedItems
}
$outputPath = "D:\IUH\test\Backend\shared\jira-batch-results.json"
$output | ConvertTo-Json -Depth 5 | Out-File -FilePath $outputPath -Encoding UTF8
Write-Host "Results exported to: $outputPath" -ForegroundColor Gray
