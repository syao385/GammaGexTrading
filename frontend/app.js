// Gamma GEX Trading System - Frontend Controller

// --- App State ---
let currentSymbol = 'SPY';
let currentExpiration = 'all';
let rawExpirations = [];
let watchlist = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'TSLA', 'NVDA'];

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
        populateScreenerTable(data);
    } catch (error) {
        console.error('Failed to run GEX screener:', error);
        alert(`Screener error: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Scan Watchlist';
    }
}

function populateScreenerTable(items) {
    const tbody = document.querySelector('#screener-table tbody');
    tbody.innerHTML = '';
    
    items.forEach(row => {
        const tr = document.createElement('tr');
        
        if (row.error) {
            tr.innerHTML = `<td class="text-bold">${row.symbol}</td><td colspan="9" class="text-red">${row.error}</td>`;
            tbody.appendChild(tr);
            return;
        }
        
        // Map elements
        const sym = `<td class="text-bold">${row.symbol}</td>`;
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
        
        // Alerts
        let alertsHtml = '<td>';
        if (row.alerts && row.alerts.length > 0) {
            row.alerts.forEach(alert => {
                let tagClass = 'alert-tag';
                if (alert.toLowerCase().includes('bullish') || alert.toLowerCase().includes('call')) {
                    tagClass += ' bullish';
                } else if (alert.toLowerCase().includes('bearish') || alert.toLowerCase().includes('put')) {
                    tagClass += ' bearish';
                }
                alertsHtml += `<span class="${tagClass}" title="${alert}">${alert.substring(0, 30)}${alert.length > 30 ? '...' : ''}</span> `;
            });
        } else {
            alertsHtml += '<span class="timestamp">No Alerts</span>';
        }
        alertsHtml += '</td>';
        
        tr.innerHTML = sym + price + flip + distToFlip + regime + cWall + pWall + oviTd + skewTd + alertsHtml;
        tbody.appendChild(tr);
    });
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
    
    let html = '';
    
    if (isPositiveGamma) {
        // --- POSITIVE GAMMA (Mean-Reversion / Decay Plays) ---
        
        // 1. Iron Condor
        html += `
            <div class="play-card neutral-play">
                <div class="play-header">
                    <span class="play-title">Iron Condor</span>
                    <span class="play-tag neutral">Neutral</span>
                </div>
                <div class="play-setup">
                    <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">30 - 45 DTE</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Put:</span><span class="setup-val">$${(putWall - strikeWidth).toFixed(1)}</span></div>
                    <div class="setup-row"><span class="setup-label">Sell Put:</span><span class="setup-val" style="color: #f43f5e; font-weight: 700;">$${putWall.toFixed(1)} (Put Wall)</span></div>
                    <div class="setup-row"><span class="setup-label">Sell Call:</span><span class="setup-val" style="color: #3b82f6; font-weight: 700;">$${callWall.toFixed(1)} (Call Wall)</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Call:</span><span class="setup-val">$${(callWall + strikeWidth).toFixed(1)}</span></div>
                </div>
                <div class="play-rules">
                    <strong>Rationale:</strong> Positive GEX acts as a volatility dampener. Spot price is expected to remain range-bound, pinning between the walls.<br><br>
                    <strong>Execution:</strong> Sell both spreads to collect max premium. Close at 50% max profit. Stop loss if spot closes outside the walls on a daily basis.
                </div>
            </div>
        `;
        
        // 2. Put Wall Credit Spread (Bull Put)
        html += `
            <div class="play-card bullish-play">
                <div class="play-header">
                    <span class="play-title">Put Wall Credit Spread</span>
                    <span class="play-tag bullish">Bullish</span>
                </div>
                <div class="play-setup">
                    <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">15 - 30 DTE</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Put:</span><span class="setup-val">$${(putWall - strikeWidth).toFixed(1)}</span></div>
                    <div class="setup-row"><span class="setup-label">Sell Put:</span><span class="setup-val" style="color: #f43f5e; font-weight: 700;">$${putWall.toFixed(1)} (Put Wall)</span></div>
                    <div class="setup-row"><span class="setup-label">Exit Target:</span><span class="setup-val">75% Max Credit</span></div>
                </div>
                <div class="play-rules">
                    <strong>Rationale:</strong> Put Wall acts as a firm floor. As spot drops near it, dealers buy underlying shares to maintain delta neutrality, forcing a bounce.<br><br>
                    <strong>Execution:</strong> Open when Spot drops within 0.5% of the Put Wall ($${putWall.toFixed(1)}). Stop loss immediately if spot breaks below the Put Wall.
                </div>
            </div>
        `;
        
        // 3. Call Wall Credit Spread (Bear Call)
        html += `
            <div class="play-card bearish-play">
                <div class="play-header">
                    <span class="play-title">Call Wall Credit Spread</span>
                    <span class="play-tag bearish">Bearish</span>
                </div>
                <div class="play-setup">
                    <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">15 - 30 DTE</span></div>
                    <div class="setup-row"><span class="setup-label">Sell Call:</span><span class="setup-val" style="color: #3b82f6; font-weight: 700;">$${callWall.toFixed(1)} (Call Wall)</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Call:</span><span class="setup-val">$${(callWall + strikeWidth).toFixed(1)}</span></div>
                    <div class="setup-row"><span class="setup-label">Exit Target:</span><span class="setup-val">75% Max Credit</span></div>
                </div>
                <div class="play-rules">
                    <strong>Rationale:</strong> Call Wall acts as a firm ceiling. As spot rises near it, dealers sell underlying shares, capping the upside.<br><br>
                    <strong>Execution:</strong> Open when Spot rises within 0.5% of the Call Wall ($${callWall.toFixed(1)}). Stop loss if spot closes above the Call Wall.
                </div>
            </div>
        `;
    } else {
        // --- NEGATIVE GAMMA (Volatility Expansion & Breakouts) ---
        
        const atmStrike = Math.round(spot);
        
        // 1. Bull Call Debit Spread (Regime Flip Breakout)
        html += `
            <div class="play-card bullish-play">
                <div class="play-header">
                    <span class="play-title">Bull Call Debit Spread</span>
                    <span class="play-tag bullish">Bullish</span>
                </div>
                <div class="play-setup">
                    <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">7 - 15 DTE</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Call (ATM):</span><span class="setup-val">$${atmStrike}</span></div>
                    <div class="setup-row"><span class="setup-label">Sell Call:</span><span class="setup-val">$${(atmStrike + strikeWidth)}</span></div>
                    <div class="setup-row"><span class="setup-label">Exit Target:</span><span class="setup-val">100% Return on Debit</span></div>
                </div>
                <div class="play-rules">
                    <strong>Rationale:</strong> In Negative Gamma, crossing above the Flip level ($${flip.toFixed(1)}) triggers short-covering stock purchases by dealers, accelerating upward breakouts.<br><br>
                    <strong>Execution:</strong> Enter when spot breaks out above the Flip level. Stop loss immediately if spot closes back below the Flip level (50% loss max).
                </div>
            </div>
        `;
        
        // 2. Bear Put Debit Spread (Regime Flip Breakdown)
        html += `
            <div class="play-card bearish-play">
                <div class="play-header">
                    <span class="play-title">Bear Put Debit Spread</span>
                    <span class="play-tag bearish">Bearish</span>
                </div>
                <div class="play-setup">
                    <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">7 - 15 DTE</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Put (ATM):</span><span class="setup-val">$${atmStrike}</span></div>
                    <div class="setup-row"><span class="setup-label">Sell Put:</span><span class="setup-val">$${(atmStrike - strikeWidth)}</span></div>
                    <div class="setup-row"><span class="setup-label">Exit Target:</span><span class="setup-val">100% Return on Debit</span></div>
                </div>
                <div class="play-rules">
                    <strong>Rationale:</strong> In Negative Gamma, spot falling below the Flip level ($${flip.toFixed(1)}) triggers aggressive dealer selling to hedge short put gamma, driving a cascade downward.<br><br>
                    <strong>Execution:</strong> Enter when spot breaks down below the GEX Flip level. Stop loss at 50% loss of debit value.
                </div>
            </div>
        `;
        
        // 3. Long Straddle (Squeeze Play)
        html += `
            <div class="play-card neutral-play">
                <div class="play-header">
                    <span class="play-title">Long Straddle</span>
                    <span class="play-tag neutral">Vol Buy</span>
                </div>
                <div class="play-setup">
                    <div class="setup-row"><span class="setup-label">Option DTE:</span><span class="setup-val">15 - 30 DTE</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Call (ATM):</span><span class="setup-val">$${atmStrike}</span></div>
                    <div class="setup-row"><span class="setup-label">Buy Put (ATM):</span><span class="setup-val">$${atmStrike}</span></div>
                    <div class="setup-row"><span class="setup-label">Exit Target:</span><span class="setup-val">35% Gain on Position</span></div>
                </div>
                <div class="play-rules">
                    <strong>Rationale:</strong> Negative Gamma expands volatility. Squeezes or cascades are highly likely. A large, directional price breakout in either direction generates profit.<br><br>
                    <strong>Execution:</strong> Buy when Spot is stuck near the Flip level during high-risk catalyst events (earnings, FOMC). Close once volatility spikes.
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}
