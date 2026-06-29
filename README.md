# FortiToken Reporting - User Documentation

## ⚠️ Disclaimer

**This is NOT an official Fortinet solution.** This tool is a community-developed application designed to help with FortiFlex token reporting. It is provided as-is without any warranty or support from Fortinet.

---

## General Idea

FortiToken Reporting is a web-based application that allows you to monitor and analyze your FortiFlex token consumption. It provides a user-friendly interface to:

- View your FortiFlex token usage across different accounts and configurations
- Monitor token entitlements and allocations
- Track token consumption patterns
- Export to CSV
- All neded information to bill consumption to endcustomers (MSSP)

The application connects to the Fortinet FortiIAM and FortiFlex APIs to retrieve real-time data about your token usage and account information.

---

## How to Use

### Option 1: Local File Usage

1. **Download the files**: Clone or download this repository to your local machine
2. **Open in browser**: 
   - Open the `index.html` file directly in your web browser
3. **Login and use**: Login with your API credentials

### Option 2: GitHub Pages

1. **Access online**: Visit the hosted version on GitHub Pages (if deployed)
3. **Same functionality**: All features work identically to the local version

### Option 3: Own Webserver
1. **Download the files**: Clone or download this repository
2. **Copy to your Webserver**: 
   - Copy the `index.html` and `app.js` to your webserver
   - Take care, that both files are in the same folder
3. **Open in Browser**: Open the webpage with your own Webserver Domain

### Getting Started

1. **Login**: Enter your generated API credentials (from the `API_Credentials_XXX.txt` file -> See `How to Create API Credentials`)
   - Username: appId
   - Password: password
2. **Retrieve Data**: Click the appropriate buttons to fetch:
   - Account Name and ID
   - FortiFlex Configurations
   - Token Entitlements
   - Points Consumtion
   - Entitlement Status
3. **View Results**: Data is displayed in interactive tables with sorting and filtering options
4. **Export Data**: Download the retrieved data as CSV for further analysis

---

### How to Create API Credentials

1. **Create API User**:
   - Create API User based on the following documentation: [FortiIAM API User](https://docs.fortinet.com/document/forticloud/26.2.0/identity-access-management-iam/927656/api-users)
   - Give the needed rights in the permission profile

3. **Download Credentials**:
   - After generation, download the credentials and save it secure
   - The text file is protected with your Fortinet Account password

#### Required API Permissions

- **Flex**: Read-Only
- **Organization**: Read-Only
- **IAM**: Account: Read-Only



---

## Security Concerns

### CORS (Cross-Origin Resource Sharing) Issue

The Fortinet APIs are not answer for OPTIONS (preflight) Browser requestions. The result is an **CORS restrictions** error message. This is a security feature of the browsers. That's the reason why the application is using an Proxy.


### Cloudflare Proxy Solution

This application uses a **Cloudflare Workers proxy** to bypass CORS restrictions / Browsers preflight check:

1. **How it works**:
   - Your request is sent to the Cloudflare Worker endpoint (the cloudflare worker answer the browser's preflight check)
   - The worker forwards your request to Fortinet's API servers
   - The response is returned to your browser with proper CORS headers
   - Your credentials are handled securely

2. **Security considerations**:
   - The proxy worker is configured to forward requests only to Fortinet's official APIs
   - Credentials are transmitted over HTTPS (encrypted)
   - The proxy does not store or log your data

3. **Alternative**: Self-hosted Proxy
   - Not developed yet

### Session Management
- **Auto-save**: Credentials are automatically saved to browser cookies (only for hosted version)
- **Session Expiry**: Tokens automatically refresh when expired
- **Logout**: Clear all stored data and credentials

---

## Technical Details

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│         FortiToken Reporting Web Application            │
│                  (index.html + app.js)                  │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
                  ┌────────────────────┐
                  │  Cloudflare Worker │
                  │   (CORS Proxy)     │
                  └────────────────────┘
                           │
                           ▼
                  ┌────────────────────┐
                  │  Fortinet APIs     │
                  │  - FortiIAM        │
                  │  - FortiFlex       │
                  │  - OAuth           │
                  └────────────────────┘
```

### Browser Compatibility

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Data Storage

- **Credentials**: Stored in browser cookies (encrypted, 30-day expiry)
- **Tokens**: Cached in memory during session
- **API Data**: Displayed in tables, not persisted locally (except exports)

---

## Troubleshooting

### Login Issues
- Verify your Fortinet credentials are correct
- Check that your account has API permissions enabled
- Ensure you're not using a VPN that blocks Fortinet APIs

### Data Not Loading
- Check browser console for error messages (F12 → Console tab)
- Verify your API token hasn't expired (re-login)
- Check Fortinet API status
- Verify Cloudflare Worker is accessible


---

## Support

This is a community tool. For issues related to:

- **This application**: Check the GitHub repository issues or contact the developer

---

**Last Updated**: June 2026

**Version**: 1.0
