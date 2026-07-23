const serverUrl = process.env.CAPACITOR_SERVER_URL || 'http://10.0.2.2:3000';
const production = process.env.NODE_ENV === 'production';

module.exports = {
    appId: 'com.portefeuille.demo',
    appName: 'Portefeuille Demo',
    webDir: 'public',
    loggingBehavior: production ? 'none' : 'debug',
    server: {
        url: serverUrl,
        cleartext: serverUrl.startsWith('http://')
    },
    android: {
        useLegacyBridge: true
    },
    plugins: {
        CapacitorHttp: {
            enabled: true
        }
    }
};
