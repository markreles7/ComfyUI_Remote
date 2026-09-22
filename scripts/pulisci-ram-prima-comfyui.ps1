param([switch]$Preview)

$ErrorActionPreference = 'Stop'

function Get-FreeRamGB {
    $os = Get-CimInstance Win32_OperatingSystem
    return [math]::Round($os.FreePhysicalMemory / 1MB, 2)
}

function Get-TargetProcesses {
    $exactNames = @(
        'MuseHub.exe',
        'urban-vpn-app.exe',
        'SteelSeriesGGEZ.exe',
        'SteelSeriesGG.exe',
        'SteelSeriesEngine.exe',
        'SteelSeriesMoments.exe',
        'SteelSeriesPrism.exe',
        'MEGAsync.exe',
        'NVIDIA Overlay.exe',
        'GooglePlayGamesServices.exe',
        'CCXProcess.exe'
    )

    Get-CimInstance Win32_Process | Where-Object {
        ($exactNames -contains $_.Name) -or
        ($_.Name -eq 'pythonw.exe' -and $_.CommandLine -like '*hermes_cli.main gateway run*') -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*openclaw*dist*index.js gateway*') -or
        ($_.Name -eq 'Ui.exe' -and $_.ExecutablePath -like '*\Samsung\Easy Connection to Screen\*')
    }
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $Preview -and -not $isAdmin) {
    Write-Host 'Richiesta di accesso amministratore per arrestare i servizi selezionati...'
    try {
        $scriptPath = $MyInvocation.MyCommand.Path
        $arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $scriptPath + '"'))
        $elevated = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
        exit $elevated.ExitCode
    } catch {
        Write-Error "Elevazione non riuscita: $($_.Exception.Message)"
        exit 1
    }
}

$before = Get-FreeRamGB
$targets = @(Get-TargetProcesses)
Write-Host "RAM libera prima: $before GB"
Write-Host "Processi selezionati: $($targets.Count)"
$targets | Select-Object Name, ProcessId, @{Name='RAM_MB'; Expression={[math]::Round($_.WorkingSetSize / 1MB)}} | Format-Table -AutoSize

if ($Preview) {
    Write-Host 'Anteprima: nessun processo o servizio e stato arrestato.'
    exit 0
}

$errors = [System.Collections.Generic.List[string]]::new()

# Questi servizi erano gia stati disabilitati all'avvio, ma possono essere ancora attivi
# fino al riavvio. Fermarli ora evita che riaprano i relativi processi.
foreach ($serviceName in @('MuseAuthService', 'UrbanVPN-Service', 'GooglePlayGamesServices-26.8.707.0')) {
    try {
        $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne 'Stopped') {
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
            Write-Host "Servizio fermato: $serviceName"
        }
    } catch {
        $errors.Add("Servizio $serviceName : $($_.Exception.Message)")
    }
}

foreach ($process in @(Get-TargetProcesses)) {
    try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Write-Host "Processo chiuso: $($process.Name) (PID $($process.ProcessId))"
    } catch {
        if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
            $errors.Add("Processo $($process.Name) (PID $($process.ProcessId)) : $($_.Exception.Message)")
        }
    }
}

# Docker Desktop ospita anche n8n e SearXNG su questo PC. Il suo arresto ferma
# quei container; non viene toccata alcuna altra distribuzione WSL.
try {
    $dockerProcesses = @(Get-Process -Name 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue)
    if ($dockerProcesses.Count -gt 0) {
        $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
        if ($docker) {
            Write-Host 'Arresto Docker Desktop e i suoi container...'
            & $docker.Source desktop stop
            if ($LASTEXITCODE -ne 0) {
                $errors.Add("Docker Desktop: comando stop terminato con codice $LASTEXITCODE")
            }
        } else {
            $errors.Add('Docker Desktop: docker.exe non trovato')
        }

        Start-Sleep -Seconds 2
        foreach ($dockerProcessName in @('Docker Desktop', 'com.docker.backend', 'com.docker.build', 'docker-agent', 'docker-sandbox')) {
            foreach ($dockerProcess in @(Get-Process -Name $dockerProcessName -ErrorAction SilentlyContinue)) {
                try {
                    Stop-Process -Id $dockerProcess.Id -Force -ErrorAction Stop
                    Write-Host "Processo Docker residuo chiuso: $dockerProcessName (PID $($dockerProcess.Id))"
                } catch {
                    if (Get-Process -Id $dockerProcess.Id -ErrorAction SilentlyContinue) {
                        $errors.Add("Processo Docker $dockerProcessName (PID $($dockerProcess.Id)) : $($_.Exception.Message)")
                    }
                }
            }
        }
    }

    $dockerWsl = @(wsl.exe --list --running --quiet 2>$null | ForEach-Object { ($_ -replace [char]0, '').Trim() })
    if ($dockerWsl -contains 'docker-desktop') {
        Write-Host 'Chiusura della sola distribuzione WSL docker-desktop...'
        & wsl.exe --terminate docker-desktop
        if ($LASTEXITCODE -ne 0) {
            $errors.Add("WSL docker-desktop: codice $LASTEXITCODE")
        }
    }
} catch {
    $errors.Add("Docker/WSL: $($_.Exception.Message)")
}

Start-Sleep -Seconds 2
$after = Get-FreeRamGB
Write-Host "RAM libera dopo: $after GB (varia con l'attivita di Windows)"
Write-Host 'LM Studio, ComfyUI e Tailscale non sono stati selezionati per la chiusura.'
Write-Host 'Il pagefile resta gestito da Windows; non viene svuotato forzatamente.'

if ($errors.Count -gt 0) {
    Write-Warning 'Alcune operazioni non sono riuscite:'
    $errors | ForEach-Object { Write-Warning $_ }
    exit 1
}

exit 0
