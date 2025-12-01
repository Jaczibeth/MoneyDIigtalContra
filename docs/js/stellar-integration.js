// Integración con Stellar Wallet para transferir tokens
// Nota: Este script requiere que StellarSdk esté cargado primero
class StellarIntegration {
    constructor() {
        this.RPC_URL = 'https://horizon-testnet.stellar.org';
        this.SOROBAN_RPC_URL = 'https://rpc-testnet.stellar.org';
        this.networkPassphrase = 'Test SDF Network ; September 2015'; // StellarSdk.Networks.TESTNET
    }

    // Verificar si Freighter está disponible
    isFreighterAvailable() {
        return typeof window.freighterApi !== 'undefined';
    }

    // Obtener clave pública del usuario desde localStorage o Freighter
    async getUserPublicKey() {
        // Intentar desde Freighter primero
        if (this.isFreighterAvailable()) {
            try {
                const isAllowed = await window.freighterApi.isAllowed();
                if (!isAllowed) {
                    await window.freighterApi.setAllowed();
                }
                return await window.freighterApi.getPublicKey();
            } catch (e) {
                console.warn('No se pudo obtener clave de Freighter:', e);
            }
        }

        // Fallback: desde localStorage
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        return currentUser.stellarPublic || null;
    }

    // Transferir tokens XLM a un usuario
    async transferTokens(recipientPublicKey, amount, memo = '') {
        try {
            // Verificar que StellarSdk esté cargado
            if (typeof StellarSdk === 'undefined') {
                throw new Error('Stellar SDK no está cargado. Por favor, recarga la página.');
            }

            const senderPublicKey = await this.getUserPublicKey();
            if (!senderPublicKey) {
                throw new Error('No hay wallet conectada');
            }

            const server = new StellarSdk.Server(this.RPC_URL);
            const senderAccount = await server.loadAccount(senderPublicKey);

            // Crear transacción
            const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
                fee: StellarSdk.BASE_FEE,
                networkPassphrase: StellarSdk.Networks.TESTNET
            })
            .addOperation(StellarSdk.Operation.payment({
                destination: recipientPublicKey,
                asset: StellarSdk.Asset.native(), // XLM
                amount: amount.toString()
            }))
            .addMemo(StellarSdk.Memo.text(memo || 'Tokens por actividad'))
            .setTimeout(30)
            .build();

            // Firmar con Freighter si está disponible
            if (this.isFreighterAvailable()) {
                const signedXdr = await window.freighterApi.signTransaction(transaction.toXDR(), {
                    network: StellarSdk.Networks.TESTNET,
                    accountToSign: senderPublicKey
                });
                const txFromXdr = StellarSdk.TransactionBuilder.fromXDR(signedXdr, StellarSdk.Networks.TESTNET);
                const result = await server.submitTransaction(txFromXdr);
                return { success: true, hash: result.hash };
            } else {
                // Usar clave secreta desde localStorage (solo para desarrollo)
                const stellarSecret = localStorage.getItem('stellarSecret');
                if (!stellarSecret) {
                    throw new Error('No se puede firmar la transacción. Conecta Freighter Wallet.');
                }
                const keypair = StellarSdk.Keypair.fromSecret(stellarSecret);
                transaction.sign(keypair);
                const result = await server.submitTransaction(transaction);
                return { success: true, hash: result.hash };
            }
        } catch (error) {
            console.error('Error en transferencia:', error);
            return { success: false, error: error.message };
        }
    }

    // Obtener balance de XLM de un usuario
    async getBalance(publicKey) {
        try {
            const server = new StellarSdk.Server(this.RPC_URL);
            const account = await server.loadAccount(publicKey);
            const balance = account.balances.find(b => b.asset_type === 'native');
            return balance ? parseFloat(balance.balance) : 0;
        } catch (error) {
            console.error('Error obteniendo balance:', error);
            return 0;
        }
    }

    // Convertir tokens del sistema a XLM (1 token = 0.1 XLM por ejemplo)
    tokensToXLM(tokens) {
        // 1 token = 0.1 XLM (ajustable)
        return (tokens * 0.1).toFixed(7);
    }
}

const stellarIntegration = new StellarIntegration();

