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
    async getCommonData() {
        return this.request(`${API_CONFIG.iamEndpoint}/accounts/getcommondata`);
    },

    async getAccountsList(parentId) {
        return this.request(`${API_CONFIG.iamEndpoint}/accounts/list`, 'POST', { parentId });
    },

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

    async getProgramPoints(programSerialNumber) {
        return this.request(`${API_CONFIG.flexEndpoint}/programs/points`, 'POST', {
            programSerialNumber
        });
    },

    async getConfigsList(programSerialNumber, accountId = null) {
        const body = { programSerialNumber };
        if (accountId) body.accountId = accountId;
        return this.request(`${API_CONFIG.flexEndpoint}/configs/list`, 'POST', body);
    },

    async getEntitlementsList(configId = null, accountId = null, programSerialNumber = null) {
        const body = {};
        if (configId) body.configId = configId;
        if (accountId) body.accountId = accountId;
        if (programSerialNumber) body.programSerialNumber = programSerialNumber;
        return this.request(`${API_CONFIG.flexEndpoint}/entitlements/list`, 'POST', body);
    },

    async getEntitlementPoints(configId = null, accountId = null, programSerialNumber = null) {
        const body = {};
        if (configId) body.configId = configId;
        if (accountId) body.accountId = accountId;
        if (programSerialNumber) body.programSerialNumber = programSerialNumber;
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

    async loadAllData() {
        try {
            // Load programs
            const programsResponse = await APIClient.getProgramsList();
            this.data.programs = programsResponse.programs || [];

            // Load accounts
            //const commonData = await APIClient.getCommonData();
            //await this.loadAccountsRecursively(commonData.organizationUnits, null);

            // Load configurations and entitlements for each program
            for (const program of this.data.programs) {
                await this.loadProgramData(program);
            }

            return this.data;
        } catch (error) {
            console.error('Data loading error:', error);
            throw error;
        }
    },

    async loadAccountsRecursively(ouData, parentId) {
        if (!ouData) return;

        // Get accounts for this OU
        try {
            const accountsResponse = await APIClient.getAccountsList(parentId);
            if (accountsResponse.accounts) {
                this.data.accounts.push(...accountsResponse.accounts.map(acc => ({
                    ...acc,
                    ouId: parentId
                })));
            }
        } catch (error) {
            console.warn(`Could not load accounts for OU ${parentId}:`, error);
        }
    },

    async loadProgramData(program) {
        const programSerial = program.serialNumber;
        
        try {
            // Load configurations
            const configsResponse = await APIClient.getConfigsList(programSerial);
            const configs = configsResponse.configs || [];
            this.data.configurations[programSerial] = configs;

            await this.loadAccountDetails(configs);

            // Load entitlements and points for each config
            for (const config of configs) {
                const entitlementsResponse = await APIClient.getEntitlementsList(config.id);
                this.data.entitlements[config.id] = entitlementsResponse.entitlements || [];

                const pointsResponse = await APIClient.getEntitlementPoints(config.id);
                if (pointsResponse.entitlements) {
                    this.data.pointsData[config.id] = pointsResponse.entitlements;
                }
            }

            // Load program points
            const pointsResponse = await APIClient.getProgramPoints(programSerial);
            this.data.pointsData[programSerial] = pointsResponse.programs || [];

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
    renderDashboard(data) {
        this.renderStats(data);
        this.renderAccountsByOU(data);
    },

    renderStats(data) {
        const statsContainer = document.getElementById('statsContainer');
        const totalAccounts = data.accounts.length;
        const totalPrograms = data.programs.length;
        const totalConfigs = Object.values(data.configurations).flat().length;
        const totalEntitlements = Object.values(data.entitlements).flat().length;

        const totalPoints = this.calculateTotalPoints(data);

        statsContainer.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">Gesamtzahl Accounts</div>
                <div class="stat-value">${totalAccounts}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">FortiFlex Programme</div>
                <div class="stat-value">${totalPrograms}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Konfigurationen</div>
                <div class="stat-value">${totalConfigs}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Entitlements</div>
                <div class="stat-value">${totalEntitlements}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Gesamtpunkte verbraucht</div>
                <div class="stat-value">${totalPoints.toLocaleString('de-DE')}</div>
            </div>
        `;
    },

    renderAccountsByOU(data) {
        const dataContainer = document.getElementById('dataContainer');
        
        if (!data.programs || data.programs.length === 0) {
            dataContainer.innerHTML = '<div class="no-data">Keine Daten verfügbar</div>';
            return;
        }

        let html = '';

        for (const program of data.programs) {
            const programSerial = program.serialNumber;
            const configs = data.configurations[programSerial] || [];
            
            const programPoints = this.calculateProgramPoints(data, programSerial);
            const groupedConfigs = this.groupConfigsByAccount(configs);
            
            html += `
                <div class="ou-section">
                    <div class="ou-title">
                        <span>📦 Programm: ${programSerial}</span>
                        <span class="ou-stats">
                            ${configs.length} Konfigurationen | 
                            Punkte: <strong>${programPoints.toLocaleString('de-DE')}</strong>
                        </span>
                    </div>
                    <div>
            `;

            for (const group of groupedConfigs) {
                const accountId = group.accountId === 'unassigned' ? 'N/A' : group.accountId;
                const accountLabel = this.getAccountDisplayName(data, accountId);
                const accountSummary = `${group.configs.length} Konfigurationen`;

                html += `
                    <div class="account-group expanded">
                        <div class="account-group-header">
                            <span class="toggle-icon">▼</span>
                            <div class="account-group-heading">
                                <div class="account-group-title">👤 ${accountLabel}</div>
                                <div class="account-group-meta">Account ID: ${accountId} • ${accountSummary}</div>
                            </div>
                        </div>
                        <div class="account-group-content">
                            <div class="config-table-wrapper">
                                <table class="config-table">
                                    <thead>
                                        <tr>
                                            <th>Konfiguration</th>
                                            <th>Produkt</th>
                                            <th>Status</th>
                                            <th>Entitlements</th>
                                            <th>Punkte</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                `;

                for (const config of group.configs) {
                    const entitlements = data.entitlements[config.id] || [];
                    const configPoints = this.calculateConfigPoints(data, config.id);
                    const rowId = `${programSerial}-${config.id}`;
                    
                    html += `
                        <tr class="config-row" data-config-id="${config.id}" data-row-id="${rowId}">
                            <td>
                                <div class="config-name">${config.name}</div>
                                <div class="config-meta">Config ID: ${config.id}</div>
                            </td>
                            <td>${config.productType?.name || 'N/A'}</td>
                            <td><span class="config-status status-active">${config.status}</span></td>
                            <td>${entitlements.length}</td>
                            <td>${configPoints.toLocaleString('de-DE')}</td>
                        </tr>
                        <tr class="config-detail-row" id="${rowId}" style="display: none;">
                            <td colspan="5">
                                ${this.renderEntitlements(entitlements)}
                            </td>
                        </tr>
                    `;
                }

                html += `
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        dataContainer.innerHTML = html;
        this.attachEventListeners();
    },

    groupConfigsByAccount(configs) {
        const groups = new Map();

        for (const config of configs) {
            const accountId = config.accountId ?? 'unassigned';
            if (!groups.has(accountId)) {
                groups.set(accountId, []);
            }
            groups.get(accountId).push(config);
        }

        return Array.from(groups.entries()).map(([accountId, groupedConfigs]) => ({
            accountId,
            configs: groupedConfigs
        }));
    },

    getAccountDisplayName(data, accountId) {
        if (!accountId || accountId === 'N/A') {
            return 'Unbekannt';
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

    renderEntitlements(entitlements) {
        if (!entitlements || entitlements.length === 0) {
            return '<div class="no-data" style="padding: 10px;">Keine Entitlements vorhanden</div>';
        }

        return entitlements.map(ent => `
            <div class="entitlement-item">
                <div class="entitlement-serial">🔐 ${ent.serialNumber}</div>
                <div class="entitlement-info">
                    <div><strong>Status:</strong> ${ent.status || 'N/A'}</div>
                    <div><strong>Token:</strong> ${ent.tokenStatus || 'N/A'}</div>
                    <div><strong>Start:</strong> ${new Date(ent.startDate).toLocaleDateString('de-DE')}</div>
                    <div><strong>Ende:</strong> ${new Date(ent.endDate).toLocaleDateString('de-DE')}</div>
                </div>
                ${ent.description ? `<div style="color: #999; font-size: 12px; margin-top: 5px;">Beschreibung: ${ent.description}</div>` : ''}
            </div>
        `).join('');
    },

    attachEventListeners() {
        document.querySelectorAll('.account-group-header').forEach(header => {
            header.addEventListener('click', function() {
                const group = this.closest('.account-group');
                const content = group.querySelector('.account-group-content');
                const isExpanded = group.classList.toggle('expanded');
                content.style.display = isExpanded ? 'block' : 'none';
                this.querySelector('.toggle-icon').textContent = isExpanded ? '▼' : '▶';
            });
        });

        document.querySelectorAll('.config-row').forEach(row => {
            row.addEventListener('click', function() {
                const detailRow = document.getElementById(this.dataset.rowId);
                const isExpanded = this.classList.toggle('expanded');
                if (detailRow) {
                    detailRow.style.display = isExpanded ? 'table-row' : 'none';
                }
            });
        });
    },

    calculateTotalPoints(data) {
        return Object.values(data.pointsData).flat().reduce((sum, item) => {
            if (typeof item.points === 'number') return sum + item.points;
            if (typeof item.pointBalance === 'number') return sum + item.pointBalance;
            return sum;
        }, 0);
    },

    calculateProgramPoints(data, programSerial) {
        const programData = data.pointsData[programSerial] || [];
        return programData.reduce((sum, item) => sum + (item.pointBalance || 0), 0);
    },

    calculateConfigPoints(data, configId) {
        const configData = data.pointsData[configId] || [];
        return configData.reduce((sum, item) => sum + (item.points || 0), 0);
    }
};

// ============================================================================
// Export Functions
// ============================================================================

const ExportService = {
    async generateCSV(data) {
        let csv = 'Programm,Konfiguration,Entitlement Serial,Status,Token Status,Start Datum,End Datum,Beschreibung\n';

        for (const program of data.programs) {
            const configs = data.configurations[program.serialNumber] || [];
            
            for (const config of configs) {
                const entitlements = data.entitlements[config.id] || [];
                
                if (entitlements.length === 0) {
                    csv += `"${program.serialNumber}","${config.name}","N/A","N/A","N/A","N/A","N/A","N/A"\n`;
                } else {
                    for (const ent of entitlements) {
                        csv += `"${program.serialNumber}","${config.name}","${ent.serialNumber}","${ent.status || 'N/A'}","${ent.tokenStatus || 'N/A'}","${new Date(ent.startDate).toLocaleDateString('de-DE')}","${new Date(ent.endDate).toLocaleDateString('de-DE')}","${(ent.description || '').replace(/"/g, '""')}"\n`;
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
                <h1>FortiToken Reporting - Verbrauchsübersicht</h1>
                <p style="text-align: center; color: #666;">Generiert am: ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE')}</p>
                
                <div style="border: 1px solid #ddd; padding: 15px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">📊 Zusammenfassung</h3>
                    <div class="stat"><div class="stat-value">${data.accounts.length}</div><div>Accounts</div></div>
                    <div class="stat"><div class="stat-value">${data.programs.length}</div><div>Programme</div></div>
                    <div class="stat"><div class="stat-value">${Object.values(data.configurations).flat().length}</div><div>Konfigurationen</div></div>
                    <div class="stat"><div class="stat-value">${Object.values(data.entitlements).flat().length}</div><div>Entitlements</div></div>
                </div>
        `;

        for (const program of data.programs) {
            const configs = data.configurations[program.serialNumber] || [];
            htmlContent += `<h2>📦 Programm: ${program.serialNumber}</h2>`;
            htmlContent += `<p><strong>Von:</strong> ${new Date(program.startDate).toLocaleDateString('de-DE')} | <strong>Bis:</strong> ${new Date(program.endDate).toLocaleDateString('de-DE')} | <strong>Support:</strong> ${program.hasSupportCoverage ? 'Ja' : 'Nein'}</p>`;

            htmlContent += `<table>
                <tr>
                    <th>Konfiguration</th>
                    <th>Produkttyp</th>
                    <th>Status</th>
                    <th>Entitlements</th>
                </tr>`;

            for (const config of configs) {
                const entitlements = data.entitlements[config.id] || [];
                htmlContent += `
                    <tr>
                        <td>${config.name}</td>
                        <td>${config.productType?.name || 'N/A'}</td>
                        <td>${config.status}</td>
                        <td>${entitlements.length}</td>
                    </tr>
                `;

                if (entitlements.length > 0) {
                    htmlContent += `<tr style="background-color: #f0f0f0;">
                        <td colspan="4">
                            <table style="width: 100%; margin: 0; border: none;">
                                <tr style="border: none;">
                                    <th style="background: none; color: #333; text-align: left; border-bottom: 1px solid #ddd;">Serial</th>
                                    <th style="background: none; color: #333; text-align: left; border-bottom: 1px solid #ddd;">Status</th>
                                    <th style="background: none; color: #333; text-align: left; border-bottom: 1px solid #ddd;">Start</th>
                                    <th style="background: none; color: #333; text-align: left; border-bottom: 1px solid #ddd;">Ende</th>
                                </tr>`;
                    
                    for (const ent of entitlements) {
                        htmlContent += `
                            <tr style="border: none;">
                                <td style="border: none;">${ent.serialNumber}</td>
                                <td style="border: none;">${ent.status}</td>
                                <td style="border: none;">${new Date(ent.startDate).toLocaleDateString('de-DE')}</td>
                                <td style="border: none;">${new Date(ent.endDate).toLocaleDateString('de-DE')}</td>
                            </tr>
                        `;
                    }
                    htmlContent += `</table></td></tr>`;
                }
            }

            htmlContent += `</table>`;
        }

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
    init() {
        this.setupEventListeners();
        this.checkExistingSession();
    },

    setupEventListeners() {
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('clearCookies').addEventListener('click', () => this.handleClearCookies());
        document.getElementById('logout').addEventListener('click', () => this.handleLogout());
        document.getElementById('exportCSV').addEventListener('click', () => this.handleExportCSV());
        document.getElementById('exportPDF').addEventListener('click', () => this.handleExportPDF());
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
            this.loadDashboard();
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

            this.showLoginSuccess('Authentifizierung erfolgreich! Daten werden geladen...');
            
            // Load dashboard data
            setTimeout(() => this.loadDashboard(), 1000);
        } catch (error) {
            this.showLoginError(`Fehler: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
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

            const data = await DataService.loadAllData();
            UIRenderer.renderDashboard(data);
            
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

    handleClearCookies() {
        if (confirm('Cookies wirklich löschen? Sie müssen sich dann erneut anmelden.')) {
            CookieManager.clear();
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            this.showLoginSuccess('Cookies gelöscht');
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
        this.showLoginSuccess('Erfolgreich abgemeldet');
    },

    handleExportCSV() {
        if (!this.currentData) {
            this.showLoginError('Keine Daten zum Exportieren vorhanden');
            return;
        }
        ExportService.downloadCSV(this.currentData);
        this.showLoginSuccess('CSV-Export erfolgreich gestartet');
    },

    handleExportPDF() {
        if (!this.currentData) {
            this.showLoginError('Keine Daten zum Exportieren vorhanden');
            return;
        }
        ExportService.downloadPDF(this.currentData);
        this.showLoginSuccess('PDF-Export erfolgreich gestartet');
    },

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
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

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
