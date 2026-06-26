// ============================================================================
// FortiToken Reporting Application
// API Endpoints & Configuration
// ============================================================================

const API_CONFIG = {
    worker_url: 'https://square-bonus-5ac2.ofee42.workers.dev/',
    authEndpoint: 'https://customerapiauth.fortinet.com/api/v1/oauth/token/',
    iamEndpoint: 'https://support.fortinet.com/es/api/iam/v1',
    flexEndpoint: 'https://support.fortinet.com/es/api/fortiflex/v2',
    clientId: 'flexvm',
    iamClientId: 'iam',
    grantType: 'password'
};

// ============================================================================
// Cookie Management
// ============================================================================

const CookieManager = {
    set(key, value, days = 30) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = "expires=" + d.toUTCString();
        document.cookie = `${key}=${encodeURIComponent(value)};${expires};path=/`;
    },

    get(key) {
        const nameEQ = key + "=";
        const ca = document.cookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i].trim();
            if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
        }
        return null;
    },

    delete(key) {
        this.set(key, '', -1);
    },

    clear() {
        this.delete('username');
        this.delete('password');
        this.delete('token');
        this.delete('tokenExpiry');
        this.delete('iamToken');
        this.delete('iamTokenExpiry');
    }
};

// ============================================================================
// API Client
// ============================================================================

const APIClient = {
    token: null,
    tokenExpiry: null,
    iamToken: null,
    iamTokenExpiry: null,

    async getToken(username, password, clientId = API_CONFIG.clientId) {
        try {
            const response = await fetch(
                `${API_CONFIG.worker_url}?target=${encodeURIComponent(API_CONFIG.authEndpoint)}`,
                {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: username,
                    password: password,
                    client_id: clientId,
                    grant_type: API_CONFIG.grantType
                })
            });

            if (!response.ok) {
                throw new Error(`Authentication failed: ${response.statusText}`);
            }

            const data = await response.json();
            const token = data.access_token;
            const tokenExpiry = Date.now() + (data.expires_in * 1000);

            if (clientId === API_CONFIG.iamClientId) {
                this.iamToken = token;
                this.iamTokenExpiry = tokenExpiry;
                CookieManager.set('iamToken', token, 7);
                CookieManager.set('iamTokenExpiry', tokenExpiry.toString(), 7);
            } else {
                this.token = token;
                this.tokenExpiry = tokenExpiry;
                CookieManager.set('token', token, 7);
                CookieManager.set('tokenExpiry', tokenExpiry.toString(), 7);
            }
            
            return token;
        } catch (error) {
            console.error('Token retrieval error:', error);
            throw error;
        }
    },

    async getIAMToken(username, password) {
        return this.getToken(username, password, API_CONFIG.iamClientId);
    },

    async request(endpoint, method = 'POST', body = {}, tokenType = 'flex') {
        const token = tokenType === 'iam' ? this.iamToken : this.token;
        if (!token) {
            throw new Error('No token available');
        }

        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        if (method === 'POST' || method === 'PUT') {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(
            `${API_CONFIG.worker_url}?target=${encodeURIComponent(endpoint)}`,
            options);

        if (response.status === 401) {
            throw new Error('Token expired or invalid');
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.message || response.statusText}`);
        }

        return await response.json();
    },

    // IAM API calls
    async getAccountDetails(accountId) {
        const attempts = [
            `${API_CONFIG.iamEndpoint}/accounts/list`,
            `${API_CONFIG.iamEndpoint}/accounts/lists`
        ];

        let lastError = null;
        for (const endpoint of attempts) {
            try {
                return await this.request(endpoint, 'POST', { accountId }, 'iam');
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('Account lookup failed');
    },

    // FortiFlex API calls
    async getProgramsList() {
        return this.request(`${API_CONFIG.flexEndpoint}/programs/list`);
    },

    async getProgramPoints(programSerialNumber, dateRange = null) {
        const body = { programSerialNumber };
        if (dateRange?.startDate) body.startDate = dateRange.startDate;
        if (dateRange?.endDate) body.endDate = dateRange.endDate;
        return this.request(`${API_CONFIG.flexEndpoint}/programs/points`, 'POST', body);
    },

    async getConfigsList(programSerialNumber, accountId = null, dateRange = null) {
        const body = { programSerialNumber };
        if (accountId) body.accountId = accountId;
        if (dateRange?.startDate) body.startDate = dateRange.startDate;
        if (dateRange?.endDate) body.endDate = dateRange.endDate;
        return this.request(`${API_CONFIG.flexEndpoint}/configs/list`, 'POST', body);
    },

    async getEntitlementsList(configId = null, accountId = null, programSerialNumber = null, dateRange = null) {
        const body = {};
        if (configId) body.configId = configId;
        if (accountId) body.accountId = accountId;
        if (programSerialNumber) body.programSerialNumber = programSerialNumber;
        if (dateRange?.startDate) body.startDate = dateRange.startDate;
        if (dateRange?.endDate) body.endDate = dateRange.endDate;
        return this.request(`${API_CONFIG.flexEndpoint}/entitlements/list`, 'POST', body);
    },

    async getEntitlementPoints(configId = null, accountId = null, programSerialNumber = null, dateRange = null) {
        const body = {};
        if (configId) body.configId = configId;
        if (accountId) body.accountId = accountId;
        if (programSerialNumber) body.programSerialNumber = programSerialNumber;
        if (dateRange?.startDate) body.startDate = dateRange.startDate;
        if (dateRange?.endDate) body.endDate = dateRange.endDate;
        return this.request(`${API_CONFIG.flexEndpoint}/entitlements/points`, 'POST', body);
    }
};

// ============================================================================
// Data Service
// ============================================================================

const DataService = {
    data: {
        accounts: [],
        programs: [],
        configurations: {},
        entitlements: {},
        pointsData: {},
        accountDetails: {}
    },

    async loadAllData(dateRange = null) {
        try {
            this.data = {
                accounts: [],
                programs: [],
                configurations: {},
                entitlements: {},
                pointsData: {},
                accountDetails: {}
            };

            App.updateLoadingStatus('Loading programs...', 'Fetching FortiFlex programs.');
            const programsResponse = await APIClient.getProgramsList();
            this.data.programs = programsResponse.programs || [];

            // Load configurations and entitlements for each program
            for (const program of this.data.programs) {
                App.updateLoadingStatus(`Loading configurations...`, `Program ${program.serialNumber} is being processed.`);
                await this.loadProgramData(program, dateRange);
            }

            return this.data;
        } catch (error) {
            console.error('Data loading error:', error);
            throw error;
        }
    },

    async loadProgramData(program, dateRange = null) {
        const programSerial = program.serialNumber;
        
        try {
            App.updateLoadingStatus('Loading configurations...', `Configurations for ${programSerial} are being fetched.`);
            const configsResponse = await APIClient.getConfigsList(programSerial, null, dateRange);
            const configs = configsResponse.configs || [];
            this.data.configurations[programSerial] = configs;

            await this.loadAccountDetails(configs);

            // Load entitlements and points for each config
            for (const config of configs) {
                App.updateLoadingStatus('Loading entitlements...', `Entitlements for ${config.name} are being processed.`);
                const entitlementsResponse = await APIClient.getEntitlementsList(config.id, null, null, dateRange);
                this.data.entitlements[config.id] = entitlementsResponse.entitlements || [];

                // Load points with error handling - use empty array on error
                App.updateLoadingStatus('Calculating consumed points...', `Points for ${config.name} are being evaluated.`);
                try {
                    const pointsResponse = await APIClient.getEntitlementPoints(config.id, null, null, dateRange);
                    if (pointsResponse.entitlements) {
                        this.data.pointsData[config.id] = pointsResponse.entitlements;
                    } else {
                        this.data.pointsData[config.id] = [];
                    }
                } catch (pointsError) {
                    console.warn(`Could not load points for config ${config.id}:`, pointsError);
                    // Set empty array so points default to 0
                    this.data.pointsData[config.id] = [];
                }
            }

            // Load program points with error handling
            App.updateLoadingStatus('Calculating program points...', `Finalizing for ${programSerial}.`);
            try {
                const pointsResponse = await APIClient.getProgramPoints(programSerial, dateRange);
                this.data.pointsData[programSerial] = pointsResponse.programs || [];
            } catch (programPointsError) {
                console.warn(`Could not load program points for ${programSerial}:`, programPointsError);
                // Set empty array so points default to 0
                this.data.pointsData[programSerial] = [];
            }

        } catch (error) {
            console.warn(`Could not load data for program ${programSerial}:`, error);
        }
    },

    async loadAccountDetails(configs) {
        const accountIds = [...new Set((configs || [])
            .map(config => config.accountId)
            .filter(Boolean))];

        for (const accountId of accountIds) {
            if (this.data.accountDetails[accountId]) continue;

            try {
                const accountResponse = await APIClient.getAccountDetails(accountId);
                const accounts = accountResponse.accounts || [];
                if (accounts.length > 0) {
                    this.data.accountDetails[accountId] = accounts[0];
                }
            } catch (error) {
                console.warn(`Could not load account details for ${accountId}:`, error);
            }
        }
    }
};

// ============================================================================
// UI Renderer
// ============================================================================

const UIRenderer = {
    renderDashboard(data, dateRange = null) {
        this.renderDateRangeSummary(dateRange);
        this.renderStats(data);
        this.renderAccountsByOU(data);
    },

    renderDateRangeSummary(dateRange) {
        const container = document.getElementById('dateRangeSummary');
        if (!container) return;

        if (dateRange?.startDate || dateRange?.endDate) {
            const startLabel = dateRange.startDate ? new Date(`${dateRange.startDate}T00:00:00`).toLocaleDateString('de-DE') : 'keine';
            const endLabel = dateRange.endDate ? new Date(`${dateRange.endDate}T00:00:00`).toLocaleDateString('de-DE') : 'keine';
            container.textContent = `Zeitraum: ${startLabel} bis ${endLabel}`;
        } else {
            container.textContent = 'Zeitraum: gesamter verfügbarer Zeitraum';
        }
    },

    renderStats(data) {
        const statsContainer = document.getElementById('statsContainer');
        const totalAccounts = data.accounts.length;
        const totalPrograms = data.programs.length;
        const totalConfigs = Object.values(data.configurations).flat().length;
        const totalEntitlements = Object.values(data.entitlements).flat().length;

        const totalPoints = this.calculateTotalPoints(data);
        const roundedTotalPoints = Math.round(totalPoints * 10) / 10;

        statsContainer.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">Total Accounts</div>
                <div class="stat-value">${totalAccounts}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">FortiFlex Programs</div>
                <div class="stat-value">${totalPrograms}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Configurations</div>
                <div class="stat-value">${totalConfigs}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Entitlements</div>
                <div class="stat-value">${totalEntitlements}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Points Consumed</div>
                <div class="stat-value">${roundedTotalPoints.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
            </div>
        `;
    },

    renderAccountsByOU(data) {
        this.renderFlexTable(data);
    },

    // -------------------------------------------------------------------------
    // Table rendering (new table solution to be implemented)
    // -------------------------------------------------------------------------

    renderFlexTable(data) {
        if (!data.programs || data.programs.length === 0) {
            document.getElementById('tableBody').innerHTML = 
                '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #999;">No data available</td></tr>';
            return;
        }

        // Build hierarchical grouped data structure: Account > Config > Entitlements
        const groupedData = new Map();

        for (const program of data.programs) {
            const programSerial = program.serialNumber;
            const configs = data.configurations[programSerial] || [];

            for (const config of configs) {
                const accountId = config.accountId ?? 'unassigned';
                const accountLabel = this.getAccountDisplayName(data, accountId === 'unassigned' ? 'N/A' : accountId);
                const entitlements = data.entitlements[config.id] || [];
                const configName = config.name || 'Unknown Configuration';
                const configId = config.id || 'N/A';
                const productName = config.productType?.name || 'N/A';
                const status = config.status || 'N/A';

                // Initialize account group if not exists
                if (!groupedData.has(accountLabel)) {
                    groupedData.set(accountLabel, { 
                        accountId: accountId === 'unassigned' ? 'N/A' : accountId,
                        configs: new Map(),
                        accountTotal: 0
                    });
                }

                const accountGroup = groupedData.get(accountLabel);

                // Get program dates for entitlements
                const program_data = data.programs.find(p => p.serialNumber === programSerial);
                const startDate = program_data?.startDate || 'N/A';
                const endDate = program_data?.endDate || 'N/A';

                // Build entitlements for this config
                // Get points data for this config (stored separately in pointsData)
                const configPointsData = data.pointsData[config.id] || [];
                let configTotal = 0;
                const configEntitlements = [];

                if (entitlements.length === 0) {
                    configEntitlements.push({
                        entitlementSerial: 'N/A',
                        status: status,
                        points: 0,
                        startDate: startDate,
                        endDate: endDate
                    });
                } else {
                    for (const ent of entitlements) {
                        // Filter out NOTUSED entitlements
                        if (ent.tokenStatus === 'NOTUSED') {
                            continue;
                        }

                        // Look for matching points data by serial number
                        const matchingPointsData = configPointsData.find(p => p.serialNumber === ent.serialNumber);
                        const entitlementPoints = this.getPointValue(matchingPointsData || ent);
                        configTotal += entitlementPoints;
                        
                        // Use entitlement's own status if available, otherwise use config status
                        const entitlementStatus = ent.status || status;
                        
                        configEntitlements.push({
                            entitlementSerial: ent.serialNumber || 'N/A',
                            status: entitlementStatus,
                            points: entitlementPoints,
                            startDate: startDate,
                            endDate: endDate,
                            tokenStatus: ent.tokenStatus
                        });
                    }
                }

                accountGroup.accountTotal += configTotal;

                // Store config with its entitlements
                accountGroup.configs.set(configId, {
                    configName: configName,
                    configId: configId,
                    productName: productName,
                    status: status,
                    entitlements: configEntitlements,
                    configTotal: configTotal
                });
            }
        }

        // Render table
        TableManager.renderHierarchicalTable(groupedData);
        TableManager.setupEventListeners();
    },

    getAccountDisplayName(data, accountId) {
        if (!accountId || accountId === 'N/A') {
            return 'Unknown';
        }

        const accountDetails = data.accountDetails?.[accountId];
        if (!accountDetails) {
            return `Account ${accountId}`;
        }

        const fullName = [accountDetails.firstName, accountDetails.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();

        return fullName || accountDetails.company || `Account ${accountId}`;
    },

    getPointValue(item) {
        const candidates = [item?.points, item?.pointBalance, item?.pointConsumption, item?.consumedPoints, item?.consumption, item?.balance];
        for (const candidate of candidates) {
            const numericValue = Number(candidate);
            if (Number.isFinite(numericValue)) {
                return numericValue;
            }
        }
        return 0;
    },

    calculateTotalPoints(data) {
        let total = 0;
        
        // Iterate through all configurations and sum only non-NOTUSED entitlements
        for (const program of data.programs) {
            const programSerial = program.serialNumber;
            const configs = data.configurations[programSerial] || [];
            
            for (const config of configs) {
                const entitlements = data.entitlements[config.id] || [];
                const configPointsData = data.pointsData[config.id] || [];
                
                for (const ent of entitlements) {
                    // Skip NOTUSED entitlements
                    if (ent.tokenStatus === 'NOTUSED') {
                        continue;
                    }
                    
                    // Look for matching points data by serial number
                    const matchingPointsData = configPointsData.find(p => p.serialNumber === ent.serialNumber);
                    const points = this.getPointValue(matchingPointsData || ent);
                    total += points;
                }
            }
        }
        
        return total;
    }
};

// ============================================================================
// Export Functions
// ============================================================================

const ExportService = {
    async generateCSV(data) {
        let csv = 'Account,Configuration,Config ID,Entitlement Serial,Product,Status,Points\n';

        for (const program of data.programs) {
            const programSerial = program.serialNumber;
            const configs = data.configurations[programSerial] || [];
            
            for (const config of configs) {
                const accountId = config.accountId ?? 'unassigned';
                const accountLabel = UIRenderer.getAccountDisplayName(data, accountId === 'unassigned' ? 'N/A' : accountId);
                const entitlements = data.entitlements[config.id] || [];
                const configPointsData = data.pointsData[config.id] || [];
                
                if (entitlements.length === 0) {
                    csv += `"${accountLabel}","${config.name}","${config.id}","N/A","${config.productType?.name || 'N/A'}","${config.status || 'N/A'}",0\n`;
                } else {
                    for (const ent of entitlements) {
                        // Filter out NOTUSED entitlements
                        if (ent.tokenStatus === 'NOTUSED') {
                            continue;
                        }

                        // Look for matching points data by serial number
                        const matchingPointsData = configPointsData.find(p => p.serialNumber === ent.serialNumber);
                        const points = UIRenderer.getPointValue(matchingPointsData || ent);
                        const roundedPoints = Math.round(points * 10) / 10;
                        
                        // Use entitlement's own status if available, otherwise use config status
                        const entitlementStatus = ent.status || config.status || 'N/A';
                        
                        csv += `"${accountLabel}","${config.name}","${config.id}","${ent.serialNumber}","${config.productType?.name || 'N/A'}","${entitlementStatus}","${roundedPoints.toString().replace('.', ',')}\n`;
                    }
                }
            }
        }

        return csv;
    },

    downloadCSV(data) {
        this.generateCSV(data).then(csv => {
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `FortiToken-Report-${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    },

    async downloadPDF(data) {
        // Create HTML content for PDF
        let htmlContent = `
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #667eea; text-align: center; }
                    h2 { color: #764ba2; margin-top: 30px; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
                    h3 { color: #333; margin-top: 15px; }
                    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #667eea; color: white; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .stat { display: inline-block; width: 20%; text-align: center; padding: 10px; }
                    .stat-value { font-size: 20px; font-weight: bold; color: #667eea; }
                </style>
            </head>
            <body>
                <h1>FortiToken Reporting - Entitlements Overview</h1>
                <p style="text-align: center; color: #666;">Generated on: ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE')}</p>
                
                <div style="border: 1px solid #ddd; padding: 15px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">📊 Summary</h3>
                    <div class="stat"><div class="stat-value">${data.accounts.length}</div><div>Accounts</div></div>
                    <div class="stat"><div class="stat-value">${data.programs.length}</div><div>Programs</div></div>
                    <div class="stat"><div class="stat-value">${Object.values(data.configurations).flat().length}</div><div>Configurations</div></div>
                    <div class="stat"><div class="stat-value">${Object.values(data.entitlements).flat().length}</div><div>Entitlements</div></div>
                </div>
        `;

        // Group by Account and Configuration
        const groupedData = {};
        for (const program of data.programs) {
            const programSerial = program.serialNumber;
            const configs = data.configurations[programSerial] || [];
            
            for (const config of configs) {
                const accountId = config.accountId ?? 'unassigned';
                const accountLabel = UIRenderer.getAccountDisplayName(data, accountId === 'unassigned' ? 'N/A' : accountId);
                const key = `${accountLabel}|${config.name}`;
                
                if (!groupedData[key]) {
                    groupedData[key] = {
                        account: accountLabel,
                        config: config.name,
                        configId: config.id,
                        product: config.productType?.name || 'N/A',
                        status: config.status || 'N/A',
                        entitlements: data.entitlements[config.id] || []
                    };
                }
            }
        }

        htmlContent += `<h2>📋 Entitlements for accounts and configurations</h2>`;
        htmlContent += `<table>
            <tr>
                <th>Account</th>
                <th>Configuration</th>
                <th>Entitlement Serial</th>
                <th>Product</th>
                <th>Status</th>
                <th>Points</th>
            </tr>`;

        for (const key in groupedData) {
            const group = groupedData[key];
            const entitlements = group.entitlements;
            const configPointsData = data.pointsData[group.configId] || [];
            
            // Filter out NOTUSED entitlements
            const filteredEntitlements = entitlements.filter(ent => ent.tokenStatus !== 'NOTUSED');
            
            if (filteredEntitlements.length === 0) {
                htmlContent += `
                    <tr>
                        <td>${group.account}</td>
                        <td>${group.config}</td>
                        <td>N/A</td>
                        <td>${group.product}</td>
                        <td>${group.status}</td>
                        <td>0,0</td>
                    </tr>
                `;
            } else {
                
                for (let i = 0; i < filteredEntitlements.length; i++) {
                    const ent = filteredEntitlements[i];
                    // Look for matching points data by serial number
                    const matchingPointsData = configPointsData.find(p => p.serialNumber === ent.serialNumber);
                    const points = UIRenderer.getPointValue(matchingPointsData || ent);
                    const roundedPoints = Math.round(points * 10) / 10;
                    const pointsStr = roundedPoints.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                    
                    // Use entitlement's own status if available, otherwise use config status
                    const entitlementStatus = ent.status || group.status;
                    
                    htmlContent += `
                        <tr>
                            ${i === 0 ? `<td rowspan="${filteredEntitlements.length}">${group.account}</td>` : ''}
                            ${i === 0 ? `<td rowspan="${filteredEntitlements.length}">${group.config}</td>` : ''}
                            <td>${ent.serialNumber}</td>
                            ${i === 0 ? `<td rowspan="${filteredEntitlements.length}">${group.product}</td>` : ''}
                            ${i === 0 ? `<td rowspan="${filteredEntitlements.length}">${entitlementStatus}</td>` : ''}
                            <td>${pointsStr}</td>
                        </tr>
                    `;
                }
            }
        }

        htmlContent += `</table>`;
        htmlContent += `
            </body>
            </html>
        `;

        // Use print functionality
        const printWindow = window.open('', '_blank');
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 250);
    }
};

// ============================================================================
// Main Application Logic
// ============================================================================

const App = {
    dateRange: null,

    init() {
        this.setupEventListeners();
        this.initializeDateRange();
        this.checkExistingSession();
    },

    setupEventListeners() {
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('clearCookies').addEventListener('click', () => this.handleClearCookies());
        document.getElementById('logout').addEventListener('click', () => this.handleLogout());
        document.getElementById('exportCSV').addEventListener('click', () => this.handleExportCSV());
        document.getElementById('exportPDF').addEventListener('click', () => this.handleExportPDF());
        document.getElementById('applyDateRange').addEventListener('click', () => this.handleApplyDateRange());
    },

    initializeDateRange() {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        this.dateRange = {
            startDate: this.formatDateInput(firstDayOfMonth),
            endDate: this.formatDateInput(today)
        };
        this.syncDateRangeInputs();
    },

    formatDateInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    syncDateRangeInputs() {
        document.getElementById('startDate').value = this.dateRange?.startDate || '';
        document.getElementById('endDate').value = this.dateRange?.endDate || '';
    },

    getDateRangeFromInputs() {
        return {
            startDate: document.getElementById('startDate').value || null,
            endDate: document.getElementById('endDate').value || null
        };
    },

    checkExistingSession() {
        const savedUsername = CookieManager.get('username');
        const savedPassword = CookieManager.get('password');
        const savedToken = CookieManager.get('token');
        const savedTokenExpiry = CookieManager.get('tokenExpiry');

        if (savedUsername && savedPassword) {
            document.getElementById('username').value = savedUsername;
            document.getElementById('password').value = savedPassword;
        }

        const savedIAMToken = CookieManager.get('iamToken');
        const savedIAMTokenExpiry = CookieManager.get('iamTokenExpiry');

        if (savedToken && savedTokenExpiry && Date.now() < parseInt(savedTokenExpiry)) {
            APIClient.token = savedToken;
            APIClient.tokenExpiry = parseInt(savedTokenExpiry);
            if (savedIAMToken && savedIAMTokenExpiry && Date.now() < parseInt(savedIAMTokenExpiry)) {
                APIClient.iamToken = savedIAMToken;
                APIClient.iamTokenExpiry = parseInt(savedIAMTokenExpiry);
            }
            this.showLoginSuccess('Session wiederhergestellt');
            this.showDashboard();
        }
    },

    async handleLogin(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();

        if (!username || !password) {
            this.showLoginError('Benutzername und Passwort sind erforderlich');
            return;
        }

        this.showLoading(true);
        this.clearMessages();

        try {
            // Get tokens for Flex and IAM
            await APIClient.getToken(username, password);
            await APIClient.getIAMToken(username, password);
            
            // Save credentials to cookie
            CookieManager.set('username', username, 30);
            CookieManager.set('password', password, 30);

            this.showLoginSuccess('Authentifizierung erfolgreich!');
            this.showDashboard();
        } catch (error) {
            this.showLoginError(`Fehler: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    },

    showDashboard() {
        this.dateRange = this.getDateRangeFromInputs();
        UIRenderer.renderDashboard({
            accounts: [],
            programs: [],
            configurations: {},
            entitlements: {},
            pointsData: {},
            accountDetails: {}
        }, this.dateRange);
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
    },

    async loadDashboard() {
        this.showLoading(true);
        this.clearMessages();

        try {
            const username = document.getElementById('username').value.trim() || CookieManager.get('username');
            const password = document.getElementById('password').value.trim() || CookieManager.get('password');

            if (username && password) {
                try {
                    await APIClient.getIAMToken(username, password);
                } catch (error) {
                    console.warn('Could not refresh IAM token:', error);
                }
            }

            this.dateRange = this.getDateRangeFromInputs();
            if (this.dateRange.startDate && this.dateRange.endDate && this.dateRange.startDate > this.dateRange.endDate) {
                throw new Error('Das Startdatum darf nicht nach dem Enddatum liegen.');
            }

            const data = await DataService.loadAllData(this.dateRange);
            UIRenderer.renderDashboard(data, this.dateRange);
            
            // Store data for export
            this.currentData = data;

            // Show dashboard, hide login
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
        } catch (error) {
            this.showLoginError(`Fehler beim Laden der Daten: ${error.message}`);
            document.getElementById('loginSection').style.display = 'block';
            document.getElementById('dashboard').style.display = 'none';
        } finally {
            this.showLoading(false);
        }
    },

    handleApplyDateRange() {
        this.dateRange = this.getDateRangeFromInputs();
        if (this.dateRange.startDate && this.dateRange.endDate && this.dateRange.startDate > this.dateRange.endDate) {
            this.showLoginError('The start date cannot be after the end date.');
            return;
        }
        this.loadDashboard();
    },

    handleClearCookies() {
        if (confirm('Really delete cookies? You will need to log in again.')) {
            CookieManager.clear();
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            this.showLoginSuccess('Cookies deleted');
        }
    },

    handleLogout() {
        CookieManager.clear();
        APIClient.token = null;
        APIClient.tokenExpiry = null;
        document.getElementById('loginSection').style.display = 'block';
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('password').focus();
        this.showLoginSuccess('Successfully logged out');
    },

    handleExportCSV() {
        if (!this.currentData) {
            this.showLoginError('No data available for export');
            return;
        }
        ExportService.downloadCSV(this.currentData);
        this.showLoginSuccess('CSV export started successfully');
    },

    handleExportPDF() {
        if (!this.currentData) {
            this.showLoginError('No data available for export');
            return;
        }
        ExportService.downloadPDF(this.currentData);
        this.showLoginSuccess('PDF export started successfully');
    },

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
        if (!show) {
            this.updateLoadingStatus('Authentication in progress...', 'Please wait a moment.');
        }
    },

    updateLoadingStatus(status, substatus = 'Please wait a moment.') {
        const statusEl = document.getElementById('loadingStatus');
        const substatusEl = document.getElementById('loadingSubstatus');
        if (statusEl) statusEl.textContent = status;
        if (substatusEl) substatusEl.textContent = substatus;
    },

    showLoginError(message) {
        const errorDiv = document.getElementById('errorMessage');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    },

    showLoginSuccess(message) {
        const successDiv = document.getElementById('successMessage');
        successDiv.textContent = message;
        successDiv.style.display = 'block';
        setTimeout(() => {
            successDiv.style.display = 'none';
        }, 5000);
    },

    clearMessages() {
        document.getElementById('errorMessage').style.display = 'none';
        document.getElementById('successMessage').style.display = 'none';
    }
};

// ============================================================================
// Initialize Application
// ============================================================================
// Table Manager
// ============================================================================

const TableManager = {
    allAccountsExpanded: true,
    allConfigsExpanded: true,
    currentData: null,

    renderHierarchicalTable(groupedData) {
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = '';

        if (groupedData.size === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #999;">Keine Daten verfügbar</td></tr>';
            return;
        }

        this.currentData = groupedData;

        let accountIndex = 0;
        for (const [accountLabel, accountGroup] of groupedData) {
            const accountId = `account-${accountIndex}`;

            // ============ ACCOUNT HEADER ROW ============
            const accountHeaderRow = document.createElement('tr');
            accountHeaderRow.className = 'account-header-row';
            accountHeaderRow.setAttribute('data-account-id', accountId);
            accountHeaderRow.setAttribute('onclick', `TableManager.toggleAccount('${accountId}')`);
            accountHeaderRow.innerHTML = `
                <td>
                    <span class="group-toggle">▼</span>
                    <strong>🏢 ${accountLabel}</strong>
                </td>
                <td><code>${accountGroup.accountId}</code></td>
                <td colspan="5"></td>
                <td>${this.formatPoints(accountGroup.accountTotal)}</td>
            `;
            tbody.appendChild(accountHeaderRow);

            // ============ CONFIGURATION ROWS ============
            let configIndex = 0;
            for (const [configId, configData] of accountGroup.configs) {
                const configGroupId = `${accountId}-config-${configIndex}`;

                // Config Header Row
                const configHeaderRow = document.createElement('tr');
                configHeaderRow.className = `config-header-row ${accountId}`;
                configHeaderRow.setAttribute('data-config-id', configGroupId);
                configHeaderRow.setAttribute('onclick', `TableManager.toggleConfig('${configGroupId}')`);
                configHeaderRow.innerHTML = `
                    <td>
                        <span class="group-toggle">▼</span>
                        ${configData.configName}
                    </td>
                    <td><code>${configData.configId}</code></td>
                    <td>${configData.productName}</td>
                    <td colspan="4"></td>
                    <td>${this.formatPoints(configData.configTotal)}</td>
                `;
                tbody.appendChild(configHeaderRow);

                // ============ ENTITLEMENT ROWS ============
                for (const entitlement of configData.entitlements) {
                    const entitlementRow = document.createElement('tr');
                    entitlementRow.className = `entitlement-row ${accountId} ${configGroupId}`;
                    entitlementRow.setAttribute('data-status', entitlement.status);
                    entitlementRow.innerHTML = `
                        <td>${configData.configName}</td>
                        <td><code>${configData.configId}</code></td>
                        <td>${configData.productName}</td>
                        <td><code>${entitlement.entitlementSerial}</code></td>
                        <td>${this.getStatusBadge(entitlement.status)}</td>
                        <td>${entitlement.startDate}</td>
                        <td>${entitlement.endDate}</td>
                        <td>${this.formatPoints(entitlement.points)}</td>
                    `;
                    tbody.appendChild(entitlementRow);
                }

                configIndex++;
            }

            accountIndex++;
        }
    },

    getStatusBadge(status) {
        const classes = {
            'ACTIVE': 'status-active',
            'PENDING': 'status-pending',
            'INACTIVE': 'status-inactive'
        };
        const className = classes[status] || 'status-inactive';
        return `<span class="status-badge ${className}">${status}</span>`;
    },

    formatPoints(points) {
        if (points === undefined || points === null) return '-';
        const rounded = Math.round(points * 10) / 10;
        return `<span class="points-badge">${rounded.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Pts</span>`;
    },

    toggleAccount(accountId) {
        // Toggle all config headers and entitlements for this account
        const configHeaders = document.querySelectorAll(`.config-header-row.${accountId}`);
        const entitlements = document.querySelectorAll(`.entitlement-row.${accountId}`);
        const accountHeader = document.querySelector(`[data-account-id="${accountId}"]`);
        const toggle = accountHeader.querySelector('.group-toggle');

        const isHidden = configHeaders[0]?.style.display === 'none';
        configHeaders.forEach(row => row.style.display = isHidden ? '' : 'none');
        entitlements.forEach(row => row.style.display = isHidden ? '' : 'none');
        toggle.classList.toggle('collapsed', !isHidden);
    },

    toggleConfig(configGroupId) {
        // Toggle entitlements for this config
        const entitlements = document.querySelectorAll(`.${configGroupId}`);
        const configHeader = document.querySelector(`[data-config-id="${configGroupId}"]`);
        const toggle = configHeader.querySelector('.group-toggle');

        const isHidden = entitlements[0]?.style.display === 'none';
        entitlements.forEach(row => row.style.display = isHidden ? '' : 'none');
        toggle.classList.toggle('collapsed', !isHidden);
    },

    toggleAllAccounts() {
        this.allAccountsExpanded = !this.allAccountsExpanded;
        const accountHeaders = document.querySelectorAll('.account-header-row');

        accountHeaders.forEach(accountHeader => {
            const accountId = accountHeader.getAttribute('data-account-id');
            const configHeaders = document.querySelectorAll(`.config-header-row.${accountId}`);
            const entitlements = document.querySelectorAll(`.entitlement-row.${accountId}`);
            const toggle = accountHeader.querySelector('.group-toggle');

            configHeaders.forEach(row => row.style.display = this.allAccountsExpanded ? '' : 'none');
            entitlements.forEach(row => row.style.display = this.allAccountsExpanded ? '' : 'none');
            toggle.classList.toggle('collapsed', !this.allAccountsExpanded);
        });
    },

    toggleAllConfigs() {
        this.allConfigsExpanded = !this.allConfigsExpanded;
        const configHeaders = document.querySelectorAll('.config-header-row');

        configHeaders.forEach(configHeader => {
            const configGroupId = configHeader.getAttribute('data-config-id');
            const entitlements = document.querySelectorAll(`.${configGroupId}`);
            const toggle = configHeader.querySelector('.group-toggle');

            entitlements.forEach(row => row.style.display = this.allConfigsExpanded ? '' : 'none');
            toggle.classList.toggle('collapsed', !this.allConfigsExpanded);
        });
    },

    setupEventListeners() {
        const searchInput = document.getElementById('tableSearch');
        const statusFilter = document.getElementById('statusFilterTable');

        if (searchInput) {
            searchInput.addEventListener('input', () => this.filterTable());
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.filterTable());
        }
    },

    filterTable() {
        const searchValue = document.getElementById('tableSearch')?.value.toLowerCase() || '';
        const statusValue = document.getElementById('statusFilterTable')?.value || '';

        // Filter entitlements
        const entitlementRows = document.querySelectorAll('.entitlement-row');
        const visibleConfigs = new Set();
        const visibleAccounts = new Set();

        entitlementRows.forEach(row => {
            const status = row.getAttribute('data-status');
            const text = row.textContent.toLowerCase();

            const matchesSearch = !searchValue || text.includes(searchValue);
            const matchesStatus = !statusValue || status === statusValue;

            if (matchesSearch && matchesStatus) {
                row.style.display = '';
                // Track which configs and accounts have visible rows
                const classes = row.className.split(' ');
                classes.forEach(cls => {
                    if (cls.startsWith('account-')) visibleAccounts.add(cls);
                    if (cls.includes('config')) visibleConfigs.add(cls);
                });
            } else {
                row.style.display = 'none';
            }
        });

        // Show/hide config headers based on visible entitlements
        const configHeaders = document.querySelectorAll('.config-header-row');
        configHeaders.forEach(header => {
            const configGroupId = header.getAttribute('data-config-id');
            const hasVisibleEntitlements = Array.from(visibleConfigs).some(cls => configGroupId.includes(cls.replace('entitlement-row ', '')));
            header.style.display = hasVisibleEntitlements ? '' : 'none';
        });

        // Show/hide account headers based on visible configs
        const accountHeaders = document.querySelectorAll('.account-header-row');
        accountHeaders.forEach(header => {
            const accountId = header.getAttribute('data-account-id');
            const hasVisibleConfigs = Array.from(visibleAccounts).some(cls => cls === accountId);
            header.style.display = hasVisibleConfigs ? '' : 'none';
        });
    }
};

// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
