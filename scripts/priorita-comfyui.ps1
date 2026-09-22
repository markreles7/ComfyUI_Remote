param(
    [string]$ComfyRoot = 'E:\ComfyUI\Data\Packages\ComfyUI LTX',
    [switch]$Watch
)

$ErrorActionPreference = 'Stop'
$main = Join-Path (Resolve-Path -LiteralPath $ComfyRoot).Path 'main.py'
if (-not (Test-Path -LiteralPath $main)) {
    throw "main.py non trovato in $ComfyRoot"
}

function Get-ComfyProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($main, [StringComparison]::OrdinalIgnoreCase) -ge 0
        })
}

$originalPriorities = @{}
Write-Host 'Priorita ComfyUI: Alta (mai Tempo reale).'
if ($Watch) { Write-Host 'Monitoraggio attivo. Premi Ctrl+C per interrompere e ripristinare le priorita.' }

try {
    do {
        foreach ($candidate in @(Get-ComfyProcesses)) {
            try {
                $comfyProcess = Get-Process -Id $candidate.ProcessId -ErrorAction Stop
                if (-not $originalPriorities.ContainsKey($candidate.ProcessId)) {
                    $originalPriorities[$candidate.ProcessId] = $comfyProcess.PriorityClass
                }
                if ($comfyProcess.PriorityClass -ne [System.Diagnostics.ProcessPriorityClass]::High) {
                    $comfyProcess.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::High
                    Write-Host "PID $($candidate.ProcessId): priorita Alta"
                }
            } catch {
                Write-Warning "PID $($candidate.ProcessId): impossibile impostare la priorita: $($_.Exception.Message)"
            }
        }
        if ($Watch) { Start-Sleep -Seconds 3 }
    } while ($Watch)
} finally {
    if ($Watch) {
        foreach ($processIdToRestore in @($originalPriorities.Keys)) {
            try {
                $comfyProcess = Get-Process -Id $processIdToRestore -ErrorAction Stop
                $comfyProcess.PriorityClass = $originalPriorities[$processIdToRestore]
                Write-Host "PID ${processIdToRestore}: priorita ripristinata"
            } catch {
                # Un processo ComfyUI gia terminato non richiede ripristino.
            }
        }
    }
}
