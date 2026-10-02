# Define the project folder path to watch and the push file to run
$projectFolder = "." 
$batchFile = ".\push.bat"

# Set up the file system watcher
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = (Get-Item $projectFolder).FullName
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

# Filter to watch for code file updates
$action = {
    $path = $Event.SourceEventArgs.FullPath
    if ($path -match '\.(html|css|js|json)$' -and $path -notmatch '\\\.git\\') {
        Write-Host "Change detected in $path. Running push.bat..." -ForegroundColor Green
        Start-Process "cmd.exe" "/c $batchFile" -WorkingDirectory $watcher.Path
    }
}

# Register events for creating and modifying files
Register-ObjectEvent $watcher "Changed" -Action $action | Out-Null
Register-ObjectEvent $watcher "Created" -Action $action | Out-Null

Write-Host "Watching for file modifications in $projectFolder... Press Ctrl+C to stop." -ForegroundColor Cyan
while ($true) { Start-Sleep 1 }
