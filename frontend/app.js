// Gamma GEX Trading System - Frontend Controller

// --- App State ---
let currentSymbol = 'SPY';
let currentExpiration = 'all';
let rawExpirations = [];
let lastFetchedGexData = null;
let watchlist = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'TSLA', 'NVDA'];
let seenAlerts = new Set();
let screenerRawData = [];
let screenerFilteredData = [];
let screenerPage = 1;
const screenerPageSize = 10;

let dayTradingInterval = null;
let liquidPage = 0;
const liquidLimit = 15;

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
    
    // Sidebar Collapse Toggle Button
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            
            // Dispatch window resize event so canvases and Chart.js scale immediately
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 250);
        });
    }
    
    // Initial data load
    fetchGexData(currentSymbol, currentExpiration);
});

// --- Tab Navigation Setup ---
function setupTabNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const tabContents = document.querySelectorAll('.tab-content');

    const cleanupActiveViews = () => {
        if (dayTradingInterval) {
            clearInterval(dayTradingInterval);
            dayTradingInterval = null;
        }
        if (ofState.simInterval) {
            clearInterval(ofState.simInterval);
            ofState.simInterval = null;
            ofState.scenario = 'none';
        }
        if (ofState.liveSocket) {
            ofState.liveSocket.close();
            ofState.liveSocket = null;
        }
    };

    const initActiveSubtab = (hubId) => {
        cleanupActiveViews();
        
        if (hubId === 'order-flow') {
            initOrderFlowCharts();
            setTimeout(() => {
                resizeOrderFlowCanvases();
                renderOrderFlowCharts();
            }, 60);
        } else if (hubId === 'live-charts') {
            const activeSub = document.querySelector('#live-charts .subtab-pill.active');
            const targetSub = activeSub ? activeSub.getAttribute('data-subtab') : 'subtab-gex-curves';
            if (targetSub === 'subtab-day-internals') {
                initDayTradingDashboard();
            } else if (targetSub === 'subtab-swing-macro') {
                initSwingDashboard();
            }
        } else if (hubId === 'scanners-hub') {
            const activeSub = document.querySelector('#scanners-hub .subtab-pill.active');
            const targetSub = activeSub ? activeSub.getAttribute('data-subtab') : 'subtab-screener-realtime';
            if (targetSub === 'subtab-universe-db') {
                initLiquidScreener();
            } else {
                const tbody = document.querySelector('#screener-table tbody');
                if (tbody && tbody.children.length === 0) {
                    runScreener();
                }
            }
        }
    };

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

            initActiveSubtab(targetTab);

            // Trigger canvas resize for crisp rendering
            window.dispatchEvent(new Event('resize'));
        });
    });

    // Setup Sub-Tab Pill Navigation
    document.addEventListener('click', (e) => {
        const pill = e.target.closest('.subtab-pill');
        if (pill) {
            const container = pill.closest('.sub-tab-pills') || pill.parentElement;
            if (container) {
                const targetSubtab = pill.getAttribute('data-subtab');
                container.querySelectorAll('.subtab-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                const parentTab = pill.closest('.tab-content');
                if (parentTab) {
                    parentTab.querySelectorAll('.subtab-content').forEach(c => {
                        if (c.id === targetSubtab) c.classList.add('active');
                        else c.classList.remove('active');
                    });
                    
                    cleanupActiveViews();
                    if (targetSubtab === 'subtab-day-internals') {
                        initDayTradingDashboard();
                    } else if (targetSubtab === 'subtab-swing-macro') {
                        initSwingDashboard();
                    } else if (targetSubtab === 'subtab-universe-db') {
                        initLiquidScreener();
                    }
                }
                window.dispatchEvent(new Event('resize'));
            }
        }
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

    // Global Settings Modal Event Listeners
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            const modal = document.getElementById('settings-modal');
            if (modal) {
                modal.style.display = 'flex';
                checkSchwabStatus(); // Pre-populate badges when opening modal
                checkAlpacaStatus();
            }
        });
    }

    const closeSettingsBtn = document.getElementById('close-settings-btn');
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            const modal = document.getElementById('settings-modal');
            if (modal) modal.style.display = 'none';
        });
    }

    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') {
                settingsModal.style.display = 'none';
            }
        });
    }

    // Provider select switcher in modal
    const providerSelect = document.getElementById('provider-select');
    if (providerSelect) {
        providerSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            const schwabSec = document.getElementById('schwab-settings-section');
            const alpacaSec = document.getElementById('alpaca-settings-section');
            const schwabStatusBlock = document.getElementById('schwab-status-block');
            const alpacaStatusBlock = document.getElementById('alpaca-status-block');
            
            if (val === 'alpaca') {
                if (schwabSec) schwabSec.style.display = 'none';
                if (alpacaSec) alpacaSec.style.display = 'block';
                if (schwabStatusBlock) schwabStatusBlock.style.display = 'none';
                if (alpacaStatusBlock) alpacaStatusBlock.style.display = 'block';
                checkAlpacaStatus();
            } else {
                if (schwabSec) schwabSec.style.display = 'block';
                if (alpacaSec) alpacaSec.style.display = 'none';
                if (schwabStatusBlock) schwabStatusBlock.style.display = 'block';
                if (alpacaStatusBlock) alpacaStatusBlock.style.display = 'none';
                checkSchwabStatus();
            }
        });
    }

    const schwabSaveBtn = document.getElementById('schwab-save-btn');
    if (schwabSaveBtn) {
        schwabSaveBtn.addEventListener('click', () => {
            saveSchwabCredentials();
        });
    }

    const schwabAuthBtn = document.getElementById('schwab-auth-btn');
    if (schwabAuthBtn) {
        schwabAuthBtn.addEventListener('click', () => {
            loginToSchwabAPI();
        });
    }

    const alpacaSaveBtn = document.getElementById('alpaca-save-btn');
    if (alpacaSaveBtn) {
        alpacaSaveBtn.addEventListener('click', () => {
            saveAlpacaCredentials();
        });
    }

    // Handle incoming window messages for auth redirection
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'SCHWAB_AUTH_SUCCESS') {
            checkSchwabStatus();
            alert("Charles Schwab authorization successful! Configuration loaded.");
        }
    });

    // Check configuration and login state on load to color badges
    checkSchwabStatus();
    checkAlpacaStatus();

    // Order Flow Simulation Scenario Selectors
    const btnAbs = document.getElementById('sim-btn-absorption');
    const btnBrk = document.getElementById('sim-btn-breakout');
    const btnRst = document.getElementById('sim-btn-reset');
    
    if (btnAbs) btnAbs.addEventListener('click', () => startOrderFlowSimulation('absorption'));
    if (btnBrk) btnBrk.addEventListener('click', () => startOrderFlowSimulation('breakout'));
    if (btnRst) btnRst.addEventListener('click', () => startOrderFlowSimulation('reset'));
}

// --- Formatter Helpers ---
const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
const formatCompact = (val) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(val);
const formatPercent = (val) => `${val.toFixed(2)}%`;

// --- Switch Active Symbol ---
function switchToSymbol(symbol) {
    if (!symbol) return;
    currentSymbol = symbol.toUpperCase().trim();
    currentExpiration = 'all'; // Reset expiration filter
    
    // Update symbol search inputs
    const symbolInput = document.getElementById('symbol-input');
    if (symbolInput) {
        symbolInput.value = currentSymbol;
    }
    
    // Programmatically trigger click on GEX & Market Hub menu tab
    const hubTabBtn = document.querySelector('.menu-item[data-tab="live-charts"]');
    if (hubTabBtn) {
        hubTabBtn.click();
    } else {
        const menuItems = document.querySelectorAll('.menu-item');
        const tabContents = document.querySelectorAll('.tab-content');
        menuItems.forEach(btn => {
            if (btn.getAttribute('data-tab') === 'live-charts') btn.classList.add('active');
            else btn.classList.remove('active');
        });
        tabContents.forEach(content => {
            if (content.id === 'live-charts') content.classList.add('active');
            else content.classList.remove('active');
        });
    }
    
    // Load ticker data
    fetchGexData(currentSymbol, currentExpiration);
}
window.switchToSymbol = switchToSymbol;

// --- Canvas Candlestick & Volume Profile Drawing Engine ---
async function fetchAndDrawScreenerChart(canvasId, symbol) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Loading ${symbol} daily chart...`, 20, 30);
    
    try {
        const res = await fetch(`/api/screener/chart-data?symbol=${symbol}`);
        const data = await res.json();
        if (!data.success || !data.candles || data.candles.length === 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ef4444';
            ctx.fillText(`Chart unavailable: ${data.error || 'No history data'}`, 20, 30);
            return;
        }
        
        const candles = data.candles;
        const fvgs = data.fvgs || [];
        const vp = data.volume_profile || [];
        
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 15, bottom: 20, left: 35, right: 65 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        let maxP = -Infinity;
        let minP = Infinity;
        candles.forEach(c => {
            if (c.high > maxP) maxP = c.high;
            if (c.low < minP) minP = c.low;
            if (c.ema20 > maxP) maxP = c.ema20;
            if (c.ema20 < minP) minP = c.ema20;
        });
        
        const priceRange = (maxP - minP) || 1.0;
        maxP += priceRange * 0.05;
        minP -= priceRange * 0.05;
        const finalRange = maxP - minP;
        
        const getY = (price) => {
            return padding.top + chartHeight - ((price - minP) / finalRange) * chartHeight;
        };
        
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#0b0f17';
        ctx.fillRect(0, 0, width, height);
        
        // Horizontal gridlines
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 4]);
        for (let i = 0; i <= 4; i++) {
            const price = minP + (finalRange / 4) * i;
            const y = getY(price);
            
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
            
            ctx.fillStyle = '#64748b';
            ctx.setLineDash([]);
            ctx.font = '9px sans-serif';
            ctx.fillText(`$${price.toFixed(1)}`, padding.left + chartWidth + 4, y + 3);
            ctx.setLineDash([2, 4]);
        }
        ctx.setLineDash([]);
        
        // Volume Profile overlay (horizontal bars on right edge)
        if (vp.length > 0) {
            let maxVol = 0;
            vp.forEach(v => {
                if (v.volume > maxVol) maxVol = v.volume;
            });
            
            const barHeight = Math.max(3, Math.floor(chartHeight / vp.length) - 2);
            vp.forEach(v => {
                if (maxVol > 0) {
                    const y = getY(v.price);
                    const barWidth = (v.volume / maxVol) * 50;
                    ctx.fillStyle = v.is_poc ? 'rgba(245, 158, 11, 0.35)' : 'rgba(59, 130, 246, 0.15)';
                    ctx.fillRect(padding.left + chartWidth - barWidth, y - barHeight/2, barWidth, barHeight);
                    
                    if (v.is_poc) {
                        ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(padding.left, y);
                        ctx.lineTo(padding.left + chartWidth, y);
                        ctx.stroke();
                    }
                }
            });
        }
        
        // Unmitigated FVGs (Fair Value Gaps)
        const candleWidth = chartWidth / candles.length;
        fvgs.forEach(f => {
            let startX = padding.left;
            const matchIdx = candles.findIndex(c => c.time === f.time);
            if (matchIdx >= 0) {
                startX = padding.left + matchIdx * candleWidth;
            }
            const endX = padding.left + chartWidth;
            const topY = getY(f.top);
            const bottomY = getY(f.bottom);
            
            // Shaded imbalance zone extending to current price action
            ctx.fillStyle = f.type === 'bullish' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)';
            ctx.fillRect(startX, Math.min(topY, bottomY), endX - startX, Math.max(2, Math.abs(topY - bottomY)));
            
            // Zone boundary lines
            ctx.strokeStyle = f.type === 'bullish' ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(startX, topY);
            ctx.lineTo(endX, topY);
            ctx.moveTo(startX, bottomY);
            ctx.lineTo(endX, bottomY);
            ctx.stroke();
        });
        
        // Candlesticks
        candles.forEach((c, i) => {
            const x = padding.left + i * candleWidth;
            const openY = getY(c.open);
            const closeY = getY(c.close);
            const highY = getY(c.high);
            const lowY = getY(c.low);
            
            const isBullish = c.close >= c.open;
            const color = isBullish ? '#10b981' : '#ef4444';
            
            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + candleWidth/2, highY);
            ctx.lineTo(x + candleWidth/2, lowY);
            ctx.stroke();
            
            // Body
            ctx.fillStyle = color;
            const bodyH = Math.max(1.5, Math.abs(closeY - openY));
            ctx.fillRect(x + 1, Math.min(openY, closeY), Math.max(1, candleWidth - 2), bodyH);
        });
        
        // 20 EMA Line
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        candles.forEach((c, i) => {
            const x = padding.left + i * candleWidth + candleWidth/2;
            const y = getY(c.ema20);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
    } catch (err) {
        console.error('Error drawing chart:', err);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ef4444';
        ctx.fillText('Chart error', 20, 30);
    }
}

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
        lastFetchedGexData = data;
        
        // Populate expirations dropdown if not filtered
        updateExpirationDropdown(data.expirations, expiration);
        
        // Populate stats banner
        updateStatsBanner(data);
        
        // Update strategy playbook
        updateStrategyPlaybook(data);
        
        // Populate strikes table
        updateStrikesTable(data.strikes);
        
        // Draw charts
        drawGexStrikeChart(data.strikes, data.current_price, data.gamma_flip, data.call_wall, data.put_wall, data.volume_profile_poc, data.volume_profile_vah, data.volume_profile_val);
        drawVexChart(data.strikes);
        drawCexChart(data.strikes);
        
        // Update ASSET Playbook Scorecard
        updateAssetScorecard(data);
        
        // Draw Daily Candlestick Chart on GEX Hub
        const gexTickerBadge = document.getElementById('gex-candlestick-ticker');
        if (gexTickerBadge) {
            gexTickerBadge.textContent = symbol;
        }
        fetchAndDrawScreenerChart('gex-hub-candlestick-chart', symbol);
        
        // Draw Sensitivity Bounds
        updateSensitivityDisplay(data.sensitivity, data.current_price);
        
        // Set timestamp
        document.getElementById('last-updated').textContent = `Last Sync: ${new Date().toLocaleTimeString()}`;

        // Reset Order Flow visualizers to center around the new ticker spot and walls
        if (ofState && ofState.initialized) {
            resetOrderFlowData();
            initializeBookmapHeatmap();
            renderOrderFlowCharts();
            
            const mode = ofState.feedMode;
            if (mode === 'schwab' || mode === 'alpaca') {
                connectLiveWebSocket(mode);
            }
        }
        
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
    
    // Update Volume Profile Stat Card
    const vpPocVal = document.getElementById('vp-poc-val');
    const vpRangeVal = document.getElementById('vp-range-val');
    if (vpPocVal && data.volume_profile_poc) {
        vpPocVal.textContent = formatCurrency(data.volume_profile_poc);
        vpRangeVal.textContent = `VA: ${formatCurrency(data.volume_profile_val)} - ${formatCurrency(data.volume_profile_vah)}`;
    } else if (vpPocVal) {
        vpPocVal.textContent = '$0.00';
        vpRangeVal.textContent = 'VA: $0.00 - $0.00';
    }
    
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

function updateSingleAssetScorecard(prefix, data) {
    const pfx = prefix ? `${prefix}-` : '';
    const gradeBadge = document.getElementById(`${pfx}asset-grade-badge`);
    const scoreNum = document.getElementById(`${pfx}asset-score-num`);
    const sizingBadge = document.getElementById(`${pfx}asset-sizing-badge`);
    const recHeader = document.getElementById(`${pfx}asset-rec-header`);
    const recDesc = document.getElementById(`${pfx}asset-rec-desc`);
    const stopLevel = document.getElementById(`${pfx}asset-stop-level`);
    const targetLevel = document.getElementById(`${pfx}asset-target-level`);
    
    if (!gradeBadge) return;
    
    if (!data.asset_grade) {
        gradeBadge.textContent = 'D';
        gradeBadge.className = 'asset-grade-circle grade-d';
        scoreNum.textContent = '0.0';
        sizingBadge.textContent = 'SKIP (0%)';
        sizingBadge.className = 'asset-sizing-badge sizing-d';
        recHeader.textContent = 'Inactive Setup';
        recDesc.textContent = 'No active trade configurations found.';
        stopLevel.textContent = '--';
        targetLevel.textContent = '--';
        return;
    }
    
    // Update basic fields
    gradeBadge.textContent = data.asset_grade;
    gradeBadge.className = `asset-grade-circle grade-${data.asset_grade.toLowerCase()}`;
    scoreNum.textContent = data.asset_confluence_score.toFixed(1);
    sizingBadge.textContent = data.asset_sizing_recommendation.split(': ')[1] || data.asset_sizing_recommendation;
    sizingBadge.className = `asset-sizing-badge sizing-${data.asset_grade.toLowerCase()}`;
    
    // Update progress bars
    const bd = data.scorecard_breakdown || {};
    
    const setBar = (fillId, ptsId, val, maxVal) => {
        const fillEl = document.getElementById(`${pfx}${fillId}`);
        const ptsEl = document.getElementById(`${pfx}${ptsId}`);
        if (fillEl && ptsEl) {
            const pct = (val / maxVal) * 100;
            fillEl.style.width = `${pct}%`;
            ptsEl.textContent = `${val.toFixed(1)}/${maxVal.toFixed(1)}`;
        }
    };
    
    setBar('fill-cat', 'pts-cat', bd.catalyst || 0.0, 2.0);
    setBar('fill-align', 'pts-align', bd.alignment || 0.0, 2.0);
    setBar('fill-rs', 'pts-rs', bd.rs_rw || 0.0, 2.0);
    setBar('fill-loc', 'pts-loc', bd.location || 0.0, 2.0);
    setBar('fill-trig', 'pts-trig', bd.trigger || 0.0, 1.0);
    setBar('fill-rr', 'pts-rr', bd.risk_reward || 0.0, 1.0);
    
    // Recommendations
    const setupsList = data.setups || [];
    if (data.asset_grade === 'D') {
        recHeader.textContent = 'No Edge / Stay Out';
        recDesc.textContent = 'The setup does not satisfy sufficient confluences to warrant capital risk. Wait for structural alignment near GEX walls or Value Area boundaries.';
        stopLevel.textContent = '--';
        targetLevel.textContent = '--';
    } else {
        const direction = data.current_price >= data.gamma_flip ? 'Bullish Long' : 'Bearish Short';
        recHeader.textContent = `Grade ${data.asset_grade} - ${direction} Entry`;
        
        let triggerMsg = setupsList.join(', ') || 'Technical Proximity';
        recDesc.textContent = `Triggered by ${triggerMsg}. High probability risk structure with solid R:R. Size according to ASSET protocol rules.`;
        
        // Populate stops and targets based on walls and flip
        if (data.current_price >= data.gamma_flip) {
            stopLevel.textContent = formatCurrency(Math.max(data.put_wall || 0, data.gamma_flip || 0, data.volume_profile_val || 0));
            targetLevel.textContent = formatCurrency(data.call_wall || 0);
        } else {
            stopLevel.textContent = formatCurrency(Math.min(data.call_wall || 0, data.gamma_flip || 0, data.volume_profile_vah || 0));
            targetLevel.textContent = formatCurrency(data.put_wall || 0);
        }
    }
}

function updateAssetScorecard(data) {
    updateSingleAssetScorecard('', data);
    updateSingleAssetScorecard('of', data);
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
function drawGexStrikeChart(strikes, spot, flip, callWall, putWall, vpPoc, vpVah, vpVal) {
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

    // Custom plugin to draw vertical levels for Volume Profile (POC, VAH, VAL)
    const levelsPlugin = {
        id: 'levelsPlugin',
        afterDraw: (chart) => {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;
            
            const drawVerticalLine = (price, color, label, offsetMultiplier) => {
                if (!chart.data.labels || chart.data.labels.length === 0) return;
                
                // Find nearest strike tick index
                let closestIdx = 0;
                let minDiff = 999999;
                for (let i = 0; i < chart.data.labels.length; i++) {
                    const diff = Math.abs(chart.data.labels[i] - price);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                    }
                }
                
                const xPixel = xAxis.getPixelForTick(closestIdx);
                if (xPixel >= xAxis.left && xPixel <= xAxis.right) {
                    ctx.save();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 5]);
                    
                    ctx.beginPath();
                    ctx.moveTo(xPixel, yAxis.top);
                    ctx.lineTo(xPixel, yAxis.bottom);
                    ctx.stroke();
                    
                    // Draw label badge
                    ctx.fillStyle = color;
                    ctx.font = 'bold 9px Plus Jakarta Sans';
                    ctx.fillText(`${label}: $${price.toFixed(1)}`, xPixel + 5, yAxis.top + 15 + (offsetMultiplier * 12));
                    ctx.restore();
                }
            };

            if (chart.options.plugins.levels) {
                const { poc, vah, val } = chart.options.plugins.levels;
                if (poc > 0) drawVerticalLine(poc, '#3b82f6', 'POC', 0);
                if (vah > 0) drawVerticalLine(vah, '#f43f5e', 'VAH', 1);
                if (val > 0) drawVerticalLine(val, '#10b981', 'VAL', 2);
            }
        }
    };

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
        plugins: [levelsPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `GEX: $${context.raw.toFixed(2)}M`
                    }
                },
                levels: {
                    poc: vpPoc,
                    vah: vpVah,
                    val: vpVal
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
        const sym = `<td class="text-bold">
            <i class="fa-solid fa-chevron-right expand-icon"></i> 
            <a href="#" onclick="event.preventDefault(); event.stopPropagation(); switchToSymbol('${row.symbol}');" style="color: var(--color-primary); text-decoration: none; border-bottom: 1px dashed rgba(59, 130, 246, 0.4); padding-bottom: 1px;">
                ${row.symbol}
            </a>
        </td>`;
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
        const setups = row.setups || [];
        const badgesHTML = setups.map(s => {
            let c = "badge-vcp";
            if (s.toLowerCase().includes('breakout')) c = "badge-breakout";
            else if (s.toLowerCase().includes('trend')) c = "badge-trend";
            else if (s.toLowerCase().includes('reversion') || s.toLowerCase().includes('rev')) c = "badge-mean-rev";
            else if (s.toLowerCase().includes('volume') || s.toLowerCase().includes('vol')) c = "badge-vol-spike";
            return `<span class="screener-badge ${c}">${s}</span>`;
        }).join('');
        
        let alertTextsHtml = '';
        if (row.alerts && row.alerts.length > 0) {
            alertTextsHtml = `<span style="font-size:10px; color:var(--text-secondary); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block;" title="${row.alerts.join(' | ')}">
                ${row.alerts[0]}
            </span>`;
        } else {
            alertTextsHtml = '<span class="timestamp">No Alerts</span>';
        }
        
        alertsHtml += `
            <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
                <div style="display:flex; flex-wrap:wrap; gap:2px;">${badgesHTML}</div>
                ${alertTextsHtml}
            </div>
        `;
        alertsHtml += '</td>';
        
        tr.innerHTML = sym + price + flip + distToFlip + regime + cWall + pWall + oviTd + skewTd + alertsHtml;
        
        // Collapsible Detail Row
        const safeSym = row.symbol.replace(/[^a-zA-Z0-9]/g, '_');
        const detailTr = document.createElement('tr');
        detailTr.className = 'screener-detail-row';
        detailTr.id = `detail-${safeSym}`;
        detailTr.style.display = 'none';
        
        const alertTime = new Date().toLocaleTimeString();
        let alertsListHtml = '';
        if (row.alerts && row.alerts.length > 0) {
            alertsListHtml = row.alerts.map(a => `<li><span class="alert-time">[${row.setup_timestamp || alertTime}]</span> <span class="alert-score" style="color:var(--color-primary); font-weight:bold;">[10-Pt Setup Score: ${(row.asset_confluence_score !== undefined ? row.asset_confluence_score : 5.0).toFixed(1)} / 10.0]</span> ${a}</li>`).join('');
        } else {
            alertsListHtml = '<li>No active desk alerts for this symbol.</li>';
        }
        
        detailTr.innerHTML = `
            <td colspan="10">
                <div class="detail-container">
                    <div class="detail-grid" style="grid-template-columns: 1.1fr 1.2fr 1.7fr; gap: 20px;">
                        <div class="detail-col">
                            <h4>System & Advanced Metrics</h4>
                            <p><strong>10-Point Playbook Setup Score:</strong> <span class="grade-badge grade-${(row.asset_grade || 'B').toLowerCase()}">${row.asset_grade || 'B'} (${(row.asset_confluence_score !== undefined ? row.asset_confluence_score : 5.0).toFixed(1)} / 10.0)</span></p>
                            <p><strong>Sizing Recommendation:</strong> ${row.asset_sizing_recommendation || 'Muted Size (50% Risk)'}</p>
                            <p><strong>Total Net GEX Exposure:</strong> ${row.total_gex_dollar >= 0 ? '+' : ''}$${formatCompact(row.total_gex_dollar)}</p>
                            <p><strong>Total Vanna (VEX):</strong> $${formatCompact(row.total_vex_dollar)}</p>
                            <p><strong>Total Charm (CEX):</strong> $${formatCompact(row.total_cex_dollar)}</p>
                            <p><strong>Max Gamma Strike:</strong> $${formatCurrency(row.max_gex_strike || row.call_wall)}</p>
                            <p><strong>Order Volatility Index (OVI):</strong> ${((row.ovi || 0) * 100).toFixed(1)}%</p>
                            <p><strong>Volatility Skew (Put/Call):</strong> ${(row.iv_skew * 100).toFixed(2)}%</p>
                        </div>
                        <div class="detail-col">
                            <h4>Alerts History Log</h4>
                            <ul class="detail-alerts-list">
                                ${alertsListHtml}
                            </ul>
                        </div>
                        <div class="detail-col chart-col" style="background: rgba(13, 17, 23, 0.8); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <h4 style="margin-top:0; margin-bottom:8px;"><i class="fa-solid fa-chart-line"></i> Daily Candlestick (20 EMA, FVG & Vol Profile)</h4>
                            <canvas id="screener-chart-${safeSym}" width="420" height="200" style="width:100%; height:190px;"></canvas>
                        </div>
                    </div>
                </div>
            </td>
        `;
        
        // Click handler to toggle details
        tr.addEventListener('click', async () => {
            const isExpanded = tr.classList.toggle('expanded');
            detailTr.style.display = isExpanded ? 'table-row' : 'none';
            if (isExpanded) {
                await fetchAndDrawScreenerChart(`screener-chart-${safeSym}`, row.symbol);
            }
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
    const assetClass = document.getElementById('bt-asset-class').value;
    
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
            stopLoss: stop,
            assetClass: assetClass
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
            e.stopPropagation(); // Prevent pill click from firing
            const symToRemove = e.target.getAttribute('data-symbol');
            removeSymbolFromWatchlist(symToRemove);
        });
        
        // Setup click event listener on pill itself to switch symbol
        pill.addEventListener('click', (e) => {
            if (e.target.classList.contains('close-pill')) return;
            switchToSymbol(symbol);
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

// --- Expanded 1-to-1 Option Strategy Playbook Helper ---
function updateStrategyPlaybook(data) {
    const gexContainer = document.getElementById('playbook-container');
    const ofContainer = document.getElementById('orderflow-playbook-container');
    
    if (!data || !data.current_price) return;
    
    const spot = data.current_price;
    const flip = data.gamma_flip || spot;
    const callWall = data.call_wall || (spot * 1.05);
    const putWall = data.put_wall || (spot * 0.95);
    const maxGamma = data.max_gex_strike || callWall;
    
    const isPositiveGamma = spot >= flip;
    const strikeWidth = Math.max(5, Math.round(spot * 0.01 / 5) * 5) || 5;
    const atmStrike = Math.round(spot / (spot > 200 ? 5 : 1)) * (spot > 200 ? 5 : 1);
    
    const timestampStr = data.setup_timestamp || (new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' EST');
    const grade = data.asset_grade || 'B';
    const sizingStr = data.asset_sizing_recommendation ? (data.asset_sizing_recommendation.split(': ')[1] || data.asset_sizing_recommendation) : 'STANDARD (5.0%)';
    
    const dte7 = new Date(Date.now() + 7 * 86400000).toLocaleDateString([], { month: 'short', day: '2-digit' });
    const dte15 = new Date(Date.now() + 15 * 86400000).toLocaleDateString([], { month: 'short', day: '2-digit' });
    const dte30 = new Date(Date.now() + 30 * 86400000).toLocaleDateString([], { month: 'short', day: '2-digit' });

    const threshold = spot * 0.012; // 1.2% proximity
    let html = '';
    let count = 0;

    const buildPlayCard = (playType, title, iconHtml, tagText, reason, dteText, strikeStruct, entryText, profitText, stopText, rules) => {
        count++;
        return `
            <div class="play-card ${playType}-play">
                <div class="play-header">
                    <span class="play-title">${iconHtml} ${title}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="play-timestamp">${timestampStr}</span>
                        <span class="play-tag ${playType}">${tagText}</span>
                    </div>
                </div>
                <div class="play-reason-box">
                    <strong>Technical Reason:</strong> ${reason}
                </div>
                <div class="play-price-grid">
                    <div class="price-target-item">
                        <span class="target-title">Expiration & DTE</span>
                        <span class="target-val dte-val">${dteText}</span>
                    </div>
                    <div class="price-target-item">
                        <span class="target-title">Strike Structure</span>
                        <span class="target-val">${strikeStruct}</span>
                    </div>
                    <div class="price-target-item">
                        <span class="target-title">Est. Entry Price</span>
                        <span class="target-val entry-val">${entryText}</span>
                    </div>
                    <div class="price-target-item">
                        <span class="target-title">Take Profit Target</span>
                        <span class="target-val profit-val">${profitText}</span>
                    </div>
                    <div class="price-target-item">
                        <span class="target-title">Stop Loss Price</span>
                        <span class="target-val stop-val">${stopText}</span>
                    </div>
                    <div class="price-target-item">
                        <span class="target-title">ASSET Sizing</span>
                        <span class="target-val">${grade} (${sizingStr})</span>
                    </div>
                </div>
                <div class="play-rules">
                    <strong>Execution & Invalidation:</strong> ${rules}
                </div>
            </div>
        `;
    };

    // 1. Put Wall Support Bounce
    if (spot >= putWall && (spot - putWall) <= threshold) {
        const estCredit = (strikeWidth * 0.25).toFixed(2);
        const tpVal = (strikeWidth * 0.25 * 0.25).toFixed(2);
        const stopVal = (strikeWidth * 0.25 * 2.0).toFixed(2);
        html += buildPlayCard(
            'bullish',
            'Put Wall Support Bounce',
            '<i class="fa-solid fa-circle-chevron-up" style="color: var(--color-green);"></i>',
            'Bullish',
            `Spot price ($${spot.toFixed(2)}) is testing Put Wall ($${putWall.toFixed(1)}). Dealer short-put hedging provides firm structural floor.`,
            `15 - 30 DTE (${dte15})`,
            `Sell $${putWall.toFixed(0)} Put / Buy $${(putWall - strikeWidth).toFixed(0)} Put`,
            `Est. Credit: $${estCredit}`,
            `Exit @ $${tpVal} (75% Max Profit)`,
            `Stop @ $${stopVal} (2x Credit Loss)`,
            `Sell Bull Put Credit Spread. Hard stop loss if spot closes below Put Wall ($${putWall.toFixed(1)}). Target 75% max credit decay.`
        );
    }

    // 2. Call Wall Resistance Reversal
    if (spot <= callWall && (callWall - spot) <= threshold) {
        const estCredit = (strikeWidth * 0.25).toFixed(2);
        const tpVal = (strikeWidth * 0.25 * 0.25).toFixed(2);
        const stopVal = (strikeWidth * 0.25 * 2.0).toFixed(2);
        html += buildPlayCard(
            'bearish',
            'Call Wall Resistance Reversal',
            '<i class="fa-solid fa-circle-chevron-down" style="color: var(--color-red);"></i>',
            'Bearish',
            `Spot price ($${spot.toFixed(2)}) is testing Call Wall ($${callWall.toFixed(1)}). Dealer long-call hedging caps upside breakout momentum.`,
            `15 - 30 DTE (${dte15})`,
            `Sell $${callWall.toFixed(0)} Call / Buy $${(callWall + strikeWidth).toFixed(0)} Call`,
            `Est. Credit: $${estCredit}`,
            `Exit @ $${tpVal} (75% Max Profit)`,
            `Stop @ $${stopVal} (2x Credit Loss)`,
            `Sell Bear Call Credit Spread. Hard stop loss if spot closes above Call Wall ($${callWall.toFixed(1)}). Target 75% max credit decay.`
        );
    }

    // 3. GEX Flip Squeeze
    if (Math.abs(spot - flip) <= threshold && isPositiveGamma) {
        const estDebit = (strikeWidth * 0.40).toFixed(2);
        const tpVal = (strikeWidth * 0.40 * 2.0).toFixed(2);
        const stopVal = (strikeWidth * 0.40 * 0.50).toFixed(2);
        html += buildPlayCard(
            'bullish',
            'GEX Flip Level Squeeze',
            '<i class="fa-solid fa-bolt" style="color: var(--color-green);"></i>',
            'Bullish',
            `Spot price ($${spot.toFixed(2)}) crossing above GEX Flip ($${flip.toFixed(1)}). Shift into Positive Gamma forces dealer short-covering.`,
            `7 - 15 DTE (${dte7})`,
            `Buy $${atmStrike} Call / Sell $${atmStrike + strikeWidth} Call`,
            `Est. Debit: $${estDebit}`,
            `Target Sale: $${tpVal} (+100% Gain)`,
            `Stop Sale: $${stopVal} (-50% Loss)`,
            `Buy Call Debit Spread. Target 100% gain on debit. Hard stop loss if spot drops back below Flip level ($${flip.toFixed(1)}).`
        );
    }

    // 4. GEX Flip Breakdown
    if (Math.abs(spot - flip) <= threshold && !isPositiveGamma) {
        const estDebit = (strikeWidth * 0.40).toFixed(2);
        const tpVal = (strikeWidth * 0.40 * 2.0).toFixed(2);
        const stopVal = (strikeWidth * 0.40 * 0.50).toFixed(2);
        html += buildPlayCard(
            'bearish',
            'GEX Flip Level Breakdown',
            '<i class="fa-solid fa-arrows-down-to-line" style="color: var(--color-red);"></i>',
            'Bearish',
            `Spot price ($${spot.toFixed(2)}) breaking below GEX Flip ($${flip.toFixed(1)}). Negative Gamma regime accelerates selling pressure.`,
            `7 - 15 DTE (${dte7})`,
            `Buy $${atmStrike} Put / Sell $${atmStrike - strikeWidth} Put`,
            `Est. Debit: $${estDebit}`,
            `Target Sale: $${tpVal} (+100% Gain)`,
            `Stop Sale: $${stopVal} (-50% Loss)`,
            `Buy Put Debit Spread. Target 100% gain on debit. Hard stop loss if spot reclaims Flip level ($${flip.toFixed(1)}).`
        );
    }

    // 5. Volatility Contraction Pattern (VCP)
    const setupsList = data.setups || [];
    if (setupsList.some(s => s.toLowerCase().includes('vcp'))) {
        const estDebit = (strikeWidth * 0.35).toFixed(2);
        const tpVal = (strikeWidth * 0.35 * 1.60).toFixed(2);
        const stopVal = (strikeWidth * 0.35 * 0.70).toFixed(2);
        html += buildPlayCard(
            'bullish',
            'VCP Pattern Volatility Coiling',
            '<i class="fa-solid fa-compress" style="color: var(--color-green);"></i>',
            'Bullish',
            `Volatility Contraction Pattern (VCP) detected. Tightening range indicates impending directional expansion.`,
            `30 - 45 DTE (${dte30})`,
            `Buy $${atmStrike} Call / Sell $${atmStrike + strikeWidth} Call`,
            `Est. Debit: $${estDebit}`,
            `Target Sale: $${tpVal} (+60% Gain)`,
            `Stop Sale: $${stopVal} (-30% Loss)`,
            `Open Bullish Diagonal/Call Spread. Hold for volatility expansion. Invalidate if consolidation support is breached.`
        );
    }

    // 6. Active FVG Imbalance Fill
    if (setupsList.some(s => s.toLowerCase().includes('fvg'))) {
        const isBull = data.current_price >= flip;
        const estDebit = (strikeWidth * 0.45).toFixed(2);
        const tpVal = (strikeWidth * 0.45 * 1.80).toFixed(2);
        const stopVal = (strikeWidth * 0.45 * 0.60).toFixed(2);
        html += buildPlayCard(
            isBull ? 'bullish' : 'bearish',
            'Fair Value Gap (FVG) Fill',
            '<i class="fa-solid fa-layer-group" style="color: var(--color-blue);"></i>',
            isBull ? 'Bullish' : 'Bearish',
            `Active Fair Value Gap imbalance on 5m chart. Price magnetizing towards institutional liquidity re-balance.`,
            `7 - 14 DTE (${dte7})`,
            isBull ? `Buy $${atmStrike} Call / Sell $${atmStrike + strikeWidth} Call` : `Buy $${atmStrike} Put / Sell $${atmStrike - strikeWidth} Put`,
            `Est. Debit: $${estDebit}`,
            `Target Sale: $${tpVal} (+80% Gain)`,
            `Stop Sale: $${stopVal} (-40% Loss)`,
            `Buy Directional Debit Spread targeting full FVG gap closure. Exit on complete gap fill or invalidation.`
        );
    }

    // 7. Breaker Block Structure Shift
    if (setupsList.some(s => s.toLowerCase().includes('breaker'))) {
        const isBull = data.current_price >= flip;
        const estDebit = (strikeWidth * 0.30).toFixed(2);
        const tpVal = (strikeWidth * 0.30 * 2.20).toFixed(2);
        const stopVal = (strikeWidth * 0.30 * 0.50).toFixed(2);
        html += buildPlayCard(
            isBull ? 'bullish' : 'bearish',
            'Breaker Block Structure Shift',
            '<i class="fa-solid fa-shield-halved" style="color: var(--color-accent);"></i>',
            isBull ? 'Bullish' : 'Bearish',
            `Breaker Block structure shift confirmed. Liquidity sweep followed by Market Structure Shift (MSS).`,
            `7 - 14 DTE (${dte7})`,
            isBull ? `Buy $${atmStrike} Call / Sell $${atmStrike + strikeWidth} Call` : `Buy $${atmStrike} Put / Sell $${atmStrike - strikeWidth} Put`,
            `Est. Debit: $${estDebit}`,
            `Target Sale: $${tpVal} (+120% Gain)`,
            `Stop Sale: $${stopVal} (-50% Loss)`,
            `Open High-Gamma Debit Spread. Stop loss if price trades beyond the Breaker Block origin level.`
        );
    }

    // 8. Unusual Volume Momentum Surge
    if (setupsList.some(s => s.toLowerCase().includes('volume'))) {
        const isBull = data.current_price >= flip;
        const estPrem = (spot * 0.015).toFixed(2);
        const tpVal = (spot * 0.015 * 2.0).toFixed(2);
        const stopVal = (spot * 0.015 * 0.60).toFixed(2);
        html += buildPlayCard(
            isBull ? 'bullish' : 'bearish',
            'Unusual Volume Momentum Surge',
            '<i class="fa-solid fa-chart-line-up" style="color: var(--color-green);"></i>',
            isBull ? 'Bullish' : 'Bearish',
            `Relative Volume (RVOL) > 2.0x 20d MA. Aggressive institutional buying flow detected.`,
            `7 - 14 DTE (${dte7})`,
            isBull ? `Buy Single ATM Call ($${atmStrike})` : `Buy Single ATM Put ($${atmStrike})`,
            `Est. Premium: $${estPrem}`,
            `Target Sale: $${tpVal} (+100% Gain)`,
            `Stop Sale: $${stopVal} (-40% Loss)`,
            `Buy Single-Leg ATM Contract to capture high-delta momentum surge. Stop out on intraday volume exhaustion.`
        );
    }

    // 9. Range-Bound Channel (Iron Condor)
    if (isPositiveGamma && spot > (putWall + threshold) && spot < (callWall - threshold)) {
        const estCredit = (strikeWidth * 0.33).toFixed(2);
        const tpVal = (strikeWidth * 0.33 * 0.50).toFixed(2);
        html += buildPlayCard(
            'neutral',
            'Positive GEX Range Channel',
            '<i class="fa-solid fa-arrows-left-right" style="color: var(--color-accent);"></i>',
            'Neutral',
            `Spot ($${spot.toFixed(2)}) is safely inside Put Wall ($${putWall.toFixed(1)}) and Call Wall ($${callWall.toFixed(1)}). Positive Gamma suppresses volatility.`,
            `30 - 45 DTE (${dte30})`,
            `Sell $${putWall.toFixed(0)} Put & Sell $${callWall.toFixed(0)} Call (Iron Condor)`,
            `Est. Credit: $${estCredit}`,
            `Exit @ $${tpVal} (50% Max Profit)`,
            `Stop @ Daily Close Beyond Wall`,
            `Sell Iron Condor. Close at 50% max profit. Hard stop loss if either GEX Wall is breached on a daily closing basis.`
        );
    }

    // 10. Max Gamma Exhaustion
    if (Math.abs(spot - maxGamma) <= threshold) {
        const estDebit = (strikeWidth * 0.35).toFixed(2);
        const tpVal = (strikeWidth * 0.35 * 2.0).toFixed(2);
        const stopVal = (strikeWidth * 0.35 * 0.50).toFixed(2);
        html += buildPlayCard(
            'bearish',
            'Max Gamma Trend Exhaustion',
            '<i class="fa-solid fa-tornado" style="color: #f59e0b;"></i>',
            'Reversal',
            `Spot ($${spot.toFixed(2)}) is testing Max Gamma strike ($${maxGamma.toFixed(1)}). High probability of mean-reversion exhaustion.`,
            `7 - 14 DTE (${dte7})`,
            `Buy $${atmStrike} Put / Sell $${atmStrike - strikeWidth} Put`,
            `Est. Debit: $${estDebit}`,
            `Target Sale: $${tpVal} (+100% Gain)`,
            `Stop Sale: $${stopVal} (-50% Loss)`,
            `Buy Reversal Put Debit Spread. Exit on mean-reversion pull-back towards GEX Flip ($${flip.toFixed(1)}).`
        );
    }

    // Fallback if no specific setup triggered
    if (count === 0 || html === '') {
        const estCredit = (strikeWidth * 0.25).toFixed(2);
        html = buildPlayCard(
            'neutral',
            'Structural Mean Reversion Monitoring',
            '<i class="fa-solid fa-circle-nodes" style="color: var(--color-accent);"></i>',
            'Standby',
            `Spot price ($${spot.toFixed(2)}) is currently in a neutral GEX zone between Put Wall ($${putWall.toFixed(1)}) and Call Wall ($${callWall.toFixed(1)}).`,
            `15 - 30 DTE (${dte15})`,
            `Put Wall ($${putWall.toFixed(0)}) / Call Wall ($${callWall.toFixed(0)}) Spreads`,
            `Est. Credit: $${estCredit}`,
            `Target 75% Credit Decay`,
            `Stop @ Wall Invalidation`,
            `Stand by. Monitor price action proximity to Put Wall ($${putWall.toFixed(1)}), Call Wall ($${callWall.toFixed(1)}), or GEX Flip ($${flip.toFixed(1)}) for active entries.`
        );
    }

    if (gexContainer) gexContainer.innerHTML = html;
    if (ofContainer) ofContainer.innerHTML = html;
}

// --- TAB 6: Order Flow Execution Engine ---
let ofState = {
    initialized: false,
    feedMode: 'alpaca', // 'alpaca' (default live stream) vs 'schwab'
    scenario: 'none', // 'none', 'absorption', 'breakout', 'live'
    simInterval: null,
    step: 0,
    spotPrice: 500.0,
    putWall: 495.0,
    callWall: 505.0,
    flipLevel: 500.0,
    isPositiveGex: true,
    volumeProfilePoc: null,
    volumeProfileVah: null,
    volumeProfileVal: null,
    volumeProfileBins: [],
    
    // User Configurations
    tickConsolidation: 0.50, // price bin size
    heatmapContrast: 35, // L2 brightness multiplier
    bubbleScale: 2.0, // trade circle size scaler
    showCumDelta: true, // toggle delta subchart
    showGrid: true, // toggle grid lines overlay
    
    // Canvas Navigation
    zoomLevel: 1.0,
    yZoomLevel: 1.0,
    panOffset: { x: 0, y: 0 },
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    
    // Data Buffers
    footprintBars: [],
    bookmapHistory: [], // array of {time, price, size, type: 'trade', tradeType: 'buy'|'sell'}
    bookmapLiquidity: {}, // priceStr -> size
    cumulativeDelta: 0, // session running delta
    cumDeltaHistory: [], // array of delta values matching bookmap ticks
    
    // WebSockets client
    liveSocket: null,

    // Advanced Order Flow Metrics
    maxGammaStrike: null,
    mlofi: 0,
    mlofiHistory: [],
    cogBid: null,
    cogAsk: null,
    sonarWarning: false,
    hedgingPressure: 0,
    showMlofi: false // Hides MLOFI line on Cumulative Delta by default
};

// Canvas references
let fpCanvas = null;
let fpCtx = null;
let bmCanvas = null;
let bmCtx = null;
let cdCanvas = null;
let cdCtx = null;

// Add a log alert item to the order flow executions alerts panel
function addOrderFlowAlert(type, msg) {
    const container = document.getElementById('orderflow-alerts-container');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `alert-item ${type}-alert`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'alert-time';
    timeSpan.textContent = new Date().toLocaleTimeString();
    
    const msgSpan = document.createElement('span');
    msgSpan.className = 'alert-msg';
    msgSpan.textContent = msg;
    
    div.appendChild(timeSpan);
    div.appendChild(msgSpan);
    
    container.insertBefore(div, container.firstChild);
    
    while (container.children.length > 40) {
        container.removeChild(container.lastChild);
    }
}

// Initialize Order Flow Panel
function initOrderFlowCharts() {
    if (!fpCanvas) {
        fpCanvas = document.getElementById('footprint-canvas');
        bmCanvas = document.getElementById('bookmap-canvas');
        cdCanvas = document.getElementById('cum-delta-canvas');
        if (fpCanvas) fpCtx = fpCanvas.getContext('2d');
        if (bmCanvas) bmCtx = bmCanvas.getContext('2d');
        if (cdCanvas) cdCtx = cdCanvas.getContext('2d');
    }

    if (!fpCanvas || !bmCanvas || !cdCanvas) {
        console.error("Order flow canvases not found in DOM");
        return;
    }

    // Schedule resize and draw after DOM layout reflow
    requestAnimationFrame(() => {
        resizeOrderFlowCanvases();
        renderOrderFlowCharts();
    });
    setTimeout(() => {
        resizeOrderFlowCanvases();
        renderOrderFlowCharts();
    }, 100);

    if (ofState.initialized) {
        checkSchwabStatus();
        if (!ofState.footprintBars || ofState.footprintBars.length === 0) {
            resetOrderFlowData();
        }
        const mode = ofState.feedMode || 'alpaca';
        if (mode === 'schwab' || mode === 'alpaca') {
            connectLiveWebSocket(mode);
        } else {
            startOrderFlowSimulation('live');
        }
        return;
    }

    // Make canvases DPI responsive
    resizeOrderFlowCanvases();
    window.addEventListener('resize', resizeOrderFlowCanvases);

    // Setup Canvas Drag and Zoom Listeners for Footprint
    setupFootprintInteraction();

    // Bind Controls UI Event Listeners
    setupOrderFlowControls();

    // Check credentials status on backend
    checkSchwabStatus();

    // Reset and initialize default datasets
    resetOrderFlowData();
    initializeBookmapHeatmap();

    ofState.initialized = true;
    
    // Read the current selected feed mode from the dropdown on startup (defaults to Alpaca)
    const feedModeSelect = document.getElementById('of-feed-mode');
    const mode = feedModeSelect ? feedModeSelect.value : 'alpaca';
    ofState.feedMode = mode;
    
    addOrderFlowAlert('system', `Order Flow Suite active. Live Feed: ${mode.toUpperCase()} connected.`);
    const simCard = document.getElementById('of-sim-card');
    if (simCard) simCard.style.display = 'none';
    connectLiveWebSocket(mode);
}

function resizeOrderFlowCanvases() {
    if (fpCanvas) {
        const parent = fpCanvas.parentElement;
        const rect = parent ? parent.getBoundingClientRect() : null;
        let w = (rect && rect.width > 50) ? rect.width : (parent ? parent.clientWidth : 0);
        let h = (rect && rect.height > 50) ? rect.height : (parent ? parent.clientHeight : 0);
        if (w <= 50) w = (parent && parent.offsetWidth > 50) ? parent.offsetWidth : 900;
        if (h <= 50) h = (parent && parent.offsetHeight > 50) ? parent.offsetHeight : 480;

        fpCanvas.width = Math.floor(w * window.devicePixelRatio);
        fpCanvas.height = Math.floor(h * window.devicePixelRatio);
        fpCanvas.style.width = Math.floor(w) + 'px';
        fpCanvas.style.height = Math.floor(h) + 'px';
    }
    if (bmCanvas) {
        const parent = bmCanvas.parentElement;
        const rect = parent ? parent.getBoundingClientRect() : null;
        let w = (rect && rect.width > 50) ? rect.width : (parent ? parent.clientWidth : 0);
        let h = (rect && rect.height > 50) ? rect.height : (parent ? parent.clientHeight : 0);
        if (w <= 50) w = (parent && parent.offsetWidth > 50) ? parent.offsetWidth : 900;
        if (h <= 50) h = (parent && parent.offsetHeight > 50) ? parent.offsetHeight : 320;

        bmCanvas.width = Math.floor(w * window.devicePixelRatio);
        bmCanvas.height = Math.floor(h * window.devicePixelRatio);
        bmCanvas.style.width = Math.floor(w) + 'px';
        bmCanvas.style.height = Math.floor(h) + 'px';
    }
    if (cdCanvas) {
        const cumWrapper = document.getElementById('cum-delta-wrapper');
        if (cumWrapper) {
            if (ofState.showCumDelta) {
                cumWrapper.style.display = 'block';
                const rect = cumWrapper.getBoundingClientRect();
                let w = (rect && rect.width > 50) ? rect.width : 900;
                let h = (rect && rect.height > 10) ? rect.height : 100;
                cdCanvas.width = Math.floor(w * window.devicePixelRatio);
                cdCanvas.height = Math.floor(h * window.devicePixelRatio);
                cdCanvas.style.width = Math.floor(w) + 'px';
                cdCanvas.style.height = Math.floor(h) + 'px';
            } else {
                cumWrapper.style.display = 'none';
            }
        }
    }
    renderOrderFlowCharts();
}

function resetOrderFlowData() {
    ofState.footprintBars = [];
    ofState.cumulativeDelta = 0;
    ofState.cumDeltaHistory = [];
    ofState.step = 0;
    
    // Read GEX levels from raw fetched data or fallback to statistics text
    let spot = 500.0;
    let flip = 500.0;
    let call = 505.0;
    let put = 495.0;

    if (lastFetchedGexData) {
        spot = lastFetchedGexData.current_price || 500.0;
        flip = lastFetchedGexData.gamma_flip || spot;
        call = lastFetchedGexData.call_wall || (spot + 5);
        put = lastFetchedGexData.put_wall || (spot - 5);
    } else {
        const spotEl = document.getElementById('spot-price-val');
        const mainSpot = spotEl ? parseFloat(spotEl.textContent.replace('$', '').replace(/,/g, '')) : NaN;
        if (!isNaN(mainSpot) && mainSpot > 0) {
            spot = mainSpot;
            const flipEl = document.getElementById('flip-level-val');
            const callEl = document.getElementById('call-wall-val');
            const putEl = document.getElementById('put-wall-val');
            
            flip = flipEl ? parseFloat(flipEl.textContent.replace('$', '').replace(/,/g, '')) : spot;
            call = callEl ? parseFloat(callEl.textContent.replace('$', '').replace(/,/g, '')) : (spot + 5);
            put = putEl ? parseFloat(putEl.textContent.replace('$', '').replace(/,/g, '')) : (spot - 5);
            
            if (isNaN(flip)) flip = spot;
            if (isNaN(call)) call = spot + 5;
            if (isNaN(put)) put = spot - 5;
        }
    }

    ofState.spotPrice = spot;
    ofState.flipLevel = flip;
    ofState.callWall = call;
    ofState.putWall = put;

    // Set advanced metrics defaults
    ofState.maxGammaStrike = lastFetchedGexData ? lastFetchedGexData.max_gex_strike : ofState.spotPrice;
    const regimeEl = document.getElementById('regime-val');
    ofState.isPositiveGex = regimeEl ? regimeEl.textContent.includes('Positive') : true;
    
    // Sync Volume Profile levels
    ofState.volumeProfilePoc = lastFetchedGexData ? lastFetchedGexData.volume_profile_poc : null;
    ofState.volumeProfileVah = lastFetchedGexData ? lastFetchedGexData.volume_profile_vah : null;
    ofState.volumeProfileVal = lastFetchedGexData ? lastFetchedGexData.volume_profile_val : null;
    ofState.volumeProfileBins = lastFetchedGexData ? lastFetchedGexData.volume_profile_bins || [] : [];
    ofState.mlofi = 0;
    ofState.mlofiHistory = Array(150).fill(0);
    ofState.cogBid = ofState.spotPrice - 0.20;
    ofState.cogAsk = ofState.spotPrice + 0.20;
    ofState.sonarWarning = false;
    ofState.hedgingPressure = 0;

    // Pre-generate historical Footprint Bars
    let baseTime = Date.now() - 300000;
    for (let i = 0; i < 5; i++) {
        const barClose = ofState.spotPrice - 1.5 + i * 0.6 + (Math.random() - 0.5) * 0.6;
        const barOpen = barClose - (Math.random() - 0.5) * 1.8;
        const high = Math.max(barOpen, barClose) + 0.8;
        const low = Math.min(barOpen, barClose) - 0.8;
        
        ofState.footprintBars.push(generateMockFootprintBar(
            baseTime + i * 60000, 
            barOpen, 
            barClose, 
            high, 
            low
        ));
    }
    
    // Reset canvas pan offsets
    ofState.zoomLevel = 1.0;
    ofState.yZoomLevel = 1.0;
    ofState.panOffset = { x: 0, y: 0 };
}

function initializeBookmapHeatmap() {
    ofState.bookmapLiquidity = {};
    ofState.bookmapHistory = [];
    
    // Setup resting liquidity steps
    for (let p = ofState.putWall - 5.0; p <= ofState.callWall + 5.0; p += 0.05) {
        ofState.bookmapLiquidity[p.toFixed(2)] = Math.floor(Math.random() * 250) + 20;
    }
    
    // Anchor high institutional limit books at GEX levels
    ofState.bookmapLiquidity[ofState.putWall.toFixed(2)] = 2500;
    ofState.bookmapLiquidity[ofState.callWall.toFixed(2)] = 3100;
    ofState.bookmapLiquidity[ofState.flipLevel.toFixed(2)] = 1000;

    // Pre-populate Bookmap historical scrolling ticks
    const now = Date.now();
    for (let i = 0; i < 150; i++) {
        const tradePrice = ofState.spotPrice + Math.sin(i / 12) * 2.0 + (Math.random() - 0.5) * 0.4;
        const isBuy = Math.random() > 0.5;
        const tickSize = Math.floor(Math.random() * 80) + 5;
        
        if (isBuy) ofState.cumulativeDelta += tickSize;
        else ofState.cumulativeDelta -= tickSize;

        ofState.bookmapHistory.push({
            time: now - (150 - i) * 1000,
            price: tradePrice,
            size: tickSize,
            type: 'trade',
            tradeType: isBuy ? 'buy' : 'sell'
        });
        ofState.cumDeltaHistory.push(ofState.cumulativeDelta);
    }
}

// Update visual streaming status badges
function updateStreamStatus(state, details = "") {
    const badgeFp = document.getElementById('orderflow-stream-status');
    const badgeBm = document.getElementById('orderflow-stream-status-bm');
    if (!badgeFp || !badgeBm) return;

    let text = "IDLE";
    let bg = "rgba(107, 114, 128, 0.15)";
    let fg = "var(--text-secondary)";

    if (state === 'idle') {
        text = "IDLE";
        bg = "rgba(107, 114, 128, 0.15)";
        fg = "var(--text-secondary)";
    } else if (state === 'simulating') {
        text = "STREAMING (SIMULATION)";
        bg = "rgba(59, 130, 246, 0.15)";
        fg = "#3b82f6";
    } else if (state === 'connecting') {
        text = `CONNECTING (${details.toUpperCase()})...`;
        bg = "rgba(245, 158, 11, 0.15)";
        fg = "#f59e0b";
    } else if (state === 'streaming') {
        text = `LIVE (${details.toUpperCase()})`;
        bg = "rgba(16, 185, 129, 0.15)";
        fg = "#10b981";
    } else if (state === 'disconnected') {
        text = "DISCONNECTED";
        bg = "rgba(244, 63, 94, 0.15)";
        fg = "#f43f5e";
    }

    [badgeFp, badgeBm].forEach(badge => {
        badge.textContent = text;
        badge.style.backgroundColor = bg;
        badge.style.color = fg;
    });
}

// Start specific simulation scenarios
function startOrderFlowSimulation(scenario) {
    if (ofState.simInterval) {
        clearInterval(ofState.simInterval);
        ofState.simInterval = null;
    }

    ofState.scenario = scenario;
    ofState.step = 0;

    if (scenario === 'reset') {
        resetOrderFlowData();
        ofState.scenario = 'none';
        ofState.bookmapHistory = ofState.bookmapHistory.slice(-150); // Keep last 150
        // Restore liquidity
        ofState.bookmapLiquidity[ofState.putWall.toFixed(2)] = 2500;
        ofState.bookmapLiquidity[ofState.callWall.toFixed(2)] = 3100;
        ofState.bookmapLiquidity[ofState.flipLevel.toFixed(2)] = 1000;
        
        updateStreamStatus('idle');
        
        const container = document.getElementById('orderflow-alerts-container');
        if (container) {
            container.innerHTML = `
                <div class="alert-item system-alert">
                    <span class="alert-time">${new Date().toLocaleTimeString()}</span>
                    <span class="alert-msg">Order flow state reset. Ready for analysis.</span>
                </div>
            `;
        }
        renderOrderFlowCharts();
        return;
    }

    addOrderFlowAlert('system', `Simulation started: Scenario = "${scenario.toUpperCase()}".`);
    updateStreamStatus('simulating');

    if (scenario === 'live') {
        // Continuous random walk simulating real-time feed updates
        ofState.simInterval = setInterval(() => {
            simulateLiveTick();
        }, 1500);
    } else if (scenario === 'absorption') {
        runAbsorptionSequence();
    } else if (scenario === 'breakout') {
        runBreakoutSequence();
    }
}

// SIMULATION 1: Absorption at Put Wall support
function runAbsorptionSequence() {
    resetOrderFlowData();
    ofState.spotPrice = ofState.putWall + 2.5; // Start slightly above Put Wall
    
    // Set a large resting block at Put Wall
    ofState.bookmapLiquidity[ofState.putWall.toFixed(2)] = 4500; // Giant limit buys
    renderOrderFlowCharts();

    const sequence = [
        // Drop towards Put Wall
        { spot: ofState.putWall + 1.5, msg: "Sellers sweeping the book down. Approaching major Put Wall." },
        { spot: ofState.putWall + 0.6, msg: "Spot near Put Wall $" + ofState.putWall.toFixed(2) + ". Rest bids stacking." },
        { spot: ofState.putWall + 0.05, msg: "Testing Put Wall. High-volume sells hitting bid." },
        // Hit the wall - Absorption starts
        { spot: ofState.putWall, bidVolScale: 8, askVolScale: 1, msg: "[ABSORPTION] Massive passive limit orders absorbing market sells at Put Wall." },
        { spot: ofState.putWall, bidVolScale: 10, askVolScale: 1.2, msg: "[ABSORPTION] 2,800 contracts executed on bid. Spot refuses to print lower." },
        { spot: ofState.putWall, bidVolScale: 6, askVolScale: 0.8, msg: "[ABSORPTION] Selling exhaustion visible. Cumulative delta diverging bullishly." },
        // Rebound
        { spot: ofState.putWall + 0.4, buyImbalance: true, msg: "[REBOUND] Bullish quote imbalance detected. Aggressive buyers stepping in." },
        { spot: ofState.putWall + 1.0, msg: "[SNIPER ENTRY] Reversal confirmed. Buy delta expanding. Stop-loss tucked behind Put Wall." },
        { spot: ofState.putWall + 2.0, msg: "Short squeeze accelerates. Dealers covering hedges as spot bounces." }
    ];

    ofState.simInterval = setInterval(() => {
        if (ofState.step >= sequence.length) {
            clearInterval(ofState.simInterval);
            ofState.simInterval = null;
            addOrderFlowAlert('system', "Absorption simulation complete. Switched to continuous live feed.");
            startOrderFlowSimulation('live');
            return;
        }

        const stepData = sequence[ofState.step];
        ofState.spotPrice = stepData.spot;

        // Simulate trade ticks in Bookmap
        const tickCount = 15;
        for (let t = 0; t < tickCount; t++) {
            const tradeType = stepData.buyImbalance ? 'buy' : (stepData.bidVolScale > 5 ? 'sell' : (Math.random() > 0.4 ? 'sell' : 'buy'));
            const size = Math.floor(Math.random() * (tradeType === 'sell' ? (stepData.bidVolScale || 1) : (stepData.askVolScale || 1)) * 150) + 10;
            
            if (tradeType === 'buy') ofState.cumulativeDelta += size;
            else ofState.cumulativeDelta -= size;

            ofState.bookmapHistory.push({
                time: Date.now() + t * 50,
                price: ofState.spotPrice + (Math.random() - 0.5) * 0.05,
                size: size,
                type: 'trade',
                tradeType: tradeType
            });
            ofState.cumDeltaHistory.push(ofState.cumulativeDelta);
        }

        // Add footprint bar update or create a new bar
        let currentBar = ofState.footprintBars[ofState.footprintBars.length - 1];
        
        // Every 3 steps, create a new footprint bar, otherwise update current bar
        if (ofState.step % 3 === 0 && ofState.step > 0) {
            currentBar = generateMockFootprintBar(Date.now(), currentBar.close, ofState.spotPrice, ofState.spotPrice + 0.4, ofState.spotPrice - 0.4);
            ofState.footprintBars.push(currentBar);
        } else {
            // Update current bar values
            currentBar.close = ofState.spotPrice;
            currentBar.high = Math.max(currentBar.high, ofState.spotPrice + 0.25);
            currentBar.low = Math.min(currentBar.low, ofState.spotPrice - 0.25);
            
            // Add volume to bar's bins at spot price
            const binKey = ofState.spotPrice.toFixed(2);
            if (!currentBar.bins[binKey]) {
                currentBar.bins[binKey] = { bid_vol: 0, ask_vol: 0, imbalance: 'none' };
            }
            
            const bidAdd = Math.floor(Math.random() * (stepData.bidVolScale || 1) * 350) + 50;
            const askAdd = Math.floor(Math.random() * (stepData.askVolScale || 1) * 200) + 50;
            currentBar.bins[binKey].bid_vol += bidAdd;
            currentBar.bins[binKey].ask_vol += askAdd;
            currentBar.total_volume += (bidAdd + askAdd);
            currentBar.bar_delta += (askAdd - bidAdd);
        }

        // Trigger Alert Log
        if (stepData.msg) {
            let alertType = 'system';
            if (stepData.msg.includes('ABSORPTION')) alertType = 'absorption';
            else if (stepData.msg.includes('REBOUND') || stepData.msg.includes('ENTRY')) alertType = 'breakout';
            addOrderFlowAlert(alertType, stepData.msg);
        }

        // Simulate L2 resting updates inside steps
        const stepSize = 0.05;
        for (let i = 1; i <= 8; i++) {
            const pBid = (ofState.spotPrice - i * stepSize).toFixed(2);
            const pAsk = (ofState.spotPrice + i * stepSize).toFixed(2);
            ofState.bookmapLiquidity[pBid] = Math.max(10, (ofState.bookmapLiquidity[pBid] || 100) + Math.floor((Math.random() - 0.45) * 220));
            ofState.bookmapLiquidity[pAsk] = Math.max(10, (ofState.bookmapLiquidity[pAsk] || 100) + Math.floor((Math.random() - 0.45) * 220));
        }
        ofState.bookmapLiquidity[ofState.putWall.toFixed(2)] = stepData.spot === ofState.putWall ? 4500 : 2500;

        renderOrderFlowCharts();
        ofState.step++;
    }, 2000);
}

// SIMULATION 2: Momentum Breakout at GEX Flip level
function runBreakoutSequence() {
    resetOrderFlowData();
    ofState.spotPrice = ofState.flipLevel - 1.8; // Start below the Flip level
    
    // Set moderate liquidity at Flip level
    ofState.bookmapLiquidity[ofState.flipLevel.toFixed(2)] = 1500;
    renderOrderFlowCharts();

    const sequence = [
        // Rise towards Flip Level
        { spot: ofState.flipLevel - 1.0, msg: "Buyers lifting the offer. Heading to GEX Flip level $" + ofState.flipLevel.toFixed(2) + "." },
        { spot: ofState.flipLevel - 0.3, msg: "Testing Flip resistance. Resting limit ask orders stacked." },
        // Pulling liquidity (Spoofing/cancellation)
        { spot: ofState.flipLevel - 0.05, pullLiquidity: true, msg: "[PULLING] Resting limit asks at Flip Level pulling from 1,500 to 120 contracts. Road clears." },
        // Sweet Breakout
        { spot: ofState.flipLevel + 0.15, askVolScale: 8, buyImbalance: true, msg: "[BREAKOUT] Spot breaks GEX Flip! Massive buying imbalances sweep the book." },
        { spot: ofState.flipLevel + 0.7, askVolScale: 12, buyImbalance: true, msg: "[BREAKOUT] Short gamma hedge acceleration. Dealers forced to buy stock." },
        { spot: ofState.flipLevel + 1.2, askVolScale: 6, msg: "[MOMENTUM] Clean breakout holds. Retesting flip level from above as new support." },
        { spot: ofState.flipLevel + 1.8, msg: "[SUCCESS] SPY enters positive GEX regime. Volatility compressing, trend establishes." }
    ];

    ofState.simInterval = setInterval(() => {
        if (ofState.step >= sequence.length) {
            clearInterval(ofState.simInterval);
            ofState.simInterval = null;
            addOrderFlowAlert('system', "Breakout simulation complete. Switched to continuous live feed.");
            startOrderFlowSimulation('live');
            return;
        }

        const stepData = sequence[ofState.step];
        ofState.spotPrice = stepData.spot;

        if (stepData.pullLiquidity) {
            // Bookmap liquidity pulled
            ofState.bookmapLiquidity[ofState.flipLevel.toFixed(2)] = 120;
        }

        // Simulate trade ticks in Bookmap
        const tickCount = 18;
        for (let t = 0; t < tickCount; t++) {
            const tradeType = stepData.buyImbalance ? 'buy' : (Math.random() > 0.45 ? 'buy' : 'sell');
            const size = Math.floor(Math.random() * (tradeType === 'buy' ? (stepData.askVolScale || 1) : 1) * 160) + 15;
            
            if (tradeType === 'buy') ofState.cumulativeDelta += size;
            else ofState.cumulativeDelta -= size;

            ofState.bookmapHistory.push({
                time: Date.now() + t * 50,
                price: ofState.spotPrice + (Math.random() - 0.5) * 0.05,
                size: size,
                type: 'trade',
                tradeType: tradeType
            });
            ofState.cumDeltaHistory.push(ofState.cumulativeDelta);
        }

        // Add or update footprint bar
        let currentBar = ofState.footprintBars[ofState.footprintBars.length - 1];
        
        if (ofState.step % 3 === 0 && ofState.step > 0) {
            currentBar = generateMockFootprintBar(Date.now(), currentBar.close, ofState.spotPrice, ofState.spotPrice + 0.4, ofState.spotPrice - 0.4);
            ofState.footprintBars.push(currentBar);
        } else {
            currentBar.close = ofState.spotPrice;
            currentBar.high = Math.max(currentBar.high, ofState.spotPrice + 0.3);
            currentBar.low = Math.min(currentBar.low, ofState.spotPrice - 0.3);
            
            const binKey = ofState.spotPrice.toFixed(2);
            if (!currentBar.bins[binKey]) {
                currentBar.bins[binKey] = { bid_vol: 0, ask_vol: 0, imbalance: 'none' };
            }
            
            const bidAdd = Math.floor(Math.random() * 150) + 20;
            const askAdd = Math.floor(Math.random() * (stepData.askVolScale || 1) * 350) + 50;
            currentBar.bins[binKey].bid_vol += bidAdd;
            currentBar.bins[binKey].ask_vol += askAdd;
            currentBar.total_volume += (bidAdd + askAdd);
            currentBar.bar_delta += (askAdd - bidAdd);
        }

        if (stepData.msg) {
            let alertType = 'system';
            if (stepData.msg.includes('BREAKOUT')) alertType = 'breakout';
            else if (stepData.msg.includes('PULLING')) alertType = 'warning';
            addOrderFlowAlert(alertType, stepData.msg);
        }

        // Simulate L2 resting updates inside steps
        const stepSize = 0.05;
        for (let i = 1; i <= 8; i++) {
            const pBid = (ofState.spotPrice - i * stepSize).toFixed(2);
            const pAsk = (ofState.spotPrice + i * stepSize).toFixed(2);
            ofState.bookmapLiquidity[pBid] = Math.max(10, (ofState.bookmapLiquidity[pBid] || 100) + Math.floor((Math.random() - 0.45) * 220));
            ofState.bookmapLiquidity[pAsk] = Math.max(10, (ofState.bookmapLiquidity[pAsk] || 100) + Math.floor((Math.random() - 0.45) * 220));
        }
        ofState.bookmapLiquidity[ofState.flipLevel.toFixed(2)] = stepData.spot === ofState.flipLevel ? 500 : 1000;
        ofState.bookmapLiquidity[ofState.callWall.toFixed(2)] = 3100;

        renderOrderFlowCharts();
        ofState.step++;
    }, 2000);
}

    // Continuous Random Walk Simulation for live feed
function simulateLiveTick() {
    // Random walk delta
    const drift = 0.05 * (Math.random() - 0.5);
    ofState.spotPrice += drift;

    // Boundary locks
    if (ofState.spotPrice >= ofState.callWall) ofState.spotPrice = ofState.callWall - 0.2;
    if (ofState.spotPrice <= ofState.putWall) ofState.spotPrice = ofState.putWall + 0.2;

    // Simulate random L2 order book adjustments (resting limit updates)
    const stepSize = 0.05;
    for (let i = 1; i <= 8; i++) {
        const pBid = (ofState.spotPrice - i * stepSize).toFixed(2);
        const pAsk = (ofState.spotPrice + i * stepSize).toFixed(2);
        
        if (Math.random() > 0.5) {
            ofState.bookmapLiquidity[pBid] = Math.max(10, (ofState.bookmapLiquidity[pBid] || 100) + Math.floor((Math.random() - 0.45) * 120));
        }
        if (Math.random() > 0.5) {
            ofState.bookmapLiquidity[pAsk] = Math.max(10, (ofState.bookmapLiquidity[pAsk] || 100) + Math.floor((Math.random() - 0.45) * 120));
        }
    }

    const isBuy = Math.random() > 0.48;
    const tickPrice = ofState.spotPrice + (Math.random() - 0.5) * 0.03;
    const tickSize = Math.floor(Math.random() * 120) + 5;

    if (isBuy) ofState.cumulativeDelta += tickSize;
    else ofState.cumulativeDelta -= tickSize;

    // Push to Bookmap cache
    ofState.bookmapHistory.push({
        time: Date.now(),
        price: tickPrice,
        size: tickSize,
        type: 'trade',
        tradeType: isBuy ? 'buy' : 'sell'
    });
    ofState.cumDeltaHistory.push(ofState.cumulativeDelta);

    // Shrink cache size to prevent memory leaks
    if (ofState.bookmapHistory.length > 250) {
        ofState.bookmapHistory.shift();
        ofState.cumDeltaHistory.shift();
    }

    // Update current Footprint bar
    let currentBar = ofState.footprintBars[ofState.footprintBars.length - 1];
    if (!currentBar) {
        currentBar = generateMockFootprintBar(Date.now(), ofState.spotPrice, ofState.spotPrice, ofState.spotPrice, ofState.spotPrice);
        ofState.footprintBars.push(currentBar);
    }

    currentBar.close = ofState.spotPrice;
    currentBar.high = Math.max(currentBar.high, ofState.spotPrice);
    currentBar.low = Math.min(currentBar.low, ofState.spotPrice);

    const binKey = ofState.spotPrice.toFixed(2);
    if (!currentBar.bins[binKey]) {
        currentBar.bins[binKey] = { bid_vol: 0, ask_vol: 0, imbalance: 'none' };
    }

    if (isBuy) {
        currentBar.bins[binKey].ask_vol += tickSize;
        currentBar.bar_delta += tickSize;
    } else {
        currentBar.bins[binKey].bid_vol += tickSize;
        currentBar.bar_delta -= tickSize;
    }
    currentBar.total_volume += tickSize;

    // Dynamic resting book adjustments
    for (let p in ofState.bookmapLiquidity) {
        // Mild noise fluctuations in order depth
        const delta = Math.floor((Math.random() - 0.5) * 40);
        ofState.bookmapLiquidity[p] = Math.max(10, ofState.bookmapLiquidity[p] + delta);
    }
    // High liquidity anchors
    ofState.bookmapLiquidity[ofState.putWall.toFixed(2)] = 2500;
    ofState.bookmapLiquidity[ofState.callWall.toFixed(2)] = 3100;
    ofState.bookmapLiquidity[ofState.flipLevel.toFixed(2)] = 1000;

    // Trigger sporadic alert events
    if (Math.random() > 0.95) {
        const type = Math.random() > 0.5 ? 'absorption' : 'warning';
        const msg = type === 'absorption' 
            ? `Minor absorption pattern detected at ${ofState.spotPrice.toFixed(2)}. Delta neutralizes.` 
            : `Stacking bids observed near ${ofState.putWall.toFixed(2)}. Wall holds.`;
        addOrderFlowAlert(type, msg);
    }

    renderOrderFlowCharts();
}

// Generate raw simulated footprint bar bins
function generateMockFootprintBar(timestamp, open, close, high, low) {
    const minuteBucket = Math.floor(timestamp / 60000) * 60000;
    const bins = {};
    const tickStep = 0.05; // options level resolution
    const startPrice = Math.floor(low / tickStep) * tickStep;
    const endPrice = Math.ceil(high / tickStep) * tickStep;
    
    let totalVol = 0;
    let netDelta = 0;
    
    for (let p = startPrice; p <= endPrice; p += tickStep) {
        const key = p.toFixed(2);
        const bid_vol = Math.floor(Math.random() * 220) + 10;
        const ask_vol = Math.floor(Math.random() * 220) + 10;
        
        bins[key] = { bid_vol, ask_vol, imbalance: 'none' };
        totalVol += (bid_vol + ask_vol);
        netDelta += (ask_vol - bid_vol);
    }

    return {
        time: new Date(minuteBucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        rawTimestamp: minuteBucket,
        open,
        close,
        high,
        low,
        total_volume: totalVol,
        bar_delta: netDelta,
        bins
    };
}

// Bind Settings Modal and Slider UI controls
function setupOrderFlowControls() {
    // Collapsible Stream Configuration Card Header
    const streamHeader = document.getElementById('stream-config-header');
    const streamBody = document.getElementById('stream-config-body');
    const streamChevron = document.getElementById('stream-config-chevron');
    if (streamHeader && streamBody) {
        streamHeader.addEventListener('click', () => {
            const isHidden = streamBody.style.display === 'none';
            streamBody.style.display = isHidden ? 'block' : 'none';
            if (streamChevron) {
                streamChevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        });
    }

    // Feed Mode Dropdown Switch (Live Providers)
    document.getElementById('of-feed-mode').addEventListener('change', (e) => {
        const mode = e.target.value;
        ofState.feedMode = mode;
        const simCard = document.getElementById('of-sim-card');
        if (simCard) simCard.style.display = 'none';
        connectLiveWebSocket(mode);
    });

    // Tick Size Dropdown Consolidation
    document.getElementById('of-tick-consolidation').addEventListener('change', (e) => {
        ofState.tickConsolidation = parseFloat(e.target.value);
        renderOrderFlowCharts();
    });

    // Contrast Slider
    const contrastInput = document.getElementById('of-heatmap-contrast');
    contrastInput.addEventListener('input', (e) => {
        ofState.heatmapContrast = parseInt(e.target.value);
        document.getElementById('of-contrast-val').textContent = `${ofState.heatmapContrast}%`;
        renderOrderFlowCharts();
    });

    // Bubble Size Slider
    const bubbleInput = document.getElementById('of-bubble-scale');
    bubbleInput.addEventListener('input', (e) => {
        ofState.bubbleScale = parseFloat(e.target.value);
        document.getElementById('of-bubble-val').textContent = `${ofState.bubbleScale.toFixed(1)}x`;
        renderOrderFlowCharts();
    });

    // Cumulative Delta Sub-Chart Toggle
    document.getElementById('toggle-cum-delta-btn').addEventListener('click', () => {
        ofState.showCumDelta = !ofState.showCumDelta;
        resizeOrderFlowCanvases();
    });

    // MLOFI Line Toggle
    const toggleMlofiBtn = document.getElementById('toggle-mlofi-btn');
    if (toggleMlofiBtn) {
        toggleMlofiBtn.addEventListener('click', () => {
            ofState.showMlofi = !ofState.showMlofi;
            
            // UX Enhancement: If turning MLOFI on, force display of Cumulative Delta subchart if collapsed
            if (ofState.showMlofi && !ofState.showCumDelta) {
                ofState.showCumDelta = true;
                const cumWrapper = document.getElementById('cum-delta-wrapper');
                if (cumWrapper) cumWrapper.style.display = 'block';
                setTimeout(resizeOrderFlowCanvases, 50);
            }
            
            if (ofState.showMlofi) {
                toggleMlofiBtn.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
                toggleMlofiBtn.style.borderColor = '#f59e0b';
                toggleMlofiBtn.style.color = '#f59e0b';
            } else {
                toggleMlofiBtn.style.backgroundColor = '';
                toggleMlofiBtn.style.borderColor = '';
                toggleMlofiBtn.style.color = '';
            }
            renderOrderFlowCharts();
        });
    }

    // Show Grid Toggle checkbox binding
    const showGridCheck = document.getElementById('of-show-grid');
    if (showGridCheck) {
        showGridCheck.addEventListener('change', (e) => {
            ofState.showGrid = e.target.checked;
            renderOrderFlowCharts();
        });
    }
}

let isSchwabConfigured = false;
let isAlpacaConfigured = false;

function updateSimCardVisibility() {
    const simCard = document.getElementById('of-sim-card');
    if (simCard && (isSchwabConfigured || isAlpacaConfigured)) {
        simCard.style.display = 'none';
    }
}

// Fetch Schwab authentication and configurations status
function checkSchwabStatus() {
    fetch('/api/schwab/status')
        .then(res => res.json())
        .then(data => {
            const configBadge = document.getElementById('schwab-config-status');
            const authBadge = document.getElementById('schwab-auth-status');
            const authBtn = document.getElementById('schwab-auth-btn');

            if (data.configured) {
                configBadge.textContent = "Configured";
                configBadge.className = "status-badge status-green";
                authBtn.removeAttribute('disabled');
                isSchwabConfigured = true;
                updateSimCardVisibility();
            } else {
                configBadge.textContent = "Unconfigured";
                configBadge.className = "status-badge status-red";
                authBtn.setAttribute('disabled', 'true');
                isSchwabConfigured = false;
            }

            if (data.authenticated) {
                authBadge.textContent = "Authenticated";
                authBadge.className = "status-badge status-green";
            } else {
                authBadge.textContent = "Disconnected";
                authBadge.className = "status-badge status-red";
            }
        })
        .catch(err => console.error("Failed to fetch Schwab status:", err));
}

// Save Developer Keys to Backend Config
function saveSchwabCredentials() {
    const key = document.getElementById('schwab-app-key').value;
    const secret = document.getElementById('schwab-app-secret').value;

    fetch(`/api/schwab/save_credentials?appKey=${encodeURIComponent(key)}&appSecret=${encodeURIComponent(secret)}`, {
        method: 'POST'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert("Schwab Credentials saved successfully.");
                checkSchwabStatus();
            } else {
                alert(`Error saving credentials: ${data.message}`);
            }
        })
        .catch(err => alert(`Failed to save credentials: ${err}`));
}

// Open Schwab Login popup
function loginToSchwabAPI() {
    fetch('/api/schwab/login')
        .then(res => res.json())
        .then(data => {
            if (data.url) {
                const width = 600, height = 700;
                const left = (window.innerWidth - width) / 2;
                const top = (window.innerHeight - height) / 2;
                
                // Open pop-up consent window
                window.open(
                    data.url, 
                    'Schwab API Login consent', 
                    `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
                );
            }
        })
        .catch(err => alert(`Failed to generate login consent: ${err}`));
}

// Fetch Alpaca configurations status
function checkAlpacaStatus() {
    fetch('/api/alpaca/status')
        .then(res => res.json())
        .then(data => {
            const configBadge = document.getElementById('alpaca-config-status');
            const keyInput = document.getElementById('alpaca-key-id');
            const secretInput = document.getElementById('alpaca-secret-key');
            if (configBadge) {
                if (data.configured) {
                    configBadge.textContent = "Configured";
                    configBadge.className = "status-badge status-green";
                    if (keyInput) keyInput.value = "••••••••••••••••••••";
                    if (secretInput) secretInput.value = "••••••••••••••••••••";
                    isAlpacaConfigured = true;
                    updateSimCardVisibility();
                } else {
                    configBadge.textContent = "Unconfigured";
                    configBadge.className = "status-badge status-red";
                    if (keyInput) keyInput.value = "";
                    if (secretInput) secretInput.value = "";
                    isAlpacaConfigured = false;
                }
            }
        })
        .catch(err => console.error("Failed to fetch Alpaca status:", err));
}

// Save Alpaca Developer Keys to Backend Config
function saveAlpacaCredentials() {
    const key = document.getElementById('alpaca-key-id').value.trim();
    const secret = document.getElementById('alpaca-secret-key').value.trim();

    if (!key || !secret) {
        alert("Please enter both API Key ID and Secret Key.");
        return;
    }

    if (key.includes('•') || secret.includes('•')) {
        alert("Credentials are already configured and unchanged.");
        return;
    }

    fetch(`/api/alpaca/save_credentials?apiKeyId=${encodeURIComponent(key)}&secretKey=${encodeURIComponent(secret)}`, {
        method: 'POST'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert("Alpaca Credentials saved successfully.");
                checkAlpacaStatus();
            } else {
                alert(`Error saving credentials: ${data.message}`);
            }
        })
        .catch(err => alert(`Failed to save credentials: ${err}`));
}

// Connect to Live FastAPI websocket proxy
function connectLiveWebSocket(provider) {
    // 1. Clear any pending reconnect timer
    if (ofState.reconnectTimer) {
        clearTimeout(ofState.reconnectTimer);
        ofState.reconnectTimer = null;
    }

    // 2. Clear any active ping keepalive interval
    if (ofState.pingInterval) {
        clearInterval(ofState.pingInterval);
        ofState.pingInterval = null;
    }

    // 3. Unbind event listeners before closing previous socket to prevent trigger cascades
    if (ofState.liveSocket) {
        ofState.liveSocket.onopen = null;
        ofState.liveSocket.onmessage = null;
        ofState.liveSocket.onclose = null;
        ofState.liveSocket.onerror = null;
        try {
            if (ofState.liveSocket.readyState === WebSocket.OPEN || ofState.liveSocket.readyState === WebSocket.CONNECTING) {
                ofState.liveSocket.close();
            }
        } catch (e) {}
        ofState.liveSocket = null;
    }

    if (ofState.simInterval) {
        clearInterval(ofState.simInterval);
        ofState.simInterval = null;
    }

    const activeProvider = provider || ofState.feedMode;
    ofState.feedMode = activeProvider;

    addOrderFlowAlert('system', `Connecting to ${activeProvider.toUpperCase()} WebSocket proxy for ${currentSymbol}...`);
    updateStreamStatus('connecting', activeProvider);
    
    const host = window.location.host || '127.0.0.1:8000';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}/api/orderflow/live?symbol=${currentSymbol}&provider=${activeProvider}`;
    
    const socket = new WebSocket(wsUrl);
    ofState.liveSocket = socket;

    socket.onopen = () => {
        if (ofState.liveSocket !== socket) return;
        addOrderFlowAlert('system', `Live ${activeProvider.toUpperCase()} Connection active. Streaming ${currentSymbol}.`);
        updateStreamStatus('streaming', activeProvider);
        ofState.reconnectAttempts = 0; // Reset backoff on successful connect
        
        // Start 15s PING keepalive interval to prevent proxy idle timeouts
        ofState.pingInterval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send("PING");
            }
        }, 15000);

        renderOrderFlowCharts();
    };

    socket.onmessage = (event) => {
        if (ofState.liveSocket !== socket) return;
        
        if (event.data === "PONG") return; // Heartbeat response

        try {
            const payload = JSON.parse(event.data);
            
            // Handle informational updates (e.g. background reconnects)
            if (payload.info) {
                addOrderFlowAlert('system', payload.info);
                updateStreamStatus('connecting', activeProvider);
                return;
            }

            // Handle error responses from proxy
            if (payload.error) {
                addOrderFlowAlert('warning', `${payload.error}`);
                updateStreamStatus('disconnected');
                return;
            }

            if (payload.source === 'schwab') {
                updateStreamStatus('streaming', activeProvider);
                processSchwabStreamTick(payload.data);
            }
        } catch (err) {
            console.error("Error parsing WS frame:", err);
        }
    };

    socket.onclose = () => {
        if (ofState.liveSocket !== socket) return;
        
        if (ofState.pingInterval) {
            clearInterval(ofState.pingInterval);
            ofState.pingInterval = null;
        }

        addOrderFlowAlert('warning', `${activeProvider.toUpperCase()} stream closed. Reconnecting...`);
        updateStreamStatus('disconnected');
        
        if (ofState.feedMode === activeProvider) {
            const attempts = (ofState.reconnectAttempts || 0) + 1;
            ofState.reconnectAttempts = attempts;
            const backoffMs = Math.min(1000 * Math.pow(1.5, attempts), 10000);
            
            ofState.reconnectTimer = setTimeout(() => {
                ofState.reconnectTimer = null;
                if (ofState.feedMode === activeProvider) {
                    connectLiveWebSocket(activeProvider);
                }
            }, backoffMs);
        }
    };

    socket.onerror = (err) => {
        if (ofState.liveSocket !== socket) return;
        console.error("FastAPI WebSocket error:", err);
        updateStreamStatus('disconnected');
    };
}

// Parse live Schwab WebSocket feeds
function processSchwabStreamTick(payload) {
    if (!payload || !payload.data) return;

    // Handle LEVELONE_EQUITIES (Trades & Quotes)
    // Format is standard Schwab API WS dictionary list response
    const dataList = payload.data;
    dataList.forEach(item => {
        const service = item.service;
        const content = item.content;
        
        if (!content) return;
        
        content.forEach(tick => {
            const symbol = tick.key;
            if (symbol !== currentSymbol) return;

            // 1. Process LEVELONE_EQUITIES trade updates
            if (service === 'LEVELONE_EQUITIES') {
                const lastPrice = tick['3']; // Last Price
                const lastSize = tick['4'];  // Last Size (volume)
                const bidPrice = tick['1'];  // Bid
                const askPrice = tick['2'];  // Ask
                
                if (lastPrice !== undefined) {
                    ofState.spotPrice = lastPrice;
                    
                    // Categorize as buy/sell via midpoint rule (Lee-Ready)
                    let tradeType = 'buy';
                    if (bidPrice && askPrice) {
                        const mid = (bidPrice + askPrice) / 2;
                        tradeType = lastPrice > mid ? 'buy' : 'sell';
                    }
                    
                    const tradeSize = lastSize || 1;
                    
                    if (tradeType === 'buy') ofState.cumulativeDelta += tradeSize;
                    else ofState.cumulativeDelta -= tradeSize;

                    // Push to Bookmap
                    ofState.bookmapHistory.push({
                        time: Date.now(),
                        price: lastPrice,
                        size: tradeSize,
                        type: 'trade',
                        tradeType: tradeType
                    });
                    ofState.cumDeltaHistory.push(ofState.cumulativeDelta);
                    if (ofState.bookmapHistory.length > 250) {
                        ofState.bookmapHistory.shift();
                        ofState.cumDeltaHistory.shift();
                    }

                    // Update Footprint
                    updateFootprintTick(lastPrice, tradeSize, tradeType);
                }
            }

            // 2. Process NASDAQ_BOOK level 2 depth updates
            if (service === 'NASDAQ_BOOK') {
                // Book details contain bid/ask levels
                // Schwab format packs prices/bids as lists in content
                const bids = tick.bids || [];
                const asks = tick.asks || [];
                
                bids.forEach(bid => {
                    const price = parseFloat(bid.price).toFixed(2);
                    ofState.bookmapLiquidity[price] = parseInt(bid.size);
                });
                
                asks.forEach(ask => {
                    const price = parseFloat(ask.price).toFixed(2);
                    ofState.bookmapLiquidity[price] = parseInt(ask.size);
                });
            }
        });
    });

    renderOrderFlowCharts();
}

function updateFootprintTick(price, size, type) {
    const now = Date.now();
    const currentMinuteBucket = Math.floor(now / 60000) * 60000;

    let currentBar = ofState.footprintBars[ofState.footprintBars.length - 1];

    // Check if no bar exists or if the current minute has rolled over into a new minute
    if (!currentBar || !currentBar.rawTimestamp || currentMinuteBucket > currentBar.rawTimestamp) {
        const formattedTime = new Date(currentMinuteBucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        currentBar = {
            time: formattedTime,
            rawTimestamp: currentMinuteBucket,
            open: price,
            close: price,
            high: price,
            low: price,
            total_volume: 0,
            bar_delta: 0,
            bins: {}
        };
        ofState.footprintBars.push(currentBar);

        // Keep maximum 50 bars to maintain smooth rendering performance
        if (ofState.footprintBars.length > 50) {
            ofState.footprintBars.shift();
        }
    }

    currentBar.close = price;
    currentBar.high = Math.max(currentBar.high, price);
    currentBar.low = Math.min(currentBar.low, price);
    currentBar.total_volume += size;

    const binKey = price.toFixed(2);
    if (!currentBar.bins[binKey]) {
        currentBar.bins[binKey] = { bid_vol: 0, ask_vol: 0, imbalance: 'none' };
    }

    if (type === 'buy') {
        currentBar.bins[binKey].ask_vol += size;
        currentBar.bar_delta += size;
    } else {
        currentBar.bins[binKey].bid_vol += size;
        currentBar.bar_delta -= size;
    }
}

// Mouse dragging, wheel zooming, and Auto-Fit buttons for Footprint & Bookmap
function setupFootprintInteraction() {
    if (!fpCanvas) return;

    // --- Footprint Drag & Zoom ---
    fpCanvas.addEventListener('mousedown', (e) => {
        ofState.isDragging = true;
        const rect = fpCanvas.getBoundingClientRect();
        ofState.dragStart.x = e.clientX - rect.left;
        ofState.dragStart.y = e.clientY - rect.top;
    });

    fpCanvas.addEventListener('mousemove', (e) => {
        if (!ofState.isDragging) return;
        const rect = fpCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        ofState.panOffset.x += (x - ofState.dragStart.x) * window.devicePixelRatio;
        ofState.panOffset.y += (y - ofState.dragStart.y) * window.devicePixelRatio;
        
        ofState.dragStart.x = x;
        ofState.dragStart.y = y;
        renderOrderFlowCharts();
    });

    window.addEventListener('mouseup', () => {
        ofState.isDragging = false;
    });

    fpCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSpeed = 0.08;
        const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
        
        if (e.shiftKey) {
            // Shift + Wheel adjusts vertical cell height / Y-zoom
            ofState.yZoomLevel = Math.min(4.0, Math.max(0.4, ofState.yZoomLevel + delta));
        } else {
            // Standard Wheel adjusts horizontal column width
            const oldZoom = ofState.zoomLevel;
            ofState.zoomLevel = Math.min(3.5, Math.max(0.4, ofState.zoomLevel + delta));
            
            const rect = fpCanvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) * window.devicePixelRatio;
            ofState.panOffset.x = mouseX - (mouseX - ofState.panOffset.x) * (ofState.zoomLevel / oldZoom);
        }
        
        renderOrderFlowCharts();
    }, { passive: false });

    // --- Bookmap Drag & Zoom ---
    if (bmCanvas) {
        let isBmDragging = false;
        let bmDragStart = { x: 0, y: 0 };

        bmCanvas.addEventListener('mousedown', (e) => {
            isBmDragging = true;
            const rect = bmCanvas.getBoundingClientRect();
            bmDragStart.x = e.clientX - rect.left;
            bmDragStart.y = e.clientY - rect.top;
        });

        bmCanvas.addEventListener('mousemove', (e) => {
            if (!isBmDragging) return;
            const rect = bmCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            ofState.panOffset.y += (y - bmDragStart.y) * window.devicePixelRatio;
            bmDragStart.x = x;
            bmDragStart.y = y;
            renderOrderFlowCharts();
        });

        window.addEventListener('mouseup', () => {
            isBmDragging = false;
        });

        bmCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = 0.08;
            const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
            ofState.yZoomLevel = Math.min(4.0, Math.max(0.4, ofState.yZoomLevel + delta));
            renderOrderFlowCharts();
        }, { passive: false });
    }

    // --- Control Buttons ---
    const resetFn = () => {
        ofState.panOffset = { x: 0, y: 0 };
        ofState.zoomLevel = 1.0;
        ofState.yZoomLevel = 1.0;
        renderOrderFlowCharts();
    };

    const fpAutofitBtn = document.getElementById('fp-autofit-btn');
    if (fpAutofitBtn) fpAutofitBtn.onclick = resetFn;

    const bmAutofitBtn = document.getElementById('bm-autofit-btn');
    if (bmAutofitBtn) bmAutofitBtn.onclick = resetFn;

    const fpZoomInBtn = document.getElementById('fp-zoomin-y-btn');
    if (fpZoomInBtn) fpZoomInBtn.onclick = () => {
        ofState.yZoomLevel = Math.min(4.0, ofState.yZoomLevel + 0.25);
        renderOrderFlowCharts();
    };

    const fpZoomOutBtn = document.getElementById('fp-zoomout-y-btn');
    if (fpZoomOutBtn) fpZoomOutBtn.onclick = () => {
        ofState.yZoomLevel = Math.max(0.4, ofState.yZoomLevel - 0.25);
        renderOrderFlowCharts();
    };
}

// Tick Consolidation algorithm & Diagonal Imbalance evaluation
function getConsolidatedBins(rawBins, tickSize) {
    const consolidated = {};
    for (let rawPriceStr in rawBins) {
        const rawPrice = parseFloat(rawPriceStr);
        const consolidatedPrice = Math.floor(rawPrice / tickSize) * tickSize;
        const key = consolidatedPrice.toFixed(2);
        
        if (!consolidated[key]) {
            consolidated[key] = { bid_vol: 0, ask_vol: 0, imbalance: 'none' };
        }
        
        consolidated[key].bid_vol += rawBins[rawPriceStr].bid_vol;
        consolidated[key].ask_vol += rawBins[rawPriceStr].ask_vol;
    }
    
    // Evaluate diagonal imbalances inside consolidated buckets
    const sortedPrices = Object.keys(consolidated).map(Number).sort((a, b) => a - b);
    const imbalanceRatio = ofState.imbalanceRatio || 3.0;

    for (let i = 1; i < sortedPrices.length; i++) {
        const pCurrent = sortedPrices[i].toFixed(2);
        const pBelow = sortedPrices[i - 1].toFixed(2);

        const askCurr = consolidated[pCurrent].ask_vol;
        const bidBelow = consolidated[pBelow].bid_vol;

        // Buying Imbalance at pCurrent if Ask[pCurrent] >= 3.0 * Bid[pBelow]
        if (askCurr >= Math.max(8, bidBelow * imbalanceRatio)) {
            consolidated[pCurrent].imbalance = 'buy';
        }

        // Selling Imbalance at pBelow if Bid[pBelow] >= 3.0 * Ask[pCurrent]
        if (bidBelow >= Math.max(8, askCurr * imbalanceRatio)) {
            consolidated[pBelow].imbalance = 'sell';
        }
    }
    
    return consolidated;
}

// DRAWING: Enhanced Footprint Chart & Right-Anchored Volume Profile
function drawFootprint() {
    if (!fpCanvas || !fpCtx) return;

    let w = fpCanvas.width;
    let h = fpCanvas.height;

    if (w <= 20 || h <= 20) {
        const parent = fpCanvas.parentElement;
        const rect = parent ? parent.getBoundingClientRect() : null;
        let parentW = (rect && rect.width > 50) ? rect.width : (parent ? parent.clientWidth : 900);
        let parentH = (rect && rect.height > 50) ? rect.height : (parent ? parent.clientHeight : 480);
        if (parentW <= 50) parentW = 900;
        if (parentH <= 50) parentH = 480;

        fpCanvas.width = Math.floor(parentW * window.devicePixelRatio);
        fpCanvas.height = Math.floor(parentH * window.devicePixelRatio);
        fpCanvas.style.width = Math.floor(parentW) + 'px';
        fpCanvas.style.height = Math.floor(parentH) + 'px';
        w = fpCanvas.width;
        h = fpCanvas.height;
    }

    const ctx = fpCtx;
    ctx.clearRect(0, 0, w, h);

    const padLeft = 60 * window.devicePixelRatio;
    const padRight = 75 * window.devicePixelRatio;
    const padTop = 30 * window.devicePixelRatio;
    const padBot = 45 * window.devicePixelRatio;
    
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBot;

    // 1. Calculate price bounds tight to active footprint bars
    let activeMax = -Infinity;
    let activeMin = Infinity;
    
    if (ofState.footprintBars && ofState.footprintBars.length > 0) {
        ofState.footprintBars.forEach(bar => {
            if (bar.high !== undefined) activeMax = Math.max(activeMax, bar.high);
            if (bar.low !== undefined) activeMin = Math.min(activeMin, bar.low);
        });
    }

    if (activeMin === Infinity || activeMax === -Infinity) {
        activeMax = ofState.spotPrice + 1.5;
        activeMin = ofState.spotPrice - 1.5;
    }

    const midPrice = (activeMax + activeMin) / 2 || ofState.spotPrice;
    const rawSpan = Math.max(1.5, activeMax - activeMin);

    const step = ofState.tickConsolidation || 0.50;
    const targetCellHeight = 22 * window.devicePixelRatio;
    const maxVisibleRows = Math.max(6, Math.floor(chartH / targetCellHeight));
    const targetSpan = maxVisibleRows * step;
    
    const yZoom = ofState.yZoomLevel || 1.0;
    const finalSpan = Math.max(rawSpan + 0.8, targetSpan) / yZoom;

    let minPrice = midPrice - finalSpan / 2;
    let maxPrice = midPrice + finalSpan / 2;
    const priceRange = maxPrice - minPrice;

    // Coordinate mappers
    const getX = (index) => {
        const barCount = ofState.footprintBars.length;
        const colW = (chartW / Math.max(5, barCount)) * ofState.zoomLevel;
        return padLeft + index * colW + colW / 2 + ofState.panOffset.x;
    };

    const getY = (price) => {
        const baseOffset = padTop + chartH;
        const scale = chartH / priceRange;
        return baseOffset - (price - minPrice) * scale + ofState.panOffset.y;
    };

    // Helper: Draw GEX / Profile Lines with Off-Screen Badges
    const drawGexLine = (price, color, label) => {
        if (price === null || price === undefined || isNaN(price)) return;
        const y = getY(price);
        
        ctx.save();
        if (y < padTop) {
            const badgeW = 75 * window.devicePixelRatio;
            const badgeH = 15 * window.devicePixelRatio;
            const badgeX = padLeft + 10;
            const badgeY = padTop + 2;
            
            ctx.fillStyle = 'rgba(7, 9, 19, 0.88)';
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 * window.devicePixelRatio;
            ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
            
            ctx.fillStyle = color;
            ctx.font = `bold ${8.5 * window.devicePixelRatio}px Outfit`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`▲ ${label}: $${price.toFixed(1)}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
        } else if (y > padTop + chartH) {
            const badgeW = 75 * window.devicePixelRatio;
            const badgeH = 15 * window.devicePixelRatio;
            const badgeX = padLeft + 10;
            const badgeY = padTop + chartH - badgeH - 2;
            
            ctx.fillStyle = 'rgba(7, 9, 19, 0.88)';
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1 * window.devicePixelRatio;
            ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
            
            ctx.fillStyle = color;
            ctx.font = `bold ${8.5 * window.devicePixelRatio}px Outfit`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`▼ ${label}: $${price.toFixed(1)}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
        } else {
            ctx.beginPath();
            if (label !== "5D POC" && label !== "POC") ctx.setLineDash([5, 5]);
            ctx.strokeStyle = color;
            ctx.lineWidth = (label.includes("POC") ? 2.5 : 1.5) * window.devicePixelRatio;
            ctx.moveTo(padLeft, y);
            ctx.lineTo(w - padRight, y);
            ctx.stroke();

            // Label pill on left margin
            ctx.fillStyle = '#070913';
            ctx.fillRect(6, y - 8 * window.devicePixelRatio, padLeft - 12, 16 * window.devicePixelRatio);
            ctx.fillStyle = color;
            ctx.font = `bold ${9.5 * window.devicePixelRatio}px Outfit`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, 6, y);
        }
        ctx.restore();
    };

    // Draw GEX Level Overlays
    drawGexLine(ofState.callWall, '#3b82f6', 'Call Wall');
    drawGexLine(ofState.putWall, '#f43f5e', 'Put Wall');
    drawGexLine(ofState.flipLevel, '#f59e0b', 'GEX Flip');
    if (ofState.maxGammaStrike) drawGexLine(ofState.maxGammaStrike, '#00e1ff', 'Max Gamma');
    if (ofState.volumeProfilePoc) drawGexLine(ofState.volumeProfilePoc, '#eab308', '5D POC');
    if (ofState.volumeProfileVah) drawGexLine(ofState.volumeProfileVah, '#6366f1', '5D VAH');
    if (ofState.volumeProfileVal) drawGexLine(ofState.volumeProfileVal, '#ec4899', '5D VAL');

    // 2. Right-Anchored Volume Profile Histogram & POC / VAH / VAL
    if (ofState.volumeProfileBins && ofState.volumeProfileBins.length > 0) {
        ctx.save();
        let maxVol = 0;
        ofState.volumeProfileBins.forEach(bin => {
            if (bin.volume > maxVol) maxVol = bin.volume;
        });
        
        if (maxVol > 0) {
            const maxBarW = chartW * 0.22;
            const val = ofState.volumeProfileVal || 0;
            const vah = ofState.volumeProfileVah || 999999;
            
            ofState.volumeProfileBins.forEach(bin => {
                const price = bin.price;
                const volume = bin.volume;
                const y = getY(price);
                
                if (y >= padTop && y <= padTop + chartH) {
                    const barW = (volume / maxVol) * maxBarW;
                    const binH = Math.max(3, (chartH / Math.max(10, ofState.volumeProfileBins.length)));
                    const x = w - padRight - barW;
                    
                    if (price >= val && price <= vah) {
                        ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';
                        ctx.strokeStyle = 'rgba(59, 130, 246, 0.75)';
                    } else {
                        ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
                        ctx.strokeStyle = 'rgba(148, 163, 184, 0.30)';
                    }
                    ctx.lineWidth = 1 * window.devicePixelRatio;
                    ctx.fillRect(x, y - binH / 2, barW, binH - 1);
                    ctx.strokeRect(x, y - binH / 2, barW, binH - 1);
                }
            });
        }
        ctx.restore();
    }

    // 3. Detect and Draw Stacked Imbalance Zones (>= 2 consecutive levels)
    const barCount = ofState.footprintBars.length;
    const colW = (chartW / Math.max(5, barCount)) * ofState.zoomLevel;
    const cellH = Math.abs(getY(0) - getY(step));

    const stackedZones = [];
    ofState.footprintBars.forEach((bar, idx) => {
        const bins = getConsolidatedBins(bar.bins, step);
        const sortedPrices = Object.keys(bins).map(Number).sort((a, b) => a - b);
        
        let buyStreak = [];
        let sellStreak = [];
        
        sortedPrices.forEach(p => {
            const key = p.toFixed(2);
            const imb = bins[key].imbalance;
            
            if (imb === 'buy') {
                buyStreak.push(p);
            } else {
                if (buyStreak.length >= 2) {
                    stackedZones.push({ type: 'buy', minPrice: buyStreak[0], maxPrice: buyStreak[buyStreak.length - 1], barIdx: idx });
                }
                buyStreak = [];
            }
            
            if (imb === 'sell') {
                sellStreak.push(p);
            } else {
                if (sellStreak.length >= 2) {
                    stackedZones.push({ type: 'sell', minPrice: sellStreak[0], maxPrice: sellStreak[sellStreak.length - 1], barIdx: idx });
                }
                sellStreak = [];
            }
        });
        
        if (buyStreak.length >= 2) {
            stackedZones.push({ type: 'buy', minPrice: buyStreak[0], maxPrice: buyStreak[buyStreak.length - 1], barIdx: idx });
        }
        if (sellStreak.length >= 2) {
            stackedZones.push({ type: 'sell', minPrice: sellStreak[0], maxPrice: sellStreak[sellStreak.length - 1], barIdx: idx });
        }
    });

    // Render horizontal Stacked Imbalance Zones extending to the right
    stackedZones.forEach(zone => {
        const xStart = getX(zone.barIdx) - colW / 2;
        const xEnd = w - padRight;
        const y1 = getY(zone.maxPrice + step / 2);
        const y2 = getY(zone.minPrice - step / 2);
        const zoneH = Math.abs(y2 - y1);
        const topY = Math.min(y1, y2);

        if (topY + zoneH >= padTop && topY <= padTop + chartH) {
            ctx.save();
            if (zone.type === 'buy') {
                ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
                ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
            } else {
                ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
                ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
            }
            ctx.lineWidth = 1.2 * window.devicePixelRatio;
            ctx.setLineDash([4, 2]);
            ctx.fillRect(xStart, topY, xEnd - xStart, zoneH);
            ctx.strokeRect(xStart, topY, xEnd - xStart, zoneH);

            // Zone tag
            ctx.setLineDash([]);
            ctx.fillStyle = zone.type === 'buy' ? '#10b981' : '#f43f5e';
            ctx.font = `bold ${8.5 * window.devicePixelRatio}px Outfit`;
            ctx.textAlign = 'left';
            ctx.fillText(`${zone.type.toUpperCase()} STACKED`, xStart + 4, topY + zoneH / 2);
            ctx.restore();
        }
    });

    // 4. Draw Grid Lines & Right Price Axis
    ctx.save();
    const yTickStep = priceRange > 15 ? 2.5 : (priceRange > 6 ? 1.0 : (priceRange > 2 ? 0.50 : 0.25));
    const startYTick = Math.ceil(minPrice / yTickStep) * yTickStep;

    if (ofState.showGrid) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1 * window.devicePixelRatio;
        for (let p = startYTick; p <= maxPrice; p += yTickStep) {
            const y = getY(p);
            if (y >= padTop && y <= padTop + chartH) {
                ctx.beginPath();
                ctx.moveTo(padLeft, y);
                ctx.lineTo(w - padRight, y);
                ctx.stroke();
            }
        }
        for (let i = 0; i < barCount; i++) {
            const x = getX(i);
            if (x >= padLeft && x <= padLeft + chartW) {
                ctx.beginPath();
                ctx.moveTo(x, padTop);
                ctx.lineTo(x, padTop + chartH);
                ctx.stroke();
            }
        }
    }

    // Right Y-Axis Price Labels
    ctx.fillStyle = '#6b7280';
    ctx.font = `${9.5 * window.devicePixelRatio}px Outfit`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let p = startYTick; p <= maxPrice; p += yTickStep) {
        const y = getY(p);
        if (y >= padTop && y <= padTop + chartH) {
            ctx.fillText(`$${p.toFixed(2)}`, w - padRight + 8, y);
        }
    }
    ctx.restore();

    // 5. Draw Footprint Bars (Color Coded Bid/Ask, Middle Candlestick + Wicks, Net Delta Footers)
    ofState.footprintBars.forEach((bar, idx) => {
        const x = getX(idx);
        if (x < padLeft - colW / 2 || x > w - padRight + colW / 2) return;

        const bins = getConsolidatedBins(bar.bins, step);
        let pocPrice = parseFloat(Object.keys(bins)[0]);
        let maxCellVol = 1;
        
        for (let pStr in bins) {
            const sum = bins[pStr].bid_vol + bins[pStr].ask_vol;
            if (sum > maxCellVol) {
                maxCellVol = sum;
                pocPrice = parseFloat(pStr);
            }
        }

        const lowBound = Math.floor(bar.low / step) * step;
        const highBound = Math.ceil(bar.high / step) * step;

        const candleW = Math.max(4 * window.devicePixelRatio, Math.min(10 * window.devicePixelRatio, colW * 0.10));
        const cellW = colW * 0.90;
        const subW = Math.max(4, (cellW - candleW) / 2);

        // A. Draw Middle Candlestick Wick (High to Low)
        ctx.save();
        ctx.strokeStyle = bar.close >= bar.open ? '#10b981' : '#f43f5e';
        ctx.lineWidth = 2 * window.devicePixelRatio;
        ctx.beginPath();
        ctx.moveTo(x, getY(bar.high));
        ctx.lineTo(x, getY(bar.low));
        ctx.stroke();

        // B. Draw Middle Candlestick Body (Open to Close)
        const yOpen = getY(bar.open);
        const yClose = getY(bar.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(3 * window.devicePixelRatio, Math.abs(yClose - yOpen));
        
        ctx.fillStyle = bar.close >= bar.open ? '#10b981' : '#f43f5e';
        ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 0.8 * window.devicePixelRatio;
        ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH);
        ctx.restore();

        // C. Draw Bid & Ask Sub-Boxes with Volume Intensity Shading
        let hasBullAbsorption = false;
        let hasBearAbsorption = false;

        ctx.save();
        for (let p = lowBound; p <= highBound + (step * 0.1); p += step) {
            const key = p.toFixed(2);
            const bin = bins[key];
            if (!bin) continue;

            const y = getY(p);
            if (y < padTop - cellH || y > padTop + chartH + cellH) continue;

            const bidX = x - candleW / 2 - subW;
            const askX = x + candleW / 2;

            // Volume Tier Shading (Light, Medium, Dark)
            const bidRatio = bin.bid_vol / maxCellVol;
            const askRatio = bin.ask_vol / maxCellVol;

            // Bid Sub-Box Color (Red Tiers)
            let bidFill = 'rgba(244, 63, 94, 0.15)';
            if (bidRatio >= 0.70) bidFill = 'rgba(244, 63, 94, 0.75)';
            else if (bidRatio >= 0.35) bidFill = 'rgba(244, 63, 94, 0.42)';

            // Ask Sub-Box Color (Green Tiers)
            let askFill = 'rgba(16, 185, 129, 0.15)';
            if (askRatio >= 0.70) askFill = 'rgba(16, 185, 129, 0.75)';
            else if (askRatio >= 0.35) askFill = 'rgba(16, 185, 129, 0.42)';

            // Draw Bid Sub-Box (Left)
            ctx.fillStyle = bidFill;
            ctx.fillRect(bidX, y - cellH / 2, subW, cellH);
            ctx.strokeStyle = bin.imbalance === 'sell' ? '#f43f5e' : 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = (bin.imbalance === 'sell' ? 1.5 : 0.6) * window.devicePixelRatio;
            ctx.strokeRect(bidX, y - cellH / 2, subW, cellH);

            // Draw Ask Sub-Box (Right)
            ctx.fillStyle = askFill;
            ctx.fillRect(askX, y - cellH / 2, subW, cellH);
            ctx.strokeStyle = bin.imbalance === 'buy' ? '#10b981' : 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = (bin.imbalance === 'buy' ? 1.5 : 0.6) * window.devicePixelRatio;
            ctx.strokeRect(askX, y - cellH / 2, subW, cellH);

            // POC Highlight Border around entire cell (Purple/Violet)
            if (Math.abs(p - pocPrice) < 0.01) {
                ctx.strokeStyle = '#a855f7';
                ctx.lineWidth = 1.8 * window.devicePixelRatio;
                ctx.strokeRect(bidX - 1, y - cellH / 2 + 1, subW * 2 + candleW + 2, cellH - 2);
            }

            // Absorption Detection: heavy volume at extremes followed by price rejection
            const isLowExtreme = Math.abs(p - bar.low) < step * 0.5;
            const isHighExtreme = Math.abs(p - bar.high) < step * 0.5;

            if (isLowExtreme && bin.bid_vol > maxCellVol * 0.75 && bar.close > bar.open) {
                hasBullAbsorption = true;
                ctx.strokeStyle = '#00e1ff';
                ctx.lineWidth = 2 * window.devicePixelRatio;
                ctx.strokeRect(bidX, y - cellH / 2, subW, cellH);
            }
            if (isHighExtreme && bin.ask_vol > maxCellVol * 0.75 && bar.close < bar.open) {
                hasBearAbsorption = true;
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = 2 * window.devicePixelRatio;
                ctx.strokeRect(askX, y - cellH / 2, subW, cellH);
            }

            // Render Bid & Ask Volume Numbers
            if (cellH >= 10 * window.devicePixelRatio) {
                const fontSize = Math.max(8.5, Math.min(12, (cellH / window.devicePixelRatio) * 0.52));
                ctx.font = `600 ${fontSize * window.devicePixelRatio}px Outfit`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Bid Vol Text (Left)
                ctx.fillStyle = bin.imbalance === 'sell' ? '#ffffff' : (bidRatio >= 0.35 ? '#ffffff' : '#cbd5e1');
                ctx.fillText(bin.bid_vol.toString(), bidX + subW / 2, y);

                // Ask Vol Text (Right)
                ctx.fillStyle = bin.imbalance === 'buy' ? '#ffffff' : (askRatio >= 0.35 ? '#ffffff' : '#cbd5e1');
                ctx.fillText(bin.ask_vol.toString(), askX + subW / 2, y);
            }
        }

        // Absorption Badge Indicators (Visible & Off-Screen)
        const yLow = getY(bar.low);
        const yHigh = getY(bar.high);

        if (hasBullAbsorption) {
            if (yLow >= padTop && yLow <= padTop + chartH) {
                ctx.fillStyle = '#00e1ff';
                ctx.font = `bold ${8.5 * window.devicePixelRatio}px Outfit`;
                ctx.textAlign = 'center';
                ctx.fillText('ABS ▲', x, yLow + 12 * window.devicePixelRatio);
            } else if (yLow > padTop + chartH) {
                // Off-screen indicator at bottom margin
                const bw = 70 * window.devicePixelRatio;
                const bh = 14 * window.devicePixelRatio;
                ctx.fillStyle = 'rgba(7, 9, 19, 0.9)';
                ctx.fillRect(x - bw / 2, padTop + chartH - bh - 2, bw, bh);
                ctx.strokeStyle = '#00e1ff';
                ctx.lineWidth = 1 * window.devicePixelRatio;
                ctx.strokeRect(x - bw / 2, padTop + chartH - bh - 2, bw, bh);
                ctx.fillStyle = '#00e1ff';
                ctx.font = `bold ${8 * window.devicePixelRatio}px Outfit`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`▼ ABS $${bar.low.toFixed(1)}`, x, padTop + chartH - bh / 2 - 2);
            }
        }
        if (hasBearAbsorption) {
            if (yHigh >= padTop && yHigh <= padTop + chartH) {
                ctx.fillStyle = '#f43f5e';
                ctx.font = `bold ${8.5 * window.devicePixelRatio}px Outfit`;
                ctx.textAlign = 'center';
                ctx.fillText('ABS ▼', x, yHigh - 8 * window.devicePixelRatio);
            } else if (yHigh < padTop) {
                // Off-screen indicator at top margin
                const bw = 70 * window.devicePixelRatio;
                const bh = 14 * window.devicePixelRatio;
                ctx.fillStyle = 'rgba(7, 9, 19, 0.9)';
                ctx.fillRect(x - bw / 2, padTop + 2, bw, bh);
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = 1 * window.devicePixelRatio;
                ctx.strokeRect(x - bw / 2, padTop + 2, bw, bh);
                ctx.fillStyle = '#f43f5e';
                ctx.font = `bold ${8 * window.devicePixelRatio}px Outfit`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`▲ ABS $${bar.high.toFixed(1)}`, x, padTop + 2 + bh / 2);
            }
        }

        // D. Render Net Delta at Bottom of Footprint Bar Column
        const netDelta = bar.bar_delta;
        const deltaStr = (netDelta > 0 ? '+' : '') + netDelta;
        ctx.fillStyle = netDelta >= 0 ? '#10b981' : '#f43f5e';
        ctx.font = `bold ${10 * window.devicePixelRatio}px Outfit`;
        ctx.textAlign = 'center';
        ctx.fillText(deltaStr, x, padTop + chartH + 16 * window.devicePixelRatio);

        // Bar Time Label
        ctx.fillStyle = '#94a3b8';
        ctx.font = `${8.5 * window.devicePixelRatio}px Outfit`;
        ctx.textAlign = 'center';
        ctx.fillText(bar.time, x, h - 10 * window.devicePixelRatio);
        ctx.restore();
    });
    
    // Render dynamic statistical footers aligned to footprint columns
    renderFootprintStatsFooter(colW, padLeft, padRight);
}

// Render dynamic statistical footers aligned to footprint columns
function renderFootprintStatsFooter(colW, padLeft, padRight) {
    const container = document.getElementById('footprint-stats-wrapper');
    if (!container) return;

    container.innerHTML = '';

    // Create labels col
    const labelsCol = document.createElement('div');
    labelsCol.className = 'fp-stat-label-col';
    labelsCol.innerHTML = `
        <div>Volume:</div>
        <div>Delta:</div>
        <div>Cum Dlt:</div>
        <div>Delta %:</div>
    `;
    container.appendChild(labelsCol);

    let runningDeltaSum = 0;
    
    ofState.footprintBars.forEach((bar, idx) => {
        runningDeltaSum += bar.bar_delta;
        
        // Calculate X coordinate
        const barCount = ofState.footprintBars.length;
        const x = padLeft + idx * colW + ofState.panOffset.x;
        
        // Skip elements scrolling off canvas view ports
        if (x < padLeft || x > fpCanvas.width - padRight) return;

        const deltaPct = ((bar.bar_delta / (bar.total_volume || 1)) * 100).toFixed(0);

        const barDataCol = document.createElement('div');
        barDataCol.className = 'fp-stat-bar-data';
        barDataCol.style.position = 'absolute';
        barDataCol.style.left = `${x / window.devicePixelRatio}px`;
        barDataCol.style.width = `${colW / window.devicePixelRatio}px`;
        
        const deltaColorClass = bar.bar_delta >= 0 ? 'text-green' : 'text-red';

        barDataCol.innerHTML = `
            <div>${formatCompact(bar.total_volume)}</div>
            <div class="${deltaColorClass}">${bar.bar_delta > 0 ? '+' : ''}${bar.bar_delta}</div>
            <div class="${runningDeltaSum >= 0 ? 'text-green' : 'text-red'}">${runningDeltaSum}</div>
            <div class="${deltaColorClass}">${deltaPct}%</div>
        `;
        
        container.appendChild(barDataCol);
    });
}

// DRAWING: Bookmap Heatmap + Cumulative Delta (Dual Scrolling Canvas)
function drawBookmap() {
    if (!bmCanvas || !bmCtx || !cdCanvas || !cdCtx) return;

    const bm = bmCtx;
    const cd = cdCtx;
    
    const w = bmCanvas.width;
    const h = bmCanvas.height;
    
    const cdW = cdCanvas.width;
    const cdH = cdCanvas.height;

    bm.clearRect(0, 0, w, h);
    cd.clearRect(0, 0, cdW, cdH);

    const padLeft = 20 * window.devicePixelRatio;
    const padRight = 65 * window.devicePixelRatio;
    const padTop = 15 * window.devicePixelRatio;
    const padBot = 30 * window.devicePixelRatio; // Increased to leave room for X-axis labels
    
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBot;

    // Price scaling bounds (centered around active trade price action)
    const history = ofState.bookmapHistory;
    const maxItems = 150;
    const sliceData = history.slice(-maxItems);

    let activeMax = -Infinity;
    let activeMin = Infinity;

    sliceData.forEach(tick => {
        activeMax = Math.max(activeMax, tick.price);
        activeMin = Math.min(activeMin, tick.price);
    });

    if (activeMin === Infinity || activeMax === -Infinity) {
        activeMax = ofState.spotPrice + 1.5;
        activeMin = ofState.spotPrice - 1.5;
    }

    const midPrice = (activeMax + activeMin) / 2 || ofState.spotPrice;
    const baseSpan = Math.max(3.0, (activeMax - activeMin) + 1.0);
    
    const yZoom = ofState.yZoomLevel || 1.0;
    const finalSpan = baseSpan / yZoom;

    const minPrice = midPrice - finalSpan / 2;
    const maxPrice = midPrice + finalSpan / 2;
    const priceRange = maxPrice - minPrice;

    const getY = (price) => {
        const baseOffset = padTop + chartH;
        const scale = chartH / priceRange;
        return baseOffset - (price - minPrice) * scale + ofState.panOffset.y;
    };

    // 1. Draw Depth of Market resting liquidity heatmap (filtered to active Y-range)
    bm.save();
    for (let pStr in ofState.bookmapLiquidity) {
        const price = parseFloat(pStr);
        if (price < minPrice - 1.0 || price > maxPrice + 1.0) continue;

        const size = ofState.bookmapLiquidity[pStr];
        const y = getY(price);
        const cellH = Math.max(1, (chartH / (priceRange / 0.05)));

        const contrastThreshold = ofState.heatmapContrast * 15;
        if (size < contrastThreshold) continue;

        let alpha = Math.min(1.0, (size - contrastThreshold) / 2200);
        let heatColor = 'rgba(99, 102, 241, ' + (alpha * 0.22) + ')';
        
        if (size > 1800) {
            heatColor = 'rgba(245, 158, 11, ' + alpha + ')';
        } else if (size > 900) {
            heatColor = 'rgba(168, 85, 247, ' + alpha + ')';
        }

        bm.fillStyle = heatColor;
        bm.fillRect(padLeft, y - cellH / 2, chartW, cellH);
    }
    bm.restore();

    // 1b. Draw Horizontal Volume Profile Histogram on the right-hand edge
    if (ofState.volumeProfileBins && ofState.volumeProfileBins.length > 0) {
        bm.save();
        
        let maxVol = 0;
        ofState.volumeProfileBins.forEach(bin => {
            if (bin.volume > maxVol) maxVol = bin.volume;
        });
        
        if (maxVol > 0) {
            const maxBarW = chartW * 0.22;
            const val = ofState.volumeProfileVal || 0;
            const vah = ofState.volumeProfileVah || 999999;
            
            ofState.volumeProfileBins.forEach(bin => {
                const price = bin.price;
                const volume = bin.volume;
                const y = getY(price);
                
                if (y >= padTop && y <= padTop + chartH) {
                    const barW = (volume / maxVol) * maxBarW;
                    const binH = Math.max(2, (chartH / Math.max(10, ofState.volumeProfileBins.length)));
                    const x = w - padRight - barW;
                    
                    if (price >= val && price <= vah) {
                        bm.fillStyle = 'rgba(59, 130, 246, 0.40)';
                        bm.strokeStyle = 'rgba(59, 130, 246, 0.85)';
                    } else {
                        bm.fillStyle = 'rgba(156, 163, 175, 0.18)';
                        bm.strokeStyle = 'rgba(156, 163, 175, 0.45)';
                    }
                    bm.lineWidth = 1 * window.devicePixelRatio;
                    bm.fillRect(x, y - binH / 2, barW, binH - 1.5);
                    bm.strokeRect(x, y - binH / 2, barW, binH - 1.5);
                }
            });
        }
        bm.restore();
    }

    // 2. Draw Bookmap GEX lines with Off-Screen Badges
    const drawGexGuide = (price, color, label) => {
        if (price === null || price === undefined || isNaN(price)) return;
        const y = getY(price);
        bm.save();

        if (y < padTop) {
            // Off-screen indicator at top
            const badgeW = 75 * window.devicePixelRatio;
            const badgeH = 14 * window.devicePixelRatio;
            const badgeX = padLeft + 6;
            const badgeY = padTop + 2;
            bm.fillStyle = 'rgba(7, 9, 19, 0.88)';
            bm.fillRect(badgeX, badgeY, badgeW, badgeH);
            bm.strokeStyle = color;
            bm.lineWidth = 1 * window.devicePixelRatio;
            bm.strokeRect(badgeX, badgeY, badgeW, badgeH);
            bm.fillStyle = color;
            bm.font = `bold ${8 * window.devicePixelRatio}px Outfit`;
            bm.textAlign = 'center';
            bm.textBaseline = 'middle';
            bm.fillText(`▲ ${label}: $${price.toFixed(1)}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
        } else if (y > padTop + chartH) {
            // Off-screen indicator at bottom
            const badgeW = 75 * window.devicePixelRatio;
            const badgeH = 14 * window.devicePixelRatio;
            const badgeX = padLeft + 6;
            const badgeY = padTop + chartH - badgeH - 2;
            bm.fillStyle = 'rgba(7, 9, 19, 0.88)';
            bm.fillRect(badgeX, badgeY, badgeW, badgeH);
            bm.strokeStyle = color;
            bm.lineWidth = 1 * window.devicePixelRatio;
            bm.strokeRect(badgeX, badgeY, badgeW, badgeH);
            bm.fillStyle = color;
            bm.font = `bold ${8 * window.devicePixelRatio}px Outfit`;
            bm.textAlign = 'center';
            bm.textBaseline = 'middle';
            bm.fillText(`▼ ${label}: $${price.toFixed(1)}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
        } else {
            bm.beginPath();
            bm.strokeStyle = color;
            bm.setLineDash([4, 4]);
            bm.lineWidth = 1 * window.devicePixelRatio;
            bm.moveTo(padLeft, y);
            bm.lineTo(w - padRight, y);
            bm.stroke();

            if (label) {
                bm.font = `bold ${8.5 * window.devicePixelRatio}px Outfit`;
                const textWidth = bm.measureText(label).width;
                bm.fillStyle = 'rgba(7, 9, 19, 0.85)';
                bm.fillRect(w - padRight + 2, y - 6 * window.devicePixelRatio, textWidth + 6, 12 * window.devicePixelRatio);
                bm.fillStyle = color;
                bm.textAlign = 'left';
                bm.textBaseline = 'middle';
                bm.fillText(label, w - padRight + 5, y);
            }
        }
        bm.restore();
    };

    drawGexGuide(ofState.callWall, 'rgba(59, 130, 246, 0.65)', 'Call Wall');
    drawGexGuide(ofState.putWall, 'rgba(244, 63, 94, 0.65)', 'Put Wall');
    drawGexGuide(ofState.flipLevel, 'rgba(245, 158, 11, 0.55)', 'GEX Flip');
    if (ofState.maxGammaStrike) drawGexGuide(ofState.maxGammaStrike, 'rgba(0, 225, 255, 0.7)', 'Max Gamma');

    // Draw Volume Profile lines (POC, VAH, VAL) on Bookmap
    const drawVolumeProfileGuide = (price, color, label, isSolid = false) => {
        if (!price) return;
        const y = getY(price);
        if (y >= padTop && y <= padTop + chartH) {
            bm.save();
            bm.beginPath();
            bm.strokeStyle = color;
            if (!isSolid) {
                bm.setLineDash([6, 3]);
            }
            bm.lineWidth = (isSolid ? 2.5 : 1.5) * window.devicePixelRatio;
            bm.moveTo(padLeft, y);
            bm.lineTo(w - padRight, y);
            bm.stroke();
            
            // Draw text label with a pill background so it pops!
            bm.font = `bold ${8.5 * window.devicePixelRatio}px Outfit`;
            const textWidth = bm.measureText(label).width;
            bm.fillStyle = 'rgba(7, 9, 19, 0.85)';
            bm.fillRect(w - padRight + 2, y - 6 * window.devicePixelRatio, textWidth + 6, 12 * window.devicePixelRatio);
            
            bm.fillStyle = color;
            bm.textAlign = 'left';
            bm.textBaseline = 'middle';
            bm.fillText(label, w - padRight + 5, y);
            bm.restore();
        }
    };
    
    drawVolumeProfileGuide(ofState.volumeProfilePoc, '#eab308', '5D POC', true);
    drawVolumeProfileGuide(ofState.volumeProfileVah, '#6366f1', '5D VAH');
    drawVolumeProfileGuide(ofState.volumeProfileVal, '#ec4899', '5D VAL');

    // Draw LOB Center of Gravity lines
    const drawLobCog = (price, color, label) => {
        if (!price) return;
        const y = getY(price);
        if (y >= padTop && y <= padTop + chartH) {
            bm.save();
            bm.beginPath();
            bm.strokeStyle = color;
            bm.setLineDash([2, 3]);
            bm.lineWidth = 1 * window.devicePixelRatio;
            bm.moveTo(padLeft, y);
            bm.lineTo(w - padRight, y);
            bm.stroke();
            
            bm.fillStyle = color;
            bm.font = `${7 * window.devicePixelRatio}px Outfit`;
            bm.textAlign = 'left';
            bm.fillText(label, w - padRight + 2, y);
            bm.restore();
        }
    };
    drawLobCog(ofState.cogBid, 'rgba(16, 185, 129, 0.4)', 'Bid CoG');
    drawLobCog(ofState.cogAsk, 'rgba(244, 63, 94, 0.4)', 'Ask CoG');

    // 3. Draw Price Y-Axis Labels & Grid Lines
    bm.save();
    
    // Draw grid lines if enabled
    if (ofState.showGrid) {
        bm.save();
        bm.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        bm.lineWidth = 1 * window.devicePixelRatio;
        const yTickStep = priceRange > 15 ? 5.0 : (priceRange > 5 ? 1.0 : 0.25);
        const startYTick = Math.ceil(minPrice / yTickStep) * yTickStep;
        for (let p = startYTick; p <= maxPrice; p += yTickStep) {
            const y = getY(p);
            if (y >= padTop && y <= padTop + chartH) {
                bm.beginPath();
                bm.moveTo(padLeft, y);
                bm.lineTo(w - padRight, y);
                bm.stroke();
            }
        }
        // Vertical grid lines (6 columns across chart width)
        const numCols = 6;
        for (let i = 0; i <= numCols; i++) {
            const x = padLeft + (i / numCols) * chartW;
            bm.beginPath();
            bm.moveTo(x, padTop);
            bm.lineTo(x, padTop + chartH);
            bm.stroke();
        }
        bm.restore();
    }

    bm.fillStyle = '#6b7280';
    bm.font = `${9 * window.devicePixelRatio}px Outfit`;
    bm.textAlign = 'left';
    bm.textBaseline = 'middle';
    
    const yTickStep = priceRange > 15 ? 5.0 : (priceRange > 5 ? 1.0 : 0.25);
    const startYTick = Math.ceil(minPrice / yTickStep) * yTickStep;
    for (let p = startYTick; p <= maxPrice; p += yTickStep) {
        bm.fillText(`$${p.toFixed(2)}`, w - padRight + 6, getY(p));
    }
    bm.restore();

    // 4. Draw Scrolling price line and trade circles
    if (sliceData.length === 0) return;

    // 4a. Draw scrolling candlesticks over the heatmap background
    bm.save();
    const numCandles = 25;
    const ticksPerCandle = Math.ceil(sliceData.length / numCandles);
    
    for (let i = 0; i < numCandles; i++) {
        const startIdx = i * ticksPerCandle;
        if (startIdx >= sliceData.length) break;
        
        const endIdx = Math.min(sliceData.length, (i + 1) * ticksPerCandle);
        const ticks = sliceData.slice(startIdx, endIdx);
        
        if (ticks.length > 0) {
            const open = ticks[0].price;
            const close = ticks[ticks.length - 1].price;
            const high = Math.max(...ticks.map(t => t.price));
            const low = Math.min(...ticks.map(t => t.price));
            
            const candleCenterIdx = (startIdx + endIdx - 1) / 2;
            const x = padLeft + (candleCenterIdx / maxItems) * chartW;
            
            const yOpen = getY(open);
            const yClose = getY(close);
            const yHigh = getY(high);
            const yLow = getY(low);
            
            const isBullish = close >= open;
            const candleColor = isBullish ? 'rgba(16, 185, 129, 0.32)' : 'rgba(244, 63, 94, 0.32)';
            const borderCol = isBullish ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.85)';
            
            // Draw wick
            bm.beginPath();
            bm.strokeStyle = borderCol;
            bm.lineWidth = 1.2 * window.devicePixelRatio;
            bm.moveTo(x, yLow);
            bm.lineTo(x, yHigh);
            bm.stroke();
            
            // Draw body
            const bodyH = Math.max(2 * window.devicePixelRatio, Math.abs(yClose - yOpen));
            const bodyY = Math.min(yOpen, yClose);
            const candleW = (ticks.length / maxItems) * chartW;
            const bodyW = Math.max(4 * window.devicePixelRatio, candleW * 0.75);
            
            bm.fillStyle = candleColor;
            bm.strokeStyle = borderCol;
            bm.lineWidth = 1 * window.devicePixelRatio;
            bm.fillRect(x - bodyW / 2, bodyY, bodyW, bodyH);
            bm.strokeRect(x - bodyW / 2, bodyY, bodyW, bodyH);
        }
    }
    bm.restore();

    bm.save();
    bm.lineWidth = 1.5 * window.devicePixelRatio;
    bm.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    bm.shadowColor = 'rgba(255, 255, 255, 0.1)';
    bm.shadowBlur = 2 * window.devicePixelRatio;
    bm.beginPath();

    sliceData.forEach((tick, idx) => {
        const x = padLeft + (idx / maxItems) * chartW;
        const y = getY(tick.price);
        if (idx === 0) bm.moveTo(x, y);
        else bm.lineTo(x, y);
    });
    bm.stroke();
    bm.restore();

    // Render aggressive trade circles
    bm.save();
    sliceData.forEach((tick, idx) => {
        const x = padLeft + (idx / maxItems) * chartW;
        const y = getY(tick.price);
        
        if (tick.size > 10) {
            bm.beginPath();
            
            // Logarithmic bubble scaling matches Bookmap.com standard
            // ensures massive trades don't cover the entire screen
            const radius = (Math.log(tick.size) * ofState.bubbleScale) * window.devicePixelRatio;
            
            bm.arc(x, y, Math.max(1.5, radius), 0, 2 * Math.PI);
            
            if (tick.tradeType === 'buy') {
                bm.fillStyle = 'rgba(16, 185, 129, 0.6)';
                bm.strokeStyle = '#10b981';
            } else {
                bm.fillStyle = 'rgba(244, 63, 94, 0.6)';
                bm.strokeStyle = '#f43f5e';
            }
            
            bm.lineWidth = 0.5 * window.devicePixelRatio;
            bm.fill();
            bm.stroke();
        }
    });

    // Draw spot pulse ring at end of price timeline
    const lastTick = sliceData[sliceData.length - 1];
    if (lastTick) {
        const endX = padLeft + chartW;
        const endY = getY(lastTick.price);
        
        bm.beginPath();
        bm.arc(endX, endY, 6 * window.devicePixelRatio, 0, 2 * Math.PI);
        bm.fillStyle = 'rgba(59, 130, 246, 0.35)';
        bm.fill();
        
        bm.beginPath();
        bm.arc(endX, endY, 2.5 * window.devicePixelRatio, 0, 2 * Math.PI);
        bm.fillStyle = '#ffffff';
        bm.fill();
    }
    bm.restore();

    // 4.5 Draw X-Axis timeline labels (Time Series markers)
    bm.save();
    bm.fillStyle = '#6b7280';
    bm.font = `${8.5 * window.devicePixelRatio}px Outfit`;
    bm.textAlign = 'center';
    bm.textBaseline = 'top';

    const tickInterval = Math.floor(maxItems / 4); // 4 markers across the width
    sliceData.forEach((tick, idx) => {
        if (idx % tickInterval === 0 || idx === sliceData.length - 1) {
            const x = padLeft + (idx / maxItems) * chartW;
            const timeStr = new Date(tick.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            bm.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            bm.lineWidth = 1 * window.devicePixelRatio;
            bm.beginPath();
            bm.moveTo(x, padTop + chartH);
            bm.lineTo(x, padTop + chartH + 4 * window.devicePixelRatio);
            bm.stroke();

            bm.fillText(timeStr, x, padTop + chartH + 6 * window.devicePixelRatio);
        }
    });
    bm.restore();

    // Draw Sonar Warning Alert if active
    if (ofState.sonarWarning) {
        bm.save();
        bm.fillStyle = 'rgba(245, 158, 11, 0.08)';
        bm.fillRect(padLeft, padTop, chartW, chartH);
        
        bm.fillStyle = '#f59e0b';
        bm.font = `bold ${10 * window.devicePixelRatio}px Outfit`;
        bm.textAlign = 'center';
        bm.fillText("⚠ SONAR PULSE EXHAUSTION WARNING: BUYING INTO RESTING RESISTANCE", padLeft + chartW / 2, padTop + 15 * window.devicePixelRatio);
        bm.restore();
    }

    // 5. DRAW SUBCHART: Cumulative Delta Timeline Chart
    if (!ofState.showCumDelta) return;

    const deltaHistory = ofState.cumDeltaHistory.slice(-maxItems);
    if (deltaHistory.length === 0) return;

    let maxDelta = Math.max(...deltaHistory);
    let minDelta = Math.min(...deltaHistory);
    let deltaRange = Math.max(100, maxDelta - minDelta);

    const getCdY = (val) => {
        const pad = 10 * window.devicePixelRatio;
        const hChart = cdH - pad * 2;
        return pad + hChart - ((val - minDelta) / deltaRange) * hChart;
    };

    cd.save();
    // Draw background grid line
    cd.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    cd.lineWidth = 1 * window.devicePixelRatio;
    cd.beginPath();
    cd.moveTo(padLeft, cdH / 2);
    cd.lineTo(cdW - padRight, cdH / 2);
    cd.stroke();

    // Draw MLOFI line overlay if active
    if (ofState.showMlofi) {
        const mlofiData = ofState.mlofiHistory.slice(-maxItems);
        if (mlofiData.length > 0) {
            let maxMlofi = Math.max(...mlofiData);
            let minMlofi = Math.min(...mlofiData);
            let mlofiRange = Math.max(100, maxMlofi - minMlofi);
            
            const getMlofiY = (val) => {
                const pad = 10 * window.devicePixelRatio;
                const hChart = cdH - pad * 2;
                return pad + hChart - ((val - minMlofi) / mlofiRange) * hChart;
            };
            
            cd.save();
            cd.lineWidth = 1.5 * window.devicePixelRatio;
            cd.strokeStyle = '#f59e0b'; // orange line for MLOFI
            cd.beginPath();
            
            mlofiData.forEach((val, idx) => {
                const x = padLeft + (idx / maxItems) * chartW;
                const y = getMlofiY(val);
                if (idx === 0) cd.moveTo(x, y);
                else cd.lineTo(x, y);
            });
            cd.stroke();
            
            // Draw axis labels on right
            cd.fillStyle = '#f59e0b';
            cd.font = `${8 * window.devicePixelRatio}px Outfit`;
            cd.textAlign = 'right';
            cd.textBaseline = 'middle';
            cd.fillText("MLOFI SKEW", cdW - 8, 12 * window.devicePixelRatio);
            cd.fillText(`${maxMlofi > 0 ? '+' : ''}${maxMlofi.toFixed(0)}`, cdW - 8, getMlofiY(maxMlofi));
            cd.fillText(`${minMlofi > 0 ? '+' : ''}${minMlofi.toFixed(0)}`, cdW - 8, getMlofiY(minMlofi));
            cd.restore();
        }
    }

    // Draw Cumulative Delta Path
    cd.strokeStyle = '#00d2ff';
    cd.lineWidth = 1.5 * window.devicePixelRatio;
    cd.beginPath();

    deltaHistory.forEach((val, idx) => {
        const x = padLeft + (idx / maxItems) * chartW;
        const y = getCdY(val);
        if (idx === 0) cd.moveTo(x, y);
        else cd.lineTo(x, y);
    });
    cd.stroke();

    // Print labels
    cd.fillStyle = '#6b7280';
    cd.font = `${8.5 * window.devicePixelRatio}px Outfit`;
    cd.textAlign = 'right';
    cd.textBaseline = 'middle';
    cd.fillText(`${maxDelta > 0 ? '+' : ''}${maxDelta}`, padLeft - 6, getCdY(maxDelta));
    cd.fillText(`${minDelta > 0 ? '+' : ''}${minDelta}`, padLeft - 6, getCdY(minDelta));
    
    // Draw Axis Label on left
    cd.fillStyle = '#00d2ff';
    cd.font = `bold ${8 * window.devicePixelRatio}px Outfit`;
    cd.textAlign = 'left';
    cd.fillText("CUMULATIVE DELTA", 8, 12 * window.devicePixelRatio);
    cd.restore();
}

// Keep track of previous book sizes to calculate delta changes for MLOFI
let prevBidSizes = {};
let prevAskSizes = {};
let lastSonarWarningTime = 0;

function detectCandlestickPattern() {
    const bars = ofState.footprintBars;
    if (bars.length < 2) return "None";
    
    const cur = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    
    const bodyCur = Math.abs(cur.close - cur.open);
    const rangeCur = cur.high - cur.low;
    if (rangeCur === 0) return "None";
    
    const upperWick = cur.high - Math.max(cur.open, cur.close);
    const lowerWick = Math.min(cur.open, cur.close) - cur.low;
    
    // 1. Hammer / Pin Bar
    if (lowerWick > bodyCur * 1.8 && upperWick < bodyCur * 0.5) {
        return "Bullish Hammer";
    }
    
    // 2. Shooting Star
    if (upperWick > bodyCur * 1.8 && lowerWick < bodyCur * 0.5) {
        return "Bearish Shooting Star";
    }
    
    // 3. Marubozu (Strong Body)
    if (bodyCur > rangeCur * 0.85 && bodyCur > (prev.high - prev.low) * 0.7) {
        return cur.close > cur.open ? "Bullish Marubozu" : "Bearish Marubozu";
    }
    
    // 4. Engulfing
    const isRedPrev = prev.close < prev.open;
    const isGreenCur = cur.close > cur.open;
    if (isRedPrev && isGreenCur && cur.close > prev.open && cur.open < prev.close) {
        return "Bullish Engulfing";
    }
    if (!isRedPrev && !isGreenCur && cur.close < prev.open && cur.open > prev.close) {
        return "Bearish Engulfing";
    }
    
    return "None";
}

function calculateAdvancedMetrics() {
    const currentPrice = ofState.spotPrice;
    const stepSize = 0.05;
    
    // 1. Calculate LOB Center of Gravity (CoG) over top 5 bid and ask rows
    let sumBidPriceVol = 0;
    let sumBidVol = 0;
    let sumAskPriceVol = 0;
    let sumAskVol = 0;
    
    // Top 5 ask levels (above spot)
    for (let i = 1; i <= 5; i++) {
        const p = currentPrice + i * stepSize;
        const pStr = p.toFixed(2);
        const size = ofState.bookmapLiquidity[pStr] || 20;
        sumAskPriceVol += p * size;
        sumAskVol += size;
    }
    
    // Top 5 bid levels (below spot)
    for (let i = 1; i <= 5; i++) {
        const p = currentPrice - i * stepSize;
        const pStr = p.toFixed(2);
        const size = ofState.bookmapLiquidity[pStr] || 20;
        sumBidPriceVol += p * size;
        sumBidVol += size;
    }
    
    ofState.cogBid = sumBidVol > 0 ? (sumBidPriceVol / sumBidVol) : currentPrice - 0.20;
    ofState.cogAsk = sumAskVol > 0 ? (sumAskPriceVol / sumAskVol) : currentPrice + 0.20;
    
    // 2. Calculate Modified Limit Order Flow Imbalance (MLOFI)
    let deltaBids = 0;
    let deltaAsks = 0;
    
    // Scan bid level updates
    for (let i = 1; i <= 5; i++) {
        const pStr = (currentPrice - i * stepSize).toFixed(2);
        const currentSize = ofState.bookmapLiquidity[pStr] || 20;
        const prevSize = prevBidSizes[pStr] || currentSize;
        deltaBids += (currentSize - prevSize);
        prevBidSizes[pStr] = currentSize;
    }
    
    // Scan ask level updates
    for (let i = 1; i <= 5; i++) {
        const pStr = (currentPrice + i * stepSize).toFixed(2);
        const currentSize = ofState.bookmapLiquidity[pStr] || 20;
        const prevSize = prevAskSizes[pStr] || currentSize;
        deltaAsks += (currentSize - prevSize);
        prevAskSizes[pStr] = currentSize;
    }
    
    const mlofiTick = deltaBids - deltaAsks;
    ofState.mlofi += mlofiTick;
    
    // Append to MLOFI history timeline (matching Bookmap cache size)
    ofState.mlofiHistory.push(ofState.mlofi);
    if (ofState.mlofiHistory.length > 250) {
        ofState.mlofiHistory.shift();
    }
    
    // 3. Real-time Dealer Hedging Pressure Speedometer
    const history = ofState.bookmapHistory;
    let deltaPrice = 0;
    if (history.length >= 2) {
        deltaPrice = history[history.length - 1].price - history[history.length - 2].price;
    }
    
    const netGexMultiplier = lastFetchedGexData ? Math.abs(lastFetchedGexData.total_gex_dollar) / 50000 : 800000;
    const isPositiveGex = ofState.isPositiveGex;
    
    const rawPressure = (isPositiveGex ? -1 : 1) * netGexMultiplier * deltaPrice * (Math.random() * 0.4 + 0.8);
    ofState.hedgingPressure = ofState.hedgingPressure * 0.8 + rawPressure * 0.2;
    
    // 4. Sonar Pulse Divergence Warning
    const sliceItems = history.slice(-10);
    let marketVol = 0;
    sliceItems.forEach(t => marketVol += t.size);
    
    let limitUpdates = Math.abs(deltaBids) + Math.abs(deltaAsks);
    const sonarRatio = limitUpdates > 0 ? (marketVol / limitUpdates) : 1.0;
    
    const isPriceSpike = sliceItems.length >= 10 && Math.abs(sliceItems[sliceItems.length - 1].price - sliceItems[0].price) > 0.15;
    const triggerSonar = isPriceSpike && (sonarRatio < 0.25 || Math.abs(mlofiTick) < 50);
    if (triggerSonar) {
        ofState.sonarWarning = true;
        lastSonarWarningTime = Date.now();
    } else if (Date.now() - lastSonarWarningTime > 3000) {
        ofState.sonarWarning = false;
    }
    
    // 5. Update DOM Widgets & Playbook indicators
    updateSidebarMetricsPanel(sonarRatio);
    updateConfluencePlaybookWidget();
}

function updateSidebarMetricsPanel(sonarRatio) {
    const maxGammaEl = document.getElementById('metric-max-gamma');
    if (maxGammaEl) {
        maxGammaEl.textContent = ofState.maxGammaStrike ? `$${ofState.maxGammaStrike.toFixed(2)}` : `$${ofState.spotPrice.toFixed(2)}`;
    }
    
    const mlofiEl = document.getElementById('metric-mlofi');
    if (mlofiEl) {
        const mVal = ofState.mlofi;
        const color = mVal > 200 ? '#10b981' : (mVal < -200 ? '#f43f5e' : 'var(--text-primary)');
        const label = mVal > 200 ? `${mVal.toFixed(0)} (Bullish)` : (mVal < -200 ? `${mVal.toFixed(0)} (Bearish)` : `${mVal.toFixed(0)} (Neutral)`);
        mlofiEl.textContent = label;
        mlofiEl.style.color = color;
    }
    
    const cogEl = document.getElementById('metric-cog');
    if (cogEl) {
        cogEl.textContent = `$${ofState.cogBid.toFixed(2)} / $${ofState.cogAsk.toFixed(2)}`;
    }
    
    const sonarEl = document.getElementById('metric-sonar');
    if (sonarEl) {
        if (ofState.sonarWarning) {
            sonarEl.textContent = 'EXHAUSTION';
            sonarEl.style.color = '#f59e0b';
        } else {
            sonarEl.textContent = 'NORMAL';
            sonarEl.style.color = '#10b981';
        }
    }

    const candleEl = document.getElementById('metric-candle');
    if (candleEl) {
        const pattern = detectCandlestickPattern();
        candleEl.textContent = pattern;
        if (pattern !== "None") {
            candleEl.style.color = pattern.includes("Bullish") ? '#10b981' : '#f43f5e';
        } else {
            candleEl.style.color = '#6b7280';
        }
    }

    const vpPocEl = document.getElementById('metric-vp-poc');
    if (vpPocEl) vpPocEl.textContent = ofState.volumeProfilePoc ? `$${ofState.volumeProfilePoc.toFixed(2)}` : '$0.00';

    const vpVahEl = document.getElementById('metric-vp-vah');
    if (vpVahEl) vpVahEl.textContent = ofState.volumeProfileVah ? `$${ofState.volumeProfileVah.toFixed(2)}` : '$0.00';

    const vpValEl = document.getElementById('metric-vp-val');
    if (vpValEl) vpValEl.textContent = ofState.volumeProfileVal ? `$${ofState.volumeProfileVal.toFixed(2)}` : '$0.00';
    
    const needle = document.getElementById('gauge-needle');
    const gaugeVal = document.getElementById('gauge-val');
    if (needle && gaugeVal) {
        const press = ofState.hedgingPressure;
        const maxPress = 450000;
        const ratio = Math.max(-1, Math.min(1, press / maxPress));
        const angle = ratio * 75;
        needle.setAttribute('transform', `rotate(${angle} 70 70)`);
        
        const prefix = press >= 0 ? '+' : '';
        gaugeVal.textContent = `${prefix}${(press / 1000).toFixed(1)} K / min`;
        gaugeVal.style.color = press >= 0 ? '#10b981' : '#f43f5e';
    }
}

function updateConfluencePlaybookWidget() {
    const regimeEl = document.getElementById('playbook-setup-regime');
    const bar = document.getElementById('playbook-strength-bar');
    const text = document.getElementById('playbook-strength-text');
    const actionBox = document.getElementById('playbook-action-box');
    
    if (!regimeEl || !bar || !text || !actionBox) return;
    
    const spot = ofState.spotPrice;
    const isPosGex = ofState.isPositiveGex;
    const candlePattern = detectCandlestickPattern();
    
    let stateLabel = "";
    let confidence = 0;
    let actionText = "NO CONFLUENCE - MONITORING";
    let actionBg = "rgba(255, 255, 255, 0.05)";
    let actionBorder = "rgba(255, 255, 255, 0.1)";
    let actionColor = "#ffffff";
    
    const distToFlip = Math.abs(spot - ofState.flipLevel) / spot;
    const distToPutWall = Math.abs(spot - ofState.putWall) / spot;
    const distToCallWall = Math.abs(spot - ofState.callWall) / spot;
    const distToMaxGamma = ofState.maxGammaStrike ? Math.abs(spot - ofState.maxGammaStrike) / spot : 999.0;
    
    if (distToPutWall < 0.008) {
        stateLabel = `Wall Reversion Setup (Put Wall - Support)`;
        confidence += 30;
        if (ofState.mlofi > 100) confidence += 20;
        if (ofState.cumulativeDelta > -500) confidence += 20;
        if (candlePattern.includes("Bullish")) confidence += 30;
        
        if (confidence >= 60) {
            actionText = `ACTION: SELL $${(Math.floor(ofState.putWall / 5) * 5).toFixed(0)} BULL PUT CREDIT SPREAD`;
            actionBg = "rgba(16, 185, 129, 0.15)";
            actionBorder = "rgba(16, 185, 129, 0.3)";
            actionColor = "#10b981";
        } else {
            actionText = "MONITORING PUT WALL SUPPORT - WAIT FOR TRADES STACKING";
        }
    } else if (distToCallWall < 0.008) {
        stateLabel = `Wall Reversion Setup (Call Wall - Resistance)`;
        confidence += 30;
        if (ofState.mlofi < -100) confidence += 20;
        if (ofState.cumulativeDelta < 500) confidence += 20;
        if (candlePattern.includes("Bearish")) confidence += 30;
        
        if (confidence >= 60) {
            actionText = `ACTION: SELL $${(Math.ceil(ofState.callWall / 5) * 5).toFixed(0)} BEAR CALL CREDIT SPREAD`;
            actionBg = "rgba(244, 63, 94, 0.15)";
            actionBorder = "rgba(244, 63, 94, 0.3)";
            actionColor = "#f43f5e";
        } else {
            actionText = "MONITORING CALL WALL RESISTANCE - WAIT FOR OFFERS STACKING";
        }
    } else if (distToFlip < 0.005) {
        stateLabel = `Regime Transition Setup (GEX Flip Breakout)`;
        confidence += 40;
        const isBullishBreak = spot > ofState.flipLevel;
        if (isBullishBreak && ofState.mlofi > 300) confidence += 20;
        if (!isBullishBreak && ofState.mlofi < -300) confidence += 20;
        if (isBullishBreak && candlePattern.includes("Bullish")) confidence += 20;
        if (!isBullishBreak && candlePattern.includes("Bearish")) confidence += 20;
        
        if (confidence >= 80) {
            const strikeStr = (Math.round(spot)).toFixed(0);
            if (isBullishBreak) {
                actionText = `ACTION: BUY CALL DEBIT SPREAD (STRIKE $${strikeStr})`;
                actionBg = "rgba(59, 130, 246, 0.15)";
                actionBorder = "rgba(59, 130, 246, 0.3)";
                actionColor = "#3b82f6";
            } else {
                actionText = `ACTION: BUY PUT DEBIT SPREAD (STRIKE $${strikeStr})`;
                actionBg = "rgba(245, 158, 11, 0.15)";
                actionBorder = "rgba(245, 158, 11, 0.3)";
                actionColor = "#f59e0b";
            }
        } else {
            actionText = `WAITING FOR BREAKOUT MOMENTUM CONFIRMATION`;
        }
    } else if (ofState.sonarWarning && distToMaxGamma < 0.015) {
        stateLabel = `Trend Exhaustion Setup (Max Gamma - Resistance)`;
        confidence = 90;
        if (candlePattern.includes("Bearish")) confidence += 10;
        actionText = `ACTION: REVERSAL - AVOID LONGS / BUY SCALP PUTS`;
        actionBg = "rgba(245, 158, 11, 0.15)";
        actionBorder = "rgba(245, 158, 11, 0.3)";
        actionColor = "#f59e0b";
    } else {
        stateLabel = isPosGex ? "Positive Gamma Regime (Range Mean Reversion)" : "Negative Gamma Regime (High Volatility Drift)";
        confidence = 20;
        if (candlePattern !== "None") confidence += 15;
        actionText = "NO SETUP CONFLUENCE - STAND BY";
    }
    
    // Cap confidence at 100%
    confidence = Math.min(100, confidence);

    regimeEl.textContent = `${stateLabel} | Candle: ${candlePattern} | Symbol: ${currentSymbol}`;
    bar.style.width = `${confidence}%`;
    text.textContent = `${confidence}%`;
    
    if (confidence >= 80) {
        bar.style.backgroundColor = '#10b981';
        text.style.color = '#10b981';
    } else if (confidence >= 50) {
        bar.style.backgroundColor = '#3b82f6';
        text.style.color = '#3b82f6';
    } else {
        bar.style.backgroundColor = '#6b7280';
        text.style.color = '#6b7280';
    }
    
    actionBox.textContent = actionText;
    actionBox.style.backgroundColor = actionBg;
    actionBox.style.borderColor = actionBorder;
    actionBox.style.color = actionColor;
}

function renderOrderFlowCharts() {
    try { calculateAdvancedMetrics(); } catch (e) { console.error("Error in calculateAdvancedMetrics:", e); }
    try { drawFootprint(); } catch (e) { console.error("Error in drawFootprint:", e); }
    try { drawBookmap(); } catch (e) { console.error("Error in drawBookmap:", e); }
    try { updateDomTable(); } catch (e) { console.error("Error in updateDomTable:", e); }
}

function updateDomTable() {
    const tbody = document.querySelector('#dom-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const currentPrice = ofState.spotPrice;
    const stepSize = 0.05; // standard options spread resolution is 0.05
    
    // Generate 16 price rows centered around current price
    const centerPrice = Math.round(currentPrice / stepSize) * stepSize;
    const startPrice = centerPrice + 8 * stepSize;
    const endPrice = centerPrice - 8 * stepSize;

    for (let p = startPrice; p >= endPrice; p -= stepSize) {
        const tr = document.createElement('tr');
        
        // Highlight row matching last price
        const isLastPrice = Math.abs(p - currentPrice) < (stepSize / 2);
        if (isLastPrice) {
            tr.className = 'last-price-row';
        }

        const priceStr = p.toFixed(2);
        const restingSize = ofState.bookmapLiquidity[priceStr] || Math.floor(Math.random() * 50) + 10;

        let bidCol = '<td></td>';
        let askCol = '<td></td>';
        
        const barWidth = Math.min(100, Math.round((restingSize / 4500) * 100));

        if (p > currentPrice) {
            // Ask Side
            tr.className += ' ask-row';
            askCol = `
                <td>
                    <span class="dom-size-bar-ask" style="width: ${barWidth}px;"></span>
                    <span>${restingSize}</span>
                </td>
            `;
        } else if (p < currentPrice) {
            // Bid Side
            tr.className += ' bid-row';
            bidCol = `
                <td>
                    <span>${restingSize}</span>
                    <span class="dom-size-bar-bid" style="width: ${barWidth}px;"></span>
                </td>
            `;
        }

        const priceCol = `<td class="price-col">$${priceStr}</td>`;
        
        tr.innerHTML = bidCol + priceCol + askCol;
        tbody.appendChild(tr);
    }
}

// Consolidated Tab Navigation is configured at the top of the file

// --- DAY TRADING DASHBOARD SYSTEM ---

function initDayTradingDashboard() {
    console.log("Initializing Day Trading Dashboard...");
    updateDayTradingData();
    dayTradingInterval = setInterval(updateDayTradingData, 3000); // refresh every 3 seconds
    
    // Wire transition evaluator button
    const evalBtn = document.getElementById('trans-eval-btn');
    if (evalBtn) {
        evalBtn.onclick = runTransitionEvaluation;
    }
}

async function updateDayTradingData() {
    const symbol = document.getElementById('symbol-input').value || "SPY";
    try {
        const response = await fetch(`/api/internals/day-trading-snapshot?symbol=${symbol}`);
        const data = await response.json();
        
        // If data internals are null, market is closed. Display Inactive/Closed state.
        if (data.add === null || data.vold === null || data.tick === null || data.trin === null) {
            updateDialNeedleClosed('needle-add', 'dial-add-val', "Closed");
            updateDialNeedleClosed('needle-vold', 'dial-vold-val', "Closed");
            updateDialNeedleClosed('needle-tick', 'dial-tick-val', "Closed");
            updateDialNeedleClosed('needle-trin', 'dial-trin-val', "Closed");
            
            const pctTxt = document.getElementById('prob-percentage-text');
            if (pctTxt) pctTxt.innerText = "Inactive";
            const ring = document.getElementById('prob-progress-ring');
            if (ring) ring.style.strokeDashoffset = 345;
            
            const priorTxt = document.getElementById('prob-prior-val');
            if (priorTxt) priorTxt.innerText = "--";
            const postTxt = document.getElementById('prob-posterior-val');
            if (postTxt) postTxt.innerText = "--";
            const kellyTxt = document.getElementById('prob-kelly-val');
            if (kellyTxt) kellyTxt.innerText = "--";
            const riskTxt = document.getElementById('prob-risk-val');
            if (riskTxt) riskTxt.innerText = "--";
            return;
        }
        
        // Update dials values and needle angles
        updateDialNeedle('needle-add', 'dial-add-val', data.add, -2000, 2000, "");
        updateDialNeedle('needle-vold', 'dial-vold-val', data.vold, 0.2, 4.0, "x");
        updateDialNeedle('needle-tick', 'dial-tick-val', data.tick, -1200, 1200, "");
        updateDialNeedle('needle-trin', 'dial-trin-val', data.trin, 3.0, 0.2, "", true); // Inverted mapping

        // Fetch probability & Kelly sizing
        const strategy = (data.tick <= -800) ? "wall_reversion" : "gex_flip";
        const probRes = await fetch(`/api/strategy/calculate-probability?symbol=${symbol}&strategy=${strategy}&tick=${data.tick}&voldRatio=${data.vold}`);
        const probData = await probRes.json();
        
        // Update probability progress ring
        const probPct = Math.round(probData.updated_probability * 100);
        const ring = document.getElementById('prob-progress-ring');
        if (ring) {
            const offset = 345 - (345 * probData.updated_probability);
            ring.style.strokeDashoffset = offset;
        }
        
        const pctTxt = document.getElementById('prob-percentage-text');
        if (pctTxt) pctTxt.innerText = `${probPct}%`;
        
        const priorTxt = document.getElementById('prob-prior-val');
        if (priorTxt) priorTxt.innerText = `${Math.round(probData.prior_probability * 100)}%`;
        
        const postTxt = document.getElementById('prob-posterior-val');
        if (postTxt) postTxt.innerText = `${probPct}%`;
        
        const kellyTxt = document.getElementById('prob-kelly-val');
        if (kellyTxt) kellyTxt.innerText = `${(probData.kelly.kelly_fraction * 100).toFixed(1)}%`;
        
        const riskTxt = document.getElementById('prob-risk-val');
        if (riskTxt) riskTxt.innerText = `${probData.kelly.risk_multiplier.toFixed(1)}x`;

    } catch (e) {
        console.error("Failed to load day-trading snapshot data: ", e);
    }
}

function updateDialNeedle(needleId, valId, value, minVal, maxVal, unit = "", isInverted = false) {
    const valEl = document.getElementById(valId);
    if (valEl) {
        let displayVal = typeof value === 'number' ? value.toFixed(value % 1 === 0 ? 0 : 2) : value;
        valEl.innerText = `${displayVal}${unit}`;
    }
    
    const needle = document.getElementById(needleId);
    if (needle) {
        // Map minVal -> -90 deg, maxVal -> +90 deg
        let pct = (value - minVal) / (maxVal - minVal);
        pct = Math.max(0.0, Math.min(1.0, pct));
        const deg = -90 + (pct * 180);
        needle.style.transform = `rotate(${deg}deg)`;
    }
}

function updateDialNeedleClosed(needleId, valId, text) {
    const valEl = document.getElementById(valId);
    if (valEl) {
        valEl.innerText = text;
        valEl.style.color = "var(--text-muted)";
    }
    const needle = document.getElementById(needleId);
    if (needle) {
        // Reset needle to straight up (neutral)
        needle.style.transform = `rotate(0deg)`;
    }
}

async function runTransitionEvaluation() {
    const symbol = document.getElementById('symbol-input').value || "SPY";
    const entryPrice = parseFloat(document.getElementById('trans-entry-price').value);
    const direction = document.getElementById('trans-direction').value;
    
    if (isNaN(entryPrice)) {
        alert("Please enter a valid entry price.");
        return;
    }
    
    try {
        const response = await fetch(`/api/trade_transition_eval?symbol=${symbol}&entryPrice=${entryPrice}&direction=${direction}`, {
            method: 'POST'
        });
        const data = await response.json();
        
        // Update Checklist DOM
        updateChecklistItem('chk-rcs', data.checklist.rcs_check, `Relative Close Strength (RCS: ${data.rcs.toFixed(2)})`);
        updateChecklistItem('chk-regime', data.checklist.regime_check, `GEX Volatility Regime (${data.gex_regime})`);
        updateChecklistItem('chk-volume', data.checklist.volume_check, `Institutional Volume (${data.volume_ratio.toFixed(1)}x 20d MA)`);
        updateChecklistItem('chk-catalysts', data.checklist.catalyst_check, `No Macro Catalysts Tomorrow Morning`);
        updateChecklistItem('chk-walls', data.checklist.wall_proximity_check, `Price Safe Distance from GEX Walls`);
        
        // Update decision banner
        const banner = document.getElementById('transition-banner-box');
        if (banner) {
            banner.style.display = 'block';
            banner.innerText = data.decision_text;
            if (data.hold_overnight) {
                banner.className = "transition-banner hold-banner";
            } else {
                banner.className = "transition-banner exit-banner";
            }
        }
    } catch (e) {
        console.error("Transition check failed: ", e);
    }
}

function updateChecklistItem(id, passed, labelText) {
    const el = document.getElementById(id);
    if (el) {
        const icon = passed ? '<i class="fa-solid fa-circle-check text-green"></i>' : '<i class="fa-solid fa-circle-xmark text-red"></i>';
        el.innerHTML = `${icon} <span>${labelText}</span>`;
    }
}

// --- SWING TRADING DASHBOARD SYSTEM ---

let swingCharts = {};

async function initSwingDashboard() {
    console.log("Initializing Swing Trading Dashboard...");
    try {
        const response = await fetch('/api/internals/swing-trading-snapshot');
        const data = await response.json();
        
        // Populate calendars
        const list = document.getElementById('opex-dates-list');
        if (list) {
            list.innerHTML = data.opex_dates.map(dateStr => {
                const diffTime = Math.abs(new Date(dateStr) - new Date());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return `
                    <li class="calendar-item">
                        <span class="calendar-date"><i class="fa-solid fa-hourglass-half"></i> ${dateStr}</span>
                        <span class="calendar-days-left">${diffDays} Days Left</span>
                    </li>
                `;
            }).join('');
        }
        
        // Populate Sovereign Debt & Spreads
        const yieldVal = document.getElementById('val-yield-spread');
        if (yieldVal) yieldVal.innerText = `${data.yield_curve.spread.toFixed(2)}%`;
        const yieldStatus = document.getElementById('val-yield-status');
        if (yieldStatus) {
            yieldStatus.innerText = data.yield_curve.inverted ? "INVERTED (REVERSION RISK)" : "STEEPENING (NORMAL)";
            yieldStatus.className = data.yield_curve.inverted ? "text-red" : "text-green";
        }
        
        const creditVal = document.getElementById('val-credit-spread');
        if (creditVal) creditVal.innerText = `${data.credit_spreads.toFixed(2)}%`;
        const creditStatus = document.getElementById('val-credit-status');
        if (creditStatus) {
            creditStatus.innerText = data.credit_spreads > 4.5 ? "HIGH DISTRESS (RISK-OFF)" : "LOW DISTRESS (RISK-ON)";
            creditStatus.className = data.credit_spreads > 4.5 ? "text-red" : "text-green";
        }
        
        // Populate Relative Strength watchlist leaderboard
        const tbody = document.querySelector('#rs-rankings-table tbody');
        if (tbody) {
            // Day snapshots includes relative strength lists
            const dayRes = await fetch('/api/internals/day-trading-snapshot');
            const dayData = await dayRes.json();
            tbody.innerHTML = dayData.relative_strength.map(row => `
                <tr>
                    <td><strong>${row.symbol}</strong></td>
                    <td class="${row.performance_pct >= 0 ? 'text-green' : 'text-red'}">${row.performance_pct.toFixed(2)}%</td>
                    <td class="${row.rs_vs_spy >= 0 ? 'text-green' : 'text-red'}">${row.rs_vs_spy.toFixed(2)}%</td>
                </tr>
            `).join('');
        }

        // Initialize Charts
        renderSwingCharts(data);
    } catch (e) {
        console.error("Failed to load swing snapshot data: ", e);
    }
}

function renderSwingCharts(data) {
    // 1. Fed Net Liquidity vs SPY Chart
    const netLiqCtx = document.getElementById('chart-net-liquidity').getContext('2d');
    if (swingCharts.netLiq) swingCharts.netLiq.destroy();
    
    const dates = data.fed_liquidity.map(d => d.date);
    const liqVals = data.fed_liquidity.map(d => d.net_liquidity);
    const spyVals = data.fed_liquidity.map(d => d.spy);
    
    swingCharts.netLiq = new Chart(netLiqCtx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Net Liquidity ($B)',
                    data: liqVals,
                    borderColor: '#10b981',
                    borderWidth: 2,
                    yAxisID: 'y-liq',
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'SPY Close ($)',
                    data: spyVals,
                    borderColor: '#3b82f6',
                    borderWidth: 2,
                    yAxisID: 'y-spy',
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.02)' } },
                'y-liq': { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' } },
                'y-spy': { type: 'linear', position: 'right', grid: { display: false } }
            },
            plugins: { legend: { display: true, labels: { font: { size: 9 } } } }
        }
    });

    // 2. VIX & SKEW Chart
    const vixSkewCtx = document.getElementById('chart-vix-skew').getContext('2d');
    if (swingCharts.vixSkew) swingCharts.vixSkew.destroy();
    
    // Simulate historical VIX / SKEW trend lines for display
    const mockVixTrend = dates.map((_, i) => data.vix_vxv.vix + Math.sin(i/3.0) * 1.5);
    const mockSkewTrend = dates.map((_, i) => data.skew + Math.cos(i/4.0) * 8.0);
    
    swingCharts.vixSkew = new Chart(vixSkewCtx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'VIX Index',
                    data: mockVixTrend,
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    yAxisID: 'y-vix',
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'SKEW Index',
                    data: mockSkewTrend,
                    borderColor: '#f43f5e',
                    borderWidth: 2,
                    yAxisID: 'y-skew',
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.02)' } },
                'y-vix': { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' } },
                'y-skew': { type: 'linear', position: 'right', grid: { display: false } }
            },
            plugins: { legend: { display: true, labels: { font: { size: 9 } } } }
        }
    });

    // 3. Breadth Chart (stocks above 50/200 dma)
    const breadthCtx = document.getElementById('chart-breadth').getContext('2d');
    if (swingCharts.breadth) swingCharts.breadth.destroy();
    
    const mock50DmaTrend = dates.map((_, i) => data.breadth.stocks_above_50dma_pct + Math.sin(i/2.0) * 10.0);
    const mock200DmaTrend = dates.map((_, i) => data.breadth.stocks_above_200dma_pct + Math.cos(i/5.0) * 5.0);
    
    swingCharts.breadth = new Chart(breadthCtx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Stocks > 50 DMA %',
                    data: mock50DmaTrend,
                    borderColor: '#a78bfa',
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: 'Stocks > 200 DMA %',
                    data: mock200DmaTrend,
                    borderColor: '#fbbf24',
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.02)' } },
                y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } }
            },
            plugins: { legend: { display: true, labels: { font: { size: 9 } } } }
        }
    });
}

// --- LIQUID UNIVERSE SCANNER SYSTEM ---

let liquidStatusInterval = null;

function initLiquidScreener() {
    console.log("Initializing Liquid Universe Screener...");
    liquidPage = 0;
    loadLiquidScannerData();
    
    // Wire refresh DB and search button
    const scanBtn = document.getElementById('liquid-scan-btn');
    if (scanBtn) {
        scanBtn.onclick = () => {
            liquidPage = 0;
            loadLiquidScannerData();
        };
    }
    
    const rebuildBtn = document.getElementById('liquid-refresh-db-btn');
    if (rebuildBtn) {
        rebuildBtn.onclick = triggerDatabaseRebuild;
    }
    
    const filterSelect = document.getElementById('liquid-setup-filter');
    if (filterSelect) {
        filterSelect.onchange = () => {
            liquidPage = 0;
            loadLiquidScannerData();
        };
    }
    
    // Pagination buttons
    const prevBtn = document.getElementById('liquid-prev-btn');
    if (prevBtn) {
        prevBtn.onclick = () => {
            if (liquidPage > 0) {
                liquidPage--;
                loadLiquidScannerData();
            }
        };
    }
    
    const nextBtn = document.getElementById('liquid-next-btn');
    if (nextBtn) {
        nextBtn.onclick = () => {
            liquidPage++;
            loadLiquidScannerData();
        };
    }
}

async function loadLiquidScannerData() {
    const filter = document.getElementById('liquid-setup-filter').value;
    const setupParam = filter === 'all' ? '' : `&setupFilter=${filter}`;
    const offset = liquidPage * liquidLimit;
    
    try {
        const response = await fetch(`/api/screener/liquid-scan?limit=${liquidLimit}&offset=${offset}${setupParam}`);
        const result = await response.json();
        
        const tbody = document.querySelector('#liquid-screener-table tbody');
        if (tbody) {
            tbody.innerHTML = '';
            if (result.data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">No liquid symbols match the selected setup filter. Run "Rebuild DB" to populate.</td></tr>`;
            } else {
                result.data.forEach(row => {
                    const tr = document.createElement('tr');
                    tr.className = 'screener-row';
                    tr.style.cursor = 'pointer';
                    
                    tr.innerHTML = `
                        <td class="text-bold">
                            <i class="fa-solid fa-chevron-right expand-icon"></i>
                            <a href="#" onclick="event.preventDefault(); event.stopPropagation(); switchToSymbol('${row.symbol}');" style="color: var(--color-primary); text-decoration: none; font-weight: bold; border-bottom: 1px dashed rgba(59, 130, 246, 0.4); padding-bottom: 1px;">
                                ${row.symbol}
                            </a>
                        </td>
                        <td>$${(row.price || 0).toFixed(2)}</td>
                        <td>${((row.avg_volume || 0) / 1000000).toFixed(1)}M</td>
                        <td>$${(row.gamma_flip || 0).toFixed(1)}</td>
                        <td class="text-green">$${(row.call_wall || 0).toFixed(1)}</td>
                        <td class="text-red">$${(row.put_wall || 0).toFixed(1)}</td>
                        <td>
                            <span class="status-badge ${row.net_gex_status === 'Positive' ? 'status-green' : 'status-red'}">
                                ${row.net_gex_status === 'Positive' ? 'Positive Gamma' : 'Negative Gamma'}
                            </span>
                        </td>
                        <td>
                            <span class="grade-badge grade-${(row.asset_grade || 'D').toLowerCase()}">
                                ${row.asset_grade || 'D'}
                            </span>
                        </td>
                        <td>${getSetupBadgesHTML(row.alerts)}</td>
                    `;
                    
                    const safeSym = row.symbol.replace(/[^a-zA-Z0-9]/g, '_');
                    const detailTr = document.createElement('tr');
                    detailTr.className = 'screener-detail-row';
                    detailTr.id = `liquid-detail-${safeSym}`;
                    detailTr.style.display = 'none';
                    
                    const alertTime = new Date().toLocaleTimeString();
                    let alertsListHtml = '';
                    if (row.alerts && row.alerts.length > 0) {
                        alertsListHtml = row.alerts.map(a => `<li><span class="alert-time">[${row.setup_timestamp || alertTime}]</span> <span class="alert-score" style="color:var(--color-primary); font-weight:bold;">[10-Pt Setup Score: ${(row.asset_confluence_score || 4.0).toFixed(1)} / 10.0]</span> ${a}</li>`).join('');
                    } else {
                        alertsListHtml = '<li>No active desk alerts for this symbol.</li>';
                    }
                    
                    detailTr.innerHTML = `
                        <td colspan="9">
                            <div class="detail-container">
                                <div class="detail-grid" style="grid-template-columns: 1.1fr 1.2fr 1.7fr; gap: 20px;">
                                    <div class="detail-col">
                                        <h4>System & Advanced Metrics</h4>
                                        <p><strong>10-Point Playbook Setup Score:</strong> <span class="grade-badge grade-${(row.asset_grade || 'D').toLowerCase()}">${row.asset_grade || 'D'} (${(row.asset_confluence_score || 4.0).toFixed(1)} / 10.0)</span></p>
                                        <p><strong>Sizing Recommendation:</strong> ${row.asset_sizing_recommendation || 'Grade D Setup: Stay Out (0% Risk)'}</p>
                                        <p><strong>EMA-20 Distance:</strong> ${(row.ema_20_dist || 0).toFixed(2)}%</p>
                                        <p><strong>EMA-50 Distance:</strong> ${(row.ema_50_dist || 0).toFixed(2)}%</p>
                                        <p><strong>5D Volume Profile POC:</strong> $${(row.volume_profile_poc || 0).toFixed(2)}</p>
                                        <p><strong>5D Volume Profile VAH:</strong> $${(row.volume_profile_vah || 0).toFixed(2)}</p>
                                        <p><strong>5D Volume Profile VAL:</strong> $${(row.volume_profile_val || 0).toFixed(2)}</p>
                                        <p><strong>Net GEX Status:</strong> ${row.net_gex_status || 'Positive'}</p>
                                    </div>
                                    <div class="detail-col">
                                        <h4>Alerts History Log</h4>
                                        <ul class="detail-alerts-list">
                                            ${alertsListHtml}
                                        </ul>
                                    </div>
                                    <div class="detail-col chart-col" style="background: rgba(13, 17, 23, 0.8); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                                        <h4 style="margin-top:0; margin-bottom:8px;"><i class="fa-solid fa-chart-line"></i> Daily Candlestick (20 EMA, FVG & Vol Profile)</h4>
                                        <canvas id="liquid-chart-${safeSym}" width="420" height="200" style="width:100%; height:190px;"></canvas>
                                    </div>
                                </div>
                            </div>
                        </td>
                    `;
                    
                    tr.addEventListener('click', async () => {
                        const isExpanded = tr.classList.toggle('expanded');
                        detailTr.style.display = isExpanded ? 'table-row' : 'none';
                        if (isExpanded) {
                            await fetchAndDrawScreenerChart(`liquid-chart-${safeSym}`, row.symbol);
                        }
                    });
                    
                    tbody.appendChild(tr);
                    tbody.appendChild(detailTr);
                });
            }
        }

// --- Canvas Candlestick & Volume Profile Drawing Engine is defined above ---
        
        // Update pagination details
        const info = document.getElementById('liquid-pagination-info');
        if (info) {
            const start = offset + 1;
            const end = Math.min(offset + liquidLimit, result.total);
            info.innerText = result.total === 0 ? "Showing 0-0 of 0 entries" : `Showing ${start}-${end} of ${result.total} entries`;
        }
    } catch (e) {
        console.error("Failed to load liquid scanner: ", e);
    }
}

function getSetupBadgesHTML(alerts) {
    if (!alerts || alerts.length === 0) return '<span style="color:var(--text-muted);">None</span>';
    
    // Map full alerts texts to short tags with direction and timestamp
    return alerts.map(a => {
        let tag = "Setup";
        let c = "badge-vcp";
        
        if (a.toLowerCase().includes('vcp')) {
            tag = "VCP";
            c = "badge-vcp";
        } else if (a.toLowerCase().includes('breakout')) {
            tag = "Breakout";
            c = "badge-breakout";
        } else if (a.toLowerCase().includes('trend')) {
            tag = "Trend Cont";
            c = "badge-trend";
        } else if (a.toLowerCase().includes('mean')) {
            tag = "Mean Rev";
            c = "badge-mean-rev";
        } else if (a.toLowerCase().includes('volume') || a.toLowerCase().includes('unusual')) {
            tag = "Vol Spike";
            c = "badge-vol-spike";
        } else if (a.toLowerCase().includes('fvg')) {
            tag = "FVG";
            c = "badge-vcp";
        } else if (a.toLowerCase().includes('breaker')) {
            tag = "Breaker";
            c = "badge-breakout";
        } else {
            tag = a.split(':')[0]; // fallback to prefix
        }

        // Extract direction and timestamp if present in the string
        let metaHtml = "";
        const dirMatch = a.match(/\[(Long|Short)\]/i);
        const timeMatch = a.match(/@\s*([^\s]+)/);
        if (dirMatch || timeMatch) {
            const dir = dirMatch ? dirMatch[1] : "";
            const timeStr = timeMatch ? timeMatch[1] : "";
            const dirColor = dir.toLowerCase() === 'long' ? '#10b981' : '#f43f5e';
            metaHtml = `<div style="font-size:9.5px; color:var(--text-secondary); margin-top:3px; font-family:var(--font-secondary);">
                <span style="color:${dirColor}; font-weight:800; text-transform:uppercase;">${dir}</span> <span style="color:var(--text-muted); font-size:9px;">${timeStr}</span>
            </div>`;
        }

        return `<div style="display:inline-block; margin-right:8px; margin-bottom:6px; vertical-align:top; background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.03); border-radius:6px; padding:4px 6px; text-align:center; min-width:80px;">
            <span class="screener-badge ${c}" title="${a}">${tag}</span>
            ${metaHtml}
        </div>`;
    }).join('');
}

async function triggerDatabaseRebuild() {
    try {
        const response = await fetch('/api/screener/liquid-update', { method: 'POST' });
        const res = await response.json();
        console.log(res.message);
        
        // Start polling status
        pollDatabaseRebuildStatus();
    } catch (e) {
        console.error("Failed to trigger DB update: ", e);
    }
}

function pollDatabaseRebuildStatus() {
    const wrapper = document.getElementById('liquid-progress-wrapper');
    const fill = document.getElementById('liquid-progress-fill');
    const txt = document.getElementById('liquid-progress-text');
    const dbLastRun = document.getElementById('liquid-db-last-run');
    
    if (wrapper) wrapper.style.display = 'flex';
    
    if (liquidStatusInterval) clearInterval(liquidStatusInterval);
    
    liquidStatusInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/screener/liquid-status');
            const status = await response.json();
            
            if (status.is_running) {
                const pct = Math.round((status.progress / status.total) * 100);
                if (fill) fill.style.width = `${pct}%`;
                if (txt) txt.innerText = `${status.progress}/${status.total}`;
                if (dbLastRun) dbLastRun.innerText = "Running Update...";
            } else {
                clearInterval(liquidStatusInterval);
                liquidStatusInterval = null;
                if (wrapper) wrapper.style.display = 'none';
                if (dbLastRun) {
                    dbLastRun.innerText = status.last_run ? `Ready (Last: ${new Date(status.last_run).toLocaleTimeString()})` : "Ready";
                }
                // Reload data
                liquidPage = 0;
                loadLiquidScannerData();
            }
        } catch (e) {
            console.error("Failed to poll status: ", e);
            clearInterval(liquidStatusInterval);
        }
    }, 1500);
}

// End of file




