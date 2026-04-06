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
        
        Write-Host "Fetching: $rssUrl"
        Write-Host "Saving to: $fileName"
        
        $maxRetries = 3
        $retryCount = 0
        $success = $false
        
        while (-not $success -and $retryCount -lt $maxRetries) {
            try {
                $response = Invoke-RestMethod -Uri $rssUrl -ErrorAction Stop
                $response | ConvertTo-Json -Depth 10 | Out-File -FilePath $fileName
                Write-Host "Successfully fetched $($config.MediaType) - $($config.FileSuffix) for $country"
                $success = $true
            } catch {
                $retryCount++
                if ($retryCount -lt $maxRetries) {
                    $sleepTime = Get-Random -Minimum 2 -Maximum 4
                    Write-Warning "Attempt $retryCount failed for $rssUrl. Retrying in $sleepTime seconds... Error: $($_.Exception.Message)"
                    Start-Sleep -Seconds $sleepTime
                } else {
                    Write-Error "Failed to fetch after $maxRetries attempts: $rssUrl"
                    Write-Error "Error Message: $($_.Exception.Message)"
                    if ($_.Exception.InnerException) {
                        Write-Error "Inner Error: $($_.Exception.InnerException.Message)"
                    }
                }
            }
        }
        
        Write-Host "Sleeping for 1.5 seconds..."
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

            # Initialize with data from ranking
            $finalName = $rankingApp.name
            $finalArtworkUrl = $rankingApp.artworkUrl100
            $finalDescription = ""

            if ($SkipExisting -and (Test-Path $detailsFilePath)) {
                # Write-Host "Details for $appId already exist. Skipping."
                try {
                    $appDetails = Get-Content -Path $detailsFilePath | ConvertFrom-Json
                } catch {
                    $appDetails = $null
                }
            } else {
                $lookupUrl = "https://itunes.apple.com/lookup?id=$appId&country=$currentCountry"
                try {
                    $appDetails = Invoke-RestMethod -Uri $lookupUrl
                    $appDetails | ConvertTo-Json -Depth 10 | Out-File -FilePath $detailsFilePath
                    # Write-Host "Details for $appId saved."
                } catch {
                    Write-Host "Failed to fetch details for $appId"
                    $appDetails = $null
                }
            }

            if ($appDetails -and $appDetails.resultCount -gt 0) {
                $appInfo = $appDetails.results[0]
                
                # Fallback for name (trackName vs collectionName)
                $finalName = $appInfo.trackName
                if ([string]::IsNullOrEmpty($finalName)) { $finalName = $appInfo.collectionName }
                if ([string]::IsNullOrEmpty($finalName)) { $finalName = $appInfo.name }
                
                $finalDescription = $appInfo.description

                # Prioritize higher res artwork
                $art = $appInfo.artworkUrl600
                if ([string]::IsNullOrEmpty($art)) { $art = $appInfo.artworkUrl512 }
                if ([string]::IsNullOrEmpty($art)) { $art = $appInfo.artworkUrl100 }
                if ([string]::IsNullOrEmpty($art)) { $art = $appInfo.artworkUrl60 }
                
                if (-not [string]::IsNullOrEmpty($art)) {
                    $finalArtworkUrl = $art
                }
            } else {
                # Write-Host "Warning: No detailed info for '$finalName' ($appId)."
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
    $appName = $_.name
    $fileName = "logos\$appId.png"

    if ($SkipExisting -and (Test-Path $fileName)) {
        Write-Host "Logo for $appId already exists. Skipping."
    } else {
        if ([string]::IsNullOrEmpty($artworkUrl)) {
            Write-Host "Artwork URL is missing for app '$appName' (ID: $appId). Skipping logo download."
        } else {
            Invoke-WebRequest -Uri $artworkUrl -OutFile $fileName
            Write-Host "Logo for $appId downloaded."
        }
    }
}

Write-Host "Step 3 Complete: App logos downloaded."

# Step 4: Create Markdown files
if ($GenerateMarkdown) {
    Get-ChildItem -Path "rankings" -Recurse -Filter "*.json" | ForEach-Object {
        $rankingFile = $_.Name
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
                #$mdContent += "<a name=`"$anchor`"></a>`n"
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
} else {
    Write-Host "Step 4 Skipped: Markdown generation is disabled."
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
+ 1)
        LastWriteTime = $_.LastWriteTime
        Length = $_.Length
    }
}
$rankingFiles | ConvertTo-Json -Depth 2 | Out-File -FilePath "rankings.json"
Write-Host "Step 5 Complete: rankings file list exported to rankings.json."
