// Gamma GEX Trading System - Frontend Controller

// --- App State ---
let currentSymbol = 'SPY';
let currentExpiration = 'all';
let rawExpirations = [];
let watchlist = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'TSLA', 'NVDA'];
let seenAlerts = new Set();
let screenerRawData = [];
let screenerFilteredData = [];
let screenerPage = 1;
const screenerPageSize = 10;

// Chart instances
let gexStrikeChart = null;
let vexChart = null;
let cexChart = null;
let backtestChart = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    setupTabNavigation();
    loadWatchlist();
    setupEventListeners();
    
    // Initial data load
    fetchGexData(currentSymbol, currentExpiration);
});

// --- Tab Navigation Setup ---
function setupTabNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const tabContents = document.querySelectorAll('.tab-content');

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            
            // Toggle active button
            menuItems.forEach(btn => btn.classList.remove('active'));
            item.classList.add('active');
            
            // Toggle active content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetTab) {
                    content.classList.add('active');
                }
            });

            // If tab is screener and it is empty, auto-trigger a scan
            if (targetTab === 'screener') {
                const tbody = document.querySelector('#screener-table tbody');
                if (tbody.children.length === 0) {
                    runScreener();
                }
            }
        });
    });
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Symbol Search
    document.getElementById('fetch-btn').addEventListener('click', () => {
        const symbol = document.getElementById('symbol-input').value.toUpperCase().trim();
        if (symbol) {
            currentSymbol = symbol;
            currentExpiration = 'all'; // Reset expiration filter
            fetchGexData(currentSymbol, currentExpiration);
        }
    });

    document.getElementById('symbol-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('fetch-btn').click();
        }
    });

    // Expiration Selector
    document.getElementById('expiration-select').addEventListener('change', (e) => {
        currentExpiration = e.target.value;
        fetchGexData(currentSymbol, currentExpiration);
    });

    // Refresh Button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        fetchGexData(currentSymbol, currentExpiration);
    });

    // Screener Run Button
    document.getElementById('run-screener-btn').addEventListener('click', () => {
        runScreener();
    });

    // Backtest Form Submit
    document.getElementById('backtest-form').addEventListener('submit', (e) => {
        e.preventDefault();
        runBacktest();
    });

    // Validation File Select
    document.getElementById('validation-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            document.getElementById('file-name-txt').textContent = file.name;
        }
    });

    // Validation Form Submit
    document.getElementById('upload-form').addEventListener('submit', (e) => {
        e.preventDefault();
        runValidation();
    });

    // Watchlist Manager Handlers
    document.getElementById('add-watchlist-btn').addEventListener('click', () => {
        addSymbolToWatchlist();
    });

    document.getElementById('watchlist-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addSymbolToWatchlist();
        }
    });

    // Screener Filter Change
    document.getElementById('screener-alert-filter').addEventListener('change', () => {
        if (screenerRawData.length > 0) {
            screenerPage = 1;
            filterScreenerData();
        }
    });
    
    // Screener Pagination Prev/Next
    document.getElementById('screener-prev-btn').addEventListener('click', () => {
        if (screenerPage > 1) {
            renderScreenerPage(screenerPage - 1);
        }
    });
    
    document.getElementById('screener-next-btn').addEventListener('click', () => {
        const totalPages = Math.ceil(screenerFilteredData.length / screenerPageSize) || 1;
        if (screenerPage < totalPages) {
            renderScreenerPage(screenerPage + 1);
        }
    });
}

// --- Formatter Helpers ---
const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
const formatCompact = (val) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(val);
const formatPercent = (val) => `${val.toFixed(2)}%`;

// --- Fetch GEX Profile ---
async function fetchGexData(symbol, expiration) {
    showLoadingState(true);
    
    try {
        let url = `/api/gex/${symbol}`;
        const params = [];
        if (expiration && expiration !== 'all') {
            params.push(`expiration=${expiration}`);
        }
        if (params.length > 0) {
            url += `?${params.join('&')}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Update Globals
        currentSymbol = data.symbol;
        rawExpirations = data.expirations;
        
        // Populate expirations dropdown if not filtered
        updateExpirationDropdown(data.expirations, expiration);
        
        // Populate stats banner
        updateStatsBanner(data);
        
        // Update strategy playbook
        updateStrategyPlaybook(data);
        
        // Populate strikes table
        updateStrikesTable(data.strikes);
        
        // Draw charts
        drawGexStrikeChart(data.strikes, data.current_price, data.gamma_flip, data.call_wall, data.put_wall);
        drawVexChart(data.strikes);
        drawCexChart(data.strikes);
        
        // Draw Sensitivity Bounds
        updateSensitivityDisplay(data.sensitivity, data.current_price);
        
        // Set timestamp
        document.getElementById('last-updated').textContent = `Last Sync: ${new Date().toLocaleTimeString()}`;
        
    } catch (error) {
        console.error('Failed to load GEX data:', error);
        alert(`Error loading GEX data for ${symbol}: ${error.message}`);
    } finally {
        showLoadingState(false);
    }
}

// --- UI Updates ---
function showLoadingState(isLoading) {
    const fetchBtn = document.getElementById('fetch-btn');
    if (isLoading) {
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
    } else {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Analyze';
    }
}

function updateExpirationDropdown(expirations, selectedVal) {
    const select = document.getElementById('expiration-select');
    
    // Save current selected
    const prevSelection = selectedVal || select.value;
    
    select.innerHTML = '<option value="all">All Expirations (Aggregate)</option>';
    
    expirations.forEach(exp => {
        const opt = document.createElement('option');
        opt.value = exp;
        opt.textContent = exp;
        if (exp === prevSelection) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

function updateStatsBanner(data) {
    document.getElementById('spot-price-val').textContent = formatCurrency(data.current_price);
    document.getElementById('flip-level-val').textContent = formatCurrency(data.gamma_flip);
    document.getElementById('call-wall-val').textContent = formatCurrency(data.call_wall);
    document.getElementById('put-wall-val').textContent = formatCurrency(data.put_wall);
    
    // Distance to flip
    const dist = data.distance_to_flip_pct !== undefined ? data.distance_to_flip_pct : ((data.current_price - data.gamma_flip) / data.current_price) * 100;
    const distEl = document.getElementById('flip-dist-val');
    distEl.textContent = `Distance: ${dist.toFixed(2)}%`;
    if (dist >= 0) {
        distEl.className = 'stat-sub text-green';
    } else {
        distEl.className = 'stat-sub text-red';
    }
    
    // Regime card
    const regimeEl = document.getElementById('regime-val');
    const regimeCard = document.querySelector('.regime-card');
    
    if (data.current_price >= data.gamma_flip) {
        regimeEl.textContent = 'Positive Gamma';
        regimeEl.className = 'text-green';
        regimeCard.className = 'stat-card regime-card positive-regime';
    } else {
        regimeEl.textContent = 'Negative Gamma';
        regimeEl.className = 'text-orange';
        regimeCard.className = 'stat-card regime-card negative-regime';
    }
}

function updateStrikesTable(strikes) {
    const tbody = document.querySelector('#strike-table tbody');
    tbody.innerHTML = '';
    
    // Sort descending by strike so high strikes are on top (standard option sheet format)
    const sortedStrikes = [...strikes].sort((a, b) => b.strike - a.strike);
    
    sortedStrikes.forEach(row => {
        const tr = document.createElement('tr');
        
        // Format columns
        const strike = `<td class="text-bold">${formatCurrency(row.strike)}</td>`;
        const cVol = `<td>${formatCompact(row.call_volume)}</td>`;
        const cOI = `<td>${formatCompact(row.call_openInterest)}</td>`;
        
        const cGex = `<td class="${row.call_gex_dollar >= 0 ? 'text-green' : 'text-red'}">${formatCompact(row.call_gex_dollar)}</td>`;
        const pGex = `<td class="${row.put_gex_dollar >= 0 ? 'text-green' : 'text-red'}">${formatCompact(row.put_gex_dollar)}</td>`;
        
        const netGex = `<td class="text-bold ${row.net_gex_dollar >= 0 ? 'text-green' : 'text-red'}">${formatCompact(row.net_gex_dollar)}</td>`;
        
        const pOI = `<td>${formatCompact(row.put_openInterest)}</td>`;
        const pVol = `<td>${formatCompact(row.put_volume)}</td>`;
        
        // Vol/OI format
        const ratio = row.vol_oi_ratio;
        let ratioClass = '';
        if (ratio > 1.0) ratioClass = 'text-orange text-bold';
        const volOi = `<td class="${ratioClass}">${ratio.toFixed(2)}x</td>`;
        
        tr.innerHTML = strike + cVol + cOI + cGex + pGex + netGex + pOI + pVol + volOi;
        tbody.appendChild(tr);
    });
}

// --- Chart drawing ---
function drawGexStrikeChart(strikes, spot, flip, callWall, putWall) {
    if (gexStrikeChart) {
        gexStrikeChart.destroy();
    }
    
    // Sort strikes ascending for chart line
    const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
    
    const labels = sorted.map(d => d.strike);
    const gexData = sorted.map(d => d.net_gex_dollar / 1e6); // Scale to millions for clean chart
    
    const ctx = document.getElementById('gex-strike-chart').getContext('2d');
    
    // Background bars colors: green for call dominated, red for put dominated
    const backgroundColors = gexData.map(val => val >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)');
    const borderColors = gexData.map(val => val >= 0 ? '#10b981' : '#f43f5e');

    gexStrikeChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Net GEX Exposure ($ Millions)',
                data: gexData,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `GEX: $${context.raw.toFixed(2)}M`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
                }
            }
        }
    });
}

function drawVexChart(strikes) {
    if (vexChart) {
        vexChart.destroy();
    }
    
    const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
    const labels = sorted.map(d => d.strike);
    const vexData = sorted.map(d => d.net_vex_dollar / 1e3); // Scale to thousands
    
    const ctx = document.getElementById('vex-chart').getContext('2d');
    
    vexChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Vanna (VEX) ($K / 1% IV)',
                data: vexData,
                borderColor: '#a855f7',
                borderWidth: 2,
                fill: false,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { display: false } },
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#6b7280' } }
            }
        }
    });
}

function drawCexChart(strikes) {
    if (cexChart) {
        cexChart.destroy();
    }
    
    const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
    const labels = sorted.map(d => d.strike);
    const cexData = sorted.map(d => d.net_cex_dollar / 1e3); // Scale to thousands
    
    const ctx = document.getElementById('cex-chart').getContext('2d');
    
    cexChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Charm (CEX) ($K / Day)',
                data: cexData,
                borderColor: '#6366f1',
                borderWidth: 2,
                fill: false,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { display: false } },
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#6b7280' } }
            }
        }
    });
}

function updateSensitivityDisplay(sensitivity, spot) {
    const bounds = sensitivity.confidence_bounds;
    
    document.getElementById('flip-min-val').textContent = formatCurrency(bounds.gamma_flip.min);
    document.getElementById('flip-max-val').textContent = formatCurrency(bounds.gamma_flip.max);
    document.getElementById('flip-spread-pct').textContent = `Confidence Spread: ${bounds.gamma_flip.spread_pct.toFixed(2)}% of spot`;
    
    document.getElementById('call-min-val').textContent = formatCurrency(bounds.call_wall.min);
    document.getElementById('call-max-val').textContent = formatCurrency(bounds.call_wall.max);
    
    document.getElementById('put-min-val').textContent = formatCurrency(bounds.put_wall.min);
    document.getElementById('put-max-val').textContent = formatCurrency(bounds.put_wall.max);
    
    // Update range bar fills (simple CSS width percentage)
    const flipWidth = Math.min(100, Math.max(10, bounds.gamma_flip.spread_pct * 10));
    document.getElementById('flip-range-fill').style.width = `${flipWidth}%`;
    document.getElementById('flip-range-fill').style.left = `${(100 - flipWidth)/2}%`;
}

// --- TAB 2: Market Screener ---
async function runScreener() {
    const btn = document.getElementById('run-screener-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
    
    try {
        const response = await fetch(`/api/screener?symbols=${watchlist.join(',')}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        screenerRawData = data;
        screenerPage = 1;
        
        // Process OS & window alerts for new GEX alerts
        processNewAlertsNotification(data);
        
        // Apply filter and render
        filterScreenerData();
    } catch (error) {
        console.error('Failed to run GEX screener:', error);
        alert(`Screener error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Scan Watchlist';
    }
}

// Process new alerts notification
function processNewAlertsNotification(items) {
    const newlyFiredAlerts = [];
    const isFirstScan = (seenAlerts.size === 0);
    
    // Request notification permission if default
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    items.forEach(row => {
        if (row.error) return;
        if (row.alerts && row.alerts.length > 0) {
            row.alerts.forEach(alertText => {
                const alertKey = `${row.symbol}:${alertText}`;
                if (!seenAlerts.has(alertKey)) {
                    seenAlerts.add(alertKey);
                    if (!isFirstScan) {
                        newlyFiredAlerts.push(`[${row.symbol}] ${alertText}`);
                    }
                }
            });
        }
    });
    
    if (newlyFiredAlerts.length > 0) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification("GammaGEX New Desk Alert(s) Fired", {
                body: newlyFiredAlerts.join(', '),
                silent: false
            });
        }
        setTimeout(() => {
            alert(`🚨 NEW GEX DESK ALERT(S) FIRED!\n\n${newlyFiredAlerts.join('\n')}`);
        }, 150);
    }
}

// Filter screener data based on dropdown selection
function filterScreenerData() {
    const filterType = document.getElementById('screener-alert-filter').value;
    
    screenerFilteredData = screenerRawData.filter(item => {
        if (item.error) return true; // Keep errors
        if (filterType === 'all') return true;
        
        const alerts = item.alerts || [];
        const hasAlerts = alerts.length > 0;
        
        if (filterType === 'any') return hasAlerts;
        
        const alertsText = alerts.join(' ').toLowerCase();
        
        if (filterType === 'bullish') {
            // Bullish filters: spot near put wall, bullish ovi, call volume outliers
            return alerts.some(a => {
                const al = a.toLowerCase();
                return al.includes('bullish') || al.includes('call volume') || al.includes('put wall');
            });
        }
        if (filterType === 'bearish') {
            // Bearish filters: spot near call wall, bearish ovi, put volume outliers
            return alerts.some(a => {
                const al = a.toLowerCase();
                return al.includes('bearish') || al.includes('put volume') || al.includes('call wall');
            });
        }
        if (filterType === 'flip') {
            return alertsText.includes('flip');
        }
        if (filterType === 'uoa') {
            return alertsText.includes('uoa');
        }
        if (filterType === 'wall') {
            return alertsText.includes('wall');
        }
        return true;
    });
    
    renderScreenerPage(1);
}

// Render specific page of filtered screener results
function renderScreenerPage(page) {
    screenerPage = page;
    const tbody = document.querySelector('#screener-table tbody');
    tbody.innerHTML = '';
    
    const totalPages = Math.ceil(screenerFilteredData.length / screenerPageSize) || 1;
    if (screenerPage > totalPages) screenerPage = totalPages;
    if (screenerPage < 1) screenerPage = 1;
    
    const startIdx = (screenerPage - 1) * screenerPageSize;
    const endIdx = Math.min(startIdx + screenerPageSize, screenerFilteredData.length);
    const pageData = screenerFilteredData.slice(startIdx, endIdx);
    
    if (pageData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 24px;">No records found matching the active filter.</td></tr>`;
        updateScreenerPagination(totalPages);
        return;
    }
    
    pageData.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'screener-row';
        tr.style.cursor = 'pointer';
        
        if (row.error) {
            tr.innerHTML = `<td class="text-bold">${row.symbol}</td><td colspan="9" class="text-red">${row.error}</td>`;
            tbody.appendChild(tr);
            return;
        }
        
        // Map elements
        const sym = `<td class="text-bold"><i class="fa-solid fa-chevron-right expand-icon"></i> ${row.symbol}</td>`;
        const price = `<td>${formatCurrency(row.price)}</td>`;
        const flip = `<td>${formatCurrency(row.gamma_flip)}</td>`;
        
        const dist = row.distance_to_flip_pct;
        const distClass = dist >= 0 ? 'text-green' : 'text-red';
        const distToFlip = `<td class="${distClass}">${dist.toFixed(2)}%</td>`;
        
        // Regime formatting
        const isPos = row.regime.includes("Positive");
        const regimeClass = isPos ? 'text-green' : 'text-orange';
        const regime = `<td class="${regimeClass}">${row.regime}</td>`;
        
        const cWall = `<td>${formatCurrency(row.call_wall)}</td>`;
        const pWall = `<td>${formatCurrency(row.put_wall)}</td>`;
        
        // OVI
        const ovi = row.ovi;
        let oviClass = '';
        if (ovi > 0.3) oviClass = 'text-green text-bold';
        else if (ovi < -0.3) oviClass = 'text-red text-bold';
        const oviTd = `<td class="${oviClass}">${(ovi * 100).toFixed(1)}%</td>`;
        
        // Skew
        const skewTd = `<td>${(row.iv_skew * 100).toFixed(1)}%</td>`;
        
        // Alerts summary tags
        let alertsHtml = '<td>';
        if (row.alerts && row.alerts.length > 0) {
            row.alerts.forEach(alert => {
                let tagClass = 'alert-tag';
                if (alert.toLowerCase().includes('bullish') || alert.toLowerCase().includes('call')) {
                    tagClass += ' bullish';
                } else if (alert.toLowerCase().includes('bearish') || alert.toLowerCase().includes('put')) {
                    tagClass += ' bearish';
                }
                alertsHtml += `<span class="${tagClass}" title="${alert}">${alert.substring(0, 24)}${alert.length > 24 ? '...' : ''}</span> `;
            });
        } else {
            alertsHtml += '<span class="timestamp">No Alerts</span>';
        }
        alertsHtml += '</td>';
        
        tr.innerHTML = sym + price + flip + distToFlip + regime + cWall + pWall + oviTd + skewTd + alertsHtml;
        
        // Collapsible Detail Row
        const detailTr = document.createElement('tr');
        detailTr.className = 'screener-detail-row';
        detailTr.id = `detail-${row.symbol}`;
        detailTr.style.display = 'none';
        
        const alertTime = new Date().toLocaleTimeString();
        let alertsListHtml = '';
        if (row.alerts && row.alerts.length > 0) {
            alertsListHtml = row.alerts.map(a => `<li><span class="alert-time">[${alertTime}]</span> ${a}</li>`).join('');
        } else {
            alertsListHtml = '<li>No active desk alerts for this symbol.</li>';
        }
        
        detailTr.innerHTML = `
            <td colspan="10">
                <div class="detail-container">
                    <div class="detail-grid">
                        <div class="detail-col">
                            <h4>System Metrics Detail</h4>
                            <p><strong>Total Net GEX Exposure:</strong> ${row.total_gex_dollar >= 0 ? '+' : ''}$${formatCompact(row.total_gex_dollar)}</p>
                            <p><strong>Total Vanna Exposure (VEX):</strong> $${formatCompact(row.total_vex_dollar)}</p>
                            <p><strong>Total Charm Exposure (CEX):</strong> $${formatCompact(row.total_cex_dollar)}</p>
                            <p><strong>Volatility Skew (Put/Call):</strong> ${(row.iv_skew * 100).toFixed(2)}%</p>
                        </div>
                        <div class="detail-col">
                            <h4>Alerts History Log</h4>
                            <ul class="detail-alerts-list">
                                ${alertsListHtml}
                            </ul>
                        </div>
                    </div>
                </div>
            </td>
        `;
        
        // Click handler to toggle details
        tr.addEventListener('click', () => {
            const isExpanded = tr.classList.toggle('expanded');
            detailTr.style.display = isExpanded ? 'table-row' : 'none';
        });
        
        tbody.appendChild(tr);
        tbody.appendChild(detailTr);
    });
    
    updateScreenerPagination(totalPages);
}

// Update screener pagination DOM controls
function updateScreenerPagination(totalPages) {
    const container = document.getElementById('screener-pagination');
    
    // Hide pagination if entries <= size
    if (screenerFilteredData.length <= screenerPageSize) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    
    // Update info text
    const startIdx = (screenerPage - 1) * screenerPageSize + 1;
    const endIdx = Math.min(startIdx + screenerPageSize - 1, screenerFilteredData.length);
    document.getElementById('screener-pagination-info').textContent = `Showing ${startIdx}-${endIdx} of ${screenerFilteredData.length} entries`;
    
    // Disable prev/next buttons
    document.getElementById('screener-prev-btn').disabled = (screenerPage === 1);
    document.getElementById('screener-next-btn').disabled = (screenerPage === totalPages);
    
    // Render page numbers
    const pageContainer = document.getElementById('screener-page-numbers');
    pageContainer.innerHTML = '';
    
    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.className = `page-btn ${screenerPage === i ? 'active' : ''}`;
        btn.textContent = i;
        btn.addEventListener('click', () => {
            renderScreenerPage(i);
        });
        pageContainer.appendChild(btn);
    }
}

// --- TAB 3: Data Validation ---
async function runValidation() {
    const symbol = document.getElementById('validation-symbol').value.toUpperCase().trim();
    const fileInput = document.getElementById('validation-file');
    const statusMsg = document.getElementById('validation-status');
    const reportCard = document.getElementById('validation-report-card');
    
    if (!symbol) {
        alert("Please enter a symbol to validate.");
        return;
    }
    if (!fileInput.files || fileInput.files.length === 0) {
        alert("Please select an external GEX file (CSV/JSON) to upload.");
        return;
    }

    statusMsg.style.display = 'block';
    statusMsg.className = 'validation-message';
    statusMsg.textContent = "Uploading external file and running mathematical convergence checks...";
    reportCard.style.display = 'none';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const response = await fetch(`/api/validate/${symbol}`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const res = await response.json();
        
        if (!res.success) {
            statusMsg.className = 'validation-message error';
            statusMsg.textContent = `Validation failed: ${res.error}`;
            return;
        }

        // Render comparative report
        statusMsg.className = 'validation-message success';
        statusMsg.textContent = "Data validation completed successfully. High-degree calibration reports loaded below.";
        
        // Show report card
        reportCard.style.display = 'block';
        
        // Populate report fields
        document.getElementById('val-corr').textContent = formatPercent(res.metrics.correlation * 100);
        document.getElementById('val-mae').textContent = formatCurrency(res.metrics.mean_absolute_error);
        document.getElementById('val-scale').textContent = res.metrics.scale_imbalance;
        
        // Table comparisons
        document.getElementById('comp-flip-our').textContent = formatCurrency(res.comparison.internal.gamma_flip);
        document.getElementById('comp-flip-ext').textContent = formatCurrency(res.comparison.external.gamma_flip);
        document.getElementById('comp-flip-diff').textContent = formatCurrency(res.comparison.differences.gamma_flip_diff);
        
        document.getElementById('comp-call-our').textContent = formatCurrency(res.comparison.internal.call_wall);
        document.getElementById('comp-call-ext').textContent = formatCurrency(res.comparison.external.call_wall);
        document.getElementById('comp-call-diff').textContent = formatCurrency(res.comparison.differences.call_wall_diff);
        
        document.getElementById('comp-put-our').textContent = formatCurrency(res.comparison.internal.put_wall);
        document.getElementById('comp-put-ext').textContent = formatCurrency(res.comparison.external.put_wall);
        document.getElementById('comp-put-diff').textContent = formatCurrency(res.comparison.differences.put_wall_diff);
        
    } catch (error) {
        console.error('Validation error:', error);
        statusMsg.className = 'validation-message error';
        statusMsg.textContent = `Error uploading/validating GEX data: ${error.message}`;
    }
}

// --- TAB 4: Backtesting Terminal ---
async function runBacktest() {
    const loader = document.getElementById('bt-loading');
    const metricsCards = document.getElementById('bt-metrics-cards');
    const chartCard = document.getElementById('bt-chart-card');
    const tradesCard = document.getElementById('bt-trades-card');
    
    loader.style.display = 'flex';
    metricsCards.style.display = 'none';
    chartCard.style.display = 'none';
    tradesCard.style.display = 'none';

    // Retrieve form values
    const symbol = document.getElementById('bt-symbol').value.toUpperCase().trim();
    const strategy = document.getElementById('bt-strategy').value;
    const capital = document.getElementById('bt-capital').value;
    const start = document.getElementById('bt-start').value;
    const end = document.getElementById('bt-end').value;
    
    const ema = document.getElementById('bt-ema').value;
    const wall = document.getElementById('bt-wall').value;
    const gexThr = document.getElementById('bt-gex-thr').value;
    const oviThr = document.getElementById('bt-ovi-thr').value;
    const stop = document.getElementById('bt-stop').value / 100.0; // convert % to decimal

    try {
        const queryParams = new URLSearchParams({
            symbol: symbol,
            strategy: strategy,
            capital: capital,
            startDate: start,
            endDate: end,
            emaLen: ema,
            wallLen: wall,
            gexThreshold: gexThr,
            oviThreshold: oviThr,
            stopLoss: stop
        });

        const response = await fetch(`/api/backtest?${queryParams.toString()}`, { method: 'POST' });
        if (!response.ok) {
            const errDetail = await response.json();
            throw new Error(errDetail.detail || `HTTP error! status: ${response.status}`);
        }

        const res = await response.json();
        
        // Show components
        metricsCards.style.display = 'grid';
        chartCard.style.display = 'block';
        tradesCard.style.display = 'block';

        // Render summary cards
        const retVal = document.getElementById('bt-res-return');
        retVal.textContent = formatPercent(res.summary.total_return_pct);
        retVal.className = res.summary.total_return_pct >= 0 ? 'text-green' : 'text-red';
        document.getElementById('bt-res-bh-return').textContent = `Buy & Hold: ${formatPercent(res.summary.buy_and_hold_return_pct)}`;
        
        document.getElementById('bt-res-sharpe').textContent = res.summary.sharpe_ratio.toFixed(2);
        document.getElementById('bt-res-dd').textContent = formatPercent(res.summary.max_drawdown_pct);
        
        document.getElementById('bt-res-win').textContent = formatPercent(res.summary.win_rate_pct);
        document.getElementById('bt-res-trades').textContent = `Total Trades: ${res.summary.total_trades}`;

        // Render Trades table
        populateBacktestTradesTable(res.trades);
        
        // Draw backtest chart
        drawBacktestChart(res.equity_curve, initialEquity = parseFloat(capital));

    } catch (error) {
        console.error('Backtest simulation failed:', error);
        alert(`Backtester simulation error: ${error.message}`);
    } finally {
        loader.style.display = 'none';
    }
}

function populateBacktestTradesTable(trades) {
    const tbody = document.querySelector('#bt-trades-table tbody');
    tbody.innerHTML = '';
    
    if (trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No trades executed during backtest period</td></tr>';
        return;
    }
    
    // Sort trades by entry date descending
    const sortedTrades = [...trades].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));

    sortedTrades.forEach(row => {
        const tr = document.createElement('tr');
        
        const type = `<td class="text-bold">${row.type}</td>`;
        const entryDate = `<td>${row.entry_date}</td>`;
        const exitDate = `<td>${row.exit_date}</td>`;
        const entryPrice = `<td>${formatCurrency(row.entry_price)}</td>`;
        const exitPrice = `<td>${formatCurrency(row.exit_price)}</td>`;
        
        const ret = `<td class="${row.return_pct >= 0 ? 'text-green' : 'text-red'}">${row.return_pct.toFixed(2)}%</td>`;
        const profit = `<td class="${row.profit >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(row.profit)}</td>`;
        
        tr.innerHTML = type + entryDate + exitDate + entryPrice + exitPrice + ret + profit;
        tbody.appendChild(tr);
    });
}

function drawBacktestChart(curve, initialEquity) {
    if (backtestChart) {
        backtestChart.destroy();
    }

    const labels = curve.map(c => c.date);
    const equityData = curve.map(c => c.equity);
    
    // Normalized Buy & Hold Comparison Curve
    const startPrice = curve[0].price;
    const bhData = curve.map(c => (c.price / startPrice) * initialEquity);

    const ctx = document.getElementById('backtest-chart').getContext('2d');

    backtestChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Strategy Equity ($)',
                    data: equityData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0
                },
                {
                    label: 'Buy & Hold Equity ($)',
                    data: bhData,
                    borderColor: '#9ca3af',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: '#9ca3af', font: { family: 'Outfit' } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#9ca3af' }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#9ca3af', callback: (value) => `$${formatCompact(value)}` }
                }
            }
        }
    });
}

// --- Watchlist Manager Helpers ---
function loadWatchlist() {
    const stored = localStorage.getItem('gex_watchlist');
    if (stored) {
        try {
            watchlist = JSON.parse(stored);
        } catch (e) {
            console.error("Failed to parse stored watchlist. Using defaults.");
        }
    } else {
        localStorage.setItem('gex_watchlist', JSON.stringify(watchlist));
    }
    renderWatchlistPills();
}

function renderWatchlistPills() {
    const container = document.getElementById('watchlist-pills');
    container.innerHTML = '';
    
    watchlist.forEach(symbol => {
        const pill = document.createElement('div');
        pill.className = 'symbol-pill';
        pill.innerHTML = `
            <span>${symbol}</span>
            <i class="fa-solid fa-xmark close-pill" data-symbol="${symbol}"></i>
        `;
        
        // Setup delete event listener
        pill.querySelector('.close-pill').addEventListener('click', (e) => {
            const symToRemove = e.target.getAttribute('data-symbol');
            removeSymbolFromWatchlist(symToRemove);
        });
        
        container.appendChild(pill);
    });
}

function addSymbolToWatchlist() {
    const input = document.getElementById('watchlist-input');
    const symbol = input.value.toUpperCase().trim();
    
    if (!symbol) {
        alert("Please enter a valid ticker symbol.");
        return;
    }
    
    if (watchlist.includes(symbol)) {
        alert(`${symbol} is already in your watchlist.`);
        return;
    }
    
    watchlist.push(symbol);
    localStorage.setItem('gex_watchlist', JSON.stringify(watchlist));
    renderWatchlistPills();
    input.value = '';
    
    // Automatically re-run screener to scan new ticker
    runScreener();
}

function removeSymbolFromWatchlist(symbol) {
    watchlist = watchlist.filter(s => s !== symbol);
    localStorage.setItem('gex_watchlist', JSON.stringify(watchlist));
    renderWatchlistPills();
    
    // Automatically re-run screener
    runScreener();
}

// --- Dynamic Option Strategy Playbook Helper ---
function updateStrategyPlaybook(data) {
    const container = document.getElementById('playbook-container');
    container.innerHTML = '';
    
    const spot = data.current_price;
    const flip = data.gamma_flip;
    const callWall = data.call_wall;
    const putWall = data.put_wall;
    
    // Calculate 1% strike width rounded to nearest 5 (min 5) for spreads
    const strikeWidth = Math.round(spot * 0.01 / 5) * 5 || 5;
    const isPositiveGamma = spot >= flip;
    
    // Proximity thresholds (0.8% of spot price)
    const threshold = spot * 0.008;
    const distFlip = Math.abs(spot - flip);
    
    let html = '';
    let triggeredCount = 0;
    
    if (isPositiveGamma) {
        // --- POSITIVE GAMMA (Mean-Reversion & Premium Decay) ---
        
        // 1. Put Wall Credit Spread (Trigger: spot is close to put wall)
        if (spot >= putWall && (spot - putWall) <= threshold) {
            triggeredCount++;
            html += `
                <div class="play-card bullish-play">
                    <div class="play-header">
                        <span class="play-title"><i class="fa-solid fa-circle-chevron-up" style="color: var(--color-green);"></i> Put Wall Bounce (Triggered)</span>
                        <span class="play-tag bullish">Bullish</span>
                    </div>
                    <div class="play-setup">
                        <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">15 - 30 DTE</span></div>
                        <div class="setup-row"><span class="setup-label">Buy Put:</span><span class="setup-val">$${(putWall - strikeWidth).toFixed(1)}</span></div>
                        <div class="setup-row"><span class="setup-label">Sell Put:</span><span class="setup-val" style="color: var(--color-green); font-weight: 700;">$${putWall.toFixed(1)} (Put Wall)</span></div>
                        <div class="setup-row"><span class="setup-label">Proximity:</span><span class="setup-val">${((spot - putWall)/spot*100).toFixed(2)}% above wall</span></div>
                    </div>
                    <div class="play-rules">
                        <strong>Trigger Rule:</strong> Spot price is near the Put Wall ($${putWall.toFixed(1)}). Dealer short put hedging acts as firm support.<br><br>
                        <strong>Execution:</strong> Sell Put Spread. Close at 75% max credit. Stop loss immediately if spot closes below the Put Wall.
                    </div>
                </div>
            `;
        }
        
        // 2. Call Wall Credit Spread (Trigger: spot is close to call wall)
        if (spot <= callWall && (callWall - spot) <= threshold) {
            triggeredCount++;
            html += `
                <div class="play-card bearish-play">
                    <div class="play-header">
                        <span class="play-title"><i class="fa-solid fa-circle-chevron-down" style="color: var(--color-red);"></i> Call Wall Reversal (Triggered)</span>
                        <span class="play-tag bearish">Bearish</span>
                    </div>
                    <div class="play-setup">
                        <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">15 - 30 DTE</span></div>
                        <div class="setup-row"><span class="setup-label">Sell Call:</span><span class="setup-val" style="color: var(--color-red); font-weight: 700;">$${callWall.toFixed(1)} (Call Wall)</span></div>
                        <div class="setup-row"><span class="setup-label">Buy Call:</span><span class="setup-val">$${(callWall + strikeWidth).toFixed(1)}</span></div>
                        <div class="setup-row"><span class="setup-label">Proximity:</span><span class="setup-val">${((callWall - spot)/spot*100).toFixed(2)}% below wall</span></div>
                    </div>
                    <div class="play-rules">
                        <strong>Trigger Rule:</strong> Spot price is testing the Call Wall ($${callWall.toFixed(1)}). Dealer long call hedging caps upside breakout potential.<br><br>
                        <strong>Execution:</strong> Sell Call Spread. Close at 75% max credit. Stop loss if spot closes above the Call Wall.
                    </div>
                </div>
            `;
        }
        
        // 3. Iron Condor (Trigger: spot is safely inside the channel and not near either wall)
        if (spot > (putWall + threshold) && spot < (callWall - threshold)) {
            triggeredCount++;
            html += `
                <div class="play-card neutral-play">
                    <div class="play-header">
                        <span class="play-title"><i class="fa-solid fa-arrows-left-right" style="color: var(--color-accent);"></i> Range-Bound Channel (Triggered)</span>
                        <span class="play-tag neutral">Neutral</span>
                    </div>
                    <div class="play-setup">
                        <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">30 - 45 DTE</span></div>
                        <div class="setup-row"><span class="setup-label">Sell Put (Floor):</span><span class="setup-val">$${putWall.toFixed(1)} (Put Wall)</span></div>
                        <div class="setup-row"><span class="setup-label">Sell Call (Cap):</span><span class="setup-val">$${callWall.toFixed(1)} (Call Wall)</span></div>
                        <div class="setup-row"><span class="setup-label">Channel Width:</span><span class="setup-val">${((callWall - putWall)/spot*100).toFixed(1)}% of Spot</span></div>
                    </div>
                    <div class="play-rules">
                        <strong>Trigger Rule:</strong> Spot price is well inside the channel and positive GEX suppresses volatility. High probability range-bound consolidation.<br><br>
                        <strong>Execution:</strong> Open Iron Condor. Close at 50% max profit. Stop loss if either wall is breached on a daily closing basis.
                    </div>
                </div>
            `;
        }
    } else {
        // --- NEGATIVE GAMMA (Volatility Expansion & Breakouts) ---
        
        const atmStrike = Math.round(spot);
        
        // 1. Bull Call / Bear Put Debit Spreads (Trigger: spot is testing the GEX Flip Level)
        if (distFlip <= threshold) {
            triggeredCount++;
            html += `
                <div class="play-card bullish-play">
                    <div class="play-header">
                        <span class="play-title"><i class="fa-solid fa-bolt" style="color: var(--color-green);"></i> Flip Level Squeeze (Triggered)</span>
                        <span class="play-tag bullish">Bullish</span>
                    </div>
                    <div class="play-setup">
                        <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">7 - 15 DTE</span></div>
                        <div class="setup-row"><span class="setup-label">Buy Call (ATM):</span><span class="setup-val">$${atmStrike}</span></div>
                        <div class="setup-row"><span class="setup-label">Sell Call:</span><span class="setup-val">$${(atmStrike + strikeWidth)}</span></div>
                        <div class="setup-row"><span class="setup-label">Proximity:</span><span class="setup-val">${(distFlip/spot*100).toFixed(2)}% from Flip</span></div>
                    </div>
                    <div class="play-rules">
                        <strong>Trigger Rule:</strong> Spot is testing the GEX Flip level ($${flip.toFixed(1)}). A break back into Positive Gamma will force dealer short-covering.<br><br>
                        <strong>Execution:</strong> Buy Call Spread. Target 100% gain on debit. Close if spot reverses below the Flip level.
                    </div>
                </div>
            `;
            
            triggeredCount++;
            html += `
                <div class="play-card bearish-play">
                    <div class="play-header">
                        <span class="play-title"><i class="fa-solid fa-arrows-down-to-line" style="color: var(--color-red);"></i> Flip Level Breakdown (Triggered)</span>
                        <span class="play-tag bearish">Bearish</span>
                    </div>
                    <div class="play-setup">
                        <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">7 - 15 DTE</span></div>
                        <div class="setup-row"><span class="setup-label">Buy Put (ATM):</span><span class="setup-val">$${atmStrike}</span></div>
                        <div class="setup-row"><span class="setup-label">Sell Put:</span><span class="setup-val">$${(atmStrike - strikeWidth)}</span></div>
                        <div class="setup-row"><span class="setup-label">Proximity:</span><span class="setup-val">${(distFlip/spot*100).toFixed(2)}% from Flip</span></div>
                    </div>
                    <div class="play-rules">
                        <strong>Trigger Rule:</strong> Spot is testing the GEX Flip level ($${flip.toFixed(1)}). A failure here triggers dealer selling to hedge short put exposures.<br><br>
                        <strong>Execution:</strong> Buy Put Spread. Target 100% gain on debit. Stop loss if spot rises back above the Flip level.
                    </div>
                </div>
            `;
        } else {
            // Volatility is expanding, but spot is far from the flip level
            triggeredCount++;
            html += `
                <div class="play-card neutral-play">
                    <div class="play-header">
                        <span class="play-title"><i class="fa-solid fa-tornado" style="color: var(--color-accent);"></i> Volatility Expansion</span>
                        <span class="play-tag neutral">Vol Buy</span>
                    </div>
                    <div class="play-setup">
                        <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">15 - 30 DTE</span></div>
                        <div class="setup-row"><span class="setup-label">Buy ATM Call:</span><span class="setup-val">$${atmStrike}</span></div>
                        <div class="setup-row"><span class="setup-label">Buy ATM Put:</span><span class="setup-val">$${atmStrike}</span></div>
                        <div class="setup-row"><span class="setup-label">Target Exit:</span><span class="setup-val">35% Net Gain</span></div>
                    </div>
                    <div class="play-rules">
                        <strong>Trigger Rule:</strong> Spot is in deep Negative Gamma and far from the Flip level. High realized volatility swings are expected.<br><br>
                        <strong>Execution:</strong> Buy Long Straddle. Hold through major macro events. Close on volatility spike.
                    </div>
                </div>
            `;
        }
    }
    
    if (triggeredCount === 0 || html === '') {
        container.innerHTML = `
            <div class="play-card neutral-play" style="grid-column: 1 / -1; text-align: center; padding: 30px;">
                <div class="play-title" style="font-size: 18px; margin-bottom: 8px;">
                    <i class="fa-solid fa-circle-nodes" style="color: var(--color-accent); font-size: 24px; margin-bottom: 12px;"></i><br>
                    No Active Proximity Setups Triggered
                </div>
                <div class="play-rules" style="border: none; padding: 0;">
                    The underlying price ($${spot.toFixed(2)}) is currently in a neutral zone.<br>
                    Monitor proximity to the **Put Wall ($${putWall.toFixed(1)})** or **Call Wall ($${callWall.toFixed(1)})** for active credit spread setups, or the **Flip Level ($${flip.toFixed(1)})** for debit breakouts.
                </div>
            </div>
        `;
    } else {
        container.innerHTML = html;
    }
}
