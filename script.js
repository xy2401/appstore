const dateSelect = document.getElementById('dateSelect');
const countrySelect = document.getElementById('countrySelect');
const mediaTypeSelect = document.getElementById('mediaTypeSelect');
const feedSelect = document.getElementById('feedSelect');
const appGrid = document.getElementById('appGrid');
const appModal = document.getElementById('appModal');
const modalBody = document.getElementById('modalBody');
const closeModalBtn = document.querySelector('.close-modal');
const jsonLink = document.getElementById('jsonLink');

let allFiles = [];
let availableDates = new Set();
let availableCountries = new Set();
let availableMediaTypes = new Set();
let availableFeeds = new Set();

// Cache for app details to avoid re-fetching
const appDetailsCache = {};

// Close modal events
closeModalBtn.onclick = () => appModal.style.display = "none";
window.onclick = (event) => {
    if (event.target == appModal) {
        appModal.style.display = "none";
    }
}

// Fetch the file list
fetch('rankings.json')
    .then(response => {
        if (!response.ok) throw new Error('Failed to load rankings.json');
        return response.json();
    })
    .then(files => {
        allFiles = files;
        processFiles();
        populateDropdowns();
        
        // Auto-select most recent if available
        if (dateSelect.options.length > 1) {
            dateSelect.selectedIndex = 1;
            updateAvailableOptions();
            // Try to set defaults if available
            if (countrySelect.options.length > 1) countrySelect.selectedIndex = 1;
            updateAvailableOptions(); // Update downstream
            if (mediaTypeSelect.options.length > 1) mediaTypeSelect.selectedIndex = 1;
            updateAvailableOptions(); // Update downstream
            if (feedSelect.options.length > 1) feedSelect.selectedIndex = 1;
            
            loadRankings();
        }
        updateJsonLink(); // Initial update after loading data
    })
    .catch(err => {
        appGrid.innerHTML = `<div class="error">Unable to load data.<br>Ensure rankings.json exists.</div>`;
        console.error(err);
        updateJsonLink(); // Also update if error
    });

function processFiles() {
    allFiles.forEach(file => {
        // Supports both slash types
        const parts = file.RelativePath.split(/[/\\]/);
        if (parts.length >= 3) {
            const date = parts[1];
            const filename = parts[parts.length - 1];
            const nameParts = filename.replace('.json', '').split('_');
            
            if (nameParts.length >= 3) {
                const country = nameParts[0];
                const mediaType = nameParts[1];
                const feed = nameParts.slice(2).join('_'); // Join rest in case feed has underscores (though we use hyphens)
                
                file.parsed = { date, country, mediaType, feed };
                availableDates.add(date);
            }
        }
    });
}

function populateDropdowns() {
    const sortedDates = Array.from(availableDates).sort().reverse();
    sortedDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = formatDate(date);
        dateSelect.appendChild(option);
    });
}

function formatDate(dateStr) {
    if (dateStr.length === 8) {
        // YYYYMMDD -> MM/DD/YYYY or similar
        return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }
    return dateStr;
}

function updateAvailableOptions() {
    const selectedDate = dateSelect.value;
    const selectedCountry = countrySelect.value;
    const selectedMediaType = mediaTypeSelect.value;
    
    // Save current selections to try and preserve them
    const currentCountry = countrySelect.value;
    const currentMediaType = mediaTypeSelect.value;
    const currentFeed = feedSelect.value;

    // Reset inner HTML only for downstream dropdowns or if we need to refresh
    // We do this carefully to avoid resetting the user's current selection if it's still valid
    
    // 1. Update Country (depends on Date)
    if (!selectedCountry || countrySelect.options.length <= 1) {
         availableCountries.clear();
         allFiles.forEach(file => {
            if (file.parsed && file.parsed.date === selectedDate) {
                availableCountries.add(file.parsed.country);
            }
         });
         
         countrySelect.innerHTML = '<option value="" disabled selected>Region</option>';
         Array.from(availableCountries).sort().forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country.toUpperCase();
            countrySelect.appendChild(option);
         });
         if (Array.from(availableCountries).includes(currentCountry)) countrySelect.value = currentCountry;
    }

    // 2. Update Media Type (depends on Date + Country)
    availableMediaTypes.clear();
    allFiles.forEach(file => {
        if (file.parsed && file.parsed.date === selectedDate && (!countrySelect.value || file.parsed.country === countrySelect.value)) {
            availableMediaTypes.add(file.parsed.mediaType);
        }
    });
    
    mediaTypeSelect.innerHTML = '<option value="" disabled selected>Media Type</option>';
    Array.from(availableMediaTypes).sort().forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        mediaTypeSelect.appendChild(option);
    });
    if (Array.from(availableMediaTypes).includes(currentMediaType)) mediaTypeSelect.value = currentMediaType;

    // 3. Update Feed (depends on Date + Country + MediaType)
    availableFeeds.clear();
    allFiles.forEach(file => {
        if (file.parsed && 
            file.parsed.date === selectedDate && 
            (!countrySelect.value || file.parsed.country === countrySelect.value) &&
            (!mediaTypeSelect.value || file.parsed.mediaType === mediaTypeSelect.value)) {
            availableFeeds.add(file.parsed.feed);
        }
    });

    feedSelect.innerHTML = '<option value="" disabled selected>Category</option>';
    Array.from(availableFeeds).sort().forEach(feed => {
        const option = document.createElement('option');
        option.value = feed;
        option.textContent = feed.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        feedSelect.appendChild(option);
    });
    if (Array.from(availableFeeds).includes(currentFeed)) feedSelect.value = currentFeed;

    updateJsonLink(); // Update link after dropdowns change
}

dateSelect.addEventListener('change', () => {
    countrySelect.selectedIndex = 0;
    mediaTypeSelect.selectedIndex = 0;
    feedSelect.selectedIndex = 0;
    updateAvailableOptions();
    appGrid.innerHTML = '<div class="loading">Select Region, Media Type, and Category</div>';
    updateJsonLink();
});

countrySelect.addEventListener('change', () => {
    mediaTypeSelect.selectedIndex = 0;
    feedSelect.selectedIndex = 0;
    updateAvailableOptions();
    updateJsonLink();
});

mediaTypeSelect.addEventListener('change', () => {
    feedSelect.selectedIndex = 0;
    updateAvailableOptions();
    updateJsonLink();
});

feedSelect.addEventListener('change', loadRankings);
feedSelect.addEventListener('change', updateJsonLink); // Update link on feed change

function updateJsonLink() {
    const date = dateSelect.value;
    const country = countrySelect.value;
    const mediaType = mediaTypeSelect.value;
    const feed = feedSelect.value;

    if (date && country && mediaType && feed) {
        const file = allFiles.find(f => 
            f.parsed && 
            f.parsed.date === date && 
            f.parsed.country === country && 
            f.parsed.mediaType === mediaType &&
            f.parsed.feed === feed
        );

        if (file) {
            const fetchPath = file.RelativePath.replace(/\\/g, '/');
            jsonLink.href = fetchPath;
            jsonLink.style.display = 'inline-block';
        } else {
            jsonLink.style.display = 'none';
            jsonLink.href = '#';
        }
    } else {
        jsonLink.style.display = 'none';
        jsonLink.href = '#';
    }
}

function loadRankings() {
    const date = dateSelect.value;
    const country = countrySelect.value;
    const mediaType = mediaTypeSelect.value;
    const feed = feedSelect.value;

    if (!date || !country || !mediaType || !feed) return;

    appGrid.innerHTML = '<div class="loading">Loading charts...</div>';

    const file = allFiles.find(f => 
        f.parsed && 
        f.parsed.date === date && 
        f.parsed.country === country && 
        f.parsed.mediaType === mediaType &&
        f.parsed.feed === feed
    );

    if (!file) {
        appGrid.innerHTML = '<div class="error">Data file not found.</div>';
        return;
    }

    const fetchPath = file.RelativePath.replace(/\\/g, '/');

    fetch(fetchPath)
        .then(res => res.json())
        .then(data => {
            if (data.feed && data.feed.results) {
                renderApps(data.feed.results);
            } else {
                throw new Error("Invalid data format");
            }
        })
        .catch(err => {
            appGrid.innerHTML = `<div class="error">Error loading rankings: ${err.message}</div>`;
        });
    updateJsonLink(); // Also update json link after loading rankings
}

function renderApps(apps) {
    appGrid.innerHTML = '';
    
    apps.forEach((app, index) => {
        const item = document.createElement('div');
        item.className = 'app-item';
        // Stagger animation
        item.style.animationDelay = `${index * 0.03}s`;
        item.onclick = () => showAppDetails(app.id, app); // Pass basic app info as backup
        
        const localLogoPath = `logos/${app.id}.png`;
        
        item.innerHTML = `
            <img src="${localLogoPath}" alt="${app.name}" class="app-logo" onerror="this.src='${app.artworkUrl100}'">
            <div class="app-info">
                <div class="app-header">
                    <span class="app-rank">${index + 1}</span>
                    <span class="app-name" title="${app.name}">${app.name}</span>
                </div>
                <div class="app-meta" title="${app.artistName}">
                    ${app.artistName}
                </div>
            </div>
        `;
        
        appGrid.appendChild(item);
    });
}

async function showAppDetails(appId, basicAppInfo) {
    modalBody.innerHTML = '<div class="loading">Loading details...</div>';
    appModal.style.display = "flex";

    try {
        let details;
        if (appDetailsCache[appId]) {
            details = appDetailsCache[appId];
        } else {
            const res = await fetch(`details/${appId}.json`);
            if (!res.ok) throw new Error('Details not found');
            const data = await res.json();
            if (data.resultCount > 0) {
                details = data.results[0];
                appDetailsCache[appId] = details;
            } else {
                throw new Error('Empty details');
            }
        }
        renderModalContent(details, appId);
    } catch (err) {
        // Fallback to basic info if fetch fails
        console.warn("Fetching details failed, using basic info:", err);
        renderModalFallback(basicAppInfo, appId);
    }
}

// Helper to format date strings
function formatAppDate(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch {
        return dateString; // Return as is if parsing fails
    }
}

function renderModalContent(app, appId) {
    const localLogoPath = `logos/${appId}.png`;
    const sizeMB = (app.fileSizeBytes / 1024 / 1024).toFixed(1) + ' MB';
    
    const screenshotsHtml = app.screenshotUrls ? 
        `<div class="screenshots-scroll">
            ${app.screenshotUrls.map(url => `<img src="${url}" class="screenshot" loading="lazy">`).join('')}
         </div>` : '';

    modalBody.innerHTML = `
        <div class="modal-header-section">
            <img src="${localLogoPath}" class="modal-icon" onerror="this.src='${app.artworkUrl512 || app.artworkUrl100}'">
            <div class="modal-title-info">
                <h2>${app.trackName}</h2>
                <div class="modal-subtitle">${app.artistName}</div>
                <a href="${app.trackViewUrl}" target="_blank" class="get-button">${app.formattedPrice || 'Get'}</a>
            </div>
        </div>

        <div class="stats-row">
            <div class="stat-item">
                <div class="stat-label">RATING</div>
                <div class="stat-value">${app.averageUserRating ? app.averageUserRating.toFixed(1) : '-'} ★</div>
                <div class="stat-sub">${app.userRatingCountForCurrentVersion || app.userRatingCount || 0} Ratings</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">AGE</div>
                <div class="stat-value">${app.contentAdvisoryRating}</div>
                <div class="stat-sub">Years Old</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">CATEGORY</div>
                <div class="stat-value">${app.primaryGenreName || 'App'}</div>
            </div>
        </div>

        ${screenshotsHtml}

        <div class="modal-section">
            <p class="description">${app.description.replace(/\n/g, '<br>')}</p>
        </div>

        <div class="modal-section">
            <h3>Information</h3>
            <div class="info-row"><span>Provider</span> <span>${app.sellerName}</span></div>
            <div class="info-row"><span>Size</span> <span>${sizeMB}</span></div>
            <div class="info-row"><span>Version</span> <span>${app.version}</span></div>
            <div class="info-row"><span>Original Release</span> <span>${formatAppDate(app.releaseDate)}</span></div>
            <div class="info-row"><span>Last Update</span> <span>${formatAppDate(app.currentVersionReleaseDate)}</span></div>
            <div class="info-row"><span>Compatibility</span> <span>${app.minimumOsVersion}+</span></div>
        </div>
    `;
}

function renderModalFallback(app, appId) {
    const localLogoPath = `logos/${appId}.png`;
    modalBody.innerHTML = `
        <div class="modal-header-section">
            <img src="${localLogoPath}" class="modal-icon" onerror="this.src='${app.artworkUrl100}'">
            <div class="modal-title-info">
                <h2>${app.name}</h2>
                <div class="modal-subtitle">${app.artistName}</div>
                <a href="${app.url}" target="_blank" class="get-button">View on App Store</a>
            </div>
        </div>
        <div class="modal-section">
            <p class="description">Detailed information is currently unavailable for this app.</p>
        </div>
    `;
}
