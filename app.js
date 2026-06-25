// ============================================================================
// FortiToken Reporting Application
// API Endpoints & Configuration
// ============================================================================

const API_CONFIG = {
    authEndpoint: 'https://customerapiauth.fortinet.com/api/v1/oauth/token/',
    iamEndpoint: 'https://support.fortinet.com/es/api/iam/v1',
    flexEndpoint: 'https://support.fortinet.com/es/api/fortiflex/v2',
    clientId: 'flexvm',
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
    }
};

// ============================================================================
// API Client
// ============================================================================

const APIClient = {
    token: null,
    tokenExpiry: null,

    async getToken(username, password) {
        try {
            const response = await fetch(API_CONFIG.authEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: username,
                    password: password,
                    client_id: API_CONFIG.clientId,
                    grant_type: API_CONFIG.grantType
                })
            });

            if (!response.ok) {
                throw new Error(`Authentication failed: ${response.statusText}`);
            }

            const data = await response.json();
            this.token = data.access_token;
            this.tokenExpiry = Date.now() + (data.expires_in * 1000);
            
            // Save token to cookie
            CookieManager.set('token', this.token, 7);
            CookieManager.set('tokenExpiry', this.tokenExpiry.toString(), 7);
            
            return this.token;
        } catch (error) {
            console.error('Token retrieval error:', error);
            throw error;
        }
    },

    async request(endpoint, method = 'POST', body = {}) {
        if (!this.token) {
            throw new Error('No token available');
        }

        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        };

        if (method === 'POST' || method === 'PUT') {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(endpoint, options);

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
        pointsData: {}
    },

    async loadAllData() {
        try {
            // Load programs
            const programsResponse = await APIClient.getProgramsList();
            this.data.programs = programsResponse.programs || [];

            // Load accounts
            const commonData = await APIClient.getCommonData();
            await this.loadAccountsRecursively(commonData.organizationUnits, null);

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
            this.data.configurations[programSerial] = configsResponse.configs || [];

            // Load entitlements and points for each config
            for (const config of this.data.configurations[programSerial]) {
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

            for (const config of configs) {
                const entitlements = data.entitlements[config.id] || [];
                const configPoints = this.calculateConfigPoints(data, config.id);
                
                html += `
                    <div class="account-card" data-config-id="${config.id}">
                        <div class="account-header">
                            <div>
                                <div class="account-name">
                                    <span class="toggle-icon">▶</span>
                                    ${config.name}
                                </div>
                                <div class="account-id">Config ID: ${config.id} | Produkt: ${config.productType?.name || 'N/A'} | Status: ${config.status}</div>
                            </div>
                            <div>
                                <span class="config-status status-active">${entitlements.length} Entitlements</span>
                                <span class="account-points">${configPoints.toLocaleString('de-DE')} Punkte</span>
                            </div>
                        </div>
                        <div class="config-list">
                            ${this.renderEntitlements(entitlements)}
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
        document.querySelectorAll('.account-card').forEach(card => {
            card.addEventListener('click', function(e) {
                if (e.target.closest('.toggle-icon') || !e.target.closest('.account-points')) {
                    this.classList.toggle('expanded');
                    this.querySelector('.config-list').style.display = 
                        this.classList.contains('expanded') ? 'block' : 'none';
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

        if (savedToken && savedTokenExpiry && Date.now() < parseInt(savedTokenExpiry)) {
            APIClient.token = savedToken;
            APIClient.tokenExpiry = parseInt(savedTokenExpiry);
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
            // Get token
            await APIClient.getToken(username, password);
            
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
