
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

# Step 1: Fetch app rankings from Apple Store RSS feed
$countries = @("us", "cn")
$feedTypes = @("top-free", "top-paid")

foreach ($country in $countries) {
    foreach ($feedType in $feedTypes) {
        $rssUrl = "https://rss.applemarketingtools.com/api/v2/$country/apps/$feedType/100/apps.json"
        $fileName = "app_rankings_${country}_${feedType}.json"
        $response = Invoke-RestMethod -Uri $rssUrl
        $response | ConvertTo-Json -Depth 10 | Out-File -FilePath $fileName
        Write-Host "App rankings fetched and saved to $fileName"
    }
}

Write-Host "Step 1 Complete: All app rankings fetched and saved."

# Step 2: Get app details
$allAppDetails = @()
Get-ChildItem -Path . -Filter "app_rankings_*.json" | ForEach-Object {
    $appRankings = Get-Content -Path $_.FullName | ConvertFrom-Json
    $appRankings.feed.results | ForEach-Object {
        $appId = $_.id
        $detailsFilePath = "app_details\$appId.json"

        if (Test-Path $detailsFilePath) {
            Write-Host "App details for $appId already exist. Skipping."
            $appDetails = Get-Content -Path $detailsFilePath | ConvertFrom-Json
        } else {
            $lookupUrl = "https://itunes.apple.com/lookup?id=$appId"
            $appDetails = Invoke-RestMethod -Uri $lookupUrl
            $appDetails | ConvertTo-Json -Depth 10 | Out-File -FilePath $detailsFilePath
            Write-Host "App details for $appId saved."
        }

        $appInfo = $appDetails.results[0]
        $allAppDetails += [PSCustomObject]@{
            id = $appInfo.trackId
            name = $appInfo.trackName
            description = $appInfo.description
            artworkUrl = $appInfo.artworkUrl512
        }
    }
}

Write-Host "Step 2 Complete: App details fetched and saved."

# Step 3: Download app logos
Get-ChildItem -Path "app_details" -Filter "*.json" | ForEach-Object {
    $appJson = Get-Content -Path $_.FullName | ConvertFrom-Json
    $artworkUrl = $appJson.results[0].artworkUrl512
    $appId = $appJson.results[0].trackId
    $fileName = "app_logos\$appId.png"

    if (Test-Path $fileName) {
        Write-Host "Logo for $appId already exists. Skipping."
    } else {
        Invoke-WebRequest -Uri $artworkUrl -OutFile $fileName
        Write-Host "Logo for $appId downloaded."
    }
}

Write-Host "Step 3 Complete: App logos downloaded."

# Step 4: Create Markdown files
Get-ChildItem -Path . -Filter "app_rankings_*.json" | ForEach-Object {
    $rankingFile = $_.Name
    $mdFileName = $rankingFile -replace '.json$', '.md'
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
            $mdContent += "![$($appInfo.name)](app_logos/$($appId).png)`n`n"
            $mdContent += "$($appInfo.description)`n`n"
        }
    }

    Set-Content -Path $mdFileName -Value ($toc + "`n" + $mdContent)
    Write-Host "Markdown file $mdFileName created."
}

Write-Host "Step 4 Complete: Markdown files created."
