param (
    [switch]$SkipExisting = $false,
    [switch]$GenerateMarkdown = $false,
    [int]$Limit = 100
)

function ConvertTo-AnchorLink {
    param (
        [string]$Text
    )
    $specialChars = @(':', '&', ' ', '.', '+', '.')
    $anchor = $Text.ToLower()
    foreach ($char in $specialChars) {
        $anchor = $anchor.Replace($char, '_')
    }
    return $anchor
}

function Invoke-DownloadWithRetry {
    param (
        [string]$Url,
        [string]$SavePath,
        [int]$MaxRetries = 3,
        [string]$Type = "Binary", # "Binary" or "Json"
        [bool]$SkipExisting = $false
    )

    if ($SkipExisting -and (Test-Path $SavePath)) {
        Write-Host "File already exists. Skipping download: $SavePath"
        if ($Type -eq "Json") {
            try { return Get-Content -Path $SavePath | ConvertFrom-Json } catch { return $null }
        }
        return $null
    }

    $retryCount = 0
    $success = $false
    $result = $null

    Write-Host "Fetching ($Type): $Url"
    Write-Host "Saving to: $SavePath"

    while (-not $success -and $retryCount -lt $MaxRetries) {
        try {
            if ($Type -eq "Json") {
                $result = Invoke-RestMethod -Uri $Url -ErrorAction Stop
                $result | ConvertTo-Json -Depth 10 | Out-File -FilePath $SavePath
            } else {
                Invoke-WebRequest -Uri $Url -OutFile $SavePath -ErrorAction Stop
            }
            $success = $true
            Write-Host "Successfully downloaded."
        } catch {
            $retryCount++
            if ($retryCount -lt $MaxRetries) {
                $sleepTime = Get-Random -Minimum 2 -Maximum 4
                Write-Warning "Attempt $retryCount failed for $Url. Retrying in $sleepTime seconds... Error: $($_.Exception.Message)"
                Start-Sleep -Seconds $sleepTime
            } else {
                Write-Warning "Failed to download $Url after $MaxRetries attempts. Error: $($_.Exception.Message)"
                if ($_.Exception.InnerException) {
                    Write-Warning "Inner Error: $($_.Exception.InnerException.Message)"
                }
            }
        }
    }
    return $result
}

# Step 1: Fetch rankings from Apple Store RSS feed
$countries = @("us", "cn", "jp")
$feedConfigs = @(
    [PSCustomObject]@{ MediaType = "apps";        FeedType = "top-free";    Resource = "apps";        FileSuffix = "top-free" }
    [PSCustomObject]@{ MediaType = "apps";        FeedType = "top-paid";    Resource = "apps";        FileSuffix = "top-paid" }
    [PSCustomObject]@{ MediaType = "music";       FeedType = "most-played"; Resource = "songs";       FileSuffix = "top-songs" }
    [PSCustomObject]@{ MediaType = "music";       FeedType = "most-played"; Resource = "albums";      FileSuffix = "top-albums" }
    [PSCustomObject]@{ MediaType = "podcasts";    FeedType = "top";         Resource = "podcasts";    FileSuffix = "top-podcasts" }
    [PSCustomObject]@{ MediaType = "books";       FeedType = "top-free";    Resource = "books";       FileSuffix = "top-free" }
    [PSCustomObject]@{ MediaType = "books";       FeedType = "top-paid";    Resource = "books";       FileSuffix = "top-paid" }
    [PSCustomObject]@{ MediaType = "audio-books"; FeedType = "top";         Resource = "audio-books"; FileSuffix = "top-audio-books" }
)
$date = Get-Date -Format "yyyyMMdd"
$outputDir = "rankings\$date"

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

foreach ($country in $countries) {
    foreach ($config in $feedConfigs) {
        $rssUrl = "https://rss.marketingtools.apple.com/api/v2/$country/$($config.MediaType)/$($config.FeedType)/$Limit/$($config.Resource).json"
        $fileName = "$outputDir\${country}_$($config.MediaType)_$($config.FileSuffix).json"
        
        Invoke-DownloadWithRetry -Url $rssUrl -SavePath $fileName -Type "Json" -SkipExisting $SkipExisting | Out-Null
        Start-Sleep -Seconds 1.5
    }
}

Write-Host "Step 1 Complete: All rankings fetched and saved."

# Step 2: Get app details
$allAppDetails = @()
Get-ChildItem -Path $outputDir -Filter "*.json" | ForEach-Object {
    $currentCountry = $_.Name.Split('_')[0]
    $appRankings = Get-Content -Path $_.FullName | ConvertFrom-Json
    
    if ($appRankings.feed.results) {
        $appRankings.feed.results | ForEach-Object {
            $rankingApp = $_
            $appId = $rankingApp.id
            $detailsFilePath = "details\$appId.json"

            # Initialize defaults from ranking
            $finalName = $rankingApp.name
            $finalArtworkUrl = $rankingApp.artworkUrl100
            $finalDescription = ""

            $lookupUrl = "https://itunes.apple.com/lookup?id=$appId&country=$currentCountry"
            $appDetails = Invoke-DownloadWithRetry -Url $lookupUrl -SavePath $detailsFilePath -Type "Json" -SkipExisting $SkipExisting
            
            if ($appDetails -and $appDetails.resultCount -gt 0) {
                $appInfo = $appDetails.results[0]
                $finalName = if ($appInfo.trackName) { $appInfo.trackName } elseif ($appInfo.collectionName) { $appInfo.collectionName } else { $appInfo.name }
                $finalDescription = $appInfo.description

                $art = if ($appInfo.artworkUrl600) { $appInfo.artworkUrl600 } elseif ($appInfo.artworkUrl512) { $appInfo.artworkUrl512 } elseif ($appInfo.artworkUrl100) { $appInfo.artworkUrl100 } else { $appInfo.artworkUrl60 }
                if ($art) { $finalArtworkUrl = $art }
            }
            
            if (-not (Test-Path $detailsFilePath)) {
                Start-Sleep -Seconds 1 # Only sleep if we actually performed a download
            }

            $allAppDetails += [PSCustomObject]@{
                id = $appId
                name = $finalName
                description = $finalDescription
                artworkUrl = $finalArtworkUrl
            }
        }
    }
}

Write-Host "Step 2 Complete: App details fetched and saved."

# Step 3: Download app logos
$allAppDetails | ForEach-Object {
    $artworkUrl = $_.artworkUrl
    $appId = $_.id
    $fileName = "logos\$appId.png"

    if (-not [string]::IsNullOrEmpty($artworkUrl)) {
        $logoResult = Invoke-DownloadWithRetry -Url $artworkUrl -SavePath $fileName -Type "Binary" -SkipExisting $SkipExisting
        if ($null -ne $logoResult) { Start-Sleep -Milliseconds 500 }
    }
}

Write-Host "Step 3 Complete: App logos downloaded."

# Step 4: Create Markdown files
if ($GenerateMarkdown) {
    Get-ChildItem -Path "rankings" -Recurse -Filter "*.json" | ForEach-Object {
        $mdFileName = $_.FullName -replace '.json$', '.md'
        $toc = ""
        $mdContent = ""

        $appRankings = Get-Content -Path $_.FullName | ConvertFrom-Json
        $appRankings.feed.results | ForEach-Object {
            $appId = $_.id
            $appInfo = $allAppDetails | Where-Object { $_.id -eq $appId } | Select-Object -First 1

            if ($appInfo) {
                $anchor = ConvertTo-AnchorLink -Text $appInfo.name
                $toc += "- [$($appInfo.name)](#$anchor)`n"
                $mdContent += "#### $($anchor)`n"
                $mdContent += "## $($appInfo.name)`n"
                $mdContent += "![$($appInfo.name)](../../logos/$($appId).png)`n`n"
                $mdContent += "$($appInfo.description)`n`n"
            }
        }

        Set-Content -Path $mdFileName -Value ($toc + "`n" + $mdContent)
        Write-Host "Markdown file $mdFileName created."
    }
    Write-Host "Step 4 Complete: Markdown files created."
}

# Step 5: Export rankings file list
$rootPath = (Get-Item .).FullName
$rankingFiles = Get-ChildItem -Path "rankings" -Recurse -File | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.Name
        RelativePath = $_.FullName.Substring($rootPath.Length + 1)
        LastWriteTime = $_.LastWriteTime
        Length = $_.Length
    }
}
$rankingFiles | ConvertTo-Json -Depth 2 | Out-File -FilePath "rankings.json"
Write-Host "Step 5 Complete: rankings file list exported to rankings.json."
