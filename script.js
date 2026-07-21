const dateSelect = document.getElementById('dateSelect');
const countrySelect = document.getElementById('countrySelect');
const mediaTypeSelect = document.getElementById('mediaTypeSelect');
const feedSelect = document.getElementById('feedSelect');
const appGrid = document.getElementById('appGrid');
const appModal = document.getElementById('appModal');
const modalBody = document.getElementById('modalBody');
const closeModalBtn = document.querySelector('.close-modal');
const jsonListButton = document.getElementById('jsonListButton');
const themeToggle = document.getElementById('themeToggle');
const CURATED_SOURCE = '@lists';
const CURATED_LIST_PATHS = [
    'lists/apple-apps.json',
    'lists/ai-apps.json',
    'lists/china-ai-apps.json',
    'lists/google-apps.json',
    'lists/microsoft-apps.json'
];

let allFiles = [];
let curatedLists = [];
let availableDates = new Set();
let availableCountries = new Set();
let availableMediaTypes = new Set();
let availableFeeds = new Set();

// Cache for app details to avoid re-fetching
const appDetailsCache = {};

const systemThemePreference = window.matchMedia('(prefers-color-scheme: dark)');

function hashArtworkUrl(url) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < url.length; index += 1) {
        hash ^= url.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function getVersionedLogoPath(id, artworkUrl) {
    return artworkUrl ? `logos/${id}-${hashArtworkUrl(artworkUrl)}.png` : `logos/${id}.png`;
}

function setImageFallbacks(image, fallbackUrls) {
    const initialUrl = image.getAttribute('src');
    const urls = [...new Set(fallbackUrls.filter(url => url && url !== initialUrl))];
    let nextUrl = 0;

    image.addEventListener('error', () => {
        if (nextUrl >= urls.length) return;
        image.src = urls[nextUrl];
        nextUrl += 1;
    });
}

function getSavedTheme() {
    try {
        const theme = localStorage.getItem('theme');
        return theme === 'light' || theme === 'dark' ? theme : null;
    } catch {
        return null;
    }
}

function updateThemeToggle() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    themeToggle.setAttribute('aria-label', label);
    themeToggle.title = label;
    themeToggle.innerHTML = isDark
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2z"></path></svg>';
}

themeToggle.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
        localStorage.setItem('theme', theme);
    } catch {
        // The current page still switches even when persistence is unavailable.
    }
    updateThemeToggle();
});

systemThemePreference.addEventListener('change', event => {
    if (getSavedTheme()) return;
    document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
    updateThemeToggle();
});

updateThemeToggle();

// Close modal events
closeModalBtn.onclick = () => appModal.style.display = "none";
window.onclick = (event) => {
    if (event.target == appModal) {
        appModal.style.display = "none";
    }
}

function fetchJson(path) {
    return fetch(path).then(response => {
        if (!response.ok) throw new Error(`Failed to load ${path}`);
        return response.json();
    });
}

// Fetch the ranking archive and manually maintained curated lists.
Promise.all([
    fetchJson('rankings.json'),
    Promise.all(CURATED_LIST_PATHS.map(path => (
        fetchJson(path).then(data => ({ ...(data.feed || data), path }))
    )))
])
    .then(([files, lists]) => {
        allFiles = files;
        curatedLists = lists;
        processFiles();
        populateDropdowns();
        jsonListButton.disabled = !allFiles.some(file => file.parsed);
        
        // Auto-select most recent if available
        const newestDate = Array.from(availableDates).sort().reverse()[0];
        if (newestDate) {
            dateSelect.value = newestDate;
            updateAvailableOptions();
            // Try to set defaults if available
            if (countrySelect.options.length > 1) countrySelect.selectedIndex = 1;
            updateAvailableOptions(); // Update downstream
            if (mediaTypeSelect.options.length > 1) mediaTypeSelect.selectedIndex = 1;
            updateAvailableOptions(); // Update downstream
            if (feedSelect.options.length > 1) feedSelect.selectedIndex = 1;
            
            loadRankings();
        }
    })
    .catch(err => {
        appGrid.innerHTML = `<div class="error">Unable to load data.<br>Ensure rankings.json exists.</div>`;
        console.error(err);
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
    if (curatedLists.length > 0) {
        const listGroup = document.createElement('optgroup');
        listGroup.label = 'Lists';
        const option = document.createElement('option');
        option.value = CURATED_SOURCE;
        option.textContent = 'Curated Lists';
        listGroup.appendChild(option);
        dateSelect.appendChild(listGroup);
    }

    const archiveGroup = document.createElement('optgroup');
    archiveGroup.label = 'Archives';
    const sortedDates = Array.from(availableDates).sort().reverse();
    sortedDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = formatDate(date);
        archiveGroup.appendChild(option);
    });
    dateSelect.appendChild(archiveGroup);
}

function formatDate(dateStr) {
    if (dateStr.length === 8) {
        // YYYYMMDD -> MM/DD/YYYY or similar
        return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }
    return dateStr;
}

function updateCuratedOptions({ loadIfComplete = true } = {}) {
    const currentFeed = feedSelect.value;
    const listIds = new Set(curatedLists.map(list => list.id));
    const selectedList = curatedLists.find(list => list.id === currentFeed)
        || curatedLists[0];
    const country = selectedList?.country || 'us';

    countrySelect.innerHTML = `<option value="${escapeHtml(country)}">${escapeHtml(country.toUpperCase())} Metadata</option>`;
    countrySelect.value = country;
    countrySelect.disabled = true;

    mediaTypeSelect.innerHTML = '<option value="apps">Apps</option>';
    mediaTypeSelect.value = 'apps';
    mediaTypeSelect.disabled = true;

    feedSelect.innerHTML = '<option value="" disabled>List</option>';
    curatedLists.forEach(list => {
        const option = document.createElement('option');
        option.value = list.id;
        option.textContent = list.title || formatLabel(list.id);
        feedSelect.appendChild(option);
    });

    if (listIds.has(currentFeed)) feedSelect.value = currentFeed;
    else if (selectedList) feedSelect.value = selectedList.id;
    else feedSelect.selectedIndex = -1;

    if (loadIfComplete && feedSelect.value) loadRankings();
}

function updateAvailableOptions({ selectFirstFeed = false, loadIfComplete = true } = {}) {
    const selectedDate = dateSelect.value;
    const currentCountry = countrySelect.value;
    const currentMediaType = mediaTypeSelect.value;
    const currentFeed = feedSelect.value;

    if (selectedDate === CURATED_SOURCE) {
        updateCuratedOptions({ loadIfComplete });
        return;
    }

    countrySelect.disabled = false;
    mediaTypeSelect.disabled = false;

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

    if (selectFirstFeed && sortedFeeds.length > 0) {
        feedSelect.value = sortedFeeds[0];
    } else if (availableFeeds.has(currentFeed)) {
        feedSelect.value = currentFeed;
    } else {
        feedSelect.selectedIndex = -1;
    }

    // If we still have a valid selection for everything, load it
    if (loadIfComplete && dateSelect.value && countrySelect.value && mediaTypeSelect.value && feedSelect.value) {
        loadRankings();
    }
}

dateSelect.addEventListener('change', () => {
    updateAvailableOptions({ selectFirstFeed: true });
});

countrySelect.addEventListener('change', () => {
    updateAvailableOptions();
});

mediaTypeSelect.addEventListener('change', () => {
    updateAvailableOptions({ selectFirstFeed: true });
});

feedSelect.addEventListener('change', () => {
    if (dateSelect.value === CURATED_SOURCE) updateCuratedOptions();
    else loadRankings();
});

jsonListButton.addEventListener('click', showJsonFileList);

function formatLabel(value) {
    return String(value || '')
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

function renderMediaIcon(mediaType) {
    const iconIds = {
        apps: 'media-icon-apps',
        music: 'media-icon-music',
        podcasts: 'media-icon-podcasts',
        books: 'media-icon-books',
        'audio-books': 'media-icon-audio-books'
    };
    const iconId = iconIds[mediaType] || 'media-icon-file';
    return `<svg viewBox="0 0 24 24"><use href="#${iconId}"></use></svg>`;
}

function formatCountryName(country) {
    const names = {
        us: 'United States',
        cn: 'China',
        jp: 'Japan',
        gb: 'United Kingdom',
        de: 'Germany',
        fr: 'France'
    };
    return names[country] || country.toUpperCase();
}

function renderJsonFileCard(file, date, selected) {
    const { country, mediaType, feed } = file.parsed;
    const isCurrent = date === selected.date
        && country === selected.country
        && mediaType === selected.mediaType
        && feed === selected.feed;
    const relativePath = file.RelativePath.replace(/\\/g, '/');

    return `
        <article class="json-file-card${isCurrent ? ' is-current' : ''}"
            data-date="${escapeHtml(date)}"
            data-country="${escapeHtml(country)}"
            data-media="${escapeHtml(mediaType)}"
            data-feed="${escapeHtml(feed)}"
            role="button"
            tabindex="0"
            aria-label="Switch to ${escapeHtml(country.toUpperCase())} ${escapeHtml(formatLabel(mediaType))} ${escapeHtml(formatLabel(feed))}">
            <div class="json-file-card-top">
                <span class="json-file-icon" aria-hidden="true">${renderMediaIcon(mediaType)}</span>
                <div class="json-file-identity">
                    <div class="json-file-title-row">
                        <strong>${escapeHtml(formatLabel(mediaType))}</strong>
                        ${isCurrent ? '<span class="json-current-badge">Current</span>' : ''}
                    </div>
                    <span class="json-feed-name">${escapeHtml(formatLabel(feed))}</span>
                </div>
                <span class="json-open-icon" aria-hidden="true">→</span>
            </div>
            <div class="json-file-card-footer">
                <a class="json-file-name" href="${escapeHtml(relativePath)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(file.Name)}">${escapeHtml(file.Name)}</a>
                <span class="json-file-size">${escapeHtml(formatFileSize(file.Length))}</span>
            </div>
        </article>
    `;
}

function showJsonFileList() {
    const mediaTypeOrder = ['apps', 'music', 'podcasts', 'books', 'audio-books'];
    const files = allFiles
        .filter(file => file.parsed)
        .sort((left, right) => {
            return right.parsed.date.localeCompare(left.parsed.date)
                || left.parsed.country.localeCompare(right.parsed.country)
                || mediaTypeOrder.indexOf(left.parsed.mediaType) - mediaTypeOrder.indexOf(right.parsed.mediaType)
                || left.parsed.feed.localeCompare(right.parsed.feed);
        });

    const filesByDate = new Map();
    files.forEach(file => {
        if (!filesByDate.has(file.parsed.date)) filesByDate.set(file.parsed.date, []);
        filesByDate.get(file.parsed.date).push(file);
    });

    const selected = {
        date: dateSelect.value,
        country: countrySelect.value,
        mediaType: mediaTypeSelect.value,
        feed: feedSelect.value
    };

    const filesByYear = new Map();
    filesByDate.forEach((dateFiles, date) => {
        const year = date.substring(0, 4);
        if (!filesByYear.has(year)) filesByYear.set(year, []);
        filesByYear.get(year).push([date, dateFiles]);
    });

    const dateNavigation = Array.from(filesByYear, ([year, yearDates]) => `
        <div class="json-date-year-group">
            <strong class="json-date-year">${escapeHtml(year)}</strong>
            <div class="json-date-year-links">
                ${yearDates.map(([date, dateFiles]) => `
                    <a class="json-date-link${date === selected.date ? ' is-selected' : ''}" href="#json-date-${escapeHtml(date)}">
                        <span>${escapeHtml(formatDate(date))}</span>
                        <strong>${dateFiles.length}</strong>
                    </a>
                `).join('')}
            </div>
        </div>
    `).join('');

    const sections = Array.from(filesByDate, ([date, dateFiles]) => {
        const filesByCountry = new Map();
        dateFiles.forEach(file => {
            const country = file.parsed.country;
            if (!filesByCountry.has(country)) filesByCountry.set(country, []);
            filesByCountry.get(country).push(file);
        });

        const countrySections = Array.from(filesByCountry, ([country, countryFiles]) => `
            <div class="json-country-group">
                <div class="json-country-heading">
                    <span class="json-country-code">${escapeHtml(country.toUpperCase())}</span>
                    <strong>${escapeHtml(formatCountryName(country))}</strong>
                    <span>${countryFiles.length} files</span>
                </div>
                <div class="json-file-grid">
                    ${countryFiles.map(file => renderJsonFileCard(file, date, selected)).join('')}
                </div>
            </div>
        `).join('');

        return `
            <section id="json-date-${escapeHtml(date)}" class="json-archive-section">
                <div class="json-date-heading">
                    <h3>${escapeHtml(formatDate(date))}</h3>
                    <span>${dateFiles.length} files</span>
                </div>
                ${countrySections}
            </section>
        `;
    }).join('');

    modalBody.innerHTML = `
        <div class="json-list-header">
            <span class="json-list-eyebrow">Rankings index</span>
            <h2>JSON Files</h2>
            <p>${files.length} archived ranking files. Select a card to open its raw JSON data.</p>
        </div>
        <nav class="json-date-nav" aria-label="Archive dates">
            <div class="json-date-nav-summary">
                <strong>Archive dates</strong>
            </div>
            <div class="json-date-nav-links">
                ${dateNavigation}
            </div>
        </nav>
        <div class="json-list-content">
            ${sections || '<div class="error">No JSON files are available.</div>'}
        </div>
    `;
    modalBody.querySelectorAll('.json-file-card').forEach(card => {
        const selectCard = () => selectRankingFile(card.dataset);
        card.addEventListener('click', event => {
            if (!event.target.closest('.json-file-name')) selectCard();
        });
        card.addEventListener('keydown', event => {
            if (event.target.closest('.json-file-name')) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectCard();
            }
        });
    });
    appModal.classList.add('json-index-modal');
    appModal.style.display = 'flex';

    const dateNav = modalBody.querySelector('.json-date-nav');
    const updateDateAnchorOffset = () => {
        modalBody.style.setProperty('--json-date-nav-offset', `${dateNav.offsetHeight + 12}px`);
    };
    updateDateAnchorOffset();
    modalBody.querySelectorAll('.json-date-link').forEach(link => {
        link.addEventListener('click', updateDateAnchorOffset);
    });
}

function selectRankingFile({ date, country, media, feed }) {
    dateSelect.value = date;
    updateAvailableOptions({ loadIfComplete: false });

    countrySelect.value = country;
    updateAvailableOptions({ loadIfComplete: false });

    mediaTypeSelect.value = media;
    updateAvailableOptions({ loadIfComplete: false });

    feedSelect.value = feed;
    appModal.style.display = 'none';
    loadRankings();
}

function loadRankings() {
    const date = dateSelect.value;
    const country = countrySelect.value;
    const mediaType = mediaTypeSelect.value;
    const feed = feedSelect.value;

    if (!date || !country || !mediaType || !feed) return;

    if (date === CURATED_SOURCE) {
        loadCuratedApps(feed);
        return;
    }

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
}

async function getAppDetails(appId) {
    if (Object.prototype.hasOwnProperty.call(appDetailsCache, appId)) {
        return appDetailsCache[appId];
    }

    let details = null;
    try {
        const data = await fetchJson(`details/${appId}.json`);
        if (data.resultCount > 0) details = data.results[0];
    } catch {
        // Some media types are not returned by the iTunes lookup endpoint.
    }
    appDetailsCache[appId] = details;
    return details;
}

function createCuratedApp(id, details) {
    return {
        id: String(details?.trackId || id),
        name: details?.trackName || `App ${id}`,
        artistName: details?.artistName || details?.sellerName || '',
        artworkUrl100: details?.artworkUrl100 || '',
        artworkUrl60: details?.artworkUrl60 || '',
        kind: 'apps',
        url: details?.trackViewUrl || '',
        genres: details?.genres || [],
        releaseDate: details?.releaseDate || ''
    };
}

async function loadCuratedApps(listId) {
    const list = curatedLists.find(candidate => candidate.id === listId);
    if (!list) {
        appGrid.innerHTML = '<div class="error">Curated list not found.</div>';
        return;
    }

    appGrid.innerHTML = '<div class="loading">Loading curated apps...</div>';
    let apps;
    if (list.results) {
        apps = list.results;
    } else {
        apps = await Promise.all((list.ids || []).map(async value => {
            const id = String(value);
            return createCuratedApp(id, await getAppDetails(id));
        }));
    }
    renderApps(apps, { collection: list });
}

function renderApps(apps, { collection = null } = {}) {
    appGrid.innerHTML = '';

    if (collection) {
        const header = document.createElement('section');
        header.className = 'collection-header';
        header.innerHTML = `
            <span class="collection-eyebrow">Curated List</span>
            <h2>${escapeHtml(collection.title || formatLabel(collection.id))}</h2>
            <p>${escapeHtml(collection.description || '')}</p>
            <div class="collection-meta">${apps.length} Apps · ${escapeHtml((collection.country || 'us').toUpperCase())} metadata</div>
        `;
        appGrid.appendChild(header);
    }

    apps.forEach((app, index) => {
        const item = document.createElement('div');
        item.className = `app-item${collection ? ' curated-app-item' : ''}`;
        item.onclick = () => showAppDetails(app.id, app); // Pass basic app info as backup

        const localLogoPath = `logos/${app.id}.png`;
        const artworkUrl = app.artworkUrl100 || app.artworkUrl60 || '';
        const name = app.name || `App ${app.id}`;
        const artistName = app.artistName || '';
        
        item.innerHTML = `
            <img src="${escapeHtml(localLogoPath)}" alt="${escapeHtml(name)}" class="app-logo">
            <div class="app-info">
                <div class="app-header">
                    ${collection ? '' : `<span class="app-rank">${index + 1}</span>`}
                    <span class="app-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                </div>
                <div class="app-meta" title="${escapeHtml(artistName)}">
                    ${escapeHtml(artistName)}
                </div>
            </div>
        `;

        setImageFallbacks(item.querySelector('.app-logo'), [artworkUrl]);
        appGrid.appendChild(item);
    });
}

async function showAppDetails(appId, basicAppInfo) {
    appModal.classList.remove('json-index-modal');
    modalBody.innerHTML = '<div class="loading">Loading details...</div>';
    appModal.style.display = "flex";

    renderModalContent(await getAppDetails(appId), appId, basicAppInfo);
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
    const stableLogoPath = `logos/${appId}.png`;
    const title = app.trackName || app.collectionName || basicAppInfo.name || 'Untitled';
    const subtitle = app.artistName || app.sellerName || basicAppInfo.artistName || '';
    const kind = basicAppInfo.kind || app.kind || app.collectionType?.toLowerCase() || app.wrapperType;
    const mediaType = formatMediaType(kind);
    const isSoftware = app.wrapperType === 'software' || app.kind === 'software' || kind === 'apps';
    const artworkUrl = app.artworkUrl600
        || app.artworkUrl512
        || app.artworkUrl100
        || app.artworkUrl60
        || basicAppInfo.artworkUrl100
        || basicAppInfo.artworkUrl60
        || '';
    const versionArtworkUrl = basicAppInfo.artworkUrl100
        || basicAppInfo.artworkUrl60
        || artworkUrl;
    const localLogoPath = getVersionedLogoPath(appId, versionArtworkUrl);
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
            <img src="${escapeHtml(localLogoPath)}" alt="${escapeHtml(title)}" class="modal-icon">
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

    setImageFallbacks(
        modalBody.querySelector('.modal-icon'),
        [stableLogoPath, versionArtworkUrl]
    );
}
