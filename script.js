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
    const currentCountry = countrySelect.value;
    const currentMediaType = mediaTypeSelect.value;
    const currentFeed = feedSelect.value;

    // 1. Update Country (depends on Date)
    availableCountries.clear();
    allFiles.forEach(file => {
        if (file.parsed && file.parsed.date === selectedDate) {
            availableCountries.add(file.parsed.country);
        }
    });
    
    countrySelect.innerHTML = '<option value="" disabled>Region</option>';
    const sortedCountries = Array.from(availableCountries).sort();
    sortedCountries.forEach(country => {
        const option = document.createElement('option');
        option.value = country;
        option.textContent = country.toUpperCase();
        countrySelect.appendChild(option);
    });
    
    // Restore selection if still valid
    if (availableCountries.has(currentCountry)) {
        countrySelect.value = currentCountry;
    } else {
        countrySelect.selectedIndex = -1; // Force user to choose if previous not valid
    }

    // 2. Update Media Type (depends on Date + Country)
    const selectedCountry = countrySelect.value;
    availableMediaTypes.clear();
    if (selectedCountry) {
        allFiles.forEach(file => {
            if (file.parsed && file.parsed.date === selectedDate && file.parsed.country === selectedCountry) {
                availableMediaTypes.add(file.parsed.mediaType);
            }
        });
    }
    
    mediaTypeSelect.innerHTML = '<option value="" disabled>Media Type</option>';
    const sortedMediaTypes = Array.from(availableMediaTypes).sort();
    sortedMediaTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        mediaTypeSelect.appendChild(option);
    });

    if (availableMediaTypes.has(currentMediaType)) {
        mediaTypeSelect.value = currentMediaType;
    } else {
        mediaTypeSelect.selectedIndex = -1;
    }

    // 3. Update Feed (depends on Date + Country + MediaType)
    const selectedMediaType = mediaTypeSelect.value;
    availableFeeds.clear();
    if (selectedCountry && selectedMediaType) {
        allFiles.forEach(file => {
            if (file.parsed && 
                file.parsed.date === selectedDate && 
                file.parsed.country === selectedCountry &&
                file.parsed.mediaType === selectedMediaType) {
                availableFeeds.add(file.parsed.feed);
            }
        });
    }

    feedSelect.innerHTML = '<option value="" disabled>Category</option>';
    const sortedFeeds = Array.from(availableFeeds).sort();
    sortedFeeds.forEach(feed => {
        const option = document.createElement('option');
        option.value = feed;
        option.textContent = feed.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        feedSelect.appendChild(option);
    });

    if (availableFeeds.has(currentFeed)) {
        feedSelect.value = currentFeed;
    } else {
        feedSelect.selectedIndex = -1;
    }

    updateJsonLink();
    
    // If we still have a valid selection for everything, load it
    if (dateSelect.value && countrySelect.value && mediaTypeSelect.value && feedSelect.value) {
        loadRankings();
    }
}

dateSelect.addEventListener('change', () => {
    updateAvailableOptions();
});

countrySelect.addEventListener('change', () => {
    updateAvailableOptions();
});

mediaTypeSelect.addEventListener('change', () => {
    updateAvailableOptions();
});

feedSelect.addEventListener('change', () => {
    loadRankings();
    updateJsonLink();
});

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

    let details = null;

    if (Object.prototype.hasOwnProperty.call(appDetailsCache, appId)) {
        details = appDetailsCache[appId];
    } else {
        try {
            const res = await fetch(`details/${appId}.json`);
            if (!res.ok) throw new Error('Details not found');
            const data = await res.json();
            if (data.resultCount > 0) {
                details = data.results[0];
            }
        } catch {
            // Some media types are not returned by the iTunes lookup endpoint.
            // Their RSS data still contains enough information for a useful modal.
            details = null;
        }
        appDetailsCache[appId] = details;
    }

    renderModalContent(details, appId, basicAppInfo);
}

function formatAppDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;

    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatGenres(genres) {
    if (!Array.isArray(genres)) return '';
    return genres
        .map(genre => typeof genre === 'string' ? genre : genre?.name)
        .filter(Boolean)
        .join(', ');
}

function formatMediaType(kind) {
    const labels = {
        apps: 'App',
        software: 'App',
        songs: 'Song',
        song: 'Song',
        albums: 'Album',
        album: 'Album',
        podcasts: 'Podcast',
        podcast: 'Podcast',
        books: 'Book',
        'audio-books': 'Audiobook'
    };

    return labels[kind] || kind || 'Media';
}

function formatPrice(app) {
    if (app.formattedPrice) return app.formattedPrice;

    const price = app.trackPrice ?? app.collectionPrice;
    if (price === undefined || price === null) return '';
    if (Number(price) === 0) return 'Free';

    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: app.currency || 'USD'
        }).format(price);
    } catch {
        return `${price} ${app.currency || ''}`.trim();
    }
}

function formatDuration(milliseconds) {
    if (!milliseconds) return '';
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function renderStat(label, value, sub = '') {
    return `
        <div class="stat-item">
            <div class="stat-label">${escapeHtml(label)}</div>
            <div class="stat-value">${escapeHtml(value || '-')}</div>
            ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ''}
        </div>
    `;
}

function renderInfoRows(rows) {
    return rows
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([label, value]) => `
            <div class="info-row">
                <span>${escapeHtml(label)}</span>
                <span>${escapeHtml(value)}</span>
            </div>
        `)
        .join('');
}

function renderModalContent(details, appId, basicAppInfo) {
    const app = details || {};
    const localLogoPath = `logos/${appId}.png`;
    const title = app.trackName || app.collectionName || basicAppInfo.name || 'Untitled';
    const subtitle = app.artistName || app.sellerName || basicAppInfo.artistName || '';
    const kind = basicAppInfo.kind || app.kind || app.collectionType?.toLowerCase() || app.wrapperType;
    const mediaType = formatMediaType(kind);
    const isSoftware = app.wrapperType === 'software' || app.kind === 'software' || kind === 'apps';
    const artworkUrl = app.artworkUrl600 || app.artworkUrl512 || app.artworkUrl100 || basicAppInfo.artworkUrl100 || '';
    const storeUrl = app.trackViewUrl || app.collectionViewUrl || basicAppInfo.url || '#';
    const price = formatPrice(app);
    const genres = formatGenres(app.genres) || app.primaryGenreName || formatGenres(basicAppInfo.genres);
    const releaseDate = formatAppDate(app.releaseDate || basicAppInfo.releaseDate);
    const description = app.description || app.longDescription || '';
    const sizeMB = app.fileSizeBytes ? `${(app.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : '';

    const screenshotsHtml = Array.isArray(app.screenshotUrls) && app.screenshotUrls.length > 0 ?
        `<div class="screenshots-scroll">
            ${app.screenshotUrls.map(url => `<img src="${escapeHtml(url)}" class="screenshot" loading="lazy" alt="">`).join('')}
         </div>` : '';

    let statsHtml;
    let informationRows;

    if (isSoftware) {
        const rating = Number(app.averageUserRating);
        const ratingCount = app.userRatingCountForCurrentVersion || app.userRatingCount || 0;
        statsHtml = [
            renderStat('RATING', Number.isFinite(rating) ? `${rating.toFixed(1)} ★` : '-', `${ratingCount.toLocaleString()} Ratings`),
            renderStat('AGE', app.contentAdvisoryRating || '-'),
            renderStat('CATEGORY', genres || 'App')
        ].join('');

        informationRows = [
            ['Provider', app.sellerName || subtitle],
            ['Size', sizeMB],
            ['Version', app.version],
            ['Original Release', releaseDate],
            ['Last Update', formatAppDate(app.currentVersionReleaseDate)],
            ['Compatibility', app.minimumOsVersion ? `${app.minimumOsVersion}+` : '']
        ];
    } else {
        const itemCount = app.trackCount
            ? `${app.trackCount.toLocaleString()} ${app.kind === 'podcast' ? 'Episodes' : 'Tracks'}`
            : '';
        statsHtml = [
            renderStat('TYPE', mediaType),
            renderStat('GENRE', genres || '-'),
            renderStat(app.kind === 'podcast' ? 'EPISODES' : 'RELEASED', app.kind === 'podcast' ? itemCount : releaseDate)
        ].join('');

        informationRows = [
            [mediaType === 'Book' || mediaType === 'Audiobook' ? 'Author' : 'Artist', subtitle],
            ['Album', app.collectionName && app.collectionName !== title ? app.collectionName : ''],
            ['Genre', genres],
            ['Release', releaseDate],
            ['Duration', app.kind === 'song' ? formatDuration(app.trackTimeMillis) : ''],
            [app.kind === 'podcast' ? 'Episodes' : 'Tracks', itemCount],
            ['Advisory', app.contentAdvisoryRating],
            ['Country', app.country],
            ['Copyright', app.copyright]
        ];
    }

    modalBody.innerHTML = `
        <div class="modal-header-section">
            <img src="${escapeHtml(localLogoPath)}" alt="${escapeHtml(title)}" class="modal-icon" onerror="this.src='${escapeHtml(artworkUrl)}'">
            <div class="modal-title-info">
                <h2>${escapeHtml(title)}</h2>
                <div class="modal-subtitle">${escapeHtml(subtitle)}</div>
                <a href="${escapeHtml(storeUrl)}" target="_blank" rel="noopener noreferrer" class="get-button">${escapeHtml(price || 'View on Apple')}</a>
            </div>
        </div>

        <div class="stats-row">
            ${statsHtml}
        </div>

        ${screenshotsHtml}

        ${description ? `
            <div class="modal-section">
                <p class="description">${escapeHtml(description).replace(/\n/g, '<br>')}</p>
            </div>
        ` : ''}

        <div class="modal-section">
            <h3>Information</h3>
            ${renderInfoRows(informationRows)}
        </div>
    `;
}
