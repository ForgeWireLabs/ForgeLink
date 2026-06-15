param(
    [ValidateSet("vscode", "claude", "codex", "forgewire", "all")]
    [string]$Target = "all",
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$BaseUrl = "http://127.0.0.1:5055",
    [string]$ChannelId = "forgewire",
    [string]$ApiToken = "",
    [string]$TokenFile = (Join-Path $HOME ".forgelink\api.token")
)

$ErrorActionPreference = "Stop"

function Write-ConfigFile {
    param([string]$Path, [string]$Content)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
    Write-Host "Wrote $Path"
}

function Json-Config {
    param([string]$Source)
    $server = Join-Path $RepoRoot "mcp\forgelink-human\dist\server.js"
    return @{
        command = "node"
        args = @($server)
        env = @{
            FORGELINK_BASE_URL = $BaseUrl
            FORGELINK_API_TOKEN_FILE = $TokenFile
            FORGELINK_CHANNEL_ID = $ChannelId
            FORGELINK_SOURCE = $Source
        }
    }
}

if ($ApiToken) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $TokenFile) -Force | Out-Null
    Set-Content -LiteralPath $TokenFile -Value $ApiToken -NoNewline -Encoding UTF8
    Write-Host "Wrote token file $TokenFile"
}

Push-Location (Join-Path $RepoRoot "mcp\forgelink-human")
try {
    npm run build
} finally {
    Pop-Location
}

$targets = if ($Target -eq "all") { @("vscode", "claude", "codex", "forgewire") } else { @($Target) }

foreach ($item in $targets) {
    if ($item -eq "vscode") {
        $path = Join-Path $HOME "AppData\Roaming\Code\User\mcp.json"
        $body = @{ '$schema' = "https://aka.ms/vscode-mcp-schema"; servers = @{ "forgelink-human" = (Json-Config "vscode-copilot") } } | ConvertTo-Json -Depth 8
        Write-ConfigFile $path $body
    }
    if ($item -eq "claude") {
        $path = Join-Path $HOME ".claude\mcp\forgelink-human.json"
        $body = @{ mcpServers = @{ "forgelink-human" = (Json-Config "claude-code") } } | ConvertTo-Json -Depth 8
        Write-ConfigFile $path $body
    }
    if ($item -eq "codex") {
        $path = Join-Path $HOME ".codex\mcp\forgelink-human.toml"
        $server = Join-Path $RepoRoot "mcp\forgelink-human\dist\server.js"
        $body = @"
[mcp_servers.forgelink-human]
command = "node"
args = ["$($server.Replace('\', '\\'))"]

[mcp_servers.forgelink-human.env]
FORGELINK_BASE_URL = "$BaseUrl"
FORGELINK_API_TOKEN_FILE = "$($TokenFile.Replace('\', '\\'))"
FORGELINK_CHANNEL_ID = "$ChannelId"
FORGELINK_SOURCE = "codex"
"@
        Write-ConfigFile $path $body
    }
    if ($item -eq "forgewire") {
        $path = Join-Path $HOME ".forgewire\mcp\forgelink-human.json"
        $body = @{ servers = @{ "forgelink-human" = (Json-Config "forgewire-fabric") } } | ConvertTo-Json -Depth 8
        Write-ConfigFile $path $body
    }
}
